import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { createDuel, destroyDuelCard, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const mframeCode = "74974229";
const discardCode = "749742290";
const ownFaceupCode = "749742291";
const opponentFaceupCode = "749742292";
const opponentCounterACode = "749742293";
const opponentCounterBCode = "749742294";
const graveReptileACode = "749742295";
const graveReptileBCode = "749742296";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMFrameScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${mframeCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceReptile = 0x80000;
const raceWarrior = 0x1;
const attributeLight = 0x10;
const counterA = 0x100e;
const linkSummonReason = duelReason.link | duelReason.summon | duelReason.specialSummon;

describe.skipIf(!hasUpstreamScripts || !hasMFrameScript)("Lua real script Alien Shocktrooper M-Frame counter revive", () => {
  it("restores discard-level A-Counter placement and destroyed M-Frame dncheck Reptile revival", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${mframeCode}.lua`));
    const reader = createCardReader(cards());

    const restoredCounters = createRestoredCounterState({ reader, workspace });
    expectCleanRestore(restoredCounters);
    expectRestoredLegalActions(restoredCounters, 0);
    const mframe = requireCard(restoredCounters.session, mframeCode);
    const discard = requireCard(restoredCounters.session, discardCode);
    requireCard(restoredCounters.session, ownFaceupCode);
    applyRestoredActionAndAssert(restoredCounters, requireAction(restoredCounters, mframe.uid, "activateEffect"));
    expect(findCard(restoredCounters.session, discard.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.cost | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: mframe.uid,
      reasonEffectId: 2,
    });
    resolveRestoredChain(restoredCounters);
    expect(getDuelCardCounter(findCard(restoredCounters.session, mframe.uid), counterA)).toBe(4);
    expect(restoredCounters.session.state.eventHistory.filter((event) => ["discarded", "sentToGraveyard", "counterAdded"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventName: "discarded", eventCode: 1018, eventCardUid: discard.uid, eventReason: duelReason.cost | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: mframe.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "hand", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: discard.uid, eventReason: duelReason.cost | duelReason.discard, eventReasonPlayer: 0, eventReasonCardUid: mframe.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "hand", current: "graveyard" },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: mframe.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: mframe.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "extraDeck", current: "monsterZone" },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: mframe.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: mframe.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "extraDeck", current: "monsterZone" },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: mframe.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: mframe.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "extraDeck", current: "monsterZone" },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: mframe.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: mframe.uid, eventReasonEffectId: 2, relatedEffectId: undefined, previous: "extraDeck", current: "monsterZone" },
    ]);

    const restoredRevive = createRestoredDestroyedState({ reader, workspace });
    expectCleanRestore(restoredRevive);
    expectRestoredLegalActions(restoredRevive, 0);
    const destroyedMFrame = requireCard(restoredRevive.session, mframeCode);
    const graveReptileA = requireCard(restoredRevive.session, graveReptileACode);
    const graveReptileB = requireCard(restoredRevive.session, graveReptileBCode);
    expect(restoredRevive.session.state.pendingTriggers.map((trigger) => ({
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
      { effectId: "lua-3-1014", eventCardUid: destroyedMFrame.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, player: 0, sourceUid: destroyedMFrame.uid, triggerBucket: "turnOptional" },
    ]);
    applyRestoredActionAndAssert(restoredRevive, requireAction(restoredRevive, destroyedMFrame.uid, "activateTrigger"));
    resolveRestoredChain(restoredRevive);
    expect(findCard(restoredRevive.session, graveReptileA.uid)).toMatchObject({ location: "monsterZone", controller: 0, faceUp: true, summonType: "special", reason: duelReason.summon | duelReason.specialSummon, reasonCardUid: destroyedMFrame.uid, reasonEffectId: 3 });
    expect(findCard(restoredRevive.session, graveReptileB.uid)).toMatchObject({ location: "graveyard", controller: 0, faceUp: true });
    expect(restoredRevive.session.state.eventHistory.filter((event) => ["sentToGraveyard", "specialSummoned"].includes(event.eventName)).slice(-2).map(slimEvent)).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: destroyedMFrame.uid, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: undefined, previous: "monsterZone", current: "graveyard" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: graveReptileA.uid, eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: destroyedMFrame.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previous: "graveyard", current: "monsterZone" },
    ]);
  });
});

function createRestoredCounterState({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 74974229, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [discardCode, ownFaceupCode], extra: [mframeCode] }, 1: { main: [opponentFaceupCode] } });
  startDuel(session);
  moveDuelCard(session.state, requireCard(session, discardCode).uid, "hand", 0);
  moveFaceUpAttack(session, requireCard(session, mframeCode), 0, 0);
  moveFaceUpAttack(session, requireCard(session, ownFaceupCode), 0, 1);
  moveFaceUpAttack(session, requireCard(session, opponentFaceupCode), 1, 0);
  openMain(session);
  registerMFrame(session, workspace);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function createRestoredDestroyedState({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 74974230, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [graveReptileACode, graveReptileBCode], extra: [mframeCode] }, 1: { main: [opponentCounterACode, opponentCounterBCode] } });
  startDuel(session);
  const mframe = moveFaceUpAttack(session, requireCard(session, mframeCode), 0, 0);
  moveDuelCard(session.state, requireCard(session, graveReptileACode).uid, "graveyard", 0).faceUp = true;
  moveDuelCard(session.state, requireCard(session, graveReptileBCode).uid, "graveyard", 0).faceUp = true;
  const counterA = moveFaceUpAttack(session, requireCard(session, opponentCounterACode), 1, 0);
  const counterB = moveFaceUpAttack(session, requireCard(session, opponentCounterBCode), 1, 1);
  expect(addDuelCardCounter(counterA, 0x100e, 1)).toBe(true);
  expect(addDuelCardCounter(counterB, 0x100e, 1)).toBe(true);
  openMain(session);
  registerMFrame(session, workspace);
  destroyDuelCard(session.state, mframe.uid, 0, duelReason.effect | duelReason.destroy, 0);
  session.state.waitingFor = 0;
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function registerMFrame(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(mframeCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Alien Shocktrooper M-Frame");
  expect(script).toContain("Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_REPTILE),2,2)");
  expect(script).toContain("e1:SetCategory(CATEGORY_COUNTER)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_QUICK_O)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.costfilter,tp,LOCATION_HAND,0,1,1,nil)");
  expect(script).toContain("e:SetLabel(g:GetFirst():GetOriginalLevel())");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_COST|REASON_DISCARD)");
  expect(script).toContain("Duel.GetMatchingGroup(Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,nil)");
  expect(script).toContain("for i=1,e:GetLabel() do");
  expect(script).toContain("tc:AddCounter(COUNTER_A,1)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return c:IsReason(REASON_DESTROY) and c:IsReason(REASON_BATTLE|REASON_EFFECT)");
  expect(script).toContain("Duel.GetMatchingGroupCount(s.acfilter,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("Duel.IsPlayerAffectedByEffect(tp,CARD_BLUEEYES_SPIRIT)");
  expect(script).toContain("aux.SelectUnselectGroup(g,e,tp,1,ct,aux.dncheck,1,tp,HINTMSG_SPSUMMON)");
  expect(script).toContain("Duel.SpecialSummon(sg,0,tp,tp,false,false,POS_FACEUP)");
}

function cards(): DuelCardData[] {
  return [
    { code: mframeCode, name: "Alien Shocktrooper M-Frame", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceReptile, attribute: attributeLight, level: 2, attack: 1900, defense: 0, linkMarkers: 0x50, linkMaterialMin: 2, linkMaterialMax: 2 },
    { code: discardCode, name: "M-Frame Discard Reptile", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: ownFaceupCode, name: "M-Frame Own Face-up Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: opponentFaceupCode, name: "M-Frame Opponent Face-up Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: opponentCounterACode, name: "M-Frame Opponent Counter A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: opponentCounterBCode, name: "M-Frame Opponent Counter B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeLight, level: 4, attack: 1000, defense: 1000 },
    { code: graveReptileACode, name: "M-Frame Grave Reptile A", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeLight, level: 4, attack: 1200, defense: 1000 },
    { code: graveReptileBCode, name: "M-Frame Grave Reptile B", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, attribute: attributeLight, level: 4, attack: 1300, defense: 1000 },
  ];
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

function openMain(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
}

function requireAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string, type: DuelAction["type"]): DuelAction {
  const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
  const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === type && (candidate as { uid?: string }).uid === uid);
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  return action!;
}

function slimEvent(event: {
  eventName: string;
  eventCode?: number;
  eventCardUid?: string;
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  eventReasonCardUid?: string;
  eventReasonEffectId?: number;
  relatedEffectId?: number;
  eventPreviousState?: { location?: string };
  eventCurrentState?: { location?: string };
}) {
  return {
    eventName: event.eventName,
    eventCode: event.eventCode,
    eventCardUid: event.eventCardUid,
    eventReason: event.eventReason,
    eventReasonPlayer: event.eventReasonPlayer,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
    relatedEffectId: event.relatedEffectId,
    previous: event.eventPreviousState?.location,
    current: event.eventCurrentState?.location,
  };
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
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
