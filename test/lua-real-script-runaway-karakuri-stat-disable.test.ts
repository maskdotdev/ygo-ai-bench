import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { isCardDisabled } from "#duel/continuous-effects.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createEffectContext } from "#duel/effect-context.js";
import type { DuelAction, DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const runawayCode = "83831356";
const hasRunawayScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${runawayCode}.lua`));
const karakuriCode = "838313560";
const decoyCode = "838313561";
const targetCode = "838313562";
const responderCode = "838313563";
const typeMonster = 0x1;
const typeEffect = 0x20;
const setKarakuri = 0x11;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasRunawayScript)("Lua real script Runaway Karakuri stat disable", () => {
  it("restores Karakuri target disable and ATK gain through battle outcome", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${runawayCode}.lua`);
    expect(script).toContain("e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_DISABLE)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)");
    expect(script).toContain("e1:SetCondition(aux.StatChangeDamageStepCondition)");
    expect(script).toContain("return c:IsFaceup() and c:IsSetCard(SET_KARAKURI)");
    expect(script).toContain("Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DISABLE,g,1,0,0)");
    expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
    expect(script).toContain("e1:SetValue(1000)");
    expect(script).toContain("e2:SetCode(EFFECT_DISABLE)");
    expect(script).toContain("e3:SetCode(EFFECT_DISABLE_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === runawayCode),
      { code: karakuriCode, name: "Runaway Karakuri Target", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [setKarakuri], level: 4, attack: 1500, defense: 1000 },
      { code: decoyCode, name: "Runaway Off-Set Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, setcodes: [0x123], level: 4, attack: 2400, defense: 1200 },
      { code: targetCode, name: "Runaway Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1800, defense: 1000 },
      { code: responderCode, name: "Runaway Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 83831356, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [runawayCode, karakuriCode, decoyCode] }, 1: { main: [targetCode, responderCode] } });
    startDuel(session);

    const runaway = requireCard(session, runawayCode);
    const karakuri = requireCard(session, karakuriCode);
    const decoy = requireCard(session, decoyCode);
    const battleTarget = requireCard(session, targetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, runaway.uid, "hand", 0);
    moveDuelCard(session.state, karakuri.uid, "monsterZone", 0);
    karakuri.position = "faceUpAttack";
    karakuri.faceUp = true;
    moveDuelCard(session.state, decoy.uid, "monsterZone", 0);
    decoy.position = "faceUpAttack";
    decoy.faceUp = true;
    moveDuelCard(session.state, battleTarget.uid, "monsterZone", 1);
    battleTarget.position = "faceUpAttack";
    battleTarget.faceUp = true;
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
    expect(host.loadCardScript(Number(runawayCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === runaway.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([
      {
        id: "chain-2",
        chainIndex: 1,
        effectId: "lua-1-1002",
        sourceUid: runaway.uid,
        player: 0,
        activationLocation: "hand",
        activationSequence: 0,
        targetFieldIds: [7],
        targetUids: [karakuri.uid],
        operationInfos: [{ category: 0x4000, count: 1, parameter: 0, player: 0, targetUids: [karakuri.uid] }],
      },
    ]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder.uid)).toBe(true);
    passChain(restoredChain, 1);
    expect(restoredChain.host.messages).not.toContain("runaway karakuri responder resolved");

    const boosted = requireCard(restoredChain.session, karakuriCode);
    const unboosted = requireCard(restoredChain.session, decoyCode);
    expect(currentAttack(boosted, restoredChain.session.state)).toBe(2500);
    expect(currentAttack(unboosted, restoredChain.session.state)).toBe(2400);
    expect(isCardDisabled(restoredChain.session.state, boosted, (effect, sourceCard, targetCard) =>
      createEffectContext(restoredChain.session.state, sourceCard, effect.controller, undefined, targetCard, [], true),
    )).toBe(true);
    expect(restoredChain.session.state.effects.filter((effect) => effect.sourceUid === boosted.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 100, event: "continuous", reset: { flags: 1107169792 }, value: 1000 },
      { code: 2, event: "continuous", reset: { flags: 1107169792 }, value: undefined },
      { code: 8, event: "continuous", reset: { flags: 1107169792 }, value: undefined },
    ]);
    expect(restoredChain.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);

    restoredChain.session.state.phase = "battle";
    restoredChain.session.state.waitingFor = 0;
    const attack = getLegalActions(restoredChain.session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === boosted.uid && action.targetUid === battleTarget.uid);
    expect(attack, JSON.stringify(getLegalActions(restoredChain.session, 0), null, 2)).toBeDefined();
    const attackResponse = applyResponse(restoredChain.session, attack!);
    expect(attackResponse.ok, attackResponse.error).toBe(true);
    passBattleResponses(restoredChain.session);
    expect(restoredChain.session.state.battleDamage).toEqual({ 0: 0, 1: 700 });
    expect(restoredChain.session.state.players[1].lifePoints).toBe(7300);
    expect(restoredChain.session.state.cards.find((card) => card.uid === boosted.uid)).toMatchObject({ location: "monsterZone" });
    expect(restoredChain.session.state.cards.find((card) => card.uid === battleTarget.uid)).toMatchObject({ location: "graveyard" });
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
      e:SetOperation(function(e,tp) Debug.Message("runaway karakuri responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function passChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
  expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyLuaRestoreAndAssert(restored, pass!);
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function passBattleResponses(session: DuelSession): void {
  let guard = 0;
  while (session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    const response = applyResponse(session, pass!);
    expect(response.ok, response.error).toBe(true);
    expect(response.legalActions).toEqual(getLegalActions(session, session.state.waitingFor ?? session.state.turnPlayer));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, session.state.waitingFor ?? session.state.turnPlayer));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}
