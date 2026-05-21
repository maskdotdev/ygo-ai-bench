import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentBaseAttack, currentBaseDefense, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { ApplyDuelResponseResult, DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Shield & Sword swap base ATK/DEF", () => {
  it("restores SetTargetCard group activation into temporary EFFECT_SWAP_BASE_AD for all face-up monsters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const shieldSwordCode = "52097679";
    const ownMonsterCode = "520976790";
    const opponentMonsterCode = "520976791";
    const facedownMonsterCode = "520976792";
    const responderCode = "520976793";
    const script = workspace.readScript(`c${shieldSwordCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DEFCHANGE)");
    expect(script).toContain("e1:SetType(EFFECT_TYPE_ACTIVATE)");
    expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
    expect(script).toContain("Duel.SetTargetCard(g)");
    expect(script).toContain("c:IsFaceup() and c:IsRelateToEffect(e) and not c:IsImmuneToEffect(e)");
    expect(script).toContain("e1:SetCode(EFFECT_SWAP_BASE_AD)");
    expect(script).toContain("e1:SetReset(RESETS_STANDARD_PHASE_END)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === shieldSwordCode),
      { code: ownMonsterCode, name: "Shield Sword Own Face-up Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 900 },
      { code: opponentMonsterCode, name: "Shield Sword Opponent Face-up Monster", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1200, defense: 2100 },
      { code: facedownMonsterCode, name: "Shield Sword Facedown Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1900, defense: 400 },
      { code: responderCode, name: "Shield Sword Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 52097679, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [shieldSwordCode, ownMonsterCode, facedownMonsterCode] }, 1: { main: [responderCode, opponentMonsterCode] } });
    startDuel(session);

    const shieldSword = requireCard(session, shieldSwordCode);
    const ownMonster = requireCard(session, ownMonsterCode);
    const opponentMonster = requireCard(session, opponentMonsterCode);
    const facedownMonster = requireCard(session, facedownMonsterCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, shieldSword.uid, "hand", 0);
    moveMonster(session, ownMonster.uid, 0, 0, true);
    moveMonster(session, opponentMonster.uid, 1, 0, true);
    moveMonster(session, facedownMonster.uid, 0, 1, false);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(shieldSwordCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    const activate = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === shieldSword.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activate!);
    expect(restoredActivation.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1-1002",
        sourceUid: shieldSword.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        targetUids: [ownMonster.uid, opponentMonster.uid],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("shield sword responder resolved");
    expect(restoredChain.session.state.effects
      .filter((effect) => effect.code === 110)
      .map((effect) => ({
        event: effect.event,
        registryKey: effect.registryKey,
        sourceUid: effect.sourceUid,
        range: effect.range,
        reset: effect.reset,
      }))).toEqual([
        {
          event: "continuous",
          registryKey: "lua:52097679:lua-3-110",
          sourceUid: ownMonster.uid,
          range: ["monsterZone"],
          reset: { flags: 1107169792 },
        },
        {
          event: "continuous",
          registryKey: "lua:52097679:lua-4-110",
          sourceUid: opponentMonster.uid,
          range: ["monsterZone"],
          reset: { flags: 1107169792 },
        },
      ]);
    expect(currentBaseAttack(ownMonster, restoredChain.session.state)).toBe(900);
    expect(currentBaseDefense(ownMonster, restoredChain.session.state)).toBe(1600);
    expect(currentAttack(ownMonster, restoredChain.session.state)).toBe(900);
    expect(currentDefense(ownMonster, restoredChain.session.state)).toBe(1600);
    expect(currentBaseAttack(opponentMonster, restoredChain.session.state)).toBe(2100);
    expect(currentBaseDefense(opponentMonster, restoredChain.session.state)).toBe(1200);
    expect(currentAttack(opponentMonster, restoredChain.session.state)).toBe(2100);
    expect(currentDefense(opponentMonster, restoredChain.session.state)).toBe(1200);
    expect(currentAttack(facedownMonster, restoredChain.session.state)).toBe(1900);
    expect(currentDefense(facedownMonster, restoredChain.session.state)).toBe(400);

    const restoredSwap = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredSwap);
    expectRestoredLegalActions(restoredSwap, 0);
    expect(currentAttack(ownMonster, restoredSwap.session.state)).toBe(900);
    expect(currentDefense(ownMonster, restoredSwap.session.state)).toBe(1600);
    expect(currentAttack(opponentMonster, restoredSwap.session.state)).toBe(2100);
    expect(currentDefense(opponentMonster, restoredSwap.session.state)).toBe(1200);

    restoredSwap.session.state.phase = "battle";
    restoredSwap.session.state.waitingFor = 0;
    expect(currentAttack(ownMonster, restoredSwap.session.state)).toBe(900);
    expect(currentAttack(opponentMonster, restoredSwap.session.state)).toBe(2100);
    const attack = getLuaRestoreLegalActions(restoredSwap, 0).find((action) => action.type === "declareAttack" && action.attackerUid === ownMonster.uid && action.targetUid === opponentMonster.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredSwap, 0), null, 2)).toBeDefined();
    applyAndAssert(restoredSwap.session, attack!);
    expect(currentAttack(ownMonster, restoredSwap.session.state)).toBe(900);
    expect(currentAttack(opponentMonster, restoredSwap.session.state)).toBe(2100);
    passBattleResponses(restoredSwap.session);
    expect(restoredSwap.session.state.battleDamage[0]).toBe(1200);
    expect(restoredSwap.session.state.players[0].lifePoints).toBe(6800);
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveMonster(session: DuelSession, uid: string, player: 0 | 1, sequence: number, faceUp: boolean): void {
  const moved = moveDuelCard(session.state, uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = faceUp;
  moved.position = faceUp ? "faceUpAttack" : "faceDownDefense";
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("shield sword responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction): ApplyDuelResponseResult {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
  return response;
}

function passBattleResponses(session: DuelSession): void {
  let guard = 0;
  while (session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
