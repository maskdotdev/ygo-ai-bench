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
    expect(session.state.pendingTriggers).toEqual([expect.objectContaining({ eventName: "normalSummoning", eventCode: 1103, eventCardUid: summoned!.uid })]);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonWindow.missingRegistryKeys).toEqual([]);
    expect(restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredSummonWindow, 1)).toEqual(getGroupedDuelLegalActions(restoredSummonWindow.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredSummonWindow, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredSummonWindow, 1));
    const warningAction = getLuaRestoreLegalActions(restoredSummonWindow, 1).find((action) => action.type === "activateTrigger" && action.uid === warning!.uid);
    expect(warningAction).toBeDefined();
    const chained = applyLuaRestoreResponse(restoredSummonWindow, warningAction!);
    expect(chained.ok, chained.error).toBe(true);
    expect(restoredSummonWindow.session.state.players[1].lifePoints).toBe(6000);
    expectWarningCost(restoredSummonWindow.session, warning!.uid, 2);
    expect(restoredSummonWindow.session.state.chain).toHaveLength(1);
    expect(restoredSummonWindow.session.state.chain[0]).toMatchObject({
      sourceUid: warning!.uid,
      eventName: "normalSummoning",
      eventCode: 1103,
      eventCardUid: summoned!.uid,
      operationInfos: [
        { category: 0x8000, targetUids: [summoned!.uid], count: 1, player: 0, parameter: 0 },
        { category: 0x1, targetUids: [summoned!.uid], count: 1, player: 0, parameter: 0 },
      ],
    });

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
    expect(restoredPendingResolution.session.state.eventHistory).not.toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "normalSummoned", eventCardUid: summoned!.uid })]));
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
    expect(session.state.pendingTriggers).toEqual([expect.objectContaining({ eventName: "specialSummoning", eventCode: 1105, eventCardUid: summoned!.uid })]);
    expect(session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "specialSummoning", eventCode: 1105, eventCardUid: summoned!.uid }),
        expect.objectContaining({ eventName: "specialSummoned", eventCode: 1102, eventCardUid: summoned!.uid }),
      ]),
    );

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonWindow.missingRegistryKeys).toEqual([]);
    expect(restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredSummonWindow, 1)).toEqual(getGroupedDuelLegalActions(restoredSummonWindow.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredSummonWindow, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredSummonWindow, 1));
    const warningAction = getLuaRestoreLegalActions(restoredSummonWindow, 1).find((action) => action.type === "activateTrigger" && action.uid === warning!.uid);
    expect(warningAction).toBeDefined();
    const chained = applyLuaRestoreResponse(restoredSummonWindow, warningAction!);
    expect(chained.ok, chained.error).toBe(true);
    expect(restoredSummonWindow.session.state.players[1].lifePoints).toBe(6000);
    expectWarningCost(restoredSummonWindow.session, warning!.uid, 4);
    expect(restoredSummonWindow.session.state.chain).toHaveLength(1);
    expect(restoredSummonWindow.session.state.chain[0]).toMatchObject({
      sourceUid: warning!.uid,
      eventName: "specialSummoning",
      eventCode: 1105,
      eventCardUid: summoned!.uid,
      operationInfos: [
        { category: 0x8000, targetUids: [summoned!.uid], count: 1, player: 0, parameter: 0 },
        { category: 0x1, targetUids: [summoned!.uid], count: 1, player: 0, parameter: 0 },
      ],
    });

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
    expect(restoredPendingResolution.session.state.eventHistory).not.toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "specialSummoned", eventCardUid: summoned!.uid })]));
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
    expect(session.state.pendingTriggers).toEqual([expect.objectContaining({ eventName: "flipSummoning", eventCode: 1104, eventCardUid: summoned!.uid })]);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonWindow.missingRegistryKeys).toEqual([]);
    expect(restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredSummonWindow, 1)).toEqual(getGroupedDuelLegalActions(restoredSummonWindow.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredSummonWindow, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredSummonWindow, 1));
    const warningAction = getLuaRestoreLegalActions(restoredSummonWindow, 1).find((action) => action.type === "activateTrigger" && action.uid === warning!.uid);
    expect(warningAction).toBeDefined();
    const chained = applyLuaRestoreResponse(restoredSummonWindow, warningAction!);
    expect(chained.ok, chained.error).toBe(true);
    expect(restoredSummonWindow.session.state.players[1].lifePoints).toBe(6000);
    expectWarningCost(restoredSummonWindow.session, warning!.uid, 3);
    expect(restoredSummonWindow.session.state.chain).toHaveLength(1);
    expect(restoredSummonWindow.session.state.chain[0]).toMatchObject({
      sourceUid: warning!.uid,
      eventName: "flipSummoning",
      eventCode: 1104,
      eventCardUid: summoned!.uid,
      operationInfos: [
        { category: 0x8000, targetUids: [summoned!.uid], count: 1, player: 0, parameter: 0 },
        { category: 0x1, targetUids: [summoned!.uid], count: 1, player: 0, parameter: 0 },
      ],
    });

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
    expect(restoredPendingResolution.session.state.eventHistory).not.toEqual(expect.arrayContaining([expect.objectContaining({ eventName: "flipSummoned", eventCardUid: summoned!.uid })]));
  });

  it("restores Solemn Warning's chain response to an activation that includes a Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const warningCode = "84749824";
    const starterCode = "929";
    const responderCode = "930";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === warningCode),
      { code: starterCode, name: "Solemn Warning Special Summon Spell", kind: "spell", typeFlags: 0x2 },
      { code: responderCode, name: "Solemn Warning Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 479, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [starterCode, responderCode] }, 1: { main: [warningCode] } });
    startDuel(session);

    const starter = session.state.cards.find((card) => card.code === starterCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const warning = session.state.cards.find((card) => card.code === warningCode);
    expect(starter).toBeDefined();
    expect(responder).toBeDefined();
    expect(warning).toBeDefined();
    moveDuelCard(session.state, starter!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, warning!.uid, "spellTrapZone", 1);
    warning!.position = "faceDown";
    warning!.faceUp = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return specialSummonSpellScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(warningCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const starterAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === starter!.uid);
    expect(starterAction).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchObject({
      sourceUid: starter!.uid,
      operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0 }],
    });

    const restoredOpenChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredOpenChain.restoreComplete, restoredOpenChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredOpenChain.missingRegistryKeys).toEqual([]);
    expect(restoredOpenChain.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredOpenChain, 1)).toEqual(getGroupedDuelLegalActions(restoredOpenChain.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredOpenChain, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredOpenChain, 1));
    const warningAction = getLuaRestoreLegalActions(restoredOpenChain, 1).find((action) => action.type === "activateEffect" && action.uid === warning!.uid);
    expect(warningAction).toBeDefined();
    const chained = applyLuaRestoreResponse(restoredOpenChain, warningAction!);
    expect(chained.ok, chained.error).toBe(true);
    expect(restoredOpenChain.session.state.players[1].lifePoints).toBe(6000);
    expectWarningCost(restoredOpenChain.session, warning!.uid, 6);
    expect(restoredOpenChain.session.state.chain).toHaveLength(2);
    expect(restoredOpenChain.session.state.chain[1]).toMatchObject({
      sourceUid: warning!.uid,
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
    expect(restoredPendingResolution.session.state.players[1].lifePoints).toBe(6000);
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === starter!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === warning!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.host.messages).not.toContain("solemn warning special summon spell resolved");
    expect(restoredPendingResolution.host.messages).not.toContain("solemn warning chain responder resolved");
    expect(restoredPendingResolution.session.state.eventHistory.filter((event) => ["destroyed", "chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: starter!.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: warning!.uid,
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
  });

  it("restores Solemn Warning's chain response to a monster effect that includes a Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const warningCode = "84749824";
    const starterCode = "931";
    const responderCode = "932";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === warningCode),
      { code: starterCode, name: "Solemn Warning Special Summon Monster", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Solemn Warning Monster Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 480, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [starterCode, responderCode] }, 1: { main: [warningCode] } });
    startDuel(session);

    const starter = session.state.cards.find((card) => card.code === starterCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const warning = session.state.cards.find((card) => card.code === warningCode);
    expect(starter).toBeDefined();
    expect(responder).toBeDefined();
    expect(warning).toBeDefined();
    moveDuelCard(session.state, starter!.uid, "monsterZone", 0);
    starter!.position = "faceUpAttack";
    starter!.faceUp = true;
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, warning!.uid, "spellTrapZone", 1);
    warning!.position = "faceDown";
    warning!.faceUp = false;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${starterCode}.lua`) return specialSummonMonsterEffectScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(warningCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(starterCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const starterAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === starter!.uid);
    expect(starterAction).toBeDefined();
    applyAndAssert(session, starterAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchObject({
      sourceUid: starter!.uid,
      operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0 }],
    });

    const restoredOpenChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredOpenChain.restoreComplete, restoredOpenChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredOpenChain.missingRegistryKeys).toEqual([]);
    expect(restoredOpenChain.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredOpenChain, 1)).toEqual(getGroupedDuelLegalActions(restoredOpenChain.session, 1));
    expect(getLuaRestoreLegalActionGroups(restoredOpenChain, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredOpenChain, 1));
    const warningAction = getLuaRestoreLegalActions(restoredOpenChain, 1).find((action) => action.type === "activateEffect" && action.uid === warning!.uid);
    expect(warningAction).toBeDefined();
    const chained = applyLuaRestoreResponse(restoredOpenChain, warningAction!);
    expect(chained.ok, chained.error).toBe(true);
    expect(restoredOpenChain.session.state.players[1].lifePoints).toBe(6000);
    expectWarningCost(restoredOpenChain.session, warning!.uid, 6);
    expect(restoredOpenChain.session.state.chain).toHaveLength(2);
    expect(restoredOpenChain.session.state.chain[1]).toMatchObject({
      sourceUid: warning!.uid,
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
    expect(restoredPendingResolution.session.state.players[1].lifePoints).toBe(6000);
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === starter!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === warning!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.host.messages).not.toContain("solemn warning special summon monster effect resolved");
    expect(restoredPendingResolution.host.messages).not.toContain("solemn warning chain responder resolved");
    expect(restoredPendingResolution.session.state.eventHistory.filter((event) => ["destroyed", "chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: starter!.uid,
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: warning!.uid,
        eventReasonEffectId: 6,
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
