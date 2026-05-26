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
const lapisLazuliCode = "47611119";
const deckGemKnightCode = "476111190";
const allySpecialCode = "476111191";
const opponentSpecialCode = "476111192";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasLapisLazuliScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${lapisLazuliCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeFusion = 0x40;
const raceAqua = 0x40;
const raceRock = 0x200000;
const attributeEarth = 0x1;
const setGemKnight = 0x1047;

describe.skipIf(!hasUpstreamScripts || !hasLapisLazuliScript)("Lua real script Gem-Knight Lady Lapis Lazuli send burn", () => {
  it("restores ignition Deck send into operated grave count and target-player damage", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${lapisLazuliCode}.lua`));
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 47611119, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [deckGemKnightCode, allySpecialCode], extra: [lapisLazuliCode] }, 1: { main: [opponentSpecialCode] } });
    startDuel(session);
    const lapisLazuli = requireCard(session, lapisLazuliCode);
    const deckGemKnight = requireCard(session, deckGemKnightCode);
    const allySpecial = requireCard(session, allySpecialCode);
    const opponentSpecial = requireCard(session, opponentSpecialCode);
    moveFaceUpAttack(session, lapisLazuli, 0, 0, "fusion");
    moveFaceUpAttack(session, allySpecial, 0, 1, "special");
    moveFaceUpAttack(session, opponentSpecial, 1, 0, "special");
    session.state.turn = 2;
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(lapisLazuliCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    applyRestoredActionAndAssert(restoredOpen, requireAction(restoredOpen, lapisLazuli.uid, "activateEffect"));
    expect(restoredOpen.session.state.chain).toEqual([]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(findCard(restoredAfter.session, deckGemKnight.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: lapisLazuli.uid,
      reasonEffectId: 3,
    });
    expect(restoredAfter.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredAfter.session.state.players[1].lifePoints).toBe(6500);
    expect(restoredAfter.session.state.eventHistory.filter((event) => ["sentToGraveyard", "damageDealt"].includes(event.eventName)).map(slimEvent)).toEqual([
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: deckGemKnight.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: lapisLazuli.uid, eventReasonEffectId: 3, previous: "deck", current: "graveyard" },
      { eventName: "damageDealt", eventCode: 1111, eventCardUid: undefined, eventPlayer: 1, eventValue: 1500, eventUids: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: lapisLazuli.uid, eventReasonEffectId: 3, previous: undefined, current: undefined },
    ]);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const lapisLazuli = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === lapisLazuliCode);
  expect(lapisLazuli).toBeDefined();
  return [
    lapisLazuli!,
    gemKnight(deckGemKnightCode, "Lapis Lazuli Deck Gem-Knight", 1400),
    { code: allySpecialCode, name: "Lapis Lazuli Ally Special", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceRock, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
    { code: opponentSpecialCode, name: "Lapis Lazuli Opponent Special", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceRock, attribute: attributeEarth, level: 4, attack: 1300, defense: 1000 },
  ];
}

function gemKnight(code: string, name: string, attack: number): DuelCardData {
  return { code, name, kind: "monster", typeFlags: typeMonster | typeEffect, race: raceRock, attribute: attributeEarth, level: 4, attack, defense: 1000, setcodes: [setGemKnight] };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("Gem-Knight Lady Lapis Lazuli");
  expect(script).toContain("Fusion.AddProcMix(c,false,false,99645428,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_GEM_KNIGHT))");
  expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_CONDITION)");
  expect(script).toContain("e2:SetCategory(CATEGORY_DAMAGE+CATEGORY_DECKDES)");
  expect(script).toContain("e2:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("e2:SetProperty(EFFECT_FLAG_PLAYER_TARGET)");
  expect(script).toContain("return c:IsSetCard(SET_GEM_KNIGHT) and c:IsMonster() and c:IsAbleToGrave()");
  expect(script).toContain("return c:IsSpecialSummoned()");
  expect(script).toContain("Duel.SetTargetPlayer(1-tp)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_DECK|LOCATION_EXTRA,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_EFFECT)");
  expect(script).toContain("Duel.GetOperatedGroup():FilterCount(Card.IsLocation,nil,LOCATION_GRAVE)");
  expect(script).toContain("Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER)");
  expect(script).toContain("Duel.Damage(p,ct*500,REASON_EFFECT)");
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number, summonType: NonNullable<DuelCardInstance["summonType"]>): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.summonType = summonType;
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
