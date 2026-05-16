import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const typeSpell = 0x2;
const typePendulumMonster = 0x1000001;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Kai-Den Kendo Spirit column send", () => {
  it("restores its Pendulum-column summon trigger and sends only opponent cards in the selected column", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const kaiDenCode = "71614230";
    const tributeCode = "71614231";
    const pendulumColumnCode = "71614232";
    const matchingBackrowCode = "71614233";
    const matchingMonsterCode = "71614234";
    const sideBackrowCode = "71614235";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === kaiDenCode),
      { code: tributeCode, name: "Kai-Den Tribute", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: pendulumColumnCode, name: "Kai-Den Pendulum Column", kind: "monster", typeFlags: typePendulumMonster, level: 4, attack: 1000, defense: 1000, leftScale: 1, rightScale: 1 },
      { code: matchingBackrowCode, name: "Kai-Den Matching Backrow", kind: "spell", typeFlags: typeSpell },
      { code: matchingMonsterCode, name: "Kai-Den Matching Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1200 },
      { code: sideBackrowCode, name: "Kai-Den Side Backrow", kind: "spell", typeFlags: typeSpell },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 716, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [kaiDenCode, tributeCode, pendulumColumnCode] }, 1: { main: [matchingBackrowCode, matchingMonsterCode, sideBackrowCode] } });
    startDuel(session);

    const kaiDen = session.state.cards.find((card) => card.code === kaiDenCode);
    const tribute = session.state.cards.find((card) => card.code === tributeCode);
    const pendulumColumn = session.state.cards.find((card) => card.code === pendulumColumnCode);
    const matchingBackrow = session.state.cards.find((card) => card.code === matchingBackrowCode);
    const matchingMonster = session.state.cards.find((card) => card.code === matchingMonsterCode);
    const sideBackrow = session.state.cards.find((card) => card.code === sideBackrowCode);
    expect(kaiDen).toBeDefined();
    expect(tribute).toBeDefined();
    expect(pendulumColumn).toBeDefined();
    expect(matchingBackrow).toBeDefined();
    expect(matchingMonster).toBeDefined();
    expect(sideBackrow).toBeDefined();
    moveDuelCard(session.state, kaiDen!.uid, "hand", 0);
    moveDuelCard(session.state, tribute!.uid, "monsterZone", 0);
    tribute!.position = "faceUpAttack";
    tribute!.faceUp = true;
    moveDuelCard(session.state, pendulumColumn!.uid, "spellTrapZone", 0);
    pendulumColumn!.sequence = 0;
    pendulumColumn!.position = "faceUpAttack";
    pendulumColumn!.faceUp = true;
    moveDuelCard(session.state, matchingBackrow!.uid, "spellTrapZone", 1);
    matchingBackrow!.sequence = 0;
    matchingBackrow!.position = "faceDown";
    matchingBackrow!.faceUp = false;
    moveDuelCard(session.state, matchingMonster!.uid, "monsterZone", 1);
    matchingMonster!.sequence = 0;
    matchingMonster!.position = "faceUpAttack";
    matchingMonster!.faceUp = true;
    moveDuelCard(session.state, sideBackrow!.uid, "spellTrapZone", 1);
    sideBackrow!.sequence = 1;
    sideBackrow!.position = "faceDown";
    sideBackrow!.faceUp = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(kaiDenCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonWindow.missingRegistryKeys).toEqual([]);
    expect(restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSummonWindow, 0);
    const summon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find(
      (action) => action.type === "tributeSummon" && action.uid === kaiDen!.uid && action.tributeUids.includes(tribute!.uid),
    );
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonWindow, summon!);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), workspace, reader);
    expect(restoredTriggerWindow.restoreComplete, restoredTriggerWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTriggerWindow.missingRegistryKeys).toEqual([]);
    expect(restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    expect(restoredTriggerWindow.session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-9-1100",
          "eventCardUid": "p0-deck-71614230-0",
          "eventCode": 1100,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "normalSummoned",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "hand",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 16,
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "when",
          "id": "trigger-6-1",
          "player": 0,
          "sourceUid": "p0-deck-71614230-0",
          "triggerBucket": "turnOptional",
        },
      ]
    `);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === kaiDen!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);

    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === kaiDen!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === pendulumColumn!.uid)).toMatchObject({ location: "spellTrapZone", controller: 0, sequence: 0 });
    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === matchingBackrow!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === matchingMonster!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === sideBackrow!.uid)).toMatchObject({ location: "spellTrapZone", controller: 1, sequence: 1 });
    expect(restoredTriggerWindow.session.state.eventHistory.filter((event) => event.eventName === "normalSummoned")).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: kaiDen!.uid,
        eventReason: duelReason.summon,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(restoredTriggerWindow.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventReasonEffectId === 9)).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: matchingBackrow!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: kaiDen!.uid,
        eventReasonEffectId: 9,
        eventPreviousState: {
          controller: 1,
          faceUp: false,
          location: "spellTrapZone",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: matchingMonster!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: kaiDen!.uid,
        eventReasonEffectId: 9,
        eventPreviousState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 1,
        },
      },
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: matchingBackrow!.uid,
        eventUids: [matchingBackrow!.uid, matchingMonster!.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: kaiDen!.uid,
        eventReasonEffectId: 9,
        eventPreviousState: {
          controller: 1,
          faceUp: false,
          location: "spellTrapZone",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
      },
    ]);
  });

  it("restores its Pendulum Zone return trigger after a Pendulum Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const kaiDenCode = "71614230";
    const lowScaleCode = "71614236";
    const candidateCode = "71614237";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === kaiDenCode),
      { code: lowScaleCode, name: "Kai-Den Low Scale", kind: "monster", typeFlags: typePendulumMonster, level: 4, attack: 1000, defense: 1000, leftScale: 1, rightScale: 1 },
      { code: candidateCode, name: "Kai-Den Pendulum Candidate", kind: "monster", typeFlags: typePendulumMonster, level: 4, attack: 1400, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 717, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [kaiDenCode, lowScaleCode, candidateCode] }, 1: { main: [] } });
    startDuel(session);

    const kaiDen = session.state.cards.find((card) => card.code === kaiDenCode);
    const lowScale = session.state.cards.find((card) => card.code === lowScaleCode);
    const candidate = session.state.cards.find((card) => card.code === candidateCode);
    expect(kaiDen).toBeDefined();
    expect(lowScale).toBeDefined();
    expect(candidate).toBeDefined();
    moveDuelCard(session.state, lowScale!.uid, "spellTrapZone", 0);
    lowScale!.sequence = 0;
    lowScale!.position = "faceUpAttack";
    lowScale!.faceUp = true;
    moveDuelCard(session.state, kaiDen!.uid, "spellTrapZone", 0);
    kaiDen!.sequence = 1;
    kaiDen!.position = "faceUpAttack";
    kaiDen!.faceUp = true;
    moveDuelCard(session.state, candidate!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(kaiDenCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredPendulumWindow = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredPendulumWindow.restoreComplete, restoredPendulumWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredPendulumWindow.missingRegistryKeys).toEqual([]);
    expect(restoredPendulumWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredPendulumWindow, 0);
    const pendulumSummon = getLuaRestoreLegalActions(restoredPendulumWindow, 0).find(
      (action): action is Extract<DuelAction, { type: "pendulumSummon" }> => action.type === "pendulumSummon" && action.summonUids.includes(candidate!.uid),
    );
    expect(pendulumSummon, JSON.stringify(getLuaRestoreLegalActions(restoredPendulumWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPendulumWindow, { ...pendulumSummon!, summonUids: [candidate!.uid] });

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredPendulumWindow.session), workspace, reader);
    expect(restoredTriggerWindow.restoreComplete, restoredTriggerWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTriggerWindow.missingRegistryKeys).toEqual([]);
    expect(restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    expect(restoredTriggerWindow.session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-8-1102",
          "eventCardUid": "p0-deck-71614237-2",
          "eventCode": 1102,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "specialSummoned",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "hand",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 2064,
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "when",
          "id": "trigger-4-1",
          "player": 0,
          "sourceUid": "p0-deck-71614230-0",
          "triggerBucket": "turnMandatory",
        },
      ]
    `);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === kaiDen!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);

    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === kaiDen!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === lowScale!.uid)).toMatchObject({ location: "spellTrapZone", controller: 0, sequence: 0 });
    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === candidate!.uid)).toMatchObject({ location: "monsterZone", controller: 0, summonType: "pendulum" });
    expect(restoredTriggerWindow.session.state.players[0].pendulumSummonAvailable).toBe(false);
    expect(restoredTriggerWindow.session.state.eventHistory.filter((event) => event.eventName === "sentToHand" && event.eventCardUid === kaiDen!.uid)).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: kaiDen!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: kaiDen!.uid,
        eventReasonEffectId: 8,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "spellTrapZone",
          position: "faceUpAttack",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
  });
});

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
