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
const celestialCode = "63362460";
const graveDestinyHeroCode = "633624600";
const drawOneCode = "633624601";
const drawTwoCode = "633624602";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const hasCelestialScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${celestialCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceWarrior = 0x1;
const attributeDark = 0x10;
const setDestinyHero = 0xc008;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase || !hasCelestialScript)("Lua real script Destiny HERO Celestial grave draw", () => {
  it("restores empty-hand grave ignition into self plus Destiny HERO banish cost and target-param draw", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${celestialCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 63362460, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [drawOneCode, drawTwoCode, celestialCode, graveDestinyHeroCode] }, 1: { main: [] } });
    startDuel(session);

    const celestial = requireCard(session, celestialCode);
    const graveDestinyHero = requireCard(session, graveDestinyHeroCode);
    const drawOne = requireCard(session, drawOneCode);
    const drawTwo = requireCard(session, drawTwoCode);
    moveDuelCard(session.state, celestial.uid, "graveyard", 0).faceUp = true;
    moveDuelCard(session.state, graveDestinyHero.uid, "graveyard", 0).faceUp = true;
    session.state.turn = 2;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(celestialCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    applyRestoredActionAndAssert(restoredOpen, requireAction(restoredOpen, celestial.uid, "activateEffect"));
    expect(restoredOpen.session.state.chain).toEqual([]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(findCard(restoredAfter.session, celestial.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: celestial.uid,
      reasonEffectId: 2,
    });
    expect(findCard(restoredAfter.session, graveDestinyHero.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost,
      reasonPlayer: 0,
      reasonCardUid: celestial.uid,
      reasonEffectId: 2,
    });
    expect(findCard(restoredAfter.session, drawOne.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(findCard(restoredAfter.session, drawTwo.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredAfter.session.state.eventHistory.filter((event) => ["banished", "cardsDrawn"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventName: "banished", eventCode: 1011, eventCardUid: graveDestinyHero.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: celestial.uid, eventReasonEffectId: 2, previous: "graveyard", current: "banished" },
      { eventName: "banished", eventCode: 1011, eventCardUid: celestial.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: celestial.uid, eventReasonEffectId: 2, previous: "graveyard", current: "banished" },
      { eventName: "banished", eventCode: 1011, eventCardUid: graveDestinyHero.uid, eventPlayer: undefined, eventValue: undefined, eventUids: [graveDestinyHero.uid, celestial.uid], eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: celestial.uid, eventReasonEffectId: 2, previous: "graveyard", current: "banished" },
      { eventName: "cardsDrawn", eventCode: 1110, eventCardUid: drawOne.uid, eventPlayer: 0, eventValue: 2, eventUids: [drawOne.uid, drawTwo.uid], eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: celestial.uid, eventReasonEffectId: 2, previous: "deck", current: "hand" },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const celestial = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === celestialCode);
  expect(celestial).toBeDefined();
  return [
    celestial!,
    destinyHero(graveDestinyHeroCode, "Celestial Grave Destiny HERO"),
    { code: drawOneCode, name: "Celestial Draw One", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1000, defense: 1000 },
    { code: drawTwoCode, name: "Celestial Draw Two", kind: "monster", typeFlags: typeMonster, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1100, defense: 1000 },
  ];
}

function destinyHero(code: string, name: string): DuelCardData {
  return { code, name, kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeDark, level: 4, attack: 1200, defense: 1000, setcodes: [setDestinyHero] };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Destiny HERO - Celestial");
  expect(script).toContain("s.listed_series={SET_DESTINY_HERO}");
  expect(script).toContain("e2:SetCategory(CATEGORY_DRAW)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_PLAYER_TARGET)");
  expect(script).toContain("e2:SetRange(LOCATION_GRAVE)");
  expect(script).toContain("return Duel.GetFieldGroupCount(tp,LOCATION_HAND,0)==0 and aux.exccon(e)");
  expect(script).toContain("return c:IsSetCard(SET_DESTINY_HERO) and c:IsMonster() and c:IsAbleToRemoveAsCost()");
  expect(script).toContain("aux.bfgcost(e,tp,eg,ep,ev,re,r,rp,0)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_GRAVE,0,1,1,c)");
  expect(script).toContain("g:AddCard(c)");
  expect(script).toContain("Duel.Remove(g,POS_FACEUP,REASON_COST)");
  expect(script).toContain("Duel.SetTargetPlayer(tp)");
  expect(script).toContain("Duel.SetTargetParam(2)");
  expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)");
  expect(script).toContain("Duel.Draw(p,d,REASON_EFFECT)");
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

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor as PlayerId | undefined;
  if (waitingFor === undefined) return;
  expect(response.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
  expect(response.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}
