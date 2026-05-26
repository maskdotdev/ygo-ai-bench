import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const springirlCode = "21057444";
const costMarincessCode = "210574440";
const fieldMarincessCode = "210574441";
const millMarincessCode = "210574442";
const waterLinkCode = "210574443";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasSpringirlScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${springirlCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceCyberse = 0x1000000;
const attributeWater = 0x2;
const setMarincess = 0x12b;

describe.skipIf(!hasUpstreamScripts || !hasSpringirlScript)("Lua real script Marincess Springirl banish summon material mill", () => {
  it("restores GY Marincess banish cost, self Special Summon, WATER Link material mill, and burn", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${springirlCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 21057444, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [springirlCode, costMarincessCode, fieldMarincessCode, millMarincessCode], extra: [waterLinkCode] }, 1: { main: [] } });
    startDuel(session);
    const springirl = requireCard(session, springirlCode);
    const costMarincess = requireCard(session, costMarincessCode);
    const fieldMarincess = requireCard(session, fieldMarincessCode);
    const millMarincess = requireCard(session, millMarincessCode);
    moveDuelCard(session.state, springirl.uid, "hand", 0);
    moveDuelCard(session.state, costMarincess.uid, "graveyard", 0).faceUp = true;
    moveFaceUpAttack(session, fieldMarincess, 0, 1);
    openMain(session);

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(springirlCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    applyRestoredActionAndAssert(restoredSummon, requireAction(restoredSummon, springirl.uid, "activateEffect"));
    expect(findCard(restoredSummon.session, costMarincess.uid)).toMatchObject({
      location: "banished",
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: springirl.uid,
      reasonEffectId: 1,
    });
    expect(findCard(restoredSummon.session, springirl.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: springirl.uid,
      reasonEffectId: 1,
    });
    expect(restoredSummon.session.state.eventHistory.filter((event) => ["banished", "specialSummoned"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: costMarincess.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: springirl.uid, eventReasonEffectId: 1, previous: "graveyard", current: "banished" },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: springirl.uid, eventPlayer: undefined, eventValue: undefined, eventUids: [springirl.uid], eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: springirl.uid, eventReasonEffectId: 1, previous: "hand", current: "monsterZone" },
    ]);

    const restoredLink = restoreDuelWithLuaScripts(serializeDuel(restoredSummon.session), workspace, reader);
    expectCleanRestore(restoredLink);
    expectRestoredLegalActions(restoredLink, 0);
    applyRestoredActionAndAssert(restoredLink, requireLinkSummonAction(restoredLink, springirl.uid));
    const waterLink = requireCard(restoredLink.session, waterLinkCode);
    expect(findCard(restoredLink.session, springirl.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.link | duelReason.material,
      reasonPlayer: 0,
      reasonCardUid: waterLink.uid,
    });
    expect(restoredLink.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
    }))).toEqual([
      { effectId: "lua-2-1108", eventCardUid: springirl.uid, eventCode: 1108, eventName: "usedAsMaterial", eventReason: duelReason.link, player: 0, sourceUid: springirl.uid },
    ]);

    applyRestoredActionAndAssert(restoredLink, requireAction(restoredLink, springirl.uid, "activateTrigger"));
    resolveRestoredChain(restoredLink);
    expect(findCard(restoredLink.session, millMarincess.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: springirl.uid,
      reasonEffectId: 2,
    });
    expect(restoredLink.session.state.players[1].lifePoints).toBe(7800);
    expect(restoredLink.session.state.eventHistory.filter((event) => ["usedAsMaterial", "sentToGraveyard", "breakEffect", "damageDealt"].includes(event.eventName)).slice(-4).map(slimEvent)).toEqual([
      { eventName: "usedAsMaterial", eventCode: 1108, eventCardUid: springirl.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.link, eventReasonPlayer: 0, eventReasonCardUid: waterLink.uid, eventReasonEffectId: 1, previous: "monsterZone", current: "graveyard" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: millMarincess.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: springirl.uid, eventReasonEffectId: 2, previous: "deck", current: "graveyard" },
      { eventName: "breakEffect", eventCode: 1050, eventCardUid: undefined, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: springirl.uid, eventReasonEffectId: 2, previous: undefined, current: undefined },
      { eventName: "damageDealt", eventCode: 1111, eventCardUid: undefined, eventPlayer: 1, eventValue: 200, eventUids: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: springirl.uid, eventReasonEffectId: 2, previous: undefined, current: undefined },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const springirl = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === springirlCode);
  expect(springirl).toBeDefined();
  return [
    springirl!,
    marincessMonster(costMarincessCode, "Springirl Cost Marincess"),
    marincessMonster(fieldMarincessCode, "Springirl Field Marincess"),
    marincessMonster(millMarincessCode, "Springirl Milled Marincess"),
    { code: waterLinkCode, name: "Springirl WATER Link Host", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceCyberse, attribute: attributeWater, level: 1, attack: 1000, defense: 0, linkMarkers: 0x1, linkMaterialMin: 1, linkMaterialMax: 1 },
  ];
}

