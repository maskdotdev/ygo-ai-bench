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
const locomotionCode = "38354937";
const tunerCode = "383549370";
const darkNonTunerCode = "383549371";
const highTargetCode = "383549372";
const lowTargetCode = "383549373";
const facedownDecoyCode = "383549374";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasLocomotionScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${locomotionCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeTuner = 0x1000;
const typeSynchro = 0x2000;
const raceMachine = 0x20;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const setGenex = 0x2;
const summonTypeSynchro = 0x41000000;
const eventSpecialSummonSuccess = 1102;
const categoryControl = 0x2000;

describe.skipIf(!hasUpstreamScripts || !hasLocomotionScript)("Lua real script Locomotion R-Genex synchro level control", () => {
  it("restores Synchro Summon success into highest-Level opponent control", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    expectScriptShape(workspace.readScript(`official/c${locomotionCode}.lua`));
    const reader = createCardReader(cards());
    const session = createDuel({ seed: 38354937, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [tunerCode, darkNonTunerCode], extra: [locomotionCode] }, 1: { main: [highTargetCode, lowTargetCode, facedownDecoyCode] } });
    startDuel(session);

    const locomotion = requireCard(session, locomotionCode);
    const tuner = requireCard(session, tunerCode);
    const darkNonTuner = requireCard(session, darkNonTunerCode);
    const highTarget = requireCard(session, highTargetCode);
    const lowTarget = requireCard(session, lowTargetCode);
    const facedownDecoy = requireCard(session, facedownDecoyCode);
    moveFaceUpAttack(session, tuner, 0, 0);
    moveFaceUpAttack(session, darkNonTuner, 0, 1);
    moveFaceUpAttack(session, highTarget, 1, 0);
    moveFaceUpAttack(session, lowTarget, 1, 1);
    moveFaceDownDefense(session, facedownDecoy, 1, 2);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(locomotionCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(locomotion.data).toMatchObject({
      synchroTunerMin: 1,
      synchroTunerMax: 1,
      synchroTunerSetcode: setGenex,
      synchroNonTunerMin: 1,
      synchroNonTunerMax: 99,
      synchroNonTunerAttribute: attributeDark,
    });

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    const synchroSummon = getLuaRestoreLegalActions(restoredOpen, 0).find((action) =>
      action.type === "synchroSummon" && action.uid === locomotion.uid
    );
    expect(synchroSummon, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, synchroSummon!);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredOpen.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.effects.filter((effect) => effect.sourceUid === locomotion.uid).map((effect) => ({
      category: effect.category,
      code: effect.code,
      event: effect.event,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: undefined, code: 31, event: "continuous", property: 263168, range: ["monsterZone"], triggerEvent: undefined },
      { category: categoryControl, code: eventSpecialSummonSuccess, event: "trigger", property: undefined, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "specialSummoned" },
    ]);
    expect(restoredTrigger.session.state.pendingTriggers.map((trigger) => ({
      effectId: trigger.effectId,
      eventCardUid: trigger.eventCardUid,
      eventCode: trigger.eventCode,
      eventName: trigger.eventName,
      eventReason: trigger.eventReason,
      eventReasonPlayer: trigger.eventReasonPlayer,
      player: trigger.player,
      sourceUid: trigger.sourceUid,
      triggerBucket: trigger.triggerBucket,
    }))).toEqual([
      {
        effectId: `lua-3-${eventSpecialSummonSuccess}`,
        eventCardUid: locomotion.uid,
        eventCode: eventSpecialSummonSuccess,
        eventName: "specialSummoned",
        eventReason: duelReason.summon | duelReason.specialSummon | duelReason.synchro,
        eventReasonPlayer: 0,
        player: 0,
        sourceUid: locomotion.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const activate = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) =>
      action.type === "activateTrigger" && action.uid === locomotion.uid
    );
    expect(activate, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, activate!);

    expect(findCard(restoredTrigger.session, highTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      data: { level: 7 },
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: locomotion.uid,
      reasonEffectId: 3,
    });
    expect(findCard(restoredTrigger.session, lowTarget.uid)).toMatchObject({ location: "monsterZone", controller: 1, data: { level: 4 } });
    expect(findCard(restoredTrigger.session, facedownDecoy.uid)).toMatchObject({ location: "monsterZone", controller: 1, faceUp: false, data: { level: 8 } });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["specialSummoned", "controlChanged"].includes(event.eventName)).map((event) => ({
      eventName: event.eventName,
      eventCode: event.eventCode,
      eventCardUid: event.eventCardUid,
      eventReason: event.eventReason,
      eventReasonPlayer: event.eventReasonPlayer,
      eventReasonCardUid: event.eventReasonCardUid,
      eventReasonEffectId: event.eventReasonEffectId,
      previousLocation: event.eventPreviousState?.location,
      previousController: event.eventPreviousState?.controller,
      currentLocation: event.eventCurrentState?.location,
      currentController: event.eventCurrentState?.controller,
    }))).toEqual([
      { eventName: "specialSummoned", eventCode: eventSpecialSummonSuccess, eventCardUid: locomotion.uid, eventReason: duelReason.summon | duelReason.specialSummon | duelReason.synchro, eventReasonPlayer: 0, eventReasonCardUid: undefined, eventReasonEffectId: undefined, previousLocation: "extraDeck", previousController: 0, currentLocation: "monsterZone", currentController: 0 },
      { eventName: "controlChanged", eventCode: 1120, eventCardUid: highTarget.uid, eventReason: duelReason.effect, eventReasonPlayer: 0, eventReasonCardUid: locomotion.uid, eventReasonEffectId: 3, previousLocation: "monsterZone", previousController: 1, currentLocation: "monsterZone", currentController: 0 },
    ]);
  });
});

