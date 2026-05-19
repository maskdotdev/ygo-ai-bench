import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelResponse } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeNormal = 0x10;
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Triangle Power base stat End Phase destroy", () => {
  it("restores base ATK/DEF boosts for Level 1 Normal monsters and destroys them at End Phase", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const trianglePowerCode = "32298781";
    const boostedAttackerCode = "322987810";
    const boostedAllyCode = "322987811";
    const levelTwoNormalCode = "322987812";
    const effectLevelOneCode = "322987813";
    const defenderCode = "322987814";
    const responderCode = "322987815";
    const script = workspace.readScript(`c${trianglePowerCode}.lua`);
    expect(script).toContain("local tpe=c:GetType()");
    expect(script).toContain("(tpe&TYPE_NORMAL)~=0 and (tpe&TYPE_TOKEN)==0 and c:GetLevel()==1");
    expect(script).toContain("e1:SetCode(EFFECT_SET_BASE_ATTACK)");
    expect(script).toContain("e1:SetValue(tc:GetBaseAttack()+2000)");
    expect(script).toContain("e2:SetCode(EFFECT_SET_BASE_DEFENSE)");
    expect(script).toContain("e2:SetValue(tc:GetBaseDefense()+2000)");
    expect(script).toContain("de:SetCode(EVENT_PHASE+PHASE_END)");
    expect(script).toContain("Duel.Destroy(g,REASON_EFFECT)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === trianglePowerCode),
      { code: boostedAttackerCode, name: "Triangle Power Level 1 Normal Attacker", kind: "monster", typeFlags: typeMonster | typeNormal, level: 1, attack: 500, defense: 400 },
      { code: boostedAllyCode, name: "Triangle Power Level 1 Normal Ally", kind: "monster", typeFlags: typeMonster | typeNormal, level: 1, attack: 300, defense: 200 },
      { code: levelTwoNormalCode, name: "Triangle Power Level 2 Normal Decoy", kind: "monster", typeFlags: typeMonster | typeNormal, level: 2, attack: 900, defense: 800 },
      { code: effectLevelOneCode, name: "Triangle Power Level 1 Effect Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, level: 1, attack: 700, defense: 600 },
      { code: defenderCode, name: "Triangle Power Battle Defender", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Triangle Power Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 3229, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [trianglePowerCode, boostedAttackerCode, boostedAllyCode, levelTwoNormalCode, effectLevelOneCode] },
      1: { main: [defenderCode, responderCode] },
    });
    startDuel(session);

    const trianglePower = session.state.cards.find((card) => card.code === trianglePowerCode);
    const boostedAttacker = session.state.cards.find((card) => card.code === boostedAttackerCode);
    const boostedAlly = session.state.cards.find((card) => card.code === boostedAllyCode);
    const levelTwoNormal = session.state.cards.find((card) => card.code === levelTwoNormalCode);
    const effectLevelOne = session.state.cards.find((card) => card.code === effectLevelOneCode);
    const defender = session.state.cards.find((card) => card.code === defenderCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(trianglePower).toBeDefined();
    expect(boostedAttacker).toBeDefined();
    expect(boostedAlly).toBeDefined();
    expect(levelTwoNormal).toBeDefined();
    expect(effectLevelOne).toBeDefined();
    expect(defender).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, trianglePower!.uid, "hand", 0);
    moveDuelCard(session.state, boostedAttacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, boostedAlly!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, levelTwoNormal!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, effectLevelOne!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, defender!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(trianglePowerCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredActivation = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredActivation);
    expectRestoredLegalActions(restoredActivation, 0);
    expect(getLuaRestoreLegalActions(restoredActivation, 0)).toEqual(getDuelLegalActions(restoredActivation.session, 0));
    const activation = getLuaRestoreLegalActions(restoredActivation, 0).find((action) => action.type === "activateEffect" && action.uid === trianglePower!.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredActivation, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredActivation, activation!);
    expect(restoredActivation.session.state.chain).toHaveLength(1);
    expect(getLuaRestoreLegalActions(restoredActivation, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredActivation.session), source, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 1);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("triangle power responder resolved");
    assertTrianglePowerStats(restoredChain, boostedAttacker!.uid, boostedAlly!.uid, levelTwoNormal!.uid, effectLevelOne!.uid);
    expect(restoredChain.session.state.effects.filter((effect) => effect.event === "continuous" && effect.sourceUid === boostedAttacker!.uid && [103, 107].includes(effect.code ?? -1))).toHaveLength(2);
    expect(restoredChain.session.state.effects.some((effect) => effect.event === "continuous" && effect.triggerEvent === "phaseEnd" && effect.sourceUid === trianglePower!.uid)).toBe(true);

    const restoredStats = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expectCleanRestore(restoredStats);
    expectRestoredLegalActions(restoredStats, 0);
    assertTrianglePowerStats(restoredStats, boostedAttacker!.uid, boostedAlly!.uid, levelTwoNormal!.uid, effectLevelOne!.uid);
    restoredStats.session.state.phase = "battle";
    restoredStats.session.state.turnPlayer = 0;
    restoredStats.session.state.waitingFor = 0;
    const attack = getLuaRestoreLegalActions(restoredStats, 0).find((action) => action.type === "declareAttack" && action.attackerUid === boostedAttacker!.uid && action.targetUid === defender!.uid);
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredStats, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredStats, attack!);
    passRestoredBattleResponses(restoredStats);
    expect(restoredStats.session.state.battleDamage).toEqual({ 0: 0, 1: 1500 });
    expect(restoredStats.session.state.players[1].lifePoints).toBe(6500);
    expect(restoredStats.session.state.cards.find((card) => card.uid === defender!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredStats.session.state.cards.find((card) => card.uid === boostedAttacker!.uid)).toMatchObject({ location: "monsterZone" });

    const restoredEnd = restoreDuelWithLuaScripts(serializeDuel(restoredStats.session), source, reader);
    expectCleanRestore(restoredEnd);
    expectRestoredLegalActions(restoredEnd, 0);
    restoredEnd.session.state.phase = "main2";
    restoredEnd.session.state.waitingFor = 0;
    const endPhase = getLuaRestoreLegalActions(restoredEnd, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredEnd, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEnd, endPhase!);
    expect(restoredEnd.session.state.eventHistory.filter((event) => event.eventName === "phaseEnd")).toEqual([{ eventName: "phaseEnd", eventCode: 0x1200 }]);
    expect(restoredEnd.session.state.cards.find((card) => card.uid === boostedAttacker!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredEnd.session.state.cards.find((card) => card.uid === boostedAlly!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredEnd.session.state.cards.find((card) => card.uid === levelTwoNormal!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restoredEnd.session.state.cards.find((card) => card.uid === effectLevelOne!.uid)).toMatchObject({ location: "monsterZone" });
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
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("triangle power responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function assertTrianglePowerStats(
  restored: ReturnType<typeof restoreDuelWithLuaScripts>,
  boostedAttackerUid: string,
  boostedAllyUid: string,
  levelTwoNormalUid: string,
  effectLevelOneUid: string,
): void {
  const state = restored.session.state;
  const boostedAttacker = state.cards.find((card) => card.uid === boostedAttackerUid);
  const boostedAlly = state.cards.find((card) => card.uid === boostedAllyUid);
  const levelTwoNormal = state.cards.find((card) => card.uid === levelTwoNormalUid);
  const effectLevelOne = state.cards.find((card) => card.uid === effectLevelOneUid);
  expect(currentAttack(boostedAttacker, state)).toBe(2500);
  expect(currentDefense(boostedAttacker, state)).toBe(2400);
  expect(currentAttack(boostedAlly, state)).toBe(2300);
  expect(currentDefense(boostedAlly, state)).toBe(2200);
  expect(currentAttack(levelTwoNormal, state)).toBe(900);
  expect(currentDefense(levelTwoNormal, state)).toBe(800);
  expect(currentAttack(effectLevelOne, state)).toBe(700);
  expect(currentDefense(effectLevelOne, state)).toBe(600);
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
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

function passRestoredBattleResponses(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}
