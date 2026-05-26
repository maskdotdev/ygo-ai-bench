import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addDuelCardCounter, getDuelCardCounter } from "#duel/counters.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const servantCode = "92559258";
const deckSpellcasterCode = "925592580";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasServantScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${servantCode}.lua`));
const counterSpell = 0x1;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const raceSpellcaster = 0x2;
const attributeDark = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasServantScript)("Lua real script Servant of Endymion PZone counter summon", () => {
  it("restores PZone Spell Counter cost into self and Deck Special Summon counters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${servantCode}.lua`);
    expectScriptShape(script);
    const source = fixtureSource(workspace);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 92559258, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [servantCode, deckSpellcasterCode] }, 1: { main: [] } });
    startDuel(session);

    const servant = requireCard(session, servantCode);
    const deckSpellcaster = requireCard(session, deckSpellcasterCode);
    movePzone(session, servant);
    expect(addDuelCardCounter(servant, counterSpell, 3)).toBe(true);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(Number(servantCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(deckSpellcasterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const summon = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === servant.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, summon!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, servant.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: servant.uid,
      reasonEffectId: 5,
    });
    expect(findCard(restored.session, deckSpellcaster.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: servant.uid,
      reasonEffectId: 5,
    });
    expect(getDuelCardCounter(findCard(restored.session, servant.uid), counterSpell)).toBe(1);
    expect(getDuelCardCounter(findCard(restored.session, deckSpellcaster.uid), counterSpell)).toBe(1);
    expect(restored.session.state.eventHistory.filter((event) => ["counterRemoved", "specialSummoned", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: servant.uid, eventCode: 0x20000, eventName: "counterRemoved", eventReason: duelReason.cost, eventReasonCardUid: servant.uid, eventReasonEffectId: 5, eventReasonPlayer: 0 },
      { eventCardUid: deckSpellcaster.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: servant.uid, eventReasonEffectId: 5, eventReasonPlayer: 0 },
      { eventCardUid: deckSpellcaster.uid, eventCode: 0x10000, eventName: "counterAdded", eventReason: duelReason.effect, eventReasonCardUid: servant.uid, eventReasonEffectId: 5, eventReasonPlayer: 0 },
      { eventCardUid: servant.uid, eventCode: 0x10000, eventName: "counterAdded", eventReason: duelReason.effect, eventReasonCardUid: servant.uid, eventReasonEffectId: 5, eventReasonPlayer: 0 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: servantCode, name: "Servant of Endymion", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceSpellcaster, attribute: attributeDark, level: 3, attack: 900, defense: 1500, leftScale: 2, rightScale: 2 },
    { code: deckSpellcasterCode, name: "Servant Deck Spell Counter Monster", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceSpellcaster, attribute: attributeDark, level: 4, attack: 1200, defense: 1000 },
  ];
}

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      if (name === `c${deckSpellcasterCode}.lua`) return "local s,id=GetID(); function s.initial_effect(c) c:EnableCounterPermit(COUNTER_SPELL) end";
      return workspace.readScript(name);
    },
  };
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toContain("c:EnableCounterPermit(COUNTER_SPELL,LOCATION_PZONE|LOCATION_MZONE)");
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("e1:SetCode(EVENT_CHAIN_SOLVING)");
  expect(script).toContain("c:AddCounter(COUNTER_SPELL,1)");
  expect(script).toContain("c:RemoveCounter(tp,COUNTER_SPELL,3,REASON_COST)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_DECK,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)==2");
  expect(script).toContain("g:ForEach(Card.AddCounter,COUNTER_SPELL,1)");
  expect(script).toContain("e3:SetCode(EFFECT_DIRECT_ATTACK)");
  expect(script).toContain("Duel.DiscardHand(tp,Card.IsDiscardable,1,1,REASON_COST|REASON_DISCARD)");
  expect(script).toContain("Duel.GetMatchingGroup(aux.FaceupFilter(Card.IsCanAddCounter,COUNTER_SPELL,1),tp,LOCATION_ONFIELD,0,nil)");
  expect(script).toContain("Duel.CheckPendulumZones(tp)");
  expect(script).toContain("Duel.MoveToField(c,tp,tp,LOCATION_PZONE,POS_FACEUP,true)");
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

function movePzone(session: DuelSession, card: DuelCardInstance): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "spellTrapZone", 0);
  moved.faceUp = true;
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
