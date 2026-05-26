import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentAttack } from "#duel/card-stats.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const venomShotCode = "60728397";
const venomConditionCode = "607283970";
const reptileDeckCode = "607283971";
const counterTargetCode = "607283972";
const counterVenom = 0x1009;
const setVenom = 0x50;
const eventCustomVenomSwamp = 0x10000000 + 54306223;
const typeMonster = 0x1;
const typeEffect = 0x20;
const raceReptile = 0x80000;
const raceWarrior = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Venom Shot counter deck send", () => {
  it("restores Venom condition, targeted Venom Counter placement, Reptile Deck send, and zero-ATK custom event", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${venomShotCode}.lua`);
    expectScriptShape(script);

    const reader = createCardReader(cards(workspace));
    const session = createDuel({ seed: 60728397, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [venomShotCode, venomConditionCode, reptileDeckCode] }, 1: { main: [counterTargetCode] } });
    startDuel(session);

    const venomShot = requireCard(session, venomShotCode);
    const venomCondition = requireCard(session, venomConditionCode);
    const reptileDeck = requireCard(session, reptileDeckCode);
    const counterTarget = requireCard(session, counterTargetCode);
    moveDuelCard(session.state, venomShot.uid, "hand", 0);
    moveFaceUpAttack(session, venomCondition, 0);
    moveFaceUpAttack(session, counterTarget, 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = fixtureSource(workspace);
    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(Number(venomShotCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(counterTargetCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects.filter((effect) => effect.sourceUid === venomShot.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
    }))).toEqual([
      { code: 1002, event: "ignition", property: 16, range: ["hand", "spellTrapZone"] },
    ]);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === counterTarget.uid), restoredOpen.session.state)).toBe(1000);
    const activate = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === venomShot.uid);
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, activate!);

    expect(restoredOpen.session.state.chain).toEqual([]);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === reptileDeck.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: venomShot.uid,
      reasonEffectId: 1,
    });
    expect(getDuelCardCounter(restoredOpen.session.state.cards.find((card) => card.uid === counterTarget.uid), counterVenom)).toBe(2);
    expect(currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === counterTarget.uid), restoredOpen.session.state)).toBe(0);
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "sentToGraveyard", "counterAdded", "customEvent"].includes(event.eventName))).toEqual([
      {
        eventName: "becameTarget",
        eventCode: 1028,
        eventCardUid: counterTarget.uid,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventReason: 0,
        eventReasonPlayer: 0,
        relatedEffectId: 1,
        eventChainLinkId: "chain-2",
        eventChainDepth: 1,
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: reptileDeck.uid,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 0 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: venomShot.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "counterAdded",
        eventCode: 0x10000,
        eventCardUid: counterTarget.uid,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: venomShot.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "customEvent",
        eventCode: eventCustomVenomSwamp,
        eventCardUid: counterTarget.uid,
        eventPlayer: 0,
        eventValue: 0,
        eventPreviousState: { controller: 1, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventReason: 0,
        eventReasonPlayer: 0,
        eventReasonCardUid: venomShot.uid,
        eventReasonEffectId: 1,
        relatedEffectId: 1,
        eventUids: [counterTarget.uid],
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: venomShot.uid,
        eventPreviousState: { controller: 0, faceUp: true, location: "spellTrapZone", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "graveyard", position: "faceDown", sequence: 1 },
        eventReason: duelReason.rule,
        eventReasonPlayer: 0,
      },
    ]);

    const restoredResolved = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), source, reader);
    expectCleanRestore(restoredResolved);
    expectRestoredLegalActions(restoredResolved, 0);
    expect(getDuelCardCounter(restoredResolved.session.state.cards.find((card) => card.uid === counterTarget.uid), counterVenom)).toBe(2);
    expect(currentAttack(restoredResolved.session.state.cards.find((card) => card.uid === counterTarget.uid), restoredResolved.session.state)).toBe(0);
  });
});

function cards(workspace: ReturnType<typeof createUpstreamNodeWorkspace>): DuelCardData[] {
  return [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === venomShotCode),
    { code: venomConditionCode, name: "Venom Shot Condition Venom", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, setcodes: [setVenom], level: 4, attack: 1600, defense: 1000 },
    { code: reptileDeckCode, name: "Venom Shot Reptile Send", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceReptile, level: 4, attack: 1200, defense: 1000 },
    { code: counterTargetCode, name: "Venom Shot Counter Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, level: 4, attack: 1000, defense: 1000 },
  ];
}

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      if (name === `c${counterTargetCode}.lua`) return counterTargetScript();
      return workspace.readScript(name);
    },
  };
}

function counterTargetScript(): string {
  return `
local s,id=GetID()
function s.initial_effect(c)
  c:EnableCounterPermit(COUNTER_VENOM,LOCATION_MZONE)
  local e=Effect.CreateEffect(c)
  e:SetType(EFFECT_TYPE_SINGLE)
  e:SetCode(EFFECT_UPDATE_ATTACK)
  e:SetRange(LOCATION_MZONE)
  e:SetValue(function(e,c) return c:GetCounter(COUNTER_VENOM)*-500 end)
  c:RegisterEffect(e)
end
`;
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toContain("Venom Shot");
  expect(script).toContain("e1:SetCategory(CATEGORY_DECKDES)");
  expect(script).toContain("e1:SetProperty(EFFECT_FLAG_CARD_TARGET)");
  expect(script).toContain("return Duel.IsExistingMatchingCard(s.cfilter,tp,LOCATION_MZONE,0,1,nil)");
  expect(script).toContain("return c:IsRace(RACE_REPTILE) and c:IsAbleToGrave()");
  expect(script).toContain("Duel.IsExistingTarget(Card.IsCanAddCounter,tp,0,LOCATION_MZONE,1,nil,COUNTER_VENOM,2)");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsCanAddCounter,tp,0,LOCATION_MZONE,1,1,nil,COUNTER_VENOM,2)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,0,0)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.tgfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_EFFECT)");
  expect(script).toContain("local tc=Duel.GetFirstTarget()");
  expect(script).toContain("tc:AddCounter(COUNTER_VENOM,2)");
  expect(script).toContain("Duel.RaiseEvent(tc,EVENT_CUSTOM+54306223,e,0,0,0,0)");
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
