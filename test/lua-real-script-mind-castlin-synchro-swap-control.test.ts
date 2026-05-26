import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, sendDuelCardToGraveyard, serializeDuel, startDuel } from "#duel/core.js";
import { markProcedureComplete } from "#duel/procedure-status.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelCardInstance, DuelEventRecord, DuelSession, PlayerId } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const mindCastlinCode = "12172567";
const ownTargetCode = "121725670";
const opponentTargetCode = "121725671";
const graveOwnTargetCode = "121725672";
const graveOpponentTargetCode = "121725673";
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasMindCastlinScript = fs.existsSync(path.join(upstreamRoot, "script", "official", `c${mindCastlinCode}.lua`));
const typeMonster = 0x1;
const typeEffect = 0x20;
const typeSynchro = 0x2000;
const typeTuner = 0x1000;
const racePsychic = 0x800;
const raceWarrior = 0x1;
const attributeDark = 0x20;
const attributeEarth = 0x1;
const categoryControl = 0x2000;

describe.skipIf(!hasUpstreamScripts || !hasMindCastlinScript)("Lua real script Mind Castlin Synchro swap control", () => {
  it("restores ignition SwapControl between itself and an opponent face-up monster", () => {
    const { workspace, reader, session } = createFixture(12172567);
    expectScriptShape(workspace.readScript(`official/c${mindCastlinCode}.lua`) ?? "");
    const castlin = requireCard(session, mindCastlinCode);
    const opponent = requireCard(session, opponentTargetCode);
    moveSynchroFaceUp(session, castlin, 0, 0);
    moveFaceUpAttack(session, opponent, 1, 0);
    prepareMainPhase(session);
    registerMindCastlin(session, workspace);

    const restoredOpen = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredOpen);
    expectRestoredLegalActions(restoredOpen, 0);
    expect(restoredOpen.session.state.effects.filter((effect) => effect.sourceUid === castlin.uid && effect.category === categoryControl).map((effect) => ({
      category: effect.category,
      code: effect.code,
      countLimit: effect.countLimit,
      event: effect.event,
      id: effect.id,
      property: effect.property,
      range: effect.range,
      triggerEvent: effect.triggerEvent,
    }))).toEqual([
      { category: categoryControl, code: undefined, countLimit: 1, event: "ignition", id: "lua-3", property: 0x10, range: ["monsterZone"], triggerEvent: undefined },
      { category: categoryControl, code: 1014, countLimit: 1, event: "trigger", id: "lua-4-1014", property: 0x10010, range: ["deck", "hand", "monsterZone", "spellTrapZone", "graveyard", "banished", "extraDeck", "overlay"], triggerEvent: "sentToGraveyard" },
    ]);
    const swap = getLuaRestoreLegalActions(restoredOpen, 0).find((action) => action.type === "activateEffect" && action.uid === castlin.uid && action.effectId === "lua-3");
    expect(swap, JSON.stringify(getLuaRestoreLegalActions(restoredOpen, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredOpen, swap!);
    resolveRestoredChain(restoredOpen);

    expect(restoredOpen.session.state.cards.find((card) => card.uid === castlin.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      previousController: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: castlin.uid,
      reasonEffectId: 3,
    });
    expect(restoredOpen.session.state.cards.find((card) => card.uid === opponent.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: castlin.uid,
      reasonEffectId: 3,
    });
    expect(restoredOpen.session.state.eventHistory.filter((event) => ["becameTarget", "controlChanged"].includes(event.eventName)).map(controlEventSummary)).toMatchInlineSnapshot(`
      [
        {
          "currentController": 1,
          "currentLocation": "monsterZone",
          "eventCardUid": "p1-deck-121725671-0",
          "eventCode": 1028,
          "eventName": "becameTarget",
          "eventReason": 0,
          "eventReasonCardUid": undefined,
          "eventReasonEffectId": undefined,
          "eventReasonPlayer": 0,
          "previousController": 1,
          "previousLocation": "deck",
        },
        {
          "currentController": 1,
          "currentLocation": "monsterZone",
          "eventCardUid": "p0-extraDeck-12172567-0",
          "eventCode": 1120,
          "eventName": "controlChanged",
          "eventReason": 64,
          "eventReasonCardUid": "p0-extraDeck-12172567-0",
          "eventReasonEffectId": 3,
          "eventReasonPlayer": 0,
          "previousController": 0,
          "previousLocation": "monsterZone",
        },
        {
          "currentController": 0,
          "currentLocation": "monsterZone",
          "eventCardUid": "p1-deck-121725671-0",
          "eventCode": 1120,
          "eventName": "controlChanged",
          "eventReason": 64,
          "eventReasonCardUid": "p0-extraDeck-12172567-0",
          "eventReasonEffectId": 3,
          "eventReasonPlayer": 0,
          "previousController": 1,
          "previousLocation": "monsterZone",
        },
        {
          "currentController": 1,
          "currentLocation": "monsterZone",
          "eventCardUid": "p0-extraDeck-12172567-0",
          "eventCode": 1120,
          "eventName": "controlChanged",
          "eventReason": 64,
          "eventReasonCardUid": "p0-extraDeck-12172567-0",
          "eventReasonEffectId": 3,
          "eventReasonPlayer": 0,
          "previousController": 0,
          "previousLocation": "monsterZone",
        },
      ]
    `);
  });

  it("restores Synchro EVENT_TO_GRAVE SelectUnselectGroup targets into cross-field SwapControl", () => {
    const { workspace, reader, session } = createFixture(12172568);
    const castlin = requireCard(session, mindCastlinCode);
    const ownTarget = requireCard(session, graveOwnTargetCode);
    const opponent = requireCard(session, graveOpponentTargetCode);
    moveSynchroFaceUp(session, castlin, 0, 0);
    moveFaceUpAttack(session, ownTarget, 0, 1);
    moveFaceUpAttack(session, opponent, 1, 0);
    prepareMainPhase(session);
    registerMindCastlin(session, workspace);
    sendDuelCardToGraveyard(session.state, castlin.uid, 0, duelReason.effect, 1);
    session.state.waitingFor = 0;

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === castlin.uid && action.effectId === "lua-4-1014");
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);
    resolveRestoredChain(restoredTrigger);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === ownTarget.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      previousController: 0,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: castlin.uid,
      reasonEffectId: 4,
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === opponent.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
      reason: duelReason.effect,
      reasonPlayer: 0,
      reasonCardUid: castlin.uid,
      reasonEffectId: 4,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => ["sentToGraveyard", "becameTarget", "controlChanged"].includes(event.eventName)).map(controlEventSummary)).toMatchInlineSnapshot(`
      [
        {
          "currentController": 0,
          "currentLocation": "graveyard",
          "eventCardUid": "p0-extraDeck-12172567-0",
          "eventCode": 1014,
          "eventName": "sentToGraveyard",
          "eventReason": 64,
          "eventReasonCardUid": undefined,
          "eventReasonEffectId": undefined,
          "eventReasonPlayer": 1,
          "previousController": 0,
          "previousLocation": "monsterZone",
        },
        {
          "currentController": 0,
          "currentLocation": "monsterZone",
          "eventCardUid": "p0-deck-121725672-1",
          "eventCode": 1028,
          "eventName": "becameTarget",
          "eventReason": 0,
          "eventReasonCardUid": undefined,
          "eventReasonEffectId": undefined,
          "eventReasonPlayer": 0,
          "previousController": 0,
          "previousLocation": "deck",
        },
        {
          "currentController": 1,
          "currentLocation": "monsterZone",
          "eventCardUid": "p1-deck-121725673-1",
          "eventCode": 1028,
          "eventName": "becameTarget",
          "eventReason": 0,
          "eventReasonCardUid": undefined,
          "eventReasonEffectId": undefined,
          "eventReasonPlayer": 0,
          "previousController": 1,
          "previousLocation": "deck",
        },
        {
          "currentController": 1,
          "currentLocation": "monsterZone",
          "eventCardUid": "p0-deck-121725672-1",
          "eventCode": 1120,
          "eventName": "controlChanged",
          "eventReason": 64,
          "eventReasonCardUid": "p0-extraDeck-12172567-0",
          "eventReasonEffectId": 4,
          "eventReasonPlayer": 0,
          "previousController": 0,
          "previousLocation": "monsterZone",
        },
        {
          "currentController": 0,
          "currentLocation": "monsterZone",
          "eventCardUid": "p1-deck-121725673-1",
          "eventCode": 1120,
          "eventName": "controlChanged",
          "eventReason": 64,
          "eventReasonCardUid": "p0-extraDeck-12172567-0",
          "eventReasonEffectId": 4,
          "eventReasonPlayer": 0,
          "previousController": 1,
          "previousLocation": "monsterZone",
        },
        {
          "currentController": 1,
          "currentLocation": "monsterZone",
          "eventCardUid": "p0-deck-121725672-1",
          "eventCode": 1120,
          "eventName": "controlChanged",
          "eventReason": 64,
          "eventReasonCardUid": "p0-extraDeck-12172567-0",
          "eventReasonEffectId": 4,
          "eventReasonPlayer": 0,
          "previousController": 0,
          "previousLocation": "monsterZone",
        },
      ]
    `);
  });
});

