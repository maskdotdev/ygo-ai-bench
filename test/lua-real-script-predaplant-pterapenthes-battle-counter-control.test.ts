import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { currentLevel } from "#duel/card-stats.js";
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
const pterapenthesCode = "26308721";
const battleTargetCode = "263087210";
const counterTargetCode = "263087211";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasPterapenthesScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${pterapenthesCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const counterPredator = 0x1041;
const categoryCounter = 0x800000;
const categoryControl = 0x2000;
const effectChangeLevel = 131;

describe.skipIf(!hasUpstreamScripts || !hasPterapenthesScript)("Lua real script Predaplant Pterapenthes battle counter control", () => {
  it("restores battle-damage target counter into level change and temporary control", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${pterapenthesCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 26308721, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [pterapenthesCode] }, 1: { main: [battleTargetCode, counterTargetCode] } });
    startDuel(session);

    const pterapenthes = requireCard(session, pterapenthesCode);
    const battleTarget = requireCard(session, battleTargetCode);
    const counterTarget = requireCard(session, counterTargetCode);
    moveFaceUpAttack(session, pterapenthes, 0, 0);
    moveFaceUpAttack(session, battleTarget, 1, 0);
    moveFaceUpAttack(session, counterTarget, 1, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(pterapenthesCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === pterapenthes.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: categoryCounter, code: 1143, countLimit: undefined, event: "trigger", property: 16, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "battleDamageDealt" },
      { category: categoryControl, code: undefined, countLimit: 1, event: "ignition", property: 16, range: ["monsterZone"], triggerEvent: undefined },
    ]);

    const attack = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "declareAttack" && action.attackerUid === pterapenthes.uid && action.targetUid === battleTarget.uid
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, attack!);
    passRestoredUntilPendingTrigger(restoredOpen);
    expect(restoredOpen.session.state.players[1].lifePoints).toBe(7800);
    expect(restoredOpen.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        player: 0,
        effectId: "lua-1-1143",
        sourceUid: pterapenthes.uid,
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: pterapenthes.uid,
        eventPlayer: 1,
        eventValue: 200,
        eventReason: duelReason.battle,
        eventReasonPlayer: 0,
        eventReasonCardUid: pterapenthes.uid,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventTriggerTiming: "when",
        triggerBucket: "turnOptional",
      },
    ]);

    const restoredCounterTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredCounterTrigger);
    expectRestoredLegalActions(restoredCounterTrigger, 0);
    const counterTrigger = getLuaRestoreLegalActions(restoredCounterTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === pterapenthes.uid
    );
    expect(counterTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredCounterTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredCounterTrigger, counterTrigger!);
    passRestoredChain(restoredCounterTrigger);

    expect(getDuelCardCounter(restoredCounterTrigger.session.state.cards.find((card) => card.uid === counterTarget.uid), counterPredator)).toBe(1);
    expect(currentLevel(restoredCounterTrigger.session.state.cards.find((card) => card.uid === counterTarget.uid), restoredCounterTrigger.session.state)).toBe(1);
    expect(restoredCounterTrigger.session.state.effects.filter((effect) => effect.sourceUid === counterTarget.uid && effect.code === effectChangeLevel).map((effect) => ({
      code: effect.code,
      event: effect.event,
      reset: effect.reset,
      sourceUid: effect.sourceUid,
      value: effect.value,
    }))).toEqual([
      { code: effectChangeLevel, event: "continuous", reset: { flags: 33427456 }, sourceUid: counterTarget.uid, value: 1 },
    ]);

    restoredCounterTrigger.session.state.phase = "main2";
    restoredCounterTrigger.session.state.waitingFor = 0;
    restoredCounterTrigger.session.state.chain = [];
    restoredCounterTrigger.session.state.pendingTriggers = [];
    const restoredIgnition = restoreDuelWithLuaScripts(serializeDuel(restoredCounterTrigger.session), workspace, reader);
    expectCleanRestore(restoredIgnition);
    expectRestoredLegalActions(restoredIgnition, 0);
    const control = getLuaRestoreLegalActions(restoredIgnition, 0).find((action) =>
      action.type === "activateEffect" && action.uid === pterapenthes.uid
    );
    expect(control, JSON.stringify(getLuaRestoreLegalActions(restoredIgnition, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredIgnition, control!);
    passRestoredChain(restoredIgnition);

    expect(restoredIgnition.session.state.cards.find((card) => card.uid === counterTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: pterapenthes.uid,
      reasonEffectId: 2,
    });
    expect(restoredIgnition.session.state.eventHistory.filter((event) => ["battleDamageDealt", "counterAdded", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousController: event.eventPreviousState?.controller,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "battleDamageDealt", eventCode: 1143, eventCardUid: pterapenthes.uid, eventPlayer: 1, eventValue: 200, eventReason: duelReason.battle, eventReasonPlayer: 0, eventReasonCardUid: pterapenthes.uid, eventReasonEffectId: undefined, previousController: 0, currentController: 0 },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: counterTarget.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: pterapenthes.uid, eventReasonEffectId: 1, previousController: 1, currentController: 1 },
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: counterTarget.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: pterapenthes.uid, eventReasonEffectId: 2, previousController: 1, currentController: 0 },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Predaplant Pterapenthes");
  expect(script).toContain("e1:SetCode(EVENT_BATTLE_DAMAGE)");
  expect(script).toContain("return ep~=tp");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsCanAddCounter,tp,0,LOCATION_MZONE,1,1,nil,COUNTER_PREDATOR,1)");
  expect(script).toContain("local tc=Duel.GetFirstTarget()");
  expect(script).toContain("tc:AddCounter(COUNTER_PREDATOR,1)");
  expect(script).toContain("e1:SetCode(EFFECT_CHANGE_LEVEL)");
  expect(script).toContain("return e:GetHandler():GetCounter(COUNTER_PREDATOR)>0");
  expect(script).toContain("return c:IsFaceup() and c:IsLevelBelow(mc:GetLevel()) and c:IsControlerCanBeChanged()");
  expect(script).toContain("Duel.SelectTarget(tp,s.ctfilter2,tp,0,LOCATION_MZONE,1,1,nil,c)");
  expect(script).toContain("Duel.GetControl(tc,tp,PHASE_END,1)");
}

function cards(): DuelCardData[] {
  return [
    { code: pterapenthesCode, name: "Predaplant Pterapenthes", kind: "monster", typeFlags: typeMonster | typeEffect, level: 3, attack: 500, defense: 500 },
    { code: battleTargetCode, name: "Pterapenthes Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 2, attack: 300, defense: 300 },
    { code: counterTargetCode, name: "Pterapenthes Counter Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 1600, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.sequence = sequence;
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

function passRestoredUntilPendingTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.pendingBattle && restored.session.state.pendingTriggers.length === 0) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
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
