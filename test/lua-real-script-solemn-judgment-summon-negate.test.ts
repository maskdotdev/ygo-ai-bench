import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Solemn Judgment summon negation", () => {
  it("restores Solemn Judgment's summon-attempt activation, LP-half cost, and negated Normal Summon cleanup", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const solemnCode = "41420027";
    const summonedCode = "925";
    const responderCode = "926";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === solemnCode),
      { code: summonedCode, name: "Solemn Judgment Summoned Monster", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1200 },
      { code: responderCode, name: "Solemn Judgment Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 477, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [summonedCode, responderCode] }, 1: { main: [solemnCode] } });
    startDuel(session);

    const summoned = session.state.cards.find((card) => card.code === summonedCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const solemn = session.state.cards.find((card) => card.code === solemnCode);
    expect(summoned).toBeDefined();
    expect(responder).toBeDefined();
    expect(solemn).toBeDefined();
    moveDuelCard(session.state, summoned!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, solemn!.uid, "spellTrapZone", 1);
    solemn!.position = "faceDown";
    solemn!.faceUp = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(solemnCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const summon = getLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);
    expect(session.state.cards.find((card) => card.uid === summoned!.uid)).toMatchObject({ location: "monsterZone", faceUp: true, position: "faceUpAttack" });
    expect(session.state.pendingTriggers).toEqual([
      {
        player: 1,
        id: "trigger-2-1",
        effectId: "lua-2-1103",
        sourceUid: solemn!.uid,
        triggerBucket: "opponentOptional",
        eventTriggerTiming: "when",
        eventName: "normalSummoning",
        eventCode: 1103,
        eventCardUid: summoned!.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
      },
    ]);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonWindow.missingRegistryKeys).toEqual([]);
    expect(restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredSummonWindow, 1)).toEqual(getGroupedDuelLegalActions(restoredSummonWindow.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredSummonWindow, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredSummonWindow, 1));
    const solemnAction = getLuaRestoreLegalActions(restoredSummonWindow, 1).find((action) => action.type === "activateTrigger" && action.uid === solemn!.uid);
    expect(solemnAction).toBeDefined();
    const chained = applyLuaRestoreResponse(restoredSummonWindow, solemnAction!);
    expect(chained.ok, chained.error).toBe(true);
    expect(restoredSummonWindow.session.state.players[1].lifePoints).toBe(4000);
    expectSolemnCost(restoredSummonWindow.session, solemn!.uid, 2);
    expect(restoredSummonWindow.session.state.chain).toHaveLength(1);
    expect(restoredSummonWindow.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-2-1103",
        "eventCardUid": "p0-deck-925-0",
        "eventCode": 1103,
        "eventCurrentState": {
          "controller": 0,
          "faceUp": false,
          "location": "hand",
          "position": "faceDown",
          "sequence": 0,
        },
        "eventName": "normalSummoning",
        "eventPreviousState": {
          "controller": 0,
          "faceUp": false,
          "location": "deck",
          "position": "faceDown",
          "sequence": 1,
        },
        "eventReason": 0,
        "eventReasonPlayer": 0,
        "eventTriggerTiming": "when",
        "id": "chain-4",
        "operationInfos": [
          {
            "category": 32768,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-925-0",
            ],
          },
          {
            "category": 1,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-925-0",
            ],
          },
        ],
        "player": 1,
        "sourceUid": "p1-deck-41420027-0",
      }
    `);

    const restoredPendingResolution = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), source, reader);
    expect(restoredPendingResolution.restoreComplete, restoredPendingResolution.incompleteReasons.join("; ")).toBe(true);
    expect(restoredPendingResolution.missingRegistryKeys).toEqual([]);
    expect(restoredPendingResolution.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredPendingResolution, 0)).toEqual(getGroupedDuelLegalActions(restoredPendingResolution.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredPendingResolution, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredPendingResolution, 0));

    for (let index = 0; index < 4 && restoredPendingResolution.session.state.chain.length > 0; index += 1) {
      const passPlayer = restoredPendingResolution.session.state.waitingFor;
      expect(passPlayer).toBeDefined();
      const pass = getLuaRestoreLegalActions(restoredPendingResolution, passPlayer!).find((action) => action.type === "passChain");
      expect(pass).toBeDefined();
      const resolved = applyLuaRestoreResponse(restoredPendingResolution, pass!);
      expect(resolved.ok, resolved.error).toBe(true);
    }

    expect(restoredPendingResolution.session.state.chain).toHaveLength(0);
    expect(restoredPendingResolution.session.state.players[1].lifePoints).toBe(4000);
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === summoned!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === solemn!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.host.messages).not.toContain("solemn judgment chain responder resolved");
    expect(restoredPendingResolution.session.state.eventHistory.filter((event) => ["normalSummonNegated", "destroyed"].includes(event.eventName))).toEqual([
      {
        eventName: "normalSummonNegated",
        eventCode: 1114,
        eventCardUid: summoned!.uid,
        eventReason: duelReason.disSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: solemn!.uid,
        eventReasonEffectId: 2,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: summoned!.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: solemn!.uid,
        eventReasonEffectId: 2,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(restoredPendingResolution.session.state.eventHistory.filter((event) => event.eventName === "normalSummoned" && event.eventCardUid === summoned!.uid)).toEqual([]);
  });

  it("restores Solemn Judgment's cloned Flip Summon-attempt activation and cleanup", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const solemnCode = "41420027";
    const summonedCode = "959";
    const responderCode = "961";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === solemnCode),
      { code: summonedCode, name: "Solemn Judgment Flip Summoned Monster", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1200 },
      { code: responderCode, name: "Solemn Judgment Flip Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 486, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [summonedCode, responderCode] }, 1: { main: [solemnCode] } });
    startDuel(session);

    const summoned = session.state.cards.find((card) => card.code === summonedCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const solemn = session.state.cards.find((card) => card.code === solemnCode);
    expect(summoned).toBeDefined();
    expect(responder).toBeDefined();
    expect(solemn).toBeDefined();
    moveDuelCard(session.state, summoned!.uid, "monsterZone", 0).position = "faceDownDefense";
    summoned!.faceUp = false;
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, solemn!.uid, "spellTrapZone", 1);
    solemn!.position = "faceDown";
    solemn!.faceUp = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(solemnCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const flip = getLegalActions(session, 0).find((action) => action.type === "flipSummon" && action.uid === summoned!.uid);
    expect(flip).toBeDefined();
    applyAndAssert(session, flip!);
    expect(session.state.cards.find((card) => card.uid === summoned!.uid)).toMatchObject({ location: "monsterZone", faceUp: true, position: "faceUpAttack" });
    expect(session.state.pendingTriggers).toEqual([
      {
        player: 1,
        id: "trigger-2-1",
        effectId: "lua-3-1104",
        sourceUid: solemn!.uid,
        triggerBucket: "opponentOptional",
        eventTriggerTiming: "when",
        eventName: "flipSummoning",
        eventCode: 1104,
        eventCardUid: summoned!.uid,
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "monsterZone",
          position: "faceDownDefense",
          sequence: 0,
        },
      },
    ]);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonWindow.missingRegistryKeys).toEqual([]);
    expect(restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredSummonWindow, 1)).toEqual(getGroupedDuelLegalActions(restoredSummonWindow.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredSummonWindow, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredSummonWindow, 1));
    const solemnAction = getLuaRestoreLegalActions(restoredSummonWindow, 1).find((action) => action.type === "activateTrigger" && action.uid === solemn!.uid);
    expect(solemnAction).toBeDefined();
    const chained = applyLuaRestoreResponse(restoredSummonWindow, solemnAction!);
    expect(chained.ok, chained.error).toBe(true);
    expect(restoredSummonWindow.session.state.players[1].lifePoints).toBe(4000);
    expectSolemnCost(restoredSummonWindow.session, solemn!.uid, 3);
    expect(restoredSummonWindow.session.state.chain).toHaveLength(1);
    expect(restoredSummonWindow.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-3-1104",
        "eventCardUid": "p0-deck-959-0",
        "eventCode": 1104,
        "eventCurrentState": {
          "controller": 0,
          "faceUp": false,
          "location": "monsterZone",
          "position": "faceDownDefense",
          "sequence": 0,
        },
        "eventName": "flipSummoning",
        "eventPreviousState": {
          "controller": 0,
          "faceUp": false,
          "location": "deck",
          "position": "faceDown",
          "sequence": 1,
        },
        "eventReason": 0,
        "eventReasonPlayer": 0,
        "eventTriggerTiming": "when",
        "id": "chain-4",
        "operationInfos": [
          {
            "category": 32768,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-959-0",
            ],
          },
          {
            "category": 1,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-959-0",
            ],
          },
        ],
        "player": 1,
        "sourceUid": "p1-deck-41420027-0",
      }
    `);

    const restoredPendingResolution = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), source, reader);
    expect(restoredPendingResolution.restoreComplete, restoredPendingResolution.incompleteReasons.join("; ")).toBe(true);
    expect(restoredPendingResolution.missingRegistryKeys).toEqual([]);
    expect(restoredPendingResolution.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredPendingResolution, 0)).toEqual(getGroupedDuelLegalActions(restoredPendingResolution.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredPendingResolution, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredPendingResolution, 0));

    for (let index = 0; index < 4 && restoredPendingResolution.session.state.chain.length > 0; index += 1) {
      const passPlayer = restoredPendingResolution.session.state.waitingFor;
      expect(passPlayer).toBeDefined();
      const pass = getLuaRestoreLegalActions(restoredPendingResolution, passPlayer!).find((action) => action.type === "passChain");
      expect(pass).toBeDefined();
      const resolved = applyLuaRestoreResponse(restoredPendingResolution, pass!);
      expect(resolved.ok, resolved.error).toBe(true);
    }

    expect(restoredPendingResolution.session.state.chain).toHaveLength(0);
    expect(restoredPendingResolution.session.state.players[1].lifePoints).toBe(4000);
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === summoned!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === solemn!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.host.messages).not.toContain("solemn judgment chain responder resolved");
    expect(restoredPendingResolution.session.state.eventHistory.filter((event) => ["flipSummonNegated", "destroyed"].includes(event.eventName))).toEqual([
      {
        eventName: "flipSummonNegated",
        eventCode: 1115,
        eventCardUid: summoned!.uid,
        eventReason: duelReason.disSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: solemn!.uid,
        eventReasonEffectId: 3,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: summoned!.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: solemn!.uid,
        eventReasonEffectId: 3,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(restoredPendingResolution.session.state.eventHistory.filter((event) => event.eventName === "flipSummoned" && event.eventCardUid === summoned!.uid)).toEqual([]);
  });

  it("restores Solemn Judgment's cloned Special Summon-attempt activation and cleanup", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const solemnCode = "41420027";
    const summonedCode = "962";
    const responderCode = "963";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === solemnCode),
      { code: summonedCode, name: "Solemn Judgment Special Summoned Monster", kind: "monster", typeFlags: 0x1, level: 4, attack: 1900, defense: 1100 },
      { code: responderCode, name: "Solemn Judgment Special Summon Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 487, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [summonedCode, responderCode] }, 1: { main: [solemnCode] } });
    startDuel(session);

    const summoned = session.state.cards.find((card) => card.code === summonedCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const solemn = session.state.cards.find((card) => card.code === solemnCode);
    expect(summoned).toBeDefined();
    expect(responder).toBeDefined();
    expect(solemn).toBeDefined();
    moveDuelCard(session.state, summoned!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, solemn!.uid, "spellTrapZone", 1);
    solemn!.position = "faceDown";
    solemn!.faceUp = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(solemnCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    specialSummonDuelCard(session.state, summoned!.uid, 0);
    expect(session.state.cards.find((card) => card.uid === summoned!.uid)).toMatchObject({ location: "monsterZone", faceUp: true, position: "faceUpAttack" });
    const specialSummoningEvent = {
      eventName: "specialSummoning",
      eventCode: 1105,
      eventCardUid: summoned!.uid,
      eventReason: 0,
      eventReasonPlayer: 0,
      eventPreviousState: {
        controller: 0,
        faceUp: false,
        location: "deck",
        position: "faceDown",
        sequence: 1,
      },
      eventCurrentState: {
        controller: 0,
        faceUp: false,
        location: "hand",
        position: "faceDown",
        sequence: 0,
      },
    };
    expect(session.state.pendingTriggers).toEqual([
      {
        player: 1,
        id: "trigger-2-1",
        effectId: "lua-4-1105",
        sourceUid: solemn!.uid,
        triggerBucket: "opponentOptional",
        eventTriggerTiming: "when",
        ...specialSummoningEvent,
      },
    ]);
    expect(session.state.eventHistory.filter((event) => event.eventName === "specialSummoning")).toEqual([specialSummoningEvent]);
    expect(session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: summoned!.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
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

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonWindow.missingRegistryKeys).toEqual([]);
    expect(restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredSummonWindow, 1)).toEqual(getGroupedDuelLegalActions(restoredSummonWindow.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredSummonWindow, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredSummonWindow, 1));
    const solemnAction = getLuaRestoreLegalActions(restoredSummonWindow, 1).find((action) => action.type === "activateTrigger" && action.uid === solemn!.uid);
    expect(solemnAction).toBeDefined();
    const chained = applyLuaRestoreResponse(restoredSummonWindow, solemnAction!);
    expect(chained.ok, chained.error).toBe(true);
    expect(restoredSummonWindow.session.state.players[1].lifePoints).toBe(4000);
    expectSolemnCost(restoredSummonWindow.session, solemn!.uid, 4);
    expect(restoredSummonWindow.session.state.chain).toHaveLength(1);
    expect(restoredSummonWindow.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "spellTrapZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-4-1105",
        "eventCardUid": "p0-deck-962-0",
        "eventCode": 1105,
        "eventCurrentState": {
          "controller": 0,
          "faceUp": false,
          "location": "hand",
          "position": "faceDown",
          "sequence": 0,
        },
        "eventName": "specialSummoning",
        "eventPreviousState": {
          "controller": 0,
          "faceUp": false,
          "location": "deck",
          "position": "faceDown",
          "sequence": 1,
        },
        "eventReason": 0,
        "eventReasonPlayer": 0,
        "eventTriggerTiming": "when",
        "id": "chain-4",
        "operationInfos": [
          {
            "category": 32768,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-962-0",
            ],
          },
          {
            "category": 1,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-962-0",
            ],
          },
        ],
        "player": 1,
        "sourceUid": "p1-deck-41420027-0",
      }
    `);

    const restoredPendingResolution = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), source, reader);
    expect(restoredPendingResolution.restoreComplete, restoredPendingResolution.incompleteReasons.join("; ")).toBe(true);
    expect(restoredPendingResolution.missingRegistryKeys).toEqual([]);
    expect(restoredPendingResolution.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredPendingResolution, 0)).toEqual(getGroupedDuelLegalActions(restoredPendingResolution.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredPendingResolution, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredPendingResolution, 0));

    for (let index = 0; index < 4 && restoredPendingResolution.session.state.chain.length > 0; index += 1) {
      const passPlayer = restoredPendingResolution.session.state.waitingFor;
      expect(passPlayer).toBeDefined();
      const pass = getLuaRestoreLegalActions(restoredPendingResolution, passPlayer!).find((action) => action.type === "passChain");
      expect(pass).toBeDefined();
      const resolved = applyLuaRestoreResponse(restoredPendingResolution, pass!);
      expect(resolved.ok, resolved.error).toBe(true);
    }

    expect(restoredPendingResolution.session.state.chain).toHaveLength(0);
    expect(restoredPendingResolution.session.state.players[1].lifePoints).toBe(4000);
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === summoned!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === solemn!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.host.messages).not.toContain("solemn judgment chain responder resolved");
    expect(restoredPendingResolution.session.state.eventHistory.filter((event) => ["specialSummonNegated", "destroyed"].includes(event.eventName))).toEqual([
      {
        eventName: "specialSummonNegated",
        eventCode: 1116,
        eventCardUid: summoned!.uid,
        eventReason: duelReason.disSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: solemn!.uid,
        eventReasonEffectId: 4,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: summoned!.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: solemn!.uid,
        eventReasonEffectId: 4,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(restoredPendingResolution.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === summoned!.uid)).toEqual([]);
  });

  it("restores Solemn Judgment's Spell activation negation, LP-half cost, and source destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const solemnCode = "41420027";
    const starterCode = "936";
    const drawnCode = "937";
    const responderCode = "938";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === solemnCode),
      { code: starterCode, name: "Solemn Judgment Draw Spell", kind: "spell", typeFlags: 0x2 },
      { code: drawnCode, name: "Solemn Judgment Drawn Card", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Solemn Judgment Spell Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 482, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [starterCode, drawnCode, responderCode] }, 1: { main: [solemnCode] } });
    startDuel(session);

    const starter = session.state.cards.find((card) => card.code === starterCode);
    const drawn = session.state.cards.find((card) => card.code === drawnCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const solemn = session.state.cards.find((card) => card.code === solemnCode);
    expect(starter).toBeDefined();
    expect(drawn).toBeDefined();
    expect(responder).toBeDefined();
    expect(solemn).toBeDefined();
    moveDuelCard(session.state, starter!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, solemn!.uid, "spellTrapZone", 1);
    solemn!.position = "faceDown";
    solemn!.faceUp = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return drawSpellScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(solemnCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const starterAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === starter!.uid);
    expect(starterAction).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchObject({
      sourceUid: starter!.uid,
      operationInfos: [{ category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 1 }],
    });

    const restoredOpenChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredOpenChain.restoreComplete, restoredOpenChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredOpenChain.missingRegistryKeys).toEqual([]);
    expect(restoredOpenChain.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredOpenChain, 1)).toEqual(getGroupedDuelLegalActions(restoredOpenChain.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredOpenChain, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredOpenChain, 1));
    const solemnAction = getLuaRestoreLegalActions(restoredOpenChain, 1).find((action) => action.type === "activateEffect" && action.uid === solemn!.uid);
    expect(solemnAction).toBeDefined();
    const chained = applyLuaRestoreResponse(restoredOpenChain, solemnAction!);
    expect(chained.ok, chained.error).toBe(true);
    expect(restoredOpenChain.session.state.players[1].lifePoints).toBe(4000);
    expectSolemnCost(restoredOpenChain.session, solemn!.uid, 6);
    expect(restoredOpenChain.session.state.chain).toHaveLength(2);
    expect(restoredOpenChain.session.state.chain[1]).toMatchObject({
      sourceUid: solemn!.uid,
      operationInfos: [
        { category: 0x10000000, targetUids: [starter!.uid], count: 1, player: 0, parameter: 0 },
        { category: 0x1, targetUids: [starter!.uid], count: 1, player: 0, parameter: 0 },
      ],
    });

    const restoredPendingResolution = restoreDuelWithLuaScripts(serializeDuel(restoredOpenChain.session), source, reader);
    expect(restoredPendingResolution.restoreComplete, restoredPendingResolution.incompleteReasons.join("; ")).toBe(true);
    expect(restoredPendingResolution.missingRegistryKeys).toEqual([]);
    expect(restoredPendingResolution.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredPendingResolution, 0)).toEqual(getGroupedDuelLegalActions(restoredPendingResolution.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredPendingResolution, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredPendingResolution, 0));

    for (let index = 0; index < 4 && restoredPendingResolution.session.state.chain.length > 0; index += 1) {
      const passPlayer = restoredPendingResolution.session.state.waitingFor;
      expect(passPlayer).toBeDefined();
      const pass = getLuaRestoreLegalActions(restoredPendingResolution, passPlayer!).find((action) => action.type === "passChain");
      expect(pass).toBeDefined();
      const resolved = applyLuaRestoreResponse(restoredPendingResolution, pass!);
      expect(resolved.ok, resolved.error).toBe(true);
    }

    expect(restoredPendingResolution.session.state.chain).toHaveLength(0);
    expect(restoredPendingResolution.session.state.players[1].lifePoints).toBe(4000);
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === starter!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === solemn!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === drawn!.uid)).toMatchObject({ location: "deck" });
    expect(restoredPendingResolution.host.messages).not.toContain("solemn judgment draw spell resolved");
    expect(restoredPendingResolution.host.messages).not.toContain("solemn judgment chain responder resolved");
    expect(restoredPendingResolution.session.state.eventHistory.filter((event) => ["destroyed", "chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: starter!.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: solemn!.uid,
        eventReasonEffectId: 6,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "spellTrapZone",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
      },
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 1,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 1,
      },
    ]);
    expect(restoredPendingResolution.session.state.eventHistory.filter((event) => event.eventName === "cardsDrawn" && event.eventPlayer === 0 && event.eventUids?.includes(drawn!.uid))).toEqual([]);
  });

  it("restores Solemn Judgment's Trap activation negation, LP-half cost, and source destruction", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const solemnCode = "41420027";
    const starterCode = "956";
    const drawnCode = "957";
    const responderCode = "958";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === solemnCode),
      { code: starterCode, name: "Solemn Judgment Draw Trap", kind: "trap", typeFlags: 0x4 },
      { code: drawnCode, name: "Solemn Judgment Trap Drawn Card", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Solemn Judgment Trap Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 485, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [starterCode, drawnCode, responderCode] }, 1: { main: [solemnCode] } });
    startDuel(session);

    const starter = session.state.cards.find((card) => card.code === starterCode);
    const drawn = session.state.cards.find((card) => card.code === drawnCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const solemn = session.state.cards.find((card) => card.code === solemnCode);
    expect(starter).toBeDefined();
    expect(drawn).toBeDefined();
    expect(responder).toBeDefined();
    expect(solemn).toBeDefined();
    moveDuelCard(session.state, starter!.uid, "spellTrapZone", 0);
    starter!.position = "faceDown";
    starter!.faceUp = false;
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, solemn!.uid, "spellTrapZone", 1);
    solemn!.position = "faceDown";
    solemn!.faceUp = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return drawTrapScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(solemnCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const starterAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === starter!.uid);
    expect(starterAction).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchObject({
      sourceUid: starter!.uid,
      operationInfos: [{ category: 0x10000, targetUids: [], count: 0, player: 0, parameter: 1 }],
    });

    const restoredOpenChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredOpenChain.restoreComplete, restoredOpenChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredOpenChain.missingRegistryKeys).toEqual([]);
    expect(restoredOpenChain.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredOpenChain, 1)).toEqual(getGroupedDuelLegalActions(restoredOpenChain.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredOpenChain, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredOpenChain, 1));
    const solemnAction = getLuaRestoreLegalActions(restoredOpenChain, 1).find((action) => action.type === "activateEffect" && action.uid === solemn!.uid);
    expect(solemnAction).toBeDefined();
    const chained = applyLuaRestoreResponse(restoredOpenChain, solemnAction!);
    expect(chained.ok, chained.error).toBe(true);
    expect(restoredOpenChain.session.state.players[1].lifePoints).toBe(4000);
    expectSolemnCost(restoredOpenChain.session, solemn!.uid, 6);
    expect(restoredOpenChain.session.state.chain).toHaveLength(2);
    expect(restoredOpenChain.session.state.chain[1]).toMatchObject({
      sourceUid: solemn!.uid,
      operationInfos: [
        { category: 0x10000000, targetUids: [starter!.uid], count: 1, player: 0, parameter: 0 },
        { category: 0x1, targetUids: [starter!.uid], count: 1, player: 0, parameter: 0 },
      ],
    });

    const restoredPendingResolution = restoreDuelWithLuaScripts(serializeDuel(restoredOpenChain.session), source, reader);
    expect(restoredPendingResolution.restoreComplete, restoredPendingResolution.incompleteReasons.join("; ")).toBe(true);
    expect(restoredPendingResolution.missingRegistryKeys).toEqual([]);
    expect(restoredPendingResolution.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredPendingResolution, 0)).toEqual(getGroupedDuelLegalActions(restoredPendingResolution.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredPendingResolution, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredPendingResolution, 0));

    for (let index = 0; index < 4 && restoredPendingResolution.session.state.chain.length > 0; index += 1) {
      const passPlayer = restoredPendingResolution.session.state.waitingFor;
      expect(passPlayer).toBeDefined();
      const pass = getLuaRestoreLegalActions(restoredPendingResolution, passPlayer!).find((action) => action.type === "passChain");
      expect(pass).toBeDefined();
      const resolved = applyLuaRestoreResponse(restoredPendingResolution, pass!);
      expect(resolved.ok, resolved.error).toBe(true);
    }

    expect(restoredPendingResolution.session.state.chain).toHaveLength(0);
    expect(restoredPendingResolution.session.state.players[1].lifePoints).toBe(4000);
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === starter!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === solemn!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === drawn!.uid)).toMatchObject({ location: "deck" });
    expect(restoredPendingResolution.host.messages).not.toContain("solemn judgment draw trap resolved");
    expect(restoredPendingResolution.host.messages).not.toContain("solemn judgment chain responder resolved");
    expect(restoredPendingResolution.session.state.eventHistory.filter((event) => ["destroyed", "chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: starter!.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: solemn!.uid,
        eventReasonEffectId: 6,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "spellTrapZone",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
      },
      {
        eventName: "chainNegated",
        eventCode: 1024,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 1,
      },
      {
        eventName: "chainDisabled",
        eventCode: 1025,
        eventPlayer: 0,
        eventValue: 1,
        eventReasonPlayer: 0,
        eventChainDepth: 1,
        eventChainLinkId: "chain-2",
        relatedEffectId: 1,
      },
    ]);
    expect(restoredPendingResolution.session.state.eventHistory.filter((event) => event.eventName === "cardsDrawn" && event.eventPlayer === 0 && event.eventUids?.includes(drawn!.uid))).toEqual([]);
  });
});

function drawSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DRAW)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsPlayerCanDraw(tp,1) end
        Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)
      end)
      e:SetOperation(function(e,tp)
        Duel.Draw(tp,1,REASON_EFFECT)
        Debug.Message("solemn judgment draw spell resolved")
      end)
      c:RegisterEffect(e)
    end
  `;
}

function drawTrapScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DRAW)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsPlayerCanDraw(tp,1) end
        Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)
      end)
      e:SetOperation(function(e,tp)
        Duel.Draw(tp,1,REASON_EFFECT)
        Debug.Message("solemn judgment draw trap resolved")
      end)
      c:RegisterEffect(e)
    end
  `;
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("solemn judgment chain responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function expectSolemnCost(session: DuelSession, solemnUid: string, effectId: number) {
  expect(session.state.eventHistory.filter((event) => event.eventName === "lifePointCostPaid")).toEqual([
    {
      eventName: "lifePointCostPaid",
      eventCode: 1201,
      eventPlayer: 1,
      eventValue: 4000,
      eventReason: duelReason.cost,
      eventReasonPlayer: 1,
      eventReasonCardUid: solemnUid,
      eventReasonEffectId: effectId,
    },
  ]);
}