function createFixture(seed: number): {
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  reader: ReturnType<typeof createCardReader>;
  session: DuelSession;
} {
  const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
  const reader = createCardReader(cards());
  const session = createDuel({ seed, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [ownTargetCode, graveOwnTargetCode], extra: [mindCastlinCode] }, 1: { main: [opponentTargetCode, graveOpponentTargetCode] } });
  startDuel(session);
  return { workspace, reader, session };
}

function cards(): DuelCardData[] {
  return [
    { code: mindCastlinCode, name: "Mind Castlin", kind: "extra", typeFlags: typeMonster | typeEffect | typeSynchro, race: racePsychic, attribute: attributeDark, level: 6, attack: 1500, defense: 2600 },
    { code: ownTargetCode, name: "Mind Castlin Own Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: racePsychic, attribute: attributeDark, level: 3, attack: 1200, defense: 1200 },
    { code: opponentTargetCode, name: "Mind Castlin Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1700, defense: 1000 },
    { code: graveOwnTargetCode, name: "Mind Castlin Grave Own Target", kind: "monster", typeFlags: typeMonster | typeEffect | typeTuner, race: racePsychic, attribute: attributeDark, level: 3, attack: 1100, defense: 1100 },
    { code: graveOpponentTargetCode, name: "Mind Castlin Grave Opponent Target", kind: "monster", typeFlags: typeMonster | typeEffect, race: raceWarrior, attribute: attributeEarth, level: 4, attack: 1800, defense: 900 },
  ];
}

function expectScriptShape(script: string): void {
  expect(script).toContain("--Mind Castlin");
  expect(script).toContain("Synchro.AddProcedure(c,nil,1,1,Synchro.NonTuner(nil),1,99)");
  expect(script).toContain("e1:SetCategory(CATEGORY_CONTROL)");
  expect(script).toContain("e1:SetType(EFFECT_TYPE_IGNITION)");
  expect(script).toContain("Duel.SelectTarget(tp,s.ctfilter,tp,0,LOCATION_MZONE,1,1,nil,tp)");
  expect(script).toContain("Duel.SwapControl(c,tc)");
  expect(script).toContain("e2:SetCode(EVENT_TO_GRAVE)");
  expect(script).toContain("return c:IsPreviousLocation(LOCATION_MZONE) and c:IsSynchroSummoned()");
  expect(script).toContain("local tg=aux.SelectUnselectGroup(g,e,tp,2,2,aux.dpcheck(Card.GetControler),1,tp,HINTMSG_CONTROL)");
  expect(script).toContain("Duel.SetTargetCard(tg)");
  expect(script).toContain("local tg=Duel.GetTargetCards(e)");
  expect(script).toContain("Duel.SwapControl(tg:GetFirst(),tg:GetNext())");
}

function registerMindCastlin(session: DuelSession, workspace: ReturnType<typeof createUpstreamNodeWorkspace>): void {
  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(mindCastlinCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
}

function requireCard(session: DuelSession, code: string): DuelCardInstance {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function moveFaceUpAttack(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveDuelCard(session.state, card.uid, "monsterZone", controller);
  moved.sequence = sequence;
  moved.faceUp = true;
  moved.position = "faceUpAttack";
  return moved;
}

function moveSynchroFaceUp(session: DuelSession, card: DuelCardInstance, controller: PlayerId, sequence: number): DuelCardInstance {
  const moved = moveFaceUpAttack(session, card, controller, sequence);
  moved.summonType = "synchro";
  markProcedureComplete(moved);
  return moved;
}

function prepareMainPhase(session: DuelSession): void {
  session.state.phase = "main1";
  session.state.turnPlayer = 0;
  session.state.waitingFor = 0;
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

function controlEventSummary(event: DuelEventRecord) {
  return {
    eventName: event.eventName,
    eventCode: event.eventCode,
    eventCardUid: event.eventCardUid,
    eventReason: event.eventReason,
    eventReasonPlayer: event.eventReasonPlayer,
    eventReasonCardUid: event.eventReasonCardUid,
    eventReasonEffectId: event.eventReasonEffectId,
    previousController: event.eventPreviousState?.controller,
    currentController: event.eventCurrentState?.controller,
    previousLocation: event.eventPreviousState?.location,
    currentLocation: event.eventCurrentState?.location,
  };
}
