import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelEffectDefinition } from "#duel/types.js";
import { cards, findPublicCard } from "./full-duel-engine-fixtures.js";

describe("chainSolved before chainEnded trigger bucket restore", () => {
  it("keeps chainEnded buckets deferred after a restored chain resolves until chainSolved buckets finish", () => {
    const session = createDuel({ seed: 466, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "400", "500"] },
      1: { main: ["400", "400", "400", "400"] },
    });
    startDuel(session);

    const starter = findPublicCard(session, 0, "hand", "100");
    const chainSolvedSource = findPublicCard(session, 0, "hand", "300");
    const chainEndedSource = findPublicCard(session, 0, "hand", "400");
    const openQuickSource = findPublicCard(session, 0, "hand", "500");
    const opponentChainSource = findPublicCard(session, 1, "hand", "400");
    expect(starter).toBeDefined();
    expect(chainSolvedSource).toBeDefined();
    expect(chainEndedSource).toBeDefined();
    expect(openQuickSource).toBeDefined();
    expect(opponentChainSource).toBeDefined();

    registerEffect(session, { ...loggedEffect("restore-solved-ended-starter", starter!.uid, "ignition", "restore-solved-ended-starter resolved"), oncePerTurn: true });
    registerEffect(session, {
      ...loggedEffect("restore-solved-ended-chain-solved", chainSolvedSource!.uid, "trigger", "restore-solved-ended-chain-solved resolved", "chainSolved"),
      oncePerTurn: true,
      optional: false,
    });
    registerEffect(session, {
      ...loggedEffect("restore-solved-ended-chain-ended", chainEndedSource!.uid, "trigger", "restore-solved-ended-chain-ended resolved", "chainEnded"),
      oncePerTurn: true,
      optional: false,
    });
    registerEffect(session, openOnlyQuick("restore-solved-ended-open-quick", openQuickSource!.uid));
    registerEffect(session, chainOnlyQuick("restore-solved-ended-opponent-chain-quick", opponentChainSource!.uid, 1));

    const starterAction = findEffectAction(session, 0, "restore-solved-ended-starter");
    expect(starterAction).toBeDefined();
    applyAndAssert(session, starterAction!);

    const restoredInitialChain = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredInitialChain)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredInitialChain.state.chain.map((link) => link.effectId)).toEqual(["restore-solved-ended-starter"]);
    expect(effectIds(restoredInitialChain, 1)).toEqual(["restore-solved-ended-opponent-chain-quick"]);
    const initialPass = getDuelLegalActions(restoredInitialChain, 1).find((action) => action.type === "passChain");
    expect(initialPass).toBeDefined();
    applyAndAssert(restoredInitialChain, initialPass!);

    const restoredChainSolvedBucket = restoreDuel(serializeDuel(restoredInitialChain), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredChainSolvedBucket)).toMatchObject({ waitingFor: 0, windowKind: "triggerBucket", chain: [], pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnMandatory" }] });
    expect(restoredChainSolvedBucket.state.pendingTriggers).toEqual([
      expect.objectContaining({ player: 0, effectId: "restore-solved-ended-chain-solved", eventName: "chainSolved", triggerBucket: "turnMandatory" }),
    ]);
    expect(restoredChainSolvedBucket.state.pendingTriggers.some((trigger) => trigger.effectId === "restore-solved-ended-chain-ended")).toBe(false);
    expect(getDuelLegalActions(restoredChainSolvedBucket, 1)).toEqual([]);
    expect(getDuelLegalActions(restoredChainSolvedBucket, 0).some((action) => action.type === "declineTrigger")).toBe(false);
    expect(hasGroupedTrigger(restoredChainSolvedBucket, 0, "restore-solved-ended-chain-solved", "triggerBucket")).toBe(true);
    expect(hasGroupedEffect(restoredChainSolvedBucket, 0, "restore-solved-ended-open-quick", "triggerBucket")).toBe(false);

    const chainSolvedTrigger = getDuelLegalActions(restoredChainSolvedBucket, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-solved-ended-chain-solved");
    expect(chainSolvedTrigger).toBeDefined();
    applyAndAssert(restoredChainSolvedBucket, chainSolvedTrigger!);

    const restoredChainSolvedResponse = restoreDuel(serializeDuel(restoredChainSolvedBucket), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredChainSolvedResponse)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredChainSolvedResponse.state.chain.map((link) => link.effectId)).toEqual(["restore-solved-ended-chain-solved"]);
    expect(restoredChainSolvedResponse.state.pendingTriggers.some((trigger) => trigger.effectId === "restore-solved-ended-chain-ended")).toBe(false);
    expect(effectIds(restoredChainSolvedResponse, 1)).toEqual(["restore-solved-ended-opponent-chain-quick"]);
    const chainSolvedPass = getDuelLegalActions(restoredChainSolvedResponse, 1).find((action) => action.type === "passChain");
    expect(chainSolvedPass).toBeDefined();
    applyAndAssert(restoredChainSolvedResponse, chainSolvedPass!);

    const restoredChainEndedBucket = restoreDuel(serializeDuel(restoredChainSolvedResponse), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredChainEndedBucket)).toMatchObject({ waitingFor: 0, windowKind: "triggerBucket", chain: [], pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnMandatory" }] });
    expect(restoredChainEndedBucket.state.pendingTriggers).toEqual([
      expect.objectContaining({ player: 0, effectId: "restore-solved-ended-chain-ended", eventName: "chainEnded", triggerBucket: "turnMandatory" }),
    ]);
    expect(restoredChainEndedBucket.state.pendingTriggers.some((trigger) => trigger.effectId === "restore-solved-ended-chain-solved")).toBe(false);
    expect(restoredChainEndedBucket.state.log.map((entry) => entry.detail)).toContain("restore-solved-ended-chain-solved resolved");
    expect(restoredChainEndedBucket.state.log.map((entry) => entry.detail)).not.toContain("restore-solved-ended-chain-ended resolved");
    expect(getDuelLegalActions(restoredChainEndedBucket, 1)).toEqual([]);
    expect(getDuelLegalActions(restoredChainEndedBucket, 0).some((action) => action.type === "declineTrigger")).toBe(false);
    expect(hasGroupedTrigger(restoredChainEndedBucket, 0, "restore-solved-ended-chain-ended", "triggerBucket")).toBe(true);
    expect(hasGroupedEffect(restoredChainEndedBucket, 0, "restore-solved-ended-open-quick", "triggerBucket")).toBe(false);

    const chainEndedTrigger = getDuelLegalActions(restoredChainEndedBucket, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-solved-ended-chain-ended");
    expect(chainEndedTrigger).toBeDefined();
    applyAndAssert(restoredChainEndedBucket, chainEndedTrigger!);

    const restoredChainEndedResponse = restoreDuel(serializeDuel(restoredChainEndedBucket), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredChainEndedResponse)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredChainEndedResponse.state.chain.map((link) => link.effectId)).toEqual(["restore-solved-ended-chain-ended"]);
    expect(effectIds(restoredChainEndedResponse, 1)).toEqual(["restore-solved-ended-opponent-chain-quick"]);
    expect(restoredChainEndedResponse.state.log.map((entry) => entry.detail)).not.toContain("restore-solved-ended-chain-ended resolved");
    const chainEndedPass = getDuelLegalActions(restoredChainEndedResponse, 1).find((action) => action.type === "passChain");
    expect(chainEndedPass).toBeDefined();
    applyAndAssert(restoredChainEndedResponse, chainEndedPass!);

    const restoredOpen = restoreDuel(serializeDuel(restoredChainEndedResponse), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpen)).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredOpen.state.chainPasses).toEqual([]);
    expect(restoredOpen.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining([
      "restore-solved-ended-starter resolved",
      "restore-solved-ended-chain-solved resolved",
      "restore-solved-ended-chain-ended resolved",
    ]));
    expect(restoredOpen.state.log.map((entry) => entry.detail)).not.toContain("restore-solved-ended-opponent-chain-quick resolved");
    expect(effectIds(restoredOpen, 0)).toEqual(["restore-solved-ended-open-quick"]);
    expect(getGroupedDuelLegalActions(restoredOpen, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restoredOpen, 0));
    expect(getDuelLegalActions(restoredOpen, 1)).toEqual([]);

    const staleChainSolved = applyResponse(restoredChainSolvedBucket, chainSolvedTrigger!);
    expect(staleChainSolved.ok).toBe(false);
    expect(staleChainSolved.error).toContain("Response is not currently legal");
    expect(staleChainSolved.legalActions).toEqual(getDuelLegalActions(restoredChainSolvedBucket, 1));
    expect(staleChainSolved.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredChainSolvedBucket, 1));
  });

  it("collects deferred chainEnded buckets after restored optional chainSolved declines", () => {
    const session = createDuel({ seed: 467, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "400", "500"] },
      1: { main: ["400", "400", "400", "400"] },
    });
    startDuel(session);

    const starter = findPublicCard(session, 0, "hand", "100");
    const chainSolvedSource = findPublicCard(session, 0, "hand", "300");
    const chainEndedSource = findPublicCard(session, 0, "hand", "400");
    const openQuickSource = findPublicCard(session, 0, "hand", "500");
    const opponentChainSource = findPublicCard(session, 1, "hand", "400");
    expect(starter).toBeDefined();
    expect(chainSolvedSource).toBeDefined();
    expect(chainEndedSource).toBeDefined();
    expect(openQuickSource).toBeDefined();
    expect(opponentChainSource).toBeDefined();

    registerEffect(session, { ...loggedEffect("restore-solved-decline-starter", starter!.uid, "ignition", "restore-solved-decline-starter resolved"), oncePerTurn: true });
    registerEffect(session, {
      ...loggedEffect("restore-solved-decline-chain-solved", chainSolvedSource!.uid, "trigger", "restore-solved-decline-chain-solved should not resolve", "chainSolved"),
      oncePerTurn: true,
    });
    registerEffect(session, {
      ...loggedEffect("restore-solved-decline-chain-ended", chainEndedSource!.uid, "trigger", "restore-solved-decline-chain-ended resolved", "chainEnded"),
      oncePerTurn: true,
      optional: false,
    });
    registerEffect(session, openOnlyQuick("restore-solved-decline-open-quick", openQuickSource!.uid));
    registerEffect(session, chainOnlyQuick("restore-solved-decline-opponent-chain-quick", opponentChainSource!.uid, 1));

    const starterAction = findEffectAction(session, 0, "restore-solved-decline-starter");
    expect(starterAction).toBeDefined();
    applyAndAssert(session, starterAction!);

    const restoredInitialChain = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredInitialChain)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", pendingTriggers: [], pendingTriggerBuckets: [] });
    const initialPass = getDuelLegalActions(restoredInitialChain, 1).find((action) => action.type === "passChain");
    expect(initialPass).toBeDefined();
    applyAndAssert(restoredInitialChain, initialPass!);

    const restoredChainSolvedBucket = restoreDuel(serializeDuel(restoredInitialChain), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredChainSolvedBucket)).toMatchObject({ waitingFor: 0, windowKind: "triggerBucket", chain: [], pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }] });
    expect(restoredChainSolvedBucket.state.pendingTriggers).toEqual([
      expect.objectContaining({ player: 0, effectId: "restore-solved-decline-chain-solved", eventName: "chainSolved", triggerBucket: "turnOptional" }),
    ]);
    expect(restoredChainSolvedBucket.state.pendingTriggers.some((trigger) => trigger.effectId === "restore-solved-decline-chain-ended")).toBe(false);
    expect(hasGroupedTrigger(restoredChainSolvedBucket, 0, "restore-solved-decline-chain-solved", "triggerBucket")).toBe(true);
    expect(hasGroupedEffect(restoredChainSolvedBucket, 0, "restore-solved-decline-open-quick", "triggerBucket")).toBe(false);

    const chainSolvedDecline = getDuelLegalActions(restoredChainSolvedBucket, 0).find((action) => action.type === "declineTrigger" && action.effectId === "restore-solved-decline-chain-solved");
    expect(chainSolvedDecline).toBeDefined();
    applyAndAssert(restoredChainSolvedBucket, chainSolvedDecline!);

    const restoredChainEndedBucket = restoreDuel(serializeDuel(restoredChainSolvedBucket), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredChainEndedBucket)).toMatchObject({ waitingFor: 0, windowKind: "triggerBucket", chain: [], pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnMandatory" }] });
    expect(restoredChainEndedBucket.state.pendingTriggers).toEqual([
      expect.objectContaining({ player: 0, effectId: "restore-solved-decline-chain-ended", eventName: "chainEnded", triggerBucket: "turnMandatory" }),
    ]);
    expect(restoredChainEndedBucket.state.log.map((entry) => entry.detail)).not.toContain("restore-solved-decline-chain-solved should not resolve");
    expect(hasGroupedTrigger(restoredChainEndedBucket, 0, "restore-solved-decline-chain-ended", "triggerBucket")).toBe(true);
    expect(hasGroupedEffect(restoredChainEndedBucket, 0, "restore-solved-decline-open-quick", "triggerBucket")).toBe(false);

    const chainEndedTrigger = getDuelLegalActions(restoredChainEndedBucket, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-solved-decline-chain-ended");
    expect(chainEndedTrigger).toBeDefined();
    applyAndAssert(restoredChainEndedBucket, chainEndedTrigger!);

    const restoredChainEndedResponse = restoreDuel(serializeDuel(restoredChainEndedBucket), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredChainEndedResponse)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredChainEndedResponse.state.chain.map((link) => link.effectId)).toEqual(["restore-solved-decline-chain-ended"]);
    expect(effectIds(restoredChainEndedResponse, 1)).toEqual(["restore-solved-decline-opponent-chain-quick"]);
    const chainEndedPass = getDuelLegalActions(restoredChainEndedResponse, 1).find((action) => action.type === "passChain");
    expect(chainEndedPass).toBeDefined();
    applyAndAssert(restoredChainEndedResponse, chainEndedPass!);

    const restoredPostEndedChainSolvedBucket = restoreDuel(serializeDuel(restoredChainEndedResponse), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredPostEndedChainSolvedBucket)).toMatchObject({ waitingFor: 0, windowKind: "triggerBucket", chain: [], pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }] });
    expect(restoredPostEndedChainSolvedBucket.state.pendingTriggers).toEqual([
      expect.objectContaining({ player: 0, effectId: "restore-solved-decline-chain-solved", eventName: "chainSolved", triggerBucket: "turnOptional" }),
    ]);
    expect(restoredPostEndedChainSolvedBucket.state.pendingTriggers.some((trigger) => trigger.effectId === "restore-solved-decline-chain-ended")).toBe(false);
    expect(restoredPostEndedChainSolvedBucket.state.log.map((entry) => entry.detail)).toContain("restore-solved-decline-chain-ended resolved");
    expect(restoredPostEndedChainSolvedBucket.state.log.map((entry) => entry.detail)).not.toContain("restore-solved-decline-chain-solved should not resolve");
    expect(hasGroupedEffect(restoredPostEndedChainSolvedBucket, 0, "restore-solved-decline-open-quick", "triggerBucket")).toBe(false);

    const finalChainSolvedDecline = getDuelLegalActions(restoredPostEndedChainSolvedBucket, 0).find((action) => action.type === "declineTrigger" && action.effectId === "restore-solved-decline-chain-solved");
    expect(finalChainSolvedDecline).toBeDefined();
    applyAndAssert(restoredPostEndedChainSolvedBucket, finalChainSolvedDecline!);

    const restoredOpen = restoreDuel(serializeDuel(restoredPostEndedChainSolvedBucket), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpen)).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredOpen.state.chainPasses).toEqual([]);
    expect(restoredOpen.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining([
      "restore-solved-decline-starter resolved",
      "restore-solved-decline-chain-ended resolved",
    ]));
    expect(restoredOpen.state.log.map((entry) => entry.detail)).not.toContain("restore-solved-decline-chain-solved should not resolve");
    expect(restoredOpen.state.log.map((entry) => entry.detail)).not.toContain("restore-solved-decline-opponent-chain-quick resolved");
    expect(effectIds(restoredOpen, 0)).toEqual(["restore-solved-decline-open-quick"]);
    expect(getDuelLegalActions(restoredOpen, 1)).toEqual([]);
  });

  it("keeps chainEnded buckets deferred after a restored chainSolved activation and declined sibling until that trigger chain resolves", () => {
    const session = createDuel({ seed: 468, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500", "600"] },
      1: { main: ["400", "500", "400", "400"] },
    });
    startDuel(session);

    const starter = findPublicCard(session, 0, "hand", "100");
    const chainSolvedSource = findPublicCard(session, 0, "hand", "300");
    const chainEndedSource = findPublicCard(session, 0, "hand", "500");
    const openQuickSource = findPublicCard(session, 0, "hand", "600");
    const opponentChainSolvedSource = findPublicCard(session, 1, "hand", "400");
    const opponentChainQuickSource = findPublicCard(session, 1, "hand", "500");
    expect(starter).toBeDefined();
    expect(chainSolvedSource).toBeDefined();
    expect(chainEndedSource).toBeDefined();
    expect(openQuickSource).toBeDefined();
    expect(opponentChainSolvedSource).toBeDefined();
    expect(opponentChainQuickSource).toBeDefined();

    registerEffect(session, { ...loggedEffect("restore-solved-mixed-starter", starter!.uid, "ignition", "restore-solved-mixed-starter resolved"), oncePerTurn: true });
    registerEffect(session, {
      ...loggedEffect("restore-solved-mixed-turn-optional", chainSolvedSource!.uid, "trigger", "restore-solved-mixed-turn-optional resolved", "chainSolved"),
      canActivate: firstChainSolvedEvent,
      oncePerTurn: true,
    });
    registerEffect(session, {
      ...loggedEffect("restore-solved-mixed-opponent-optional", opponentChainSolvedSource!.uid, "trigger", "restore-solved-mixed-opponent-optional should not resolve", "chainSolved"),
      controller: 1,
      canActivate: firstChainSolvedEvent,
    });
    registerEffect(session, {
      ...loggedEffect("restore-solved-mixed-chain-ended", chainEndedSource!.uid, "trigger", "restore-solved-mixed-chain-ended resolved", "chainEnded"),
      optional: false,
      oncePerTurn: true,
    });
    registerEffect(session, openOnlyQuick("restore-solved-mixed-open-quick", openQuickSource!.uid));
    registerEffect(session, chainOnlyQuickAfterEffect("restore-solved-mixed-opponent-chain-quick", opponentChainQuickSource!.uid, 1, "restore-solved-mixed-turn-optional"));

    const starterAction = findEffectAction(session, 0, "restore-solved-mixed-starter");
    expect(starterAction).toBeDefined();
    applyAndAssert(session, starterAction!);

    const restoredChainSolvedBucket = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredChainSolvedBucket)).toMatchObject({ waitingFor: 0, windowKind: "triggerBucket" });
    expect(restoredChainSolvedBucket.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual([
      "restore-solved-mixed-turn-optional",
      "restore-solved-mixed-opponent-optional",
    ]);
    expect(queryPublicState(restoredChainSolvedBucket).pendingTriggerBuckets.map((bucket) => bucket.triggerBucket)).toEqual(["turnOptional", "opponentOptional"]);
    expect(hasGroupedEffect(restoredChainSolvedBucket, 0, "restore-solved-mixed-open-quick", "triggerBucket")).toBe(false);

    const turnTrigger = getDuelLegalActions(restoredChainSolvedBucket, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-solved-mixed-turn-optional");
    expect(turnTrigger).toBeDefined();
    applyAndAssert(restoredChainSolvedBucket, turnTrigger!);

    const restoredOpponentBucket = restoreDuel(serializeDuel(restoredChainSolvedBucket), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpponentBucket)).toMatchObject({ waitingFor: 1, windowKind: "triggerBucket" });
    expect(restoredOpponentBucket.state.chain.map((link) => link.effectId)).toEqual(["restore-solved-mixed-turn-optional"]);
    expect(restoredOpponentBucket.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["restore-solved-mixed-opponent-optional"]);
    expect(restoredOpponentBucket.state.pendingTriggers.some((trigger) => trigger.effectId === "restore-solved-mixed-chain-ended")).toBe(false);
    const opponentDecline = getDuelLegalActions(restoredOpponentBucket, 1).find((action) => action.type === "declineTrigger" && action.effectId === "restore-solved-mixed-opponent-optional");
    expect(opponentDecline).toBeDefined();
    const declined = applyAndAssert(restoredOpponentBucket, opponentDecline!);
    expect(declined.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredOpponentBucket.state.chain.map((link) => link.effectId)).toEqual(["restore-solved-mixed-turn-optional"]);
    expect(restoredOpponentBucket.state.pendingTriggers.some((trigger) => trigger.effectId === "restore-solved-mixed-chain-ended")).toBe(false);
    expect(hasGroupedEffect(restoredOpponentBucket, 1, "restore-solved-mixed-opponent-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(restoredOpponentBucket, 0, "restore-solved-mixed-open-quick", "chainResponse")).toBe(false);

    const restoredChainResponse = restoreDuel(serializeDuel(restoredOpponentBucket), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredChainResponse)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse", pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(getDuelLegalActions(restoredChainResponse, 0)).toEqual([]);
    expect(getDuelLegalActions(restoredChainResponse, 1)).toEqual(getDuelLegalActions(restoredOpponentBucket, 1));
    expect(getGroupedDuelLegalActions(restoredChainResponse, 1)).toEqual(getGroupedDuelLegalActions(restoredOpponentBucket, 1));
    const pass = getDuelLegalActions(restoredChainResponse, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    applyAndAssert(restoredChainResponse, pass!);

    const restoredChainEndedBucket = restoreDuel(serializeDuel(restoredChainResponse), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredChainEndedBucket)).toMatchObject({ waitingFor: 0, windowKind: "triggerBucket", chain: [], pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnMandatory" }] });
    expect(restoredChainEndedBucket.state.pendingTriggers).toEqual([
      expect.objectContaining({ player: 0, effectId: "restore-solved-mixed-chain-ended", eventName: "chainEnded", triggerBucket: "turnMandatory" }),
    ]);
    expect(restoredChainEndedBucket.state.log.map((entry) => entry.detail)).toContain("restore-solved-mixed-turn-optional resolved");
    expect(restoredChainEndedBucket.state.log.map((entry) => entry.detail)).not.toContain("restore-solved-mixed-chain-ended resolved");
    expect(restoredChainEndedBucket.state.log.map((entry) => entry.detail)).not.toContain("restore-solved-mixed-opponent-optional should not resolve");
    expect(hasGroupedTrigger(restoredChainEndedBucket, 0, "restore-solved-mixed-chain-ended", "triggerBucket")).toBe(true);
    expect(hasGroupedEffect(restoredChainEndedBucket, 0, "restore-solved-mixed-open-quick", "triggerBucket")).toBe(false);

    const chainEndedTrigger = getDuelLegalActions(restoredChainEndedBucket, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-solved-mixed-chain-ended");
    expect(chainEndedTrigger).toBeDefined();
    applyAndAssert(restoredChainEndedBucket, chainEndedTrigger!);

    const restoredOpen = restoreDuel(serializeDuel(restoredChainEndedBucket), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpen)).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredOpen.state.chainPasses).toEqual([]);
    expect(restoredOpen.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining([
      "restore-solved-mixed-starter resolved",
      "restore-solved-mixed-turn-optional resolved",
      "restore-solved-mixed-chain-ended resolved",
    ]));
    expect(restoredOpen.state.log.map((entry) => entry.detail)).not.toContain("restore-solved-mixed-opponent-optional should not resolve");
    expect(effectIds(restoredOpen, 0)).toEqual(["restore-solved-mixed-open-quick"]);
    expect(getDuelLegalActions(restoredOpen, 1)).toEqual([]);
  });
});

