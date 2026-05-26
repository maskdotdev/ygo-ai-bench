import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const creationCode = "98167225";
const pzoneCode = "981672250";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasCreationScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${creationCode}.lua`));
const counterResonance = 0x211;
const eventCustomVaalmonica = 0x10000000 + 39210885;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const typeSpell = 0x2;
const typeContinuous = 0x20000;
const setVaalmonica = 0x19c;

describe.skipIf(!hasUpstreamScripts || !hasCreationScript)("Lua real script Vaalmonica Creation grave counter custom event", () => {
  it("restores EVENT_TO_GRAVE trigger into PZone Resonance Counters and custom event", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${creationCode}.lua`);
    expectScriptShape(script);
    const source = fixtureSource(workspace);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 98167225, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [creationCode, pzoneCode] }, 1: { main: [] } });
    startDuel(session);

    const creation = requireCard(session, creationCode);
    const pzone = requireCard(session, pzoneCode);
    moveFaceUpSpell(session, creation);
    movePzone(session, pzone);
    expect(addDuelCardCounter(pzone, counterResonance, 1)).toBe(true);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(Number(creationCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(pzoneCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    sendDuelCardToGraveyard(session.state, creation.uid, 0, duelReason.effect, 0);
    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const trigger = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.uid === creation.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, trigger!);

    expect(findCard(restored.session, creation.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
      reasonPlayer: 0,
    });
    expect(getDuelCardCounter(findCard(restored.session, pzone.uid), counterResonance)).toBe(3);
    expect(restored.session.state.eventHistory.filter((event) => ["sentToGraveyard", "counterAdded", "customEvent"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
      eventValue: event.eventValue,
    }))).toEqual([
      { eventCardUid: creation.uid, eventCode: 1014, eventName: "sentToGraveyard", eventReason: duelReason.effect, eventReasonCardUid: undefined, eventReasonEffectId: undefined, eventReasonPlayer: 0, eventValue: undefined },
      { eventCardUid: pzone.uid, eventCode: 0x10000, eventName: "counterAdded", eventReason: duelReason.effect, eventReasonCardUid: creation.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, eventValue: undefined },
      { eventCardUid: pzone.uid, eventCode: eventCustomVaalmonica, eventName: "customEvent", eventReason: 0, eventReasonCardUid: creation.uid, eventReasonEffectId: 4, eventReasonPlayer: 0, eventValue: 1 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: creationCode, name: "Vaalmonica Creation", kind: "spell", typeFlags: typeSpell | typeContinuous, setcodes: [setVaalmonica] },
    { code: pzoneCode, name: "Vaalmonica Creation PZone", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, setcodes: [setVaalmonica], level: 4, attack: 1200, defense: 1200, leftScale: 3, rightScale: 3 },
  ];
}

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      if (name === `c${pzoneCode}.lua`) return "local s,id=GetID(); function s.initial_effect(c) c:EnableCounterPermit(COUNTER_RESONANCE,LOCATION_PZONE) end";
      return workspace.readScript(name);
    },
  };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toContain("e1:SetCode(EFFECT_UPDATE_ATTACK)");
  expect(script).toContain("Duel.GetCounter(e:GetHandlerPlayer(),1,0,COUNTER_RESONANCE)>=6");
  expect(script).toContain("e2:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("eg:IsExists(Card.IsSummonPlayer,1,nil,1-tp)");
  expect(script).toContain("Duel.IsExistingMatchingCard(s.lkfilter,tp,LOCATION_EXTRA,0,1,nil)");
  expect(script).toContain("Duel.LinkSummon(tp,sc)");
  expect(script).toContain("e3:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return e:GetHandler():IsPreviousLocation(LOCATION_HAND|LOCATION_ONFIELD)");
  expect(script).toContain("local ct=c:GetCounter(COUNTER_RESONANCE)");
  expect(script).toContain("return ct<3 and c:IsCanAddCounter(COUNTER_RESONANCE,3-ct)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.ctfilter,tp,LOCATION_PZONE,0,1,1,nil)");
  expect(script).toContain("tc:AddCounter(COUNTER_RESONANCE,3-tc:GetCounter(COUNTER_RESONANCE),true)");
  expect(script).toContain("Duel.RaiseEvent(tc,EVENT_CUSTOM+39210885,e,0,tp,tp,1)");
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

function moveFaceUpSpell(session: DuelSession, card: DuelCardInstance): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  moved.turnId = 0;
}

function movePzone(session: DuelSession, card: DuelCardInstance): void {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
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
