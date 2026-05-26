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
const typePendulumMonster = 0x1000001;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Yoko-Zuna Sumo Spirit column send", () => {
  it("restores its Pendulum-column summon trigger and sends only opponent monsters in those columns", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const yokoCode = "40516623";
    const tributeCode = "40516624";
    const pendulumColumnCode = "40516625";
    const matchingMonsterCode = "40516626";
    const sideMonsterCode = "40516627";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === yokoCode),
      { code: tributeCode, name: "Yoko-Zuna Tribute", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: pendulumColumnCode, name: "Yoko-Zuna Pendulum Column", kind: "monster", typeFlags: typePendulumMonster, level: 4, attack: 1000, defense: 1000, leftScale: 1, rightScale: 1 },
      { code: matchingMonsterCode, name: "Yoko-Zuna Matching Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1200 },
      { code: sideMonsterCode, name: "Yoko-Zuna Side Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1400, defense: 1100 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 405, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [yokoCode, tributeCode, pendulumColumnCode] }, 1: { main: [matchingMonsterCode, sideMonsterCode] } });
    startDuel(session);

    const yoko = session.state.cards.find((card) => card.code === yokoCode);
    const tribute = session.state.cards.find((card) => card.code === tributeCode);
    const pendulumColumn = session.state.cards.find((card) => card.code === pendulumColumnCode);
    const matchingMonster = session.state.cards.find((card) => card.code === matchingMonsterCode);
    const sideMonster = session.state.cards.find((card) => card.code === sideMonsterCode);
    expect(yoko).toBeDefined();
    expect(tribute).toBeDefined();
    expect(pendulumColumn).toBeDefined();
    expect(matchingMonster).toBeDefined();
    expect(sideMonster).toBeDefined();
    moveDuelCard(session.state, yoko!.uid, "hand", 0);
    moveDuelCard(session.state, tribute!.uid, "monsterZone", 0);
    tribute!.position = "faceUpAttack";
    tribute!.faceUp = true;
    moveDuelCard(session.state, pendulumColumn!.uid, "spellTrapZone", 0);
    pendulumColumn!.sequence = 0;
    pendulumColumn!.position = "faceUpAttack";
    pendulumColumn!.faceUp = true;
    moveDuelCard(session.state, matchingMonster!.uid, "monsterZone", 1);
    matchingMonster!.sequence = 0;
    matchingMonster!.position = "faceUpAttack";
    matchingMonster!.faceUp = true;
    moveDuelCard(session.state, sideMonster!.uid, "monsterZone", 1);
    sideMonster!.sequence = 1;
    sideMonster!.position = "faceUpAttack";
    sideMonster!.faceUp = true;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(yokoCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonWindow.missingRegistryKeys).toEqual([]);
    expect(restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSummonWindow, 0);
    const summon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find(
      (action) => action.type === "tributeSummon" && action.uid === yoko!.uid && action.tributeUids.includes(tribute!.uid),
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
          "eventCardUid": "p0-deck-40516623-0",
          "eventCode": 1100,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "normalSummoned",
          "eventPlayer": 0,
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
          "sourceUid": "p0-deck-40516623-0",
          "triggerBucket": "turnOptional",
        },
      ]
    `);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === yoko!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);

    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === yoko!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === pendulumColumn!.uid)).toMatchObject({ location: "spellTrapZone", controller: 0, sequence: 0 });
    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === matchingMonster!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === sideMonster!.uid)).toMatchObject({ location: "monsterZone", controller: 1, sequence: 1 });
    expect(restoredTriggerWindow.session.state.eventHistory.filter((event) => event.eventName === "normalSummoned")).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: yoko!.uid,
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
        eventCardUid: matchingMonster!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: yoko!.uid,
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
          sequence: 0,
        },
      },
    ]);
  });

  it("restores its Pendulum Zone return trigger after a Pendulum Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const yokoCode = "40516623";
    const lowScaleCode = "40516628";
    const candidateCode = "40516629";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === yokoCode),
      { code: lowScaleCode, name: "Yoko-Zuna High Scale", kind: "monster", typeFlags: typePendulumMonster, level: 4, attack: 1000, defense: 1000, leftScale: 10, rightScale: 10 },
      { code: candidateCode, name: "Yoko-Zuna Pendulum Candidate", kind: "monster", typeFlags: typePendulumMonster, level: 4, attack: 1400, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 406, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [yokoCode, lowScaleCode, candidateCode] }, 1: { main: [] } });
    startDuel(session);

    const yoko = session.state.cards.find((card) => card.code === yokoCode);
    const lowScale = session.state.cards.find((card) => card.code === lowScaleCode);
    const candidate = session.state.cards.find((card) => card.code === candidateCode);
    expect(yoko).toBeDefined();
    expect(lowScale).toBeDefined();
    expect(candidate).toBeDefined();
    moveDuelCard(session.state, lowScale!.uid, "spellTrapZone", 0);
    lowScale!.sequence = 0;
    lowScale!.position = "faceUpAttack";
    lowScale!.faceUp = true;
    moveDuelCard(session.state, yoko!.uid, "spellTrapZone", 0);
    yoko!.sequence = 1;
    yoko!.position = "faceUpAttack";
    yoko!.faceUp = true;
    moveDuelCard(session.state, candidate!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(yokoCode), workspace).ok).toBe(true);
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
          "eventCardUid": "p0-deck-40516629-2",
          "eventCode": 1102,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "specialSummoned",
          "eventPlayer": 0,
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
          "sourceUid": "p0-deck-40516623-0",
          "triggerBucket": "turnMandatory",
        },
      ]
    `);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === yoko!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);

    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === yoko!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === lowScale!.uid)).toMatchObject({ location: "spellTrapZone", controller: 0, sequence: 0 });
    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === candidate!.uid)).toMatchObject({ location: "monsterZone", controller: 0, summonType: "pendulum" });
    expect(restoredTriggerWindow.session.state.players[0].pendulumSummonAvailable).toBe(false);
    expect(restoredTriggerWindow.session.state.eventHistory.filter((event) => event.eventName === "sentToHand" && event.eventCardUid === yoko!.uid)).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: yoko!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: yoko!.uid,
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
