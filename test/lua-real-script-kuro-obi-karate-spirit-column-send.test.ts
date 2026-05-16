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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Kuro-Obi Karate Spirit column send", () => {
  it("restores its Pendulum-column Spirit summon trigger and sends only matching opponent backrow", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const kuroObiCode = "77511331";
    const tributeCode = "77511332";
    const pendulumColumnCode = "77511333";
    const matchingBackrowCode = "77511334";
    const sideBackrowCode = "77511335";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === kuroObiCode),
      { code: tributeCode, name: "Kuro-Obi Tribute", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: pendulumColumnCode, name: "Kuro-Obi Pendulum Column", kind: "monster", typeFlags: typePendulumMonster, level: 4, attack: 1000, defense: 1000, leftScale: 1, rightScale: 1 },
      { code: matchingBackrowCode, name: "Kuro-Obi Same Column Backrow", kind: "spell", typeFlags: typeSpell },
      { code: sideBackrowCode, name: "Kuro-Obi Side Backrow", kind: "spell", typeFlags: typeSpell },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 775, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [kuroObiCode, tributeCode, pendulumColumnCode] }, 1: { main: [matchingBackrowCode, sideBackrowCode] } });
    startDuel(session);

    const kuroObi = session.state.cards.find((card) => card.code === kuroObiCode);
    const tribute = session.state.cards.find((card) => card.code === tributeCode);
    const pendulumColumn = session.state.cards.find((card) => card.code === pendulumColumnCode);
    const matchingBackrow = session.state.cards.find((card) => card.code === matchingBackrowCode);
    const sideBackrow = session.state.cards.find((card) => card.code === sideBackrowCode);
    expect(kuroObi).toBeDefined();
    expect(tribute).toBeDefined();
    expect(pendulumColumn).toBeDefined();
    expect(matchingBackrow).toBeDefined();
    expect(sideBackrow).toBeDefined();
    moveDuelCard(session.state, kuroObi!.uid, "hand", 0);
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
    moveDuelCard(session.state, sideBackrow!.uid, "spellTrapZone", 1);
    sideBackrow!.sequence = 1;
    sideBackrow!.position = "faceDown";
    sideBackrow!.faceUp = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(kuroObiCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonWindow.missingRegistryKeys).toEqual([]);
    expect(restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSummonWindow, 0);
    const summon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find(
      (action) => action.type === "tributeSummon" && action.uid === kuroObi!.uid && action.tributeUids.includes(tribute!.uid),
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
          "eventCardUid": "p0-deck-77511331-0",
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
          "sourceUid": "p0-deck-77511331-0",
          "triggerBucket": "turnOptional",
        },
      ]
    `);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === kuroObi!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);
    expect(restoredTriggerWindow.session.state.chain).toEqual([]);

    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === kuroObi!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === pendulumColumn!.uid)).toMatchObject({ location: "spellTrapZone", controller: 0, sequence: 0 });
    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === matchingBackrow!.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredTriggerWindow.session.state.cards.find((card) => card.uid === sideBackrow!.uid)).toMatchObject({ location: "spellTrapZone", controller: 1, sequence: 1 });
    expect(restoredTriggerWindow.session.state.eventHistory.filter((event) => event.eventName === "normalSummoned")).toEqual([
      {
        eventName: "normalSummoned",
        eventCode: 1100,
        eventCardUid: kuroObi!.uid,
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
    expect(restoredTriggerWindow.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === matchingBackrow!.uid)).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: matchingBackrow!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: kuroObi!.uid,
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
