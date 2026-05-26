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
const nimbusCode = "20003527";
const waterTributeACode = "200035270";
const earthTributeCode = "200035271";
const waterTributeBCode = "200035272";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasNimbusScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${nimbusCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceAqua = 0x40;
const raceWarrior = 0x1;
const attributeWater = 0x2;
const attributeEarth = 0x1;
const counterFog = 0x1019;
const effectIndestructibleBattle = 42;
const effectSelfDestroy = 141;
const effectMaterialCheck = 251;
const effectUpdateAttack = 100;
const eventSummonSuccess = 1100;

describe.skipIf(!hasUpstreamScripts || !hasNimbusScript)("Lua real script Cloudian Nimbusman tribute counter stat", () => {
  it("restores tribute material WATER counting into Fog Counters and global ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${nimbusCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const restoredOpen = createRestoredOpen(reader, workspace);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const nimbus = requireCard(restoredOpen.session, nimbusCode);
    const waterA = requireCard(restoredOpen.session, waterTributeACode);
    const earth = requireCard(restoredOpen.session, earthTributeCode);
    const waterB = requireCard(restoredOpen.session, waterTributeBCode);

    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === nimbus.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { category: undefined, code: effectIndestructibleBattle, event: "continuous", id: "lua-1-42", property: undefined, range: ["hand"] },
      { category: undefined, code: effectSelfDestroy, event: "continuous", id: "lua-2-141", property: 0x20000, range: ["monsterZone"] },
      { category: undefined, code: 32, event: "continuous", id: "lua-3-32", property: 0x40400, range: ["hand"] },
      { category: undefined, code: effectMaterialCheck, event: "continuous", id: "lua-4-251", property: undefined, range: ["hand"] },
      { category: 0x800000, code: eventSummonSuccess, event: "trigger", id: "lua-5-1100", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"] },
      { category: undefined, code: effectUpdateAttack, event: "continuous", id: "lua-6-100", property: 0x20000, range: ["monsterZone"] },
    ]);

    const tributeSummon = getLuaRestoreLegalActions(restoredOpen, 0).find((action): action is Extract<DuelAction, { type: "tributeSummon" }> =>
      action.type === "tributeSummon" &&
      action.uid === nimbus.uid &&
      action.effectId === "lua-3-32"
    );
    expect(tributeSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, tributeSummon!);

    expect(findCard(restoredOpen.session, nimbus.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "tribute",
      summonMaterialUids: [waterA.uid],
    });
    expect(restoredOpen.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-5-1100", eventCardUid: nimbus.uid, eventCode: eventSummonSuccess, eventName: "normalSummoned", eventReason: duelReason.summon, eventReasonPlayer: 0, player: 0, sourceUid: nimbus.uid, triggerBucket: "turnMandatory" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === nimbus.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(findCard(restoredTrigger.session, earth.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(findCard(restoredTrigger.session, waterB.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(getDuelCardCounter(findCard(restoredTrigger.session, nimbus.uid), counterFog)).toBe(1);
    expect(currentAttack(findCard(restoredTrigger.session, nimbus.uid), restoredTrigger.session.state)).toBe((nimbus.data.attack ?? 0) + 500);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["sentToGraveyard", "normalSummoned", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previous: event.eventPreviousState?.location,
      current: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: waterA.uid, eventReason: duelReason.release | duelReason.material | duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: nimbus.uid, eventReasonEffectId: 3, previous: "monsterZone", current: "graveyard" },
      { eventName: "normalSummoned", eventCode: eventSummonSuccess, eventCardUid: nimbus.uid, eventReason: duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "hand", current: "monsterZone" },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: nimbus.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: nimbus.uid, eventReasonEffectId: 5, previous: "hand", current: "monsterZone" },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(getDuelCardCounter(findCard(restoredAfter.session, nimbus.uid), counterFog)).toBe(1);
    expect(currentAttack(findCard(restoredAfter.session, nimbus.uid), restoredAfter.session.state)).toBe((nimbus.data.attack ?? 0) + 500);
  });
});

function createRestoredOpen(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 20003527, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [nimbusCode, waterTributeACode, earthTributeCode, waterTributeBCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, nimbusCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, waterTributeACode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, earthTributeCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, waterTributeBCode), 0, 2);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(nimbusCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const nimbus = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === nimbusCode);
  expect(nimbus).toBeDefined();
  return [
    nimbus!,
    { code: waterTributeACode, name: "Nimbusman WATER Tribute A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, level: 4, attack: 1000, defense: 1000 },
    { code: earthTributeCode, name: "Nimbusman EARTH Tribute", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1100, defense: 1000 },
    { code: waterTributeBCode, name: "Nimbusman WATER Tribute B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceAqua, attribute: attributeWater, level: 4, attack: 1200, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Cloudian - Nimbusman");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e2:SetCode(EFFECT_SELF_DESTROY)");
  expect(script).toContain("return e:GetHandler():IsPosition(POS_FACEUP_DEFENSE)");
  expect(script).toContain("aux.AddNormalSummonProcedure(c,true,true,1,99,SUMMON_TYPE_TRIBUTE,aux.Stringid(id,0),s.cfilter)");
  expect(script).toContain("e4:SetCode(EFFECT_MATERIAL_CHECK)");
  expect(script).toContain("local g=c:GetMaterial()");
  expect(script).toContain("e:SetLabel(g:FilterCount(Card.IsAttribute,nil,ATTRIBUTE_WATER))");
  expect(script).toContain("e5:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():IsTributeSummoned()");
  expect(script).toContain("e:GetHandler():AddCounter(COUNTER_NEED_ENABLE+COUNTER_FOG,e:GetLabelObject():GetLabel())");
  expect(script).toContain("e6:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("return Duel.GetCounter(0,1,1,COUNTER_FOG)*500");
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
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
