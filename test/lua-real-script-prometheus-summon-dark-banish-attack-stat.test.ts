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
const prometheusCode = "82213171";
const firstDarkCode = "822131710";
const secondDarkCode = "822131711";
const fieldDarkDecoyCode = "822131712";
const lightDecoyCode = "822131713";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasPrometheusScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${prometheusCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceFiend = 0x8;
const attributeDark = 0x20;
const attributeLight = 0x10;
const effectUpdateAttack = 100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasPrometheusScript)("Lua real script Prometheus summon dark banish attack stat", () => {
  it("restores summon trigger into SpElim-filtered DARK grave banish and ATK gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${prometheusCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredSummon = createRestoredPrometheusSummonWindow({ reader, workspace });
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const prometheus = requireCard(restoredSummon.session, prometheusCode);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) =>
      action.type === "normalSummon" && action.uid === prometheus.uid
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === prometheus.uid
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    if (!trigger || trigger.type !== "activateTrigger") throw new Error("Expected Prometheus summon trigger");
    const effectNumericId = Number(trigger.effectId.split("-")[1]);
    applyRestoredActionAndAssert(restoredTrigger, trigger);
    resolveRestoredChain(restoredTrigger);

    const graveDarks = [firstDarkCode, secondDarkCode].map((code) => requireCard(restoredTrigger.session, code));
    const fieldDarkDecoy = requireCard(restoredTrigger.session, fieldDarkDecoyCode);
    const lightDecoy = requireCard(restoredTrigger.session, lightDecoyCode);
    for (const target of graveDarks) {
      expect(restoredTrigger.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
        location: "banished",
        controller: 0,
        faceUp: true,
        reason: duelReason.effect,
        reasonPlayer: 0,
        reasonCardUid: prometheus.uid,
        reasonEffectId: effectNumericId,
      });
    }
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === fieldDarkDecoy.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === lightDecoy.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      faceUp: true,
    });
    expect(currentAttack(restoredTrigger.session.state.cards.find((card) => card.uid === prometheus.uid), restoredTrigger.session.state)).toBe(2000);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === prometheus.uid && effect.code === effectUpdateAttack).map((effect) => ({
      code: effect.code,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectUpdateAttack, reset: { flags: 1107235328 }, sourceUid: prometheus.uid, value: 800 },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "banished"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      eventUids: event.eventUids,
    }))).toEqual([
      { eventCardUid: prometheus.uid, eventCode: 1100, eventName: "normalSummoned", eventReason: duelReason.summon, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, eventUids: undefined },
      { eventCardUid: graveDarks[0]!.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.effect, eventReasonCardUid: prometheus.uid, eventReasonEffectId: effectNumericId, eventReasonPlayer: 0, eventUids: undefined },
      { eventCardUid: graveDarks[1]!.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.effect, eventReasonCardUid: prometheus.uid, eventReasonEffectId: effectNumericId, eventReasonPlayer: 0, eventUids: undefined },
      { eventCardUid: graveDarks[0]!.uid, eventCode: 1011, eventName: "banished", eventReason: duelReason.effect, eventReasonCardUid: prometheus.uid, eventReasonEffectId: effectNumericId, eventReasonPlayer: 0, eventUids: graveDarks.map((target) => target.uid) },
    ]);
    expect(restoredTrigger.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
  });
});

function createRestoredPrometheusSummonWindow({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 82213171, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [prometheusCode, firstDarkCode, secondDarkCode, fieldDarkDecoyCode, lightDecoyCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, prometheusCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, fieldDarkDecoyCode), 0, 0);
  moveFaceUpGrave(session, requireCard(session, firstDarkCode), 0, 0);
  moveFaceUpGrave(session, requireCard(session, secondDarkCode), 0, 1);
  moveFaceUpGrave(session, requireCard(session, lightDecoyCode), 0, 2);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(prometheusCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Prometheus, King of the Shadows");
  expect(script).toContain("CATEGORY_REMOVE+CATEGORY_ATKCHANGE");
  expect(script).toContain("EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F");
  expect(script).toContain("EVENT_SUMMON_SUCCESS");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_REMOVE,nil,1,tp,LOCATION_GRAVE)");
  expect(script).toContain("return c:IsAttribute(ATTRIBUTE_DARK) and c:IsAbleToRemove() and aux.SpElimFilter(c,true)");
  expect(script).toContain("Duel.GetMatchingGroupCount(s.rmfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,nil)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.rmfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,max_ct,nil)");
  expect(script).toContain("local ct=Duel.Remove(g,POS_FACEUP,REASON_EFFECT)");
  expect(script).toContain("EFFECT_UPDATE_ATTACK");
  expect(script).toContain("e1:SetValue(ct*400)");
  expect(script).toContain("e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)");
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const prometheus = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === prometheusCode);
  expect(prometheus).toBeDefined();
  return [
    prometheus!,
    { code: firstDarkCode, name: "Prometheus First DARK Grave Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1200, defense: 800 },
    { code: secondDarkCode, name: "Prometheus Second DARK Grave Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: fieldDarkDecoyCode, name: "Prometheus Field DARK SpElim Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeDark, level: 4, attack: 900, defense: 1200 },
    { code: lightDecoyCode, name: "Prometheus LIGHT Grave Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFiend, attribute: attributeLight, level: 4, attack: 1400, defense: 1000 },
  ];
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

function moveFaceUpGrave(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "graveyard", player);
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