function cards(): DuelCardData[] {
  return [
    { code: locomotionCode, name: "Locomotion R-Genex", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: raceMachine, attribute: attributeDark, level: 9, attack: 2500, defense: 2000, setcodes: [setGenex] },
    { code: tunerCode, name: "Locomotion Genex Tuner", kind: "monster", typeFlags: typeMonster | typeTuner, race: raceMachine, attribute: attributeDark, level: 3, attack: 1000, defense: 1000, setcodes: [setGenex] },
    { code: darkNonTunerCode, name: "Locomotion DARK Non-Tuner", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceMachine, attribute: attributeDark, level: 6, attack: 1800, defense: 1200 },
    { code: highTargetCode, name: "Locomotion Highest-Level Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 7, attack: 2300, defense: 1800 },
    { code: lowTargetCode, name: "Locomotion Low-Level Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000 },
    { code: facedownDecoyCode, name: "Locomotion Facedown High-Level Decoy", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 8, attack: 2500, defense: 2000 },
  ];
}

function expectScriptShape(script: string | undefined): void {
  expect(script).toBeDefined();
  if (!script) return;
  expect(script).toContain("--Locomotion R-Genex");
  expect(script).toContain("Synchro.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_GENEX),1,1,Synchro.NonTunerEx(Card.IsAttribute,ATTRIBUTE_DARK),1,99)");
  expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
  expect(script).toContain("e1:SetCode(EVENT_SPSUMMON_SUCCESS)");
  expect(script).toContain("return e:GetHandler():IsSynchroSummoned()");
  expect(script).toContain("return c:IsFaceup() and c:HasLevel()");
  expect(script).toContain("Duel.GetMatchingGroup(s.filter,tp,0,LOCATION_MZONE,nil)");
  expect(script).toContain("local sg=g:GetMaxGroup(Card.GetLevel)");
  expect(script).toContain("Duel.GetControl(tc,tp)");
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

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
}

function moveFaceDownDefense(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): void {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
  moved.sequence = sequence;
  moved.faceUp = false;
  moved.position = "faceDownDefense";
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