function loggedEffect(id: string, sourceUid: string, event: "ignition" | "trigger", detail: string, triggerEvent?: DuelEffectDefinition["triggerEvent"]): DuelEffectDefinition {
  return {
    id,
    registryKey: id,
    sourceUid,
    controller: 0,
    event,
    ...(triggerEvent === undefined ? {} : { triggerEvent }),
    range: ["hand"],
    operation(ctx) {
      ctx.log(detail);
    },
  };
}

function openOnlyQuick(id: string, sourceUid: string): DuelEffectDefinition {
  return quickEffect(id, sourceUid, 0, 0);
}

function chainOnlyQuick(id: string, sourceUid: string, controller: 0 | 1): DuelEffectDefinition {
  return quickEffect(id, sourceUid, controller, 1);
}

function chainOnlyQuickAfterEffect(id: string, sourceUid: string, controller: 0 | 1, requiredEffectId: string): DuelEffectDefinition {
  return {
    ...chainOnlyQuick(id, sourceUid, controller),
    canActivate(ctx) {
      return ctx.duel.chain.some((link) => link.effectId === requiredEffectId);
    },
  };
}

function quickEffect(id: string, sourceUid: string, controller: 0 | 1, minimumChainLength: number): DuelEffectDefinition {
  return {
    id,
    registryKey: id,
    sourceUid,
    controller,
    event: "quick",
    range: ["hand"],
    operation(ctx) {
      ctx.log(`${id} resolved`);
    },
    canActivate(ctx) {
      return minimumChainLength === 0 ? ctx.duel.chain.length === 0 : ctx.duel.chain.length > 0;
    },
  };
}

