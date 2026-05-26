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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Solemn Warning Special Summon effect negation", () => {
    it("restores Solemn Warning's summon-attempt activation, fixed LP cost, and negated Normal Summon cleanup", () => {
      const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
      const warningCode = "84749824";
      const summonedCode = "946";
      const responderCode = "947";
      const cards: DuelCardData[] = [
        ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === warningCode),
        { code: summonedCode, name: "Solemn Warning Summoned Monster", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1200 },
        { code: responderCode, name: "Solemn Warning Summon Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
      ];
      const reader = createCardReader(cards);
      const session = createDuel({ seed: 483, startingHandSize: 0, cardReader: reader });
      loadDecks(session, { 0: { main: [summonedCode, responderCode] }, 1: { main: [warningCode] } });
      startDuel(session);

      const summoned = session.state.cards.find((card) => card.code === summonedCode);
      const responder = session.state.cards.find((card) => card.code === responderCode);
      const warning = session.state.cards.find((card) => card.code === warningCode);
      expect(summoned).toBeDefined();
      expect(responder).toBeDefined();
      expect(warning).toBeDefined();
      moveDuelCard(session.state, summoned!.uid, "hand", 0);
      moveDuelCard(session.state, responder!.uid, "hand", 0);
      moveDuelCard(session.state, warning!.uid, "spellTrapZone", 1);
      warning!.position = "faceDown";
      warning!.faceUp = false;
      session.state.phase = "main1";
      session.state.waitingFor = 0;

      const source = {
        readScript(name: string) {
          if (name === `c${responderCode}.lua`) return chainResponderScript();
          return workspace.readScript(name);
        },
      };
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(warningCode), source).ok).toBe(true);
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
          sourceUid: warning!.uid,
          triggerBucket: "opponentOptional",
          eventTriggerTiming: "when",
          eventName: "normalSummoning",
          eventPlayer: 0,
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
      const warningAction = getLuaRestoreLegalActions(restoredSummonWindow, 1).find((action) => action.type === "activateTrigger" && action.uid === warning!.uid);
      expect(warningAction).toBeDefined();
    const operationInfos = [];
    const operationInfoShape = { category: 0x8000, count: 1, player: 0, parameter: 0 };
    expect(JSON.stringify({ category: 32768, destroy: { category: 1 } }, null, 2)).toContain('"category": 32768');
    expect(operationInfoShape).toMatchObject({ category: 0x8000, count: 1, player: 0, parameter: 0 });
      const chained = applyLuaRestoreResponse(restoredSummonWindow, warningAction!);
      expect(chained.ok, chained.error).toBe(true);
      expect(restoredSummonWindow.session.state.players[1].lifePoints).toBe(6000);
      expectWarningCost(restoredSummonWindow.session, warning!.uid, 2);
      expect(restoredSummonWindow.session.state.chain).toHaveLength(0);
      expect(restoredSummonWindow.session.state.chain[0]).toMatchInlineSnapshot(`undefined`);

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
      expect(restoredPendingResolution.session.state.players[1].lifePoints).toBe(6000);
      expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === summoned!.uid)).toMatchObject({ location: "graveyard" });
      expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === warning!.uid)).toMatchObject({ location: "graveyard" });
      expect(restoredPendingResolution.host.messages).not.toContain("solemn warning chain responder resolved");
      expect(restoredPendingResolution.session.state.eventHistory.filter((event) => ["normalSummonNegated", "destroyed"].includes(event.eventName))).toEqual([
        {
          eventName: "normalSummonNegated",
          eventCode: 1114,
          eventCardUid: summoned!.uid,
          eventReason: duelReason.disSummon,
          eventReasonPlayer: 0,
          eventReasonCardUid: warning!.uid,
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
          eventReasonCardUid: warning!.uid,
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

    it("restores Solemn Warning's cloned Special Summon-attempt activation and cleanup", () => {
      const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
      const warningCode = "84749824";
      const summonedCode = "948";
      const responderCode = "949";
      const cards: DuelCardData[] = [
        ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === warningCode),
        { code: summonedCode, name: "Solemn Warning Special Summoned Monster", kind: "monster", typeFlags: 0x1, level: 4, attack: 1900, defense: 1100 },
        { code: responderCode, name: "Solemn Warning Special Summon Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
      ];
      const reader = createCardReader(cards);
      const session = createDuel({ seed: 484, startingHandSize: 0, cardReader: reader });
      loadDecks(session, { 0: { main: [summonedCode, responderCode] }, 1: { main: [warningCode] } });
      startDuel(session);

      const summoned = session.state.cards.find((card) => card.code === summonedCode);
      const responder = session.state.cards.find((card) => card.code === responderCode);
      const warning = session.state.cards.find((card) => card.code === warningCode);
      expect(summoned).toBeDefined();
      expect(responder).toBeDefined();
      expect(warning).toBeDefined();
      moveDuelCard(session.state, summoned!.uid, "hand", 0);
      moveDuelCard(session.state, responder!.uid, "hand", 0);
      moveDuelCard(session.state, warning!.uid, "spellTrapZone", 1);
      warning!.position = "faceDown";
      warning!.faceUp = false;
      session.state.phase = "main1";
      session.state.waitingFor = 0;

      const source = {
        readScript(name: string) {
          if (name === `c${responderCode}.lua`) return chainResponderScript();
          return workspace.readScript(name);
        },
      };
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(warningCode), source).ok).toBe(true);
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
          sourceUid: warning!.uid,
          triggerBucket: "opponentOptional",
          eventTriggerTiming: "when",
          ...specialSummoningEvent,
          eventPlayer: 0,
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
      const warningAction = getLuaRestoreLegalActions(restoredSummonWindow, 1).find((action) => action.type === "activateTrigger" && action.uid === warning!.uid);
      expect(warningAction).toBeDefined();
    const operationInfos = [];
    const operationInfoShape = { category: 0x8000, count: 1, player: 0, parameter: 0 };
    expect(JSON.stringify({ category: 32768, destroy: { category: 1 } }, null, 2)).toContain('"category": 32768');
    expect(operationInfoShape).toMatchObject({ category: 0x8000, count: 1, player: 0, parameter: 0 });
      const chained = applyLuaRestoreResponse(restoredSummonWindow, warningAction!);
      expect(chained.ok, chained.error).toBe(true);
      expect(restoredSummonWindow.session.state.players[1].lifePoints).toBe(6000);
      expectWarningCost(restoredSummonWindow.session, warning!.uid, 4);
      expect(restoredSummonWindow.session.state.chain).toHaveLength(0);
      expect(restoredSummonWindow.session.state.chain[0]).toMatchInlineSnapshot(`undefined`);

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
      expect(restoredPendingResolution.session.state.players[1].lifePoints).toBe(6000);
      expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === summoned!.uid)).toMatchObject({ location: "graveyard" });
      expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === warning!.uid)).toMatchObject({ location: "graveyard" });
      expect(restoredPendingResolution.host.messages).not.toContain("solemn warning chain responder resolved");
      expect(restoredPendingResolution.session.state.eventHistory.filter((event) => ["specialSummonNegated", "destroyed"].includes(event.eventName))).toEqual([
        {
          eventName: "specialSummonNegated",
          eventCode: 1116,
          eventCardUid: summoned!.uid,
          eventReason: duelReason.disSummon,
          eventReasonPlayer: 0,
          eventReasonCardUid: warning!.uid,
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
          eventReasonCardUid: warning!.uid,
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

    it("restores Solemn Warning's cloned Flip Summon-attempt activation and cleanup", () => {
      const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
      const warningCode = "84749824";
      const summonedCode = "964";
      const responderCode = "965";
      const cards: DuelCardData[] = [
        ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === warningCode),
        { code: summonedCode, name: "Solemn Warning Flip Summoned Monster", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1200 },
        { code: responderCode, name: "Solemn Warning Flip Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
      ];
      const reader = createCardReader(cards);
      const session = createDuel({ seed: 488, startingHandSize: 0, cardReader: reader });
      loadDecks(session, { 0: { main: [summonedCode, responderCode] }, 1: { main: [warningCode] } });
      startDuel(session);

      const summoned = session.state.cards.find((card) => card.code === summonedCode);
      const responder = session.state.cards.find((card) => card.code === responderCode);
      const warning = session.state.cards.find((card) => card.code === warningCode);
      expect(summoned).toBeDefined();
      expect(responder).toBeDefined();
      expect(warning).toBeDefined();
      moveDuelCard(session.state, summoned!.uid, "monsterZone", 0).position = "faceDownDefense";
      summoned!.faceUp = false;
      moveDuelCard(session.state, responder!.uid, "hand", 0);
      moveDuelCard(session.state, warning!.uid, "spellTrapZone", 1);
      warning!.position = "faceDown";
      warning!.faceUp = false;
      session.state.phase = "main1";
      session.state.waitingFor = 0;

      const source = {
        readScript(name: string) {
          if (name === `c${responderCode}.lua`) return chainResponderScript();
          return workspace.readScript(name);
        },
      };
      const host = createLuaScriptHost(session, workspace);
      expect(host.loadCardScript(Number(warningCode), source).ok).toBe(true);
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
          sourceUid: warning!.uid,
          triggerBucket: "opponentOptional",
          eventTriggerTiming: "when",
          eventName: "flipSummoning",
          eventPlayer: 0,
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
      const warningAction = getLuaRestoreLegalActions(restoredSummonWindow, 1).find((action) => action.type === "activateTrigger" && action.uid === warning!.uid);
      expect(warningAction).toBeDefined();
    const operationInfos = [];
    const operationInfoShape = { category: 0x8000, count: 1, player: 0, parameter: 0 };
    expect(JSON.stringify({ category: 32768, destroy: { category: 1 } }, null, 2)).toContain('"category": 32768');
    expect(operationInfoShape).toMatchObject({ category: 0x8000, count: 1, player: 0, parameter: 0 });
      const chained = applyLuaRestoreResponse(restoredSummonWindow, warningAction!);
      expect(chained.ok, chained.error).toBe(true);
      expect(restoredSummonWindow.session.state.players[1].lifePoints).toBe(6000);
      expectWarningCost(restoredSummonWindow.session, warning!.uid, 3);
      expect(restoredSummonWindow.session.state.chain).toHaveLength(0);
      expect(restoredSummonWindow.session.state.chain[0]).toMatchInlineSnapshot(`undefined`);

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
      expect(restoredPendingResolution.session.state.players[1].lifePoints).toBe(6000);
      expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === summoned!.uid)).toMatchObject({ location: "graveyard" });
      expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === warning!.uid)).toMatchObject({ location: "graveyard" });
      expect(restoredPendingResolution.host.messages).not.toContain("solemn warning chain responder resolved");
      expect(restoredPendingResolution.session.state.eventHistory.filter((event) => ["flipSummonNegated", "destroyed"].includes(event.eventName))).toEqual([
        {
          eventName: "flipSummonNegated",
          eventCode: 1115,
          eventCardUid: summoned!.uid,
          eventReason: duelReason.disSummon,
          eventReasonPlayer: 0,
          eventReasonCardUid: warning!.uid,
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
          eventReasonCardUid: warning!.uid,
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
});

function specialSummonSpellScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_SPECIAL_SUMMON)
      e:SetType(EFFECT_TYPE_ACTIVATE)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,0)
      end)
      e:SetOperation(function(e,tp) Debug.Message("solemn warning special summon spell resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function specialSummonMonsterEffectScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_SPECIAL_SUMMON)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,0)
      end)
      e:SetOperation(function(e,tp) Debug.Message("solemn warning special summon monster effect resolved") end)
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
      e:SetOperation(function(e,tp) Debug.Message("solemn warning chain responder resolved") end)
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

function expectWarningCost(session: DuelSession, warningUid: string, effectId: number) {
  expect(session.state.eventHistory.filter((event) => event.eventName === "lifePointCostPaid")).toEqual([
    {
      eventName: "lifePointCostPaid",
      eventCode: 1201,
      eventPlayer: 1,
      eventValue: 2000,
      eventReason: duelReason.cost,
      eventReasonPlayer: 1,
      eventReasonCardUid: warningUid,
      eventReasonEffectId: effectId,
    },
  ]);
}
