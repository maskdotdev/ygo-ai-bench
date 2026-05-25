import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
const hinezumiCode = "71459017";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasHinezumiScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${hinezumiCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const categoryCounter = 0x800000;
const categoryControl = 0x2000;
const categoryDestroy = 0x1;
const categoryDamage = 0x80000;
const categoryDice = 0x2000000;
const effectCannotBeMaterial = 248;
const counterType = 0x203;

describe.skipIf(!hasUpstreamScripts || !hasHinezumiScript)("Lua real script Hinezumi Hanabi counter control dice", () => {
  it("restores summon counters into End Phase control transfer and dice destroy burn", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${hinezumiCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: "aaaaaaaaad", startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [hinezumiCode] }, 1: { main: [] } });
    startDuel(session);

    const hinezumi = requireCard(session, hinezumiCode);
    moveDuelCard(session.state, hinezumi.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(hinezumiCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === hinezumi.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 66051, countLimit: undefined, event: "continuous", property: undefined, range: ["hand"], triggerEvent: undefined },
      { category: undefined, code: effectCannotBeMaterial, countLimit: undefined, event: "continuous", property: 263168, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: undefined },
      { category: categoryCounter, code: 1100, countLimit: undefined, event: "trigger", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "normalSummoned" },
      { category: categoryCounter, code: 1102, countLimit: undefined, event: "trigger", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "specialSummoned" },
      { category: categoryControl, code: 4608, countLimit: 1, event: "trigger", property: undefined, range: ["monsterZone"], triggerEvent: "phaseEnd" },
      { category: categoryDestroy | categoryDamage | categoryDice, code: 1120, countLimit: undefined, event: "trigger", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "controlChanged" },
    ]);

    const summon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "normalSummon" && action.uid === hinezumi.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, summon!);

    const restoredCounterTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredCounterTrigger);
    expectRestoredLegalActions(restoredCounterTrigger, 0);
    const counterTrigger = getLuaRestoreLegalActions(restoredCounterTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === hinezumi.uid);
    expect(counterTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredCounterTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredCounterTrigger, counterTrigger!);
    passRestoredChain(restoredCounterTrigger);
    expect(getDuelCardCounter(restoredCounterTrigger.session.state.cards.find((card) => card.uid === hinezumi.uid), counterType)).toBe(6);
    restoredCounterTrigger.session.state.phase = "main2";
    restoredCounterTrigger.session.state.waitingFor = 0;

    const restoredEndWindow = restoreDuelWithLuaScripts(serializeDuel(restoredCounterTrigger.session), workspace, reader);
    expectCleanRestore(restoredEndWindow);
    expectRestoredLegalActions(restoredEndWindow, 0);
    const end = getLuaRestoreLegalActions(restoredEndWindow, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(end, JSON.stringify(getLuaRestoreLegalActions(restoredEndWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredEndWindow, end!);
    expect(restoredEndWindow.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        player: 0,
        effectId: "lua-5-4608",
        sourceUid: hinezumi.uid,
        eventName: "phaseEnd",
        eventCode: 4608,
        eventTriggerTiming: "when",
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredControlTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredEndWindow.session), workspace, reader);
    expectCleanRestore(restoredControlTrigger);
    expectRestoredLegalActions(restoredControlTrigger, 0);
    const controlTrigger = getLuaRestoreLegalActions(restoredControlTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === hinezumi.uid && action.effectId === "lua-5-4608"
    );
    expect(controlTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredControlTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredControlTrigger, controlTrigger!);
    passRestoredChain(restoredControlTrigger);
    expect(restoredControlTrigger.session.state.cards.find((card) => card.uid === hinezumi.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: hinezumi.uid,
      reasonEffectId: 5,
    });
    expect(restoredControlTrigger.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        player: 0,
        effectId: "lua-6-1120",
        sourceUid: hinezumi.uid,
        eventName: "controlChanged",
        eventCode: 1120,
        eventPlayer: 1,
        eventCardUid: hinezumi.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: hinezumi.uid,
        eventReasonEffectId: 5,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventTriggerTiming: "when",
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredDiceTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredControlTrigger.session), workspace, reader);
    expectCleanRestore(restoredDiceTrigger);
    expectRestoredLegalActions(restoredDiceTrigger, 0);
    const diceTrigger = getLuaRestoreLegalActions(restoredDiceTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === hinezumi.uid && action.effectId === "lua-6-1120"
    );
    expect(diceTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredDiceTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredDiceTrigger, diceTrigger!);
    passRestoredChain(restoredDiceTrigger);

    expect(restoredDiceTrigger.session.state.lastDiceResults).toEqual([6]);
    expect(restoredDiceTrigger.session.state.cards.find((card) => card.uid === hinezumi.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: hinezumi.uid,
      reasonEffectId: 6,
    });
    expect(getDuelCardCounter(restoredDiceTrigger.session.state.cards.find((card) => card.uid === hinezumi.uid), counterType)).toBe(0);
    expect(restoredDiceTrigger.session.state.players[0].lifePoints).toBe(6000);
    expect(restoredDiceTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "counterAdded", "phaseEnd", "controlChanged", "diceTossed", "counterRemoved", "destroyed", "damageDealt"].includes(event.eventName))).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: hinezumi.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "counterAdded",
        eventCode: 0x10000,
        eventCardUid: hinezumi.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: hinezumi.uid,
        eventReasonEffectId: 3,
        eventPreviousState: { controller: 0, faceUp: false, location: "hand", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      { eventName: "phaseEnd", eventCode: 4608 },
      {
        eventName: "controlChanged",
        eventCode: 1120,
        eventCardUid: hinezumi.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: hinezumi.uid,
        eventReasonEffectId: 5,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "diceTossed",
        eventCode: 1150,
        eventPlayer: 0,
        eventValue: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: hinezumi.uid,
        eventReasonEffectId: 6,
      },
      {
        eventName: "counterRemoved",
        eventCode: 0x20000,
        eventCardUid: hinezumi.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: hinezumi.uid,
        eventReasonEffectId: 6,
        eventPreviousState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: hinezumi.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: hinezumi.uid,
        eventReasonEffectId: 6,
        eventPreviousState: { controller: 1, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventCurrentState: { controller: 1, faceUp: true, location: "graveyard", position: "faceUpAttack", sequence: 0 },
      },
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 0,
        eventValue: 2000,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: hinezumi.uid,
        eventReasonEffectId: 6,
      },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Hinezumi Hanabi");
  expect(script).toContain("c:EnableCounterPermit(0x203)");
  expect(script).toContain("e1:SetCode(EFFECT_CANNOT_BE_MATERIAL)");
  expect(script).toContain("e1:SetValue(aux.cannotmatfilter(SUMMON_TYPE_FUSION,SUMMON_TYPE_SYNCHRO,SUMMON_TYPE_XYZ,SUMMON_TYPE_LINK))");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,3,0,0x203)");
  expect(script).toContain("e:GetHandler():AddCounter(0x203,6)");
  expect(script).toContain("e4:SetCode(EVENT_PHASE+PHASE_END)");
  expect(script).toContain("return Duel.IsTurnPlayer(tp)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_CONTROL,e:GetHandler(),1,0,0)");
  expect(script).toContain("Duel.GetControl(c,1-tp)");
  expect(script).toContain("e5:SetCode(EVENT_CONTROL_CHANGED)");
  expect(script).toContain("e:GetHandler():GetCounter(0x203)>0");
  expect(script).toContain("Duel.TossDice(tp,1)");
  expect(script).toContain("c:RemoveCounter(tp,0x203,ct,REASON_EFFECT)");
  expect(script).toContain("Duel.Destroy(c,REASON_EFFECT)");
  expect(script).toContain("Duel.Damage(tp,2000,REASON_EFFECT)");
}

function cards(): DuelCardData[] {
  return [
    { code: hinezumiCode, name: "Hinezumi Hanabi", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2000, defense: 200 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
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

function passRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
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
