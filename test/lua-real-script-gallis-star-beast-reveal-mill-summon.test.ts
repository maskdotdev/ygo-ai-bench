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
const gallisCode = "30915572";
const millMonsterCode = "309155720";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasGallisScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${gallisCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceBeast = 0x4000;
const attributeEarth = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasGallisScript)("Lua real script Gallis the Star Beast reveal mill summon", () => {
  it("restores SelfReveal hand ignition into Deck mill, damage, and self Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${gallisCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 30915572, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [gallisCode, millMonsterCode] }, 1: { main: [] } });
    startDuel(session);
    const gallis = requireCard(session, gallisCode);
    const millMonster = requireCard(session, millMonsterCode);
    moveDuelCard(session.state, gallis.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gallisCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const activation = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === gallis.uid);
    expect(activation, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activation!);
    expect(restoredOpen.session.state.chain).toEqual([]);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredChain);
    expectRestoredLegalActions(restoredChain, 0);

    expect(findCard(restoredChain.session, millMonster.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      faceUp: true,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: gallis.uid,
      reasonEffectId: 1,
    });
    expect(findCard(restoredChain.session, gallis.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: gallis.uid,
      reasonEffectId: 1,
    });
    expect(restoredChain.session.state.players[0].lifePoints).toBe(8000);
    expect(restoredChain.session.state.players[1].lifePoints).toBe(7200);
    expect(restoredChain.session.state.eventHistory.filter((event) => ["confirmed", "sentToGraveyard", "breakEffect", "damageDealt", "specialSummoned"].includes(event.eventName)).map((event) => ({
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
    }))).toEqual([
      { eventName: "confirmed", eventCode: 1211, eventCardUid: gallis.uid, eventPlayer: 1, eventValue: 1, eventUids: [gallis.uid], eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previous: "deck", current: "hand" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: millMonster.uid, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: gallis.uid, eventReasonEffectId: 1, previous: "deck", current: "graveyard" },
      { eventName: "breakEffect", eventCode: 1050, eventCardUid: undefined, eventPlayer: undefined, eventValue: undefined, eventUids: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: gallis.uid, eventReasonEffectId: 1, previous: undefined, current: undefined },
      { eventName: "damageDealt", eventCode: 1111, eventCardUid: undefined, eventPlayer: 1, eventValue: 800, eventUids: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: gallis.uid, eventReasonEffectId: 1, previous: undefined, current: undefined },
      { eventName: "specialSummoned", eventCode: 1102, eventCardUid: gallis.uid, eventPlayer: undefined, eventValue: undefined, eventUids: [gallis.uid], eventReason: duelReason.summon | duelReason.specialSummon, eventReasonPlayer: 0, eventReasonCardUid: gallis.uid, eventReasonEffectId: 1, previous: "hand", current: "monsterZone" },
    ]);

    const restoredAfter = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), workspace, reader);
    expectCleanRestore(restoredAfter);
    expectRestoredLegalActions(restoredAfter, 0);
    expect(findCard(restoredAfter.session, gallis.uid)).toMatchObject({ location: "monsterZone", faceUp: true, summonType: "special" });
    expect(restoredAfter.session.state.players[1].lifePoints).toBe(7200);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  const gallis = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === gallisCode);
  expect(gallis).toBeDefined();
  return [
    gallis!,
    { code: millMonsterCode, name: "Gallis Milled Level 4 Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceBeast, attribute: attributeEarth, level: 4, attack: 1200, defense: 1000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Gallis the Star Beast");
  expect(script).toContain("e1:SetCost(Cost.SelfReveal)");
  expect(script).toContain("Duel.IsPlayerCanDiscardDeck(tp,1)");
  expect(script).toContain("Duel.GetLocationCount(tp,LOCATION_MZONE)>0");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_DECKDES,nil,0,tp,1)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,200)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,tp,0)");
  expect(script).toContain("Duel.SetPossibleOperationInfo(0,CATEGORY_DESTROY,c,1,tp,0)");
  expect(script).toContain("Duel.DiscardDeck(tp,1,REASON_EFFECT)");
  expect(script).toContain("local top_c=Duel.GetOperatedGroup():GetFirst()");
  expect(script).toContain("Duel.BreakEffect()");
  expect(script).toContain("Duel.Damage(1-tp,top_c:GetOriginalLevel()*200,REASON_EFFECT)");
  expect(script).toContain("Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)");
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
