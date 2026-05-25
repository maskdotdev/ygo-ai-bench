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
const lambdaCode = "17188206";
const rbDeckCode = "171882060";
const rbLinkCode = "171882061";
const controlTargetCode = "171882062";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasLambdaScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${lambdaCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeLink = 0x4000000;
const raceMachine = 0x20;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x10;
const setRb = 0x1ca;
const categoryDestroy = 0x1;
const categoryToGrave = 0x20;
const categoryControl = 0x2000;
const effectFlagDelay = 0x10000;
const effectFlagCardTarget = 0x10;
const quickCountLimitCode = 70402891792;
const allLocations = ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"];

describe.skipIf(!hasUpstreamScripts || !hasLambdaScript)("Lua real script R.B. Lambda Blade send control delayed destroy", () => {
  it("restores summon send-to-GY trigger and LP-cost linked control with delayed End Phase destroy", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${lambdaCode}.lua`));
    const reader = createCardReader(cards());

    const summon = createRestoredSummonField({ reader, workspace });
    expect(summon.restored.session.state.effects.filter((effect) => effect.sourceUid === summon.lambda.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      countLimitCode: effect.countLimitCode,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      sourceUid: effect.sourceUid,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: categoryToGrave, code: 1100, countLimit: 1, countLimitCode: Number(lambdaCode), event: "trigger", property: effectFlagDelay, range: allLocations, sourceUid: summon.lambda.uid, triggerEvent: "normalSummoned" },
      { category: categoryToGrave, code: 1102, countLimit: 1, countLimitCode: Number(lambdaCode), event: "trigger", property: effectFlagDelay, range: allLocations, sourceUid: summon.lambda.uid, triggerEvent: "specialSummoned" },
      { category: categoryDestroy | categoryControl, code: 1002, countLimit: 1, countLimitCode: quickCountLimitCode, event: "quick", property: effectFlagCardTarget, range: ["monsterZone"], sourceUid: summon.lambda.uid, triggerEvent: undefined },
    ]);
    const normalSummon = getLuaRestoreLegalActions(summon.restored, 0).find((action) =>
      action.type === "normalSummon" && action.uid === summon.lambda.uid
    );
    expect(normalSummon, JSON.stringify(getLuaRestoreLegalActions(summon.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(summon.restored, normalSummon!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(summon.restored.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === summon.lambda.uid && action.effectId === "lua-1-1100"
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    passRestoredChain(restoredTrigger);

    expect(findCard(restoredTrigger.session, summon.rbDeck.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: summon.lambda.uid,
      reasonEffectId: 1,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["normalSummoned", "sentToGraveyard"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      currentLocation: event.eventCurrentState?.location,
    }))).toEqual([
      { eventName: "normalSummoned", eventCode: 1100, eventCardUid: summon.lambda.uid, eventReason: duelReason.summon, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previousLocation: "hand", currentLocation: "monsterZone" },
      { eventName: "sentToGraveyard", eventCode: 1014, eventCardUid: summon.rbDeck.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: summon.lambda.uid, eventReasonEffectId: 1, previousLocation: "deck", currentLocation: "graveyard" },
    ]);

    const control = createRestoredControlField({ reader, workspace });
    const quick = getLuaRestoreLegalActions(control.restored, 0).find((action) =>
      action.type === "activateEffect" && action.uid === control.lambda.uid && action.effectId === "lua-3-1002"
    );
    expect(quick, JSON.stringify(getLuaRestoreLegalActions(control.restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(control.restored, quick!);
    passRestoredChain(control.restored);

    expect(control.restored.session.state.players[0]?.lifePoints).toBe(6600);
    expect(findCard(control.restored.session, control.lambda.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: control.lambda.uid,
      reasonEffectId: 3,
    });
    expect(findCard(control.restored.session, control.controlTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: control.lambda.uid,
      reasonEffectId: 3,
    });
    expect(control.restored.session.state.effects.find((effect) =>
      effect.event === "continuous" && effect.code === 0x1200 && effect.sourceUid === control.lambda.uid
    )).toMatchObject({
      labelObjectUids: [control.controlTarget.uid],
      reset: { flags: 0, count: 0 },
    });
    expect(control.restored.session.state.eventHistory.filter((event) => ["lifePointCostPaid", "becameTarget", "destroyed", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventPlayer: event.eventPlayer,
      eventValue: event.eventValue,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      relatedEffectId: event.relatedEffectId,
      previousLocation: event.eventPreviousState?.location,
      previousController: event.eventPreviousState?.controller,
      currentLocation: event.eventCurrentState?.location,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "lifePointCostPaid", eventCode: 1201, eventCardUid: undefined, eventPlayer: 0, eventValue: 1400, eventReason: duelReason.cost, eventReasonPlayer: 0, eventReasonCardUid: control.lambda.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previousLocation: undefined, previousController: undefined, currentLocation: undefined, currentController: undefined },
      { eventName: "becameTarget", eventCode: 1028, eventCardUid: control.controlTarget.uid, eventPlayer: undefined, eventValue: undefined, eventReason: 0, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, relatedEffectId: 3, previousLocation: "deck", previousController: 1, currentLocation: "monsterZone", currentController: 1 },
      { eventName: "destroyed", eventCode: 1029, eventCardUid: control.lambda.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect | duelReason.destroy, eventReasonPlayer: 0, eventReasonCardUid: control.lambda.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previousLocation: "monsterZone", previousController: 0, currentLocation: "graveyard", currentController: 0 },
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: control.controlTarget.uid, eventPlayer: undefined, eventValue: undefined, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: control.lambda.uid, eventReasonEffectId: 3, relatedEffectId: undefined, previousLocation: "monsterZone", previousController: 1, currentLocation: "monsterZone", currentController: 0 },
    ]);

    const restoredEnd = restoreDuelWithLuaScripts(serializeDuel(control.restored.session), workspace, reader);
    expectCleanRestore(restoredEnd);
    advanceRestoredToEndTurn(restoredEnd, 1);
    expect(findCard(restoredEnd.session, control.controlTarget.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.destroy,
      reasonPlayer: 0,
      reasonCardUid: control.lambda.uid,
      reasonEffectId: 4,
    });
  });
});

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--R.B. Lambda Blade");
  expect(script).toContain("e1a:SetCategory(CATEGORY_TOGRAVE)");
  expect(script).toContain("e1a:SetProperty(EFFECT_FLAG_DELAY)");
  expect(script).toContain("e1a:SetCode(EVENT_SUMMON_SUCCESS)");
  expect(script).toContain("e1b:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("Duel.SelectMatchingCard(tp,s.tgfilter,tp,LOCATION_DECK,0,1,1,nil)");
  expect(script).toContain("Duel.SendtoGrave(g,REASON_EFFECT)");
  expect(script).toContain("e2:SetCost(Cost.PayLP(1400))");
  expect(script).toContain("Duel.IsMainPhase(1-tp)");
  expect(script).toContain("Duel.GetMZoneCount(tp,c,tp,LOCATION_REASON_CONTROL)>0");
  expect(script).toContain("Duel.SelectTarget(tp,Card.IsAbleToChangeControler,tp,0,LOCATION_MZONE,1,1,nil)");
  expect(script).toContain("Duel.Destroy(c,REASON_EFFECT)>0");
  expect(script).toContain("Duel.GetControl(tc,tp)");
  expect(script).toContain("aux.DelayedOperation(tc,PHASE_END,id,e,tp,function(ag) Duel.Destroy(ag,REASON_EFFECT) end,nil,0,0,aux.Stringid(id,2))");
}

function createRestoredSummonField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}) {
  const session = createDuel({ seed: 17188206, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [lambdaCode, rbDeckCode] }, 1: { main: [] } });
  startDuel(session);
  const lambda = requireCard(session, lambdaCode);
  const rbDeck = requireCard(session, rbDeckCode);
  moveDuelCard(session.state, lambda.uid, "hand", 0);
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
  const restored = registerAndRestore(session, workspace, reader);
  expectCleanRestore(restored);
  expectRestoredLegalActions(restored, 0);
  return { restored, lambda, rbDeck };
}

function createRestoredControlField({
  reader,
  workspace,
}: {
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
}) {
  const session = createDuel({ seed: 17188207, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [lambdaCode], extra: [rbLinkCode] }, 1: { main: [controlTargetCode] } });
  startDuel(session);
  const lambda = requireCard(session, lambdaCode);
  const rbLink = requireCard(session, rbLinkCode);
  const controlTarget = requireCard(session, controlTargetCode);
  moveFaceUpAttack(session, lambda, 0, 0);
  moveFaceUpAttack(session, rbLink, 0, 5);
  moveFaceUpAttack(session, controlTarget, 1, 1);
  session.state.phase = "main1";
  session.state.turnPlayer = 1;
  session.state.waitingFor = 0;
  const restored = registerAndRestore(session, workspace, reader);
  expectCleanRestore(restored);
  expectRestoredLegalActions(restored, 0);
  return { restored, lambda, rbLink, controlTarget };
}

function registerAndRestore(
  session: DuelSession,
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>,
  reader: ReturnType<typeof createCardReader>,
) {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(lambdaCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function cards(): DuelCardData[] {
  return [
    { code: lambdaCode, name: "R.B. Lambda Blade", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeDark, level: 4, attack: 1500, defense: 1500, setcodes: [setRb] },
    { code: rbDeckCode, name: "R.B. Deck Send Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeDark, level: 4, attack: 1200, defense: 1000, setcodes: [setRb] },
    { code: rbLinkCode, name: "R.B. Linked Link Monster", kind: "extra", typeFlags: typeMonster | typeEffect | typeLink, race: raceMachine, attribute: attributeDark, level: 4, attack: 2000, defense: 0, linkMarkers: 0x1, setcodes: [setRb] },
    { code: controlTargetCode, name: "R.B. Lambda Control Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 1000 },
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

function advanceRestoredToEndTurn(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: PlayerId): void {
  for (const phase of ["battle", "main2", "end"] as const) {
    if (restored.session.state.turnPlayer !== player) return;
    if (restored.session.state.phase === phase) continue;
    const action = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
    if (!action) continue;
    applyRestoredActionAndAssert(restored, action);
  }
}

function findCard(session: DuelSession, uid: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.uid === uid);
  expect(card).toBeDefined();
  return card!;
}