function restoreRegistry(): Record<string, (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition> {
  return {
    "restore-solved-ended-starter": restoreLoggedEffect,
    "restore-solved-ended-chain-solved": restoreLoggedEffect,
    "restore-solved-ended-chain-ended": restoreLoggedEffect,
    "restore-solved-ended-open-quick": restoreOpenOnlyQuick,
    "restore-solved-ended-opponent-chain-quick": restoreChainOnlyQuick,
    "restore-solved-decline-starter": restoreLoggedEffect,
    "restore-solved-decline-chain-solved": restoreLoggedEffect,
    "restore-solved-decline-chain-ended": restoreLoggedEffect,
    "restore-solved-decline-open-quick": restoreOpenOnlyQuick,
    "restore-solved-decline-opponent-chain-quick": restoreChainOnlyQuick,
    "restore-solved-mixed-starter": restoreLoggedEffect,
    "restore-solved-mixed-turn-optional": (effect) => ({ ...restoreLoggedEffect(effect), canActivate: firstChainSolvedEvent, oncePerTurn: true }),
    "restore-solved-mixed-opponent-optional": (effect) => ({ ...restoreLoggedEffect(effect), canActivate: firstChainSolvedEvent }),
    "restore-solved-mixed-chain-ended": (effect) => ({ ...restoreLoggedEffect(effect), optional: false, oncePerTurn: true }),
    "restore-solved-mixed-open-quick": restoreOpenOnlyQuick,
    "restore-solved-mixed-opponent-chain-quick": (effect) => ({
      ...restoreLoggedEffect(effect),
      canActivate(ctx) {
        return ctx.duel.chain.some((link) => link.effectId === "restore-solved-mixed-turn-optional");
      },
    }),
  };
}

function firstChainSolvedEvent(ctx: Parameters<NonNullable<DuelEffectDefinition["canActivate"]>>[0]): boolean {
  return ctx.duel.eventHistory.filter((event) => event.eventName === "chainSolved").length === 1;
}

function restoreOpenOnlyQuick(effect: Omit<DuelEffectDefinition, "operation">): DuelEffectDefinition {
  return {
    ...restoreLoggedEffect(effect),
    canActivate(ctx) {
      return ctx.duel.chain.length === 0;
    },
  };
}

function restoreChainOnlyQuick(effect: Omit<DuelEffectDefinition, "operation">): DuelEffectDefinition {
  return {
    ...restoreLoggedEffect(effect),
    canActivate(ctx) {
      return ctx.duel.chain.length > 0;
    },
  };
}

function restoreLoggedEffect(effect: Omit<DuelEffectDefinition, "operation">): DuelEffectDefinition {
  return {
    ...effect,
    operation(ctx) {
      ctx.log(`${effect.id} resolved`);
    },
  };
}

function findEffectAction(session: ReturnType<typeof createDuel>, player: 0 | 1, effectId: string) {
  return getDuelLegalActions(session, player).find((action) => action.type === "activateEffect" && action.effectId === effectId);
}

function effectIds(session: ReturnType<typeof createDuel>, player: 0 | 1): string[] {
  return getDuelLegalActions(session, player)
    .filter((action) => action.type === "activateEffect")
    .map((action) => action.effectId);
}

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function hasGroupedTrigger(session: ReturnType<typeof createDuel>, player: 0 | 1, effectId: string, windowKind: "triggerBucket"): boolean {
  return getGroupedDuelLegalActions(session, player).some((group) =>
    group.windowKind === windowKind && group.actions.some((action) => action.type === "activateTrigger" && action.player === player && action.effectId === effectId && action.windowKind === windowKind),
  );
}

function hasGroupedEffect(session: ReturnType<typeof createDuel>, player: 0 | 1, effectId: string, windowKind: "triggerBucket" | "chainResponse" | "open"): boolean {
  return getGroupedDuelLegalActions(session, player).some((group) =>
    group.windowKind === windowKind && group.actions.some((action) => action.type === "activateEffect" && action.player === player && action.effectId === effectId && action.windowKind === windowKind),
  );
}
