import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const altusCode = "79703905";
const cloudianAllyCode = "797039050";
const opponentHandCode = "797039051";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasAltusScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${altusCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceFairy = 0x4;
const attributeWater = 0x2;
const setCloudian = 0x18;
const counterFog = 0x1019;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasAltusScript)("Lua real script Cloudian Altus counter hand discard", () => {
  it("restores Cloudian-count Fog Counters into counter-cost opponent hand discard", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${altusCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));

    const restoredSummon = createRestoredSummonState(reader, workspace);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    const altus = requireCard(restoredSummon.session, altusCode);
    const summon = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "normalSummon" && action.uid === altus.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summon!);

    const restoredCounter = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredCounter);
    expectRestoredLegalActions(restoredCounter, 0);
    const counterTrigger = getLuaRestoreLegalActions(restoredCounter, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === altus.uid && action.effectId?.endsWith("-1100")
    );
    expect(counterTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredCounter, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredCounter, counterTrigger!);
    expect(restoredCounter.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredCounter);
    expect(getDuelCardCounter(findCard(restoredCounter.session, altus.uid), counterFog)).toBe(2);
    expect(restoredCounter.session.state.eventHistory.filter((event) => ["normalSummoned", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "normalSummoned", eventCode: 1100, eventCardUid: altus.uid, eventReason: duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: altus.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: altus.uid, eventReasonEffectId: 3 },
    ]);

    const restoredDiscard = createRestoredDiscardState(reader, workspace);
    expectCleanRestore(restoredDiscard);
    expectRestoredLegalActions(restoredDiscard, 0);
    const discardAltus = requireCard(restoredDiscard.session, altusCode);
    const opponentHand = requireCard(restoredDiscard.session, opponentHandCode);
    const discard = getLuaRestoreLegalActions(restoredDiscard, 0).find((action) =>
      action.type === "activateEffect" && action.uid === discardAltus.uid && action.effectId === "lua-4"
    );
    expect(discard, JSON.stringify(getLuaRestoreLegalActions(restoredDiscard, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDiscard, discard!);
    expect(getDuelCardCounter(findCard(restoredDiscard.session, discardAltus.uid), counterFog)).toBe(0);
    expect(restoredDiscard.session.state.chain.flatMap((link) => link.operationInfos ?? [])).toEqual([]);
    resolveRestoredChain(restoredDiscard);
    expect(findCard(restoredDiscard.session, opponentHand.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: discardAltus.uid,
      reasonEffectId: 4,
    });
    expect(restoredDiscard.session.state.eventHistory.filter((event) => ["counterRemoved", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
    }))).toEqual([
      { eventName: "counterRemoved", eventCode: 0x20000, eventCardUid: discardAltus.uid, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: discardAltus.uid, eventReasonEffectId: 4 },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: opponentHand.uid, eventReason: duelReason.effect | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: discardAltus.uid, eventReasonEffectId: 4 },
    ]);
  });
});

function createRestoredSummonState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 79703905, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [altusCode, cloudianAllyCode] }, 1: { main: [] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, altusCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, cloudianAllyCode), 0, 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerAltus(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredDiscardState(
  reader: ReturnType<typeof createCardReader>,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 79703906, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [altusCode] }, 1: { main: [opponentHandCode] } });
  startDuel(session);
  const altus = moveFaceUpAttack(session, requireCard(session, altusCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, opponentHandCode).uid, "hand", 1);
  expect(addDuelCardCounter(altus, counterFog, 3)).toBe(true);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  registerAltus(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const altus = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === altusCode);
  expect(altus).toBeDefined();
  return [
    altus!,
    { code: cloudianAllyCode, name: "Cloudian Altus Ally", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeWater, setcodes: [setCloudian], level: 4, attack: 1200, defense: 0 },
    { code: opponentHandCode, name: "Cloudian Altus Opponent Hand", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceFairy, attribute: attributeWater, level: 4, attack: 1000, defense: 1000 },
  ];
}

function registerAltus(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(altusCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Cloudian - Altus");
  expect(script).toContain("e1:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e2:SetCode(EFFECT_SELF_DESTROY)");
  expect(script).toContain("return e:GetHandler():IsPosition(POS_FACEUP_DEFENSE)");
  expect(script).toContain("e3:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e3:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("Duel.GetMatchingGroupCount(s.cfilter,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
  expect(script).toContain("e:GetHandler():AddCounter(COUNTER_NEED_ENABLE+COUNTER_FOG,ct)");
  expect(script).toContain("e4:SetCategory(CATEGORY_HANDES)");
  expect(script).toContain("Duel.IsCanRemoveCounter(tp,1,1,COUNTER_FOG,3,REASON_COST)");
  expect(script).toContain("Duel.RemoveCounter(tp,1,1,COUNTER_FOG,3,REASON_COST)");
  expect(script).toContain("Duel.GetFieldGroupCount(tp,0,LOCATION_HAND)~=0");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_HANDES,nil,0,tp,1)");
  expect(script).toContain("Duel.GetFieldGroup(tp,0,LOCATION_HAND):RandomSelect(tp,1)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_EFFECT|REASON_DISCARD)");
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
