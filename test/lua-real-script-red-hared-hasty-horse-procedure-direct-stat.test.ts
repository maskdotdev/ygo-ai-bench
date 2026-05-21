import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const horseCode = "19636995";
const defenderCode = "196369950";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasHorseScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${horseCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceBeast = 0x4000;
const raceWarrior = 0x1;
const attributeWind = 0x10;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasHorseScript)("Lua real script Red Hared Hasty Horse procedure direct stat", () => {
  it("restores hand Special Summon procedure into base-ATK halving and direct attack permission", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${horseCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
    expect(script).toContain("e1:SetProperty(EFFECT_FLAG_UNCOPYABLE+EFFECT_FLAG_SPSUM_PARAM)");
    expect(script).toContain("e1:SetTargetRange(POS_FACEUP_ATTACK,0)");
    expect(script).toContain("Duel.GetFieldGroup(tp,LOCATION_ONFIELD,LOCATION_ONFIELD)");
    expect(script).toContain("tc:GetColumnZone(LOCATION_MZONE,0,0,tp)");
    expect(script).toContain("e2:SetCode(EVENT_MOVE)");
    expect(script).toContain("return #(e:GetHandler():GetColumnGroup()&eg)>0");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DESTROY,e:GetHandler(),1,0,0)");
    expect(script).toContain("e3:SetType(EFFECT_TYPE_IGNITION)");
    expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,e:GetHandler(),1,0,0)");
    expect(script).toContain("e1:SetCode(EFFECT_SET_BASE_ATTACK)");
    expect(script).toContain("e1:SetValue(c:GetBaseAttack()/2)");
    expect(script).toContain("e2:SetDescription(3205)");
    expect(script).toContain("e2:SetCode(EFFECT_DIRECT_ATTACK)");

    const reader = createCardReader(cards());
    const session = createDuel({ seed: 19636995, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [horseCode] }, 1: { main: [defenderCode] } });
    startDuel(session);

    const horse = requireCard(session, horseCode);
    const defender = requireCard(session, defenderCode);
    moveDuelCard(session.state, horse.uid, "hand", 0);
    moveFaceUpAttack(session, defender, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(horseCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredProcedure = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredProcedure);
    expectRestoredLegalActions(restoredProcedure, 0);
    const procedure = getLuaRestoreLegalActions(restoredProcedure, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === horse.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restoredProcedure, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredProcedure, procedure!);
    expect(restoredProcedure.session.state.cards.find((card) => card.uid === horse.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
    });
    expect(restoredProcedure.session.state.eventHistory.filter((event) => ["specialSummoned", "moved"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventPlayer: event.eventPlayer,
      eventReasonPlayer: event.eventReasonPlayer,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: horse.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventPlayer: undefined, eventReasonPlayer: 0, previousLocation: "hand", currentLocation: "monsterZone" },
    ]);

    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredProcedure.session), workspace, reader);
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const ignition = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) => action.type === "activateEffect" && action.uid === horse.uid);
    expect(ignition, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    expect(JSON.stringify(ignition)).not.toContain("operationInfos");
    applyRestoredActionAndAssert(restoredIgnition, ignition!);
    resolveRestoredChain(restoredIgnition);

    expect(currentAttack(restoredIgnition.session.state.cards.find((card) => card.uid === horse.uid), restoredIgnition.session.state)).toBe(1000);
    expect(restoredIgnition.session.state.effects.filter((effect) => effect.sourceUid === horse.uid && [74, 103].includes(effect.code ?? -1)).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      reset: effect.reset,
      value: effect.value,
    }))).toEqual([
      { code: 103, event: "continuous", property: undefined, reset: { flags: 1107169792 }, value: 1000 },
      { code: 74, event: "continuous", property: 0x4000000, reset: { flags: 1107169792 }, value: undefined },
    ]);

    restoredIgnition.session.state.phase = "battle";
    restoredIgnition.session.state.waitingFor = 0;
    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredIgnition.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 0);
    const battleActions = getLuaRestoreLegalActions(restoredBattle, 0);
    expect(battleActions.some((action) => action.type === "declareAttack" && action.attackerUid === horse.uid && action.targetUid === defender.uid)).toBe(true);
    const directAttack = battleActions.find((action) => action.type === "declareAttack" && action.attackerUid === horse.uid && action.directAttack);
    expect(directAttack, JSON.stringify(battleActions, null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattle, directAttack!);
    passBattle(restoredBattle);
    expect(restoredBattle.session.state.players[1].lifePoints).toBe(7000);
    expect(restoredBattle.session.state.cards.find((card) => card.uid === defender.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredBattle.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt").map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
    }))).toEqual([
      { eventName: "battleDamageDealt", eventCode: 1143, eventCardUid: horse.uid, eventPlayer: 1, eventValue: 1000, eventReasonPlayer: 0, eventReasonCardUid: horse.uid },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: horseCode, name: "Red Hared Hasty Horse", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeWind, level: 5, attack: 2000, defense: 1800 },
    { code: defenderCode, name: "Red Hared Defender Fixture", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1200, defense: 1200 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function passBattle(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle) {
    expect(++guard).toBeLessThan(30);
    if (restored.session.state.chain.length > 0) {
      resolveRestoredChain(restored);
      continue;
    }
    if (restored.session.state.pendingTriggers.length > 0) break;
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}
