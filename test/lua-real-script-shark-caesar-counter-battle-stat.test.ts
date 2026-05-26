import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const sharkCode = "14306092";
const materialCode = "143060920";
const defenderCode = "143060921";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSharkScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${sharkCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceFish = 0x80;
const raceWarrior = 0x1;
const attributeWater = 0x2;
const attributeEarth = 0x1;
const counterShark = 0x2e;
const effectXyzMaterial = 31;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasSharkScript)("Lua real script Shark Caesar counter battle stat", () => {
  it("restores Xyz detach counter placement into battle-only ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${sharkCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredOpen = createRestoredOpen(reader, workspace);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const shark = requireCard(restoredOpen.session, sharkCode);
    const material = requireCard(restoredOpen.session, materialCode);
    const defender = requireCard(restoredOpen.session, defenderCode);
    const baseAttack = shark.data.attack ?? 0;
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === shark.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      luaConditionDescriptor: effect.luaConditionDescriptor,
      luaValueDescriptor: effect.luaValueDescriptor,
      range: effect.range,
    }))).toEqual([
      { category: undefined, code: 0x10000 + counterShark, countLimit: undefined, event: "continuous", id: "lua-1-65582", luaConditionDescriptor: undefined, luaValueDescriptor: undefined, range: ["monsterZone"] },
      { category: undefined, code: effectXyzMaterial, countLimit: undefined, event: "continuous", id: "lua-2-31", luaConditionDescriptor: undefined, luaValueDescriptor: undefined, range: ["monsterZone"] },
      { category: 0x800000, code: undefined, countLimit: 1, event: "ignition", id: "lua-3", luaConditionDescriptor: undefined, luaValueDescriptor: undefined, range: ["monsterZone"] },
      { category: undefined, code: effectUpdateAttack, countLimit: undefined, event: "continuous", id: "lua-4-100", luaConditionDescriptor: undefined, luaValueDescriptor: undefined, range: ["monsterZone"] },
    ]);
    expect(currentAttack(findCard(restoredOpen.session, shark.uid), restoredOpen.session.state)).toBe(baseAttack);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === shark.uid && action.effectId === "lua-3");
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    resolveRestoredChain(restoredOpen);

    expect(findCard(restoredOpen.session, shark.uid).overlayUids).toEqual([]);
    expect(findCard(restoredOpen.session, material.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: shark.uid,
      reasonEffectId: 3,
    });
    expect(getDuelCardCounter(findCard(restoredOpen.session, shark.uid), counterShark)).toBe(1);
    expect(currentAttack(findCard(restoredOpen.session, shark.uid), restoredOpen.session.state)).toBe(baseAttack);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["sentToGraveyard", "detachedMaterial", "counterAdded"].includes(event.eventName)).map((event) => eventSummary(event))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: material.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: shark.uid, eventReasonEffectId: 3 },
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: material.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: shark.uid, eventReasonEffectId: 3 },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: shark.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: shark.uid, eventReasonEffectId: 3 },
    ]);

    const restoredCountered = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredCountered);
    restoredCountered.session.state.phase = "battle";
    restoredCountered.session.state.turnPlayer = 0;
    restoredCountered.session.state.waitingFor = 0;
    declareAndPassToDamage(restoredCountered.session, shark.uid, defender.uid);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(restoredCountered.session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expect(restoredBattle.session.state.battleWindow?.kind).toBe("duringDamageCalculation");
    expect(currentAttack(findCard(restoredBattle.session, shark.uid), restoredBattle.session.state)).toBe(baseAttack + 1000);
    passRestoredBattleResponses(restoredBattle);
    expect(restoredBattle.session.state.battleDamage).toEqual({ 0: 0, 1: (baseAttack + 1000) - (defender.data.attack ?? 0) });
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const shark = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === sharkCode);
  expect(shark).toBeDefined();
  return [
    shark!,
    { code: materialCode, name: "Shark Caesar Xyz Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFish, attribute: attributeWater, level: 3, attack: 800, defense: 1000 },
    { code: defenderCode, name: "Shark Caesar Battle Defender", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 2500, defense: 1000 },
  ];
}

function createRestoredOpen(reader: ReturnType<typeof createCardReader>, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 14306092, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [materialCode], extra: [sharkCode] }, 1: { main: [defenderCode] } });
  startDuel(session);
  const shark = requireCard(session, sharkCode);
  const material = requireCard(session, materialCode);
  moveFaceUpAttack(session, shark, 0, 0);
  shark.summonType = "xyz";
  shark.summonTypeCode = 0x49000000;
  moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
  shark.overlayUids.push(material.uid);
  moveFaceUpAttack(session, requireCard(session, defenderCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(sharkCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Shark Caesar");
  expect(script).toContain("c:EnableCounterPermit(0x2e)");
  expect(script).toContain("Xyz.AddProcedure(c,nil,3,3,nil,nil,5)");
  expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1))");
  expect(script).toContain("c:AddCounter(0x2e,1)");
  expect(script).toContain("Duel.GetCurrentPhase()");
  expect(script).toContain("Duel.GetAttacker()==e:GetHandler() or Duel.GetAttackTarget()==e:GetHandler()");
  expect(script).toContain("return c:GetCounter(0x2e)*1000");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function eventSummary(event: { eventName: string; eventCode?: number; eventCardUid?: string; eventReason?: number; eventReasonPlayer?: PlayerId; eventReasonCardUid?: string; eventReasonEffectId?: number }) {
  return {
    eventName: event.eventName,
    eventCode: event.eventCode,
    eventCardUid: event.eventCardUid,
    eventReason: event.eventReason,
    eventReasonPlayer: event.eventReasonPlayer,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
  };
}

function declareAndPassToDamage(session: DuelSession, attackerUid: string, targetUid: string): void {
  const attack = getLegalActions(session, session.state.waitingFor ?? session.state.turnPlayer).find(
    (action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid,
  );
  expect(attack, JSON.stringify(getLegalActions(session, session.state.waitingFor ?? session.state.turnPlayer), null, 2)).toBeDefined();
  applyAndAssert(session, attack!);
  passUntilBattleWindow(session, "duringDamageCalculation");
}

function passUntilBattleWindow(session: DuelSession, kind: NonNullable<DuelSession["state"]["battleWindow"]>["kind"]): void {
  let guard = 0;
  while (session.state.battleWindow?.kind !== kind) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
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
    const result = applyLuaRestoreResponse(restored, pass!);
    expect(result.ok, result.error).toBe(true);
  }
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
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
