import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentAttack } from "#duel/card-stats.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const ashenveilCode = "12235475";
const hasAshenveilScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${ashenveilCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasAshenveilScript)("Lua real script Fabled Ashenveil Damage Step boost", () => {
  it("restores its hand cost and pre-damage calculation ATK boost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const discardCode = "12235476";
    const defenderCode = "12235477";
    const responderCode = "12235478";
    const script = workspace.readScript(`c${ashenveilCode}.lua`);
    expect(script).toContain("e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)");
    expect(script).toContain("Duel.SendtoGrave(g,REASON_COST)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(600)");
    const cards: DuelCardData[] = [
      { code: ashenveilCode, name: "Fabled Ashenveil", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1200 },
      { code: discardCode, name: "Fabled Ashenveil Cost", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: defenderCode, name: "Fabled Ashenveil Defender", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1000 },
      { code: responderCode, name: "Fabled Ashenveil Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1223, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ashenveilCode, discardCode] }, 1: { main: [defenderCode, responderCode] } });
    startDuel(session);

    const ashenveil = requireCard(session, ashenveilCode);
    const discard = requireCard(session, discardCode);
    const defender = requireCard(session, defenderCode);
    const responder = requireCard(session, responderCode);
    moveFaceUpAttack(session, ashenveil, 0);
    moveDuelCard(session.state, discard.uid, "hand", 0);
    moveFaceUpAttack(session, defender, 1);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ashenveilCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredSetup = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredSetup);
    expectRestoredLegalActions(restoredSetup, 0);
    const attack = getLuaRestoreLegalActions(restoredSetup, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === ashenveil.uid && action.targetUid === defender.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredSetup, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSetup, attack!);
    passRestoredBattleAction(restoredSetup, 1, "passAttack");
    passRestoredBattleAction(restoredSetup, 0, "passAttack");

    const restoredDamageStep = restoreDuelWithLuaScripts(serializeDuel(restoredSetup.session), source, reader);
    expectCleanRestore(restoredDamageStep);
    expectRestoredLegalActions(restoredDamageStep, 1);
    passRestoredBattleAction(restoredDamageStep, 1, "passDamage");
    expect(restoredDamageStep.session.state.battleWindow?.kind).toBe("startDamageStep");
    expect(restoredDamageStep.session.state.waitingFor).toBe(0);
    passRestoredBattleAction(restoredDamageStep, 0, "passDamage");
    expect(restoredDamageStep.session.state.battleWindow?.kind).toBe("beforeDamageCalculation");
    expect(restoredDamageStep.session.state.waitingFor).toBe(1);
    passRestoredBattleAction(restoredDamageStep, 1, "passDamage");
    expect(restoredDamageStep.session.state.waitingFor).toBe(0);

    const activation = getLuaRestoreLegalActions(restoredDamageStep, 0).find((action) => action.type === "activateEffect" && action.uid === ashenveil.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredDamageStep, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDamageStep, activation!);
    expect(restoredDamageStep.session.state.cards.find((card) => card.uid === discard.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredDamageStep.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === discard.uid)).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: discard.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: ashenveil.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
      },
    ]);
    expect(restoredDamageStep.session.state.chain).toHaveLength(1);
    expect(restoredDamageStep.session.state.chain[0]?.operationInfos ?? []).toEqual([]);
    expect(getLuaRestoreLegalActions(restoredDamageStep, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredDamageStep.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    const passChain = getLuaRestoreLegalActions(restoredChain, 1).find((action) => action.type === "passChain");
    expect(passChain, JSON.stringify(getLuaRestoreLegalActions(restoredChain, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredChain, passChain!);
    const boostedAshenveil = restoredChain.session.state.cards.find((card) => card.uid === ashenveil.uid);
    expect(currentAttack(boostedAshenveil, restoredChain.session.state)).toBe((ashenveil.data.attack ?? 0) + 600);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 1);
    expect(currentAttack(restoredBattle.session.state.cards.find((card) => card.uid === ashenveil.uid), restoredBattle.session.state)).toBe((ashenveil.data.attack ?? 0) + 600);
    passBattleResponses(restoredBattle);
    expect(restoredBattle.session.state.battleDamage[1]).toBe((ashenveil.data.attack ?? 0) + 600 - (defender.data.attack ?? 0));
    expect(restoredBattle.session.state.players[1].lifePoints).toBe(8000 - restoredBattle.session.state.battleDamage[1]!);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredBattle.host.messages).not.toContain("ashenveil responder resolved");
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetProperty(EFFECT_FLAG_DAMAGE_STEP)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("ashenveil responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function moveFaceUpAttack(session: DuelSession, card: DuelSession["state"]["cards"][number], player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function passRestoredBattleAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1, type: "passAttack" | "passDamage"): void {
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === type);
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, pass!);
}

function passBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle || restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    if (restored.session.state.chain.length > 0) {
      const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
      expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
      applyRestoredActionAndAssert(restored, pass!);
      continue;
    }
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
