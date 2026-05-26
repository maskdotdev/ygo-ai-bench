import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const drumCode = "77799846";
const materialACode = "777998460";
const materialBCode = "777998461";
const costRobotCode = "777998462";
const overlayRobotCode = "777998463";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasDrumScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${drumCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeXyz = 0x800000;
const raceMachine = 0x20;
const attributeEarth = 0x1;
const setSuperDefenseRobot = 0x85;
const effectUpdateAttack = 100;
const eventToGrave = 1014;

describe.skipIf(!hasUpstreamScripts || !hasDrumScript)("Lua real script Googly-Eyes Drum Dragon detach revive overlay stat", () => {
  it("restores detach-cost ATK gain and destroyed Xyz self-revive into optional overlay attach", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${drumCode}.lua`));
    const reader = createCardReader(cards());

    const restoredStat = createRestoredField({ reader, workspace });
    expectCleanRestore(restoredStat);
    expectRestoredLegalActions(restoredStat, 0);
    const statDrum = requireCard(restoredStat.session, drumCode);
    const materialA = requireCard(restoredStat.session, materialACode);
    const boost = getLuaRestoreLegalActions(restoredStat, 0).find((action) => action.type === "activateEffect" && action.uid === statDrum.uid && action.effectId === "lua-2");
    expect(boost, JSON.stringify(getLuaRestoreLegalActions(restoredStat, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredStat, boost!);
    resolveRestoredChain(restoredStat);

    expect(restoredStat.session.state.cards.find((card) => card.uid === statDrum.uid)?.overlayUids).toEqual([requireCard(restoredStat.session, materialBCode).uid]);
    expect(restoredStat.session.state.cards.find((card) => card.uid === materialA.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: statDrum.uid,
      reasonEffectId: 2,
    });
    expect(currentAttack(restoredStat.session.state.cards.find((card) => card.uid === statDrum.uid), restoredStat.session.state)).toBe(4000);
    expect(restoredStat.session.state.effects.filter((effect) => effect.sourceUid === statDrum.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      property: effect.property,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([{ code: effectUpdateAttack, property: 0x2000, reset: { flags: 1107235328, count: 2 }, sourceUid: statDrum.uid, value: 1000 }]);

    const restoredDestroyed = createRestoredField({ reader, workspace }, { yesPrompts: true });
    expectCleanRestore(restoredDestroyed);
    const reviveDrum = requireCard(restoredDestroyed.session, drumCode);
    const costRobot = requireCard(restoredDestroyed.session, costRobotCode);
    const overlayRobot = requireCard(restoredDestroyed.session, overlayRobotCode);
    destroyDuelCard(restoredDestroyed.session.state, reviveDrum.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(restoredDestroyed.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      { effectId: "lua-3-1014", eventCardUid: reviveDrum.uid, eventCode: eventToGrave, eventName: "sentToGraveyard", eventReason: duelReason.effect | duelReason.destroy, player: 0, sourceUid: reviveDrum.uid, triggerBucket: "turnOptional" },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDestroyed.session), workspace, reader, { promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }] });
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const revive = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === reviveDrum.uid && action.effectId === "lua-3-1014");
    expect(revive, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, revive!);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.host.promptDecisions.filter((prompt) => prompt.api === "SelectYesNo").map((prompt) => ({
      api: prompt.api,
      player: prompt.player,
      returned: prompt.returned,
    }))).toEqual([{ api: "SelectYesNo", player: 0, returned: true }]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === costRobot.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: reviveDrum.uid,
      reasonEffectId: 3,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === reviveDrum.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      overlayUids: [materialA.uid, requireCard(restoredTrigger.session, materialBCode).uid, overlayRobot.uid],
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: reviveDrum.uid,
      reasonEffectId: 3,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === overlayRobot.uid)).toMatchObject({
      location: "overlay",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: reviveDrum.uid,
      reasonEffectId: 3,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["sentToGraveyard", "banished", "specialSummoned", "overlayAttached"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventUids: event.eventUids,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "sentToGraveyard", eventCode: eventToGrave, eventCardUid: reviveDrum.uid, eventUids: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "banished", eventCode: 1011, eventCardUid: costRobot.uid, eventUids: undefined, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: reviveDrum.uid, eventReasonEffectId: 3 },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: reviveDrum.uid, eventUids: [reviveDrum.uid], eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: reviveDrum.uid, eventReasonEffectId: 3 },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Googly-Eyes Drum Dragon");
  expect(script).toContain("Xyz.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_MACHINE),8,2)");
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_COPY_INHERIT)");
  expect(script).toContain("e1:SetValue(1000)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END,2)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return e:GetHandler():IsReason(REASON_DESTROY) and e:GetHandler():GetOverlayCount()>0");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.rfilter,tp,LOCATION_GRAVE|LOCATION_MZONE,0,1,1,nil,tp)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("Duel.SelectYesNo(tp,aux.Stringid(id,2))");
  expect(script).toContain("Duel.Overlay(c,mg)");
}

function cards(): DuelCardData[] {
  return [
    { code: drumCode, name: "Googly-Eyes Drum Dragon", kind: "extra", typeFlags: typeMonster | typeEffect | typeXyz, race: raceMachine, attribute: attributeEarth, level: 8, attack: 3000, defense: 2500 },
    { code: materialACode, name: "Googly-Eyes Material A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 8, attack: 1000, defense: 1000 },
    { code: materialBCode, name: "Googly-Eyes Material B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, level: 8, attack: 1000, defense: 1000 },
    { code: costRobotCode, name: "Googly-Eyes Super Defense Cost", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, setcodes: [setSuperDefenseRobot], level: 4, attack: 1200, defense: 1200 },
    { code: overlayRobotCode, name: "Googly-Eyes Super Defense Overlay", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeEarth, setcodes: [setSuperDefenseRobot], level: 4, attack: 1300, defense: 1300 },
  ];
}

function createRestoredField(
  { reader, workspace }: { reader: ReturnType<typeof createCardReader>; workspace: ReturnType<typeof createUpstreamNodeWorkspace> },
  options: { yesPrompts?: boolean } = {},
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 77799846, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [materialACode, materialBCode, costRobotCode, overlayRobotCode], extra: [drumCode] }, 1: { main: [] } });
  startDuel(session);
  const drum = requireCard(session, drumCode);
  moveFaceUpAttack(session, drum, 0);
  drum.summonType = "xyz";
  drum.customStatusMask = 0x8;
  attachOverlay(session, drum, requireCard(session, materialACode), 0);
  attachOverlay(session, drum, requireCard(session, materialBCode), 1);
  moveDuelCard(session.state, requireCard(session, costRobotCode).uid, "graveyard", 0).faceUp = true;
  moveDuelCard(session.state, requireCard(session, overlayRobotCode).uid, "graveyard", 0).faceUp = true;
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(drumCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader, options.yesPrompts ? { promptOverrides: [{ api: "SelectYesNo", player: 0, returned: true }] } : undefined);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function attachOverlay(session: DuelSession, holder: DuelCardInstance, material: DuelCardInstance, sequence: number): void {
  const moved = moveDuelCard(session.state, material.uid, "overlay", holder.controller);
  moved.sequence = sequence;
  holder.overlayUids.push(material.uid);
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
