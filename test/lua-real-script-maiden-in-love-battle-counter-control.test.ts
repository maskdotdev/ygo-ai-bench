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
import type { LuaPromptDecision } from "#lua/host-types.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const maidenCode = "8445808";
const targetCode = "84458080";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMaidenScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${maidenCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const counterMaiden = 0x1090;
const categoryCounter = 0x800000;
const categoryControl = 0x2000;

describe.skipIf(!hasUpstreamScripts || !hasMaidenScript)("Lua real script Maiden in Love battle counter control", () => {
  it("restores Damage Step End SelectEffect branches into counter placement and control take", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const script = workspace.readScript(`official/c${maidenCode}.lua`);
    expectScriptShape(script);
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 8445808, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [maidenCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const maiden = requireCard(session, maidenCode);
    const target = requireCard(session, targetCode);
    moveFaceUpAttack(session, maiden, 0);
    moveFaceUpAttack(session, target, 1);
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(maidenCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 1);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === maiden.uid).map((effect) => ({
      code: effect.code,
      event: effect.event,
      range: effect.range,
      targetRange: effect.targetRange,
      value: effect.value,
    }))).toEqual([
      { code: 191, event: "continuous", range: ["monsterZone"], targetRange: [0, 4], value: undefined },
      { code: 344, event: "continuous", range: ["monsterZone"], targetRange: [0, 4], value: undefined },
      { code: 42, event: "continuous", range: ["monsterZone"], targetRange: undefined, value: 1 },
      { code: 1141, event: "trigger", range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], targetRange: undefined, value: undefined },
    ]);

    attackAndReachDamageEnd(restoredOpen, 1, target.uid, maiden.uid);
    expect(restoredOpen.session.state.pendingTriggers.map(({ id: _id, ...trigger }) => trigger)).toEqual([
      {
        player: 0,
        effectId: "lua-4-1141",
        sourceUid: maiden.uid,
        eventName: "damageStepEnded",
        eventCode: 1141,
        eventCardUid: maiden.uid,
        eventPlayer: 0,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 0 },
        eventCurrentState: { controller: 0, faceUp: true, location: "monsterZone", position: "faceUpAttack", sequence: 0 },
        eventUids: [target.uid, maiden.uid],
        eventTriggerTiming: "when",
        triggerBucket: "opponentOptional",
      },
    ]);

    const restoredCounterChoice = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredCounterChoice);
    expectRestoredLegalActions(restoredCounterChoice, 0);
    const addCounter = getLuaRestoreLegalActions(restoredCounterChoice, 0).find((action) => action.type === "activateTrigger" && action.uid === maiden.uid);
    expect(addCounter, JSON.stringify(getLuaRestoreLegalActions(restoredCounterChoice, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredCounterChoice, addCounter!);
    passRestoredChain(restoredCounterChoice);
    expect(restoredCounterChoice.host.promptDecisions.filter(isSelectEffectPrompt).map((prompt) => ({
      api: prompt.api,
      player: prompt.player,
      options: prompt.options,
      returned: prompt.returned,
    }))).toEqual([{ api: "SelectEffect", player: 0, options: [1], returned: 1 }]);
    expect(getDuelCardCounter(restoredCounterChoice.session.state.cards.find((card) => card.uid === target.uid), counterMaiden)).toBe(1);
    expect(restoredCounterChoice.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({ location: "monsterZone", controller: 1 });

    prepareSecondBattle(restoredCounterChoice.session);
    const restoredControlBattle = restoreDuelWithLuaScripts(serializeDuel(restoredCounterChoice.session), workspace, reader, {
      promptOverrides: [{ api: "SelectEffect", player: 0, returned: 2 }],
    });
    expectCleanRestore(restoredControlBattle);
    expectRestoredLegalActions(restoredControlBattle, 1);
    attackAndReachDamageEnd(restoredControlBattle, 1, target.uid, maiden.uid);

    const restoredControlChoice = restoreDuelWithLuaScripts(serializeDuel(restoredControlBattle.session), workspace, reader, {
      promptOverrides: [{ api: "SelectEffect", player: 0, returned: 2 }],
    });
    expectCleanRestore(restoredControlChoice);
    expectRestoredLegalActions(restoredControlChoice, 0);
    const takeControl = getLuaRestoreLegalActions(restoredControlChoice, 0).find((action) => action.type === "activateTrigger" && action.uid === maiden.uid);
    expect(takeControl, JSON.stringify(getLuaRestoreLegalActions(restoredControlChoice, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredControlChoice, takeControl!);
    passRestoredChain(restoredControlChoice);

    expect(restoredControlChoice.host.promptDecisions.filter(isSelectEffectPrompt).map((prompt) => ({
      api: prompt.api,
      player: prompt.player,
      options: prompt.options,
      returned: prompt.returned,
    }))).toEqual([{ api: "SelectEffect", player: 0, options: [1, 2], returned: 2 }]);
    expect(restoredControlChoice.session.state.cards.find((card) => card.uid === target.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: maiden.uid,
      reasonEffectId: 4,
    });
    expect(restoredControlChoice.session.state.eventHistory.filter((event) => ["damageStepEnded", "counterAdded", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousController: event.eventPreviousState?.controller,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "damageStepEnded", eventCode: 1141, eventCardUid: target.uid, eventReason: 0, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previousController: 1, currentController: 1 },
      { eventName: "counterAdded", eventCode: 0x10000, eventCardUid: target.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: maiden.uid, eventReasonEffectId: 4, previousController: 1, currentController: 1 },
      { eventName: "damageStepEnded", eventCode: 1141, eventCardUid: target.uid, eventReason: 0, eventReasonPlayer: 1, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previousController: 1, currentController: 1 },
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: target.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: maiden.uid, eventReasonEffectId: 4, previousController: 1, currentController: 0 },
    ]);
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Maiden in Love");
  expect(script).toContain("e1:SetCode(EFFECT_MUST_ATTACK)");
  expect(script).toContain("e2:SetCode(EFFECT_MUST_ATTACK_MONSTER)");
  expect(script).toContain("e3:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)");
  expect(script).toContain("e4:SetCode(EVENT_DAMAGE_STEP_END)");
  expect(script).toContain("return c:GetBattleTarget() and c:IsStatus(STATUS_OPPO_BATTLE)");
  expect(script).toContain("Duel.SelectEffect(tp,");
  expect(script).toContain("Duel.IsExistingMatchingCard(Card.IsCanAddCounter,tp,0,LOCATION_MZONE,1,nil,COUNTER_MAIDEN,1)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_COUNTER,nil,1,tp,COUNTER_MAIDEN)");
  expect(script).toContain("Duel.GetMatchingGroup(s.controlfilter,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("Duel.SetOperationInfo(0,CATEGORY_CONTROL,g,1,tp,0)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,Card.IsCanAddCounter,tp,0,LOCATION_MZONE,1,1,nil,COUNTER_MAIDEN,1)");
  expect(script).toContain("sc:AddCounter(COUNTER_MAIDEN,1)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.controlfilter,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.GetControl(sc,tp)");
}

function cards(): DuelCardData[] {
  return [
    { code: maidenCode, name: "Maiden in Love", kind: "monster", typeFlags: typeMonster | typeEffect, level: 2, attack: 400, defense: 300 },
    { code: targetCode, name: "Maiden Battle Target", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4, attack: 2000, defense: 1000 },
  ];
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, player: PlayerId): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", player);
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function prepareSecondBattle(session: DuelSession): void {
  session.state.phase = "battle";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 1;
  session.state.chain = [];
  session.state.pendingTriggers = [];
  delete session.state.pendingBattle;
  delete session.state.currentAttack;
  delete session.state.battleStep;
  delete session.state.battleWindow;
  session.state.attacksDeclared = [];
  session.state.attackPasses = [];
  session.state.damagePasses = [];
}

function isSelectEffectPrompt(prompt: LuaPromptDecision): prompt is Extract<LuaPromptDecision, { options: number[] }> {
  return prompt.api === "SelectEffect";
}

function attackAndReachDamageEnd(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId, attackerUid: string, targetUid: string): void {
  const attack = getLuaRestoreLegalActions(restored, player).find((action) =>
    action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid
  );
  expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
  applyRestoredActionAndAssert(restored, attack!);
  passRestoredUntilPendingTrigger(restored);
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
