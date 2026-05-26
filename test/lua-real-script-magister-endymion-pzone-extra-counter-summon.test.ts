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
const magisterCode = "66104644";
const extraSpellcasterCode = "661046440";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMagisterScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${magisterCode}.lua`));
const counterSpell = 0x1;
const typeMonster = 0x1;
const typeEffect = 0x20;
const typePendulum = 0x1000000;
const raceSpellcaster = 0x2;
const attributeEarth = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasMagisterScript)("Lua real script Magister of Endymion PZone Extra Deck counter summon", () => {
  it("restores PZone Spell Counter cost into self and face-up Extra Deck Special Summon counters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${magisterCode}.lua`);
    expectScriptShape(script);
    const source = fixtureSource(workspace);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 66104644, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [magisterCode], extra: [extraSpellcasterCode] }, 1: { main: [] } });
    startDuel(session);

    const magister = requireCard(session, magisterCode);
    const extraSpellcaster = requireCard(session, extraSpellcasterCode);
    movePzone(session, magister);
    makeFaceUpExtraDeckPendulum(extraSpellcaster);
    expect(addDuelCardCounter(magister, counterSpell, 3)).toBe(true);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, source);
    expect(host.loadCardScript(Number(magisterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(extraSpellcasterCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restored);
    expectRestoredLegalActions(restored, 0);
    const summon = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.uid === magister.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, summon!);
    resolveRestoredChain(restored);

    expect(findCard(restored.session, magister.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: magister.uid,
      reasonEffectId: 5,
    });
    expect(findCard(restored.session, extraSpellcaster.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: magister.uid,
      reasonEffectId: 5,
    });
    expect(getDuelCardCounter(findCard(restored.session, magister.uid), counterSpell)).toBe(1);
    expect(getDuelCardCounter(findCard(restored.session, extraSpellcaster.uid), counterSpell)).toBe(1);
    expect(restored.session.state.eventHistory.filter((event) => ["counterRemoved", "specialSummoned", "counterAdded"].includes(event.eventName)).map((event) => ({
      eventCardUid: event.eventCardUid,
      eventCode: event.eventCode,
      eventName: event.eventName,
      eventReason: event.eventReason,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      eventReasonPlayer: event.eventReasonPlayer,
    }))).toEqual([
      { eventCardUid: magister.uid, eventCode: 0x20000, eventName: "counterRemoved", eventReason: duelReason.cost, eventReasonCardUid: magister.uid, eventReasonEffectId: 5, eventReasonPlayer: 0 },
      { eventCardUid: extraSpellcaster.uid, eventCode: 1102, eventName: "specialSummoned", eventReason: duelReason.summon | duelReason.specialSummon, eventReasonCardUid: magister.uid, eventReasonEffectId: 5, eventReasonPlayer: 0 },
      { eventCardUid: extraSpellcaster.uid, eventCode: 0x10000, eventName: "counterAdded", eventReason: duelReason.effect, eventReasonCardUid: magister.uid, eventReasonEffectId: 5, eventReasonPlayer: 0 },
      { eventCardUid: magister.uid, eventCode: 0x10000, eventName: "counterAdded", eventReason: duelReason.effect, eventReasonCardUid: magister.uid, eventReasonEffectId: 5, eventReasonPlayer: 0 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: magisterCode, name: "Magister of Endymion", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceSpellcaster, attribute: attributeEarth, level: 3, attack: 1500, defense: 900, leftScale: 8, rightScale: 8 },
    { code: extraSpellcasterCode, name: "Magister Face-up Extra Spell Counter Monster", kind: "monster", typeFlags: typeMonster | typeEffect | typePendulum, race: raceSpellcaster, attribute: attributeEarth, level: 4, attack: 1600, defense: 1000, leftScale: 2, rightScale: 2 },
  ];
}

function fixtureSource(workspace: ReturnType<typeof createUpstreamNodeWorkspace>) {
  return {
    readScript(name: string) {
      if (name === `c${extraSpellcasterCode}.lua`) return "local s,id=GetID(); function s.initial_effect(c) c:EnableCounterPermit(COUNTER_SPELL,LOCATION_PZONE|LOCATION_MZONE) end";
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
  expect(script).toContain("Duel.GetLocationCountFromEx(tp)>0");
  expect(script).toContain("Duel.GetUsableMZoneCount(tp)>1");
  expect(script).toContain("Duel.SelectMatchingCard(tp,aux.FaceupFilter(s.spfilter,e,tp),tp,LOCATION_EXTRA,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)==2");
  expect(script).toContain("g:ForEach(Card.AddCounter,COUNTER_SPELL,1)");
  expect(script).toContain("e3:SetCode(EVENT_ATTACK_ANNOUNCE)");
  expect(script).toContain("Duel.RemoveCounter(tp,1,0,COUNTER_SPELL,3,REASON_COST)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_DECK,0,1,1,nil,e,tp)");
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

function makeFaceUpExtraDeckPendulum(card: DuelCardInstance): void {
  card.faceUp = true;
  card.position = "faceUpAttack";
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
