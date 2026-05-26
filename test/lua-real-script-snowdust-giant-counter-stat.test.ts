import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const snowdustCode = "73659078";
const materialCode = "736590780";
const waterHandA = "736590781";
const waterHandB = "736590782";
const nonWaterTargetCode = "736590783";
const waterTargetCode = "736590784";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasSnowdustScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${snowdustCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceAqua = 0x40;
const raceWarrior = 0x1;
const attributeWater = 0x2;
const attributeEarth = 0x1;
const counterIce = 0x1015;
const categoryCounter = 0x800000;
const effectXyzMaterial = 31;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasSnowdustScript)("Lua real script Snowdust Giant counter stat", () => {
  it("restores detach-cost Ice Counter placement into global non-WATER ATK reduction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${snowdustCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const restoredOpen = createRestoredOpen(reader, workspace);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);

    const snowdust = requireCard(restoredOpen.session, snowdustCode);
    const material = requireCard(restoredOpen.session, materialCode);
    const nonWaterTarget = requireCard(restoredOpen.session, nonWaterTargetCode);
    const waterTarget = requireCard(restoredOpen.session, waterTargetCode);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === snowdust.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      range: effect.range,
      targetRange: effect.targetRange,
    }))).toEqual([
      { category: undefined, code: effectXyzMaterial, countLimit: undefined, event: "continuous", id: "lua-1-31", range: ["monsterZone"], targetRange: undefined },
      { category: categoryCounter, code: undefined, countLimit: 1, event: "ignition", id: "lua-2", range: ["monsterZone"], targetRange: undefined },
      { category: undefined, code: effectUpdateAttack, countLimit: undefined, event: "continuous", id: "lua-3-100", range: ["monsterZone"], targetRange: [4, 4] },
    ]);

    expect(currentAttack(nonWaterTarget, restoredOpen.session.state)).toBe(1800);
    expect(currentAttack(waterTarget, restoredOpen.session.state)).toBe(1600);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === snowdust.uid && action.effectId === "lua-2");
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === snowdust.uid)?.overlayUids).toEqual([]);
    expect(restoredOpen.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: snowdust.uid,
      reasonEffectId: 2,
    });
    expect(getDuelCardCounter(restoredOpen.session.state.cards.find((card) => card.uid === snowdust.uid), counterIce)).toBe(2);
    expect(getDuelCardCounter(restoredOpen.session.state.cards.find((card) => card.uid === nonWaterTarget.uid), counterIce)).toBe(0);
    expect(getDuelCardCounter(restoredOpen.session.state.cards.find((card) => card.uid === waterTarget.uid), counterIce)).toBe(0);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === nonWaterTarget.uid), restoredOpen.session.state)).toBe(1400);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === waterTarget.uid), restoredOpen.session.state)).toBe(1600);

    const restoredStat = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === nonWaterTarget.uid), restoredStat.session.state)).toBe(1400);
    expect(restoredStat.session.state.eventHistory.filter((event) => ["sentToGraveyard", "detachedMaterial", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: material.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: snowdust.uid, eventReasonEffectId: 2 },
      { eventName: "detachedMaterial", eventCode: 1202, eventCardUid: material.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: snowdust.uid, eventReasonEffectId: 2 },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: snowdust.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: snowdust.uid, eventReasonEffectId: 2 },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: snowdust.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: snowdust.uid, eventReasonEffectId: 2 },
    ]);
  });
});

function createRestoredOpen(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 73659078, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [materialCode, waterHandA, waterHandB, waterTargetCode], extra: [snowdustCode] }, 1: { main: [nonWaterTargetCode] } });
  startDuel(session);
  const snowdust = requireCard(session, snowdustCode);
  const material = requireCard(session, materialCode);
  moveFaceUpAttack(session, snowdust, 0, 0);
  snowdust.summonType = "xyz";
  snowdust.summonTypeCode = 0x49000000;
  moveDuelCard(session.state, material.uid, "overlay", 0, duelReason.material | duelReason.xyz, 0);
  snowdust.overlayUids.push(material.uid);
  moveDuelCard(session.state, requireCard(session, waterHandA).uid, "hand", 0);
  moveDuelCard(session.state, requireCard(session, waterHandB).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, waterTargetCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, nonWaterTargetCode), 1, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(snowdustCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const snowdust = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === snowdustCode);
  expect(snowdust).toBeDefined();
  return [
    snowdust!,
    { code: materialCode, name: "Snowdust Giant Xyz Material", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, level: 4, attack: 1000, defense: 1000 },
    { code: waterHandA, name: "Snowdust Giant Revealed WATER A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, level: 4, attack: 800, defense: 1200 },
    { code: waterHandB, name: "Snowdust Giant Revealed WATER B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, level: 4, attack: 900, defense: 1100 },
    { code: nonWaterTargetCode, name: "Snowdust Giant Non-WATER Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
    { code: waterTargetCode, name: "Snowdust Giant WATER Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, level: 4, attack: 1600, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Snowdust Giant");
  expect(script).toContain("Xyz.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsAttribute,ATTRIBUTE_WATER),4,2)");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e1:SetCost(Cost.DetachFromSelf(1,1,nil))");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
  expect(script).toContain("Duel.GetMatchingGroup(s.cfilter,tp,LOCATION_HAND,0,nil)");
  expect(script).toContain("Duel.ConfirmCards(1-tp,rg)");
  expect(script).toContain("Duel.ShuffleHand(tp)");
  expect(script).toContain("tc:AddCounter(0x1015,1)");
  expect(script).toContain("e2:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("return c:IsAttributeExcept(ATTRIBUTE_WATER)");
  expect(script).toContain("return Duel.GetCounter(0,1,1,0x1015)*-200");
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.sequence = sequence;
  return moved;
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