function marincessMonster(code: string, name: string): DuelCardData {
  return { code, name, kind: "monster", typeFlags: typeMonster | typeEffect, race: raceCyberse, attribute: attributeWater, level: 4, attack: 1000, defense: 1000, setcodes: [setMarincess] };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Marincess Springirl");
  expect(script).toContain("e1:SetCategory(CATEGORY_SPECIAL_SUMMON)");
  expect(script).toContain("e1:SetRange(LOCATION_HAND)");
  expect(script).toContain("return c:IsSetCard(SET_MARINCESS) and c:IsMonster() and c:IsAbleToRemoveAsCost() and aux.SpElimFilter(c,true)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.spcostfilter,tp,LOCATION_MZONE|LOCATION_GRAVE,0,1,1,nil)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
  expect(script).toContain("e2:SetCategory(CATEGORY_DECKDES+CATEGORY_DAMAGE)");
  expect(script).toContain("e2:SetCode(EVENT_BE_MATERIAL)");
  expect(script).toContain("return c:IsLocation(LOCATION_GRAVE) and r==REASON_LINK and c:GetReasonCard():IsAttribute(ATTRIBUTE_WATER)");
  expect(script).toContain("Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsSetCard,SET_MARINCESS),tp,LOCATION_MZONE,0,nil)");
  expect(script).toContain("Duel.DiscardDeck(tp,ct,REASON_EFFECT)");
  expect(script).toContain("Duel.GetOperatedGroup():Match(Card.IsSetCard,nil,SET_MARINCESS):Match(Card.IsLocation,nil,LOCATION_GRAVE):GetCount()");
  expect(script).toContain("Duel.Damage(1-tp,dc*200,REASON_EFFECT)");
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
  session.state.turn = 2;
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

function requireLinkSummonAction(restored: ReturnType<typeof restoreDuelWithLuaScripts>, materialUid: string): DuelAction {
  const waterLink = requireCard(restored.session, waterLinkCode);
  const action = getLuaRestoreLegalActions(restored, 0).find((candidate) =>
    candidate.type === "linkSummon" &&
    candidate.uid === waterLink.uid &&
    JSON.stringify(candidate.materialUids) === JSON.stringify([materialUid]));
  expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
  return action!;
}

function slimEvent(event: {
  eventName: string;
  eventCode?: number;
  eventCardUid?: string;
  eventPlayer?: PlayerId;
  eventValue?: number;
  eventUids?: string[];
  eventReason?: number;
  eventReasonPlayer?: PlayerId;
  eventReasonCardUid?: string;
  eventReasonEffectId?: number;
  eventPreviousState?: { location?: string };
  eventCurrentState?: { location?: string };
}) {
  return {
    eventName: event.eventName,
    eventCode: event.eventCode,
    eventCardUid: event.eventCardUid,
    eventPlayer: event.eventPlayer,
    eventValue: event.eventValue,
    eventUids: event.eventUids,
    eventReason: event.eventReason,
    eventReasonPlayer: event.eventReasonPlayer,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
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
