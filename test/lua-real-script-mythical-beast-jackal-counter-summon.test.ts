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
const jackalCode = "91182675";
const counterTargetCode = "911826750";
const summonTargetCode = "911826751";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasJackalScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${jackalCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const counterSpell = 0x1;
const setMythicalBeast = 0x10d;

describe.skipIf(!hasUpstreamScripts || !hasJackalScript)("Lua real script Mythical Beast Jackal counter summon", () => {
  it("restores MZONE counter-release Special Summon and PZONE destroy-counter script shape", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${jackalCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());

    const summon = setupJackalDuel(reader);
    const summonJackal = requireCard(summon, jackalCode);
    const summonTarget = requireCard(summon, summonTargetCode);
    moveFaceUpAttack(summon, summonJackal, 0, 0);
    expect(addDuelCardCounter(summonJackal, counterSpell, 3)).toBe(true);
    registerJackal(summon, workspace);
    const restoredSummon = restoreDuelWithLuaScripts(serializeDuel(summon), workspace, reader);
    expectCleanRestore(restoredSummon);
    expectRestoredLegalActions(restoredSummon, 0);
    expect(restoredSummon.session.state.effects.filter((effect) => effect.sourceUid === summonJackal.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 320, event: "continuous", property: 263168, range: ["spellTrapZone"], triggerEvent: undefined },
      { category: undefined, code: 1002, event: "ignition", property: undefined, range: ["hand"], triggerEvent: undefined },
      { category: undefined, code: 0x10000 + counterSpell, event: "continuous", property: undefined, range: ["monsterZone"], triggerEvent: undefined },
      { category: 8388609, code: undefined, event: "ignition", property: 16, range: ["spellTrapZone"], triggerEvent: undefined },
      { category: undefined, code: 1027, event: "continuous", property: 1024, range: ["monsterZone"], triggerEvent: undefined },
      { category: undefined, code: 1020, event: "continuous", property: 65536, range: ["monsterZone"], triggerEvent: undefined },
      { category: 512, code: undefined, event: "ignition", property: undefined, range: ["monsterZone"], triggerEvent: undefined },
    ]);
    const summonAction = getLuaRestoreLegalActions(restoredSummon, 0).find((action) => action.type === "activateEffect" && action.uid === summonJackal.uid);
    expect(summonAction, JSON.stringify(getLuaRestoreLegalActions(restoredSummon, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummon, summonAction!);
    resolveRestoredChain(restoredSummon);
    expect(restoredSummon.session.state.cards.find((card) => card.uid === summonJackal.uid)).toMatchObject({
      location: "extraDeck",
      faceUp: true,
      reason: duelReason.cost | duelReason.release,
      reasonPlayer: 0,
      reasonCardUid: summonJackal.uid,
      reasonEffectId: 7,
    });
    expect(restoredSummon.session.state.cards.find((card) => card.uid === summonTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
      reason: duelReason.summon | duelReason.specialSummon,
      reasonPlayer: 0,
      reasonCardUid: summonJackal.uid,
      reasonEffectId: 7,
    });
    expect(restoredSummon.session.state.eventHistory.filter((event) => ["counterRemoved", "released", "specialSummoned"].includes(event.eventName))).toEqual([
      {
        eventName: "counterRemoved",
        eventCode: 0x20000,
        eventCardUid: summonJackal.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: summonJackal.uid,
        eventReasonEffectId: 7,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: summonJackal.uid,
        eventReason: duelReason.cost | duelReason.release,
        eventReasonPlayer: 0,
        eventReasonCardUid: summonJackal.uid,
        eventReasonEffectId: 7,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "extraDeck", position: "faceDown", sequence: 0 },
      },
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: summonTarget.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: summonJackal.uid,
        eventReasonEffectId: 7,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventUids: [summonTarget.uid],
      },
    ]);
  });
});

function setupJackalDuel(reader: ReturnType<typeof createCardReader>): DuelSession {
  const session = createDuel({ seed: 91182675, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [jackalCode, counterTargetCode, summonTargetCode] }, 1: { main: [] } });
  startDuel(session);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  return session;
}

function registerJackal(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(jackalCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Mythical Beast Jackal");
  expect(script).toContain("Pendulum.AddProcedure(c)");
  expect(script).toContain("c:EnableCounterPermit(COUNTER_SPELL)");
  expect(script).toContain("Duel.GetFieldGroupCount(tp,LOCATION_PZONE,0)==1");
  expect(script).toContain("Duel.SelectTarget(tp,s.ctfilter,tp,LOCATION_ONFIELD,0,1,1,c)");
  expect(script).toContain("Duel.Destroy(c,REASON_EFFECT)");
  expect(script).toContain("tc:AddCounter(COUNTER_SPELL,1)");
  expect(script).toContain("e2:SetOperation(aux.chainreg)");
  expect(script).toContain("e3:SetCode(EVENT_CHAIN_SOLVING)");
  expect(script).toContain("Duel.IsCanRemoveCounter(tp,1,0,COUNTER_SPELL,3,REASON_COST)");
  expect(script).toContain("Duel.RemoveCounter(tp,1,0,COUNTER_SPELL,3,REASON_COST)");
  expect(script).toContain("Duel.Release(c,REASON_COST)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_DECK,0,1,1,nil,e,tp)");
  expect(script).toContain("Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)");
}

function cards(): DuelCardData[] {
  return [
    { code: jackalCode, name: "Mythical Beast Jackal", kind: "monster", typeFlags: typeMonster | typeEffect | 0x1000000, level: 1, attack: 0, defense: 1400, leftScale: 4, rightScale: 4, setcodes: [setMythicalBeast] },
    { code: counterTargetCode, name: "Jackal Counter Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1000, defense: 1000 },
    { code: summonTargetCode, name: "Jackal Mythical Beast Summon Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1000, setcodes: [setMythicalBeast] },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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
