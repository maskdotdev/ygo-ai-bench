import { describe, expect, it } from "vitest";
import { addDuelChainLimit, applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { ChainLimit, DuelEffectDefinition } from "#duel/types.js";
import { cards } from "./full-duel-engine-fixtures.js";

const TRIGGER_HANDOFF_TURN_ONLY_CHAIN_LIMIT_KEY = "restore-trigger-pass-handoff-turn-only-chain-limit";
const TRIGGER_HANDOFF_TURN_ONLY_UNTIL_CHAIN_END_LIMIT_KEY = "restore-trigger-pass-handoff-turn-only-until-chain-end-limit";

describe("trigger bucket open fast restore", () => {
  it("returns restored trigger chains to open-only fast-effect priority after chain resolution", () => {
    const session = createDuel({ seed: 233, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "500", "300"] },
    });
    startDuel(session);

    const summoned = findHandCard(session, 0, "100");
    const turnTrigger = findHandCard(session, 0, "300");
    const turnQuick = findHandCard(session, 0, "500");
    const opponentTrigger = findHandCard(session, 1, "400");
    expect(summoned).toBeDefined();
    expect(turnTrigger).toBeDefined();
    expect(turnQuick).toBeDefined();
    expect(opponentTrigger).toBeDefined();

    registerEffect(session, normalSummonTrigger("restore-open-fast-turn-trigger", turnTrigger!.uid, 0));
    registerEffect(session, normalSummonTrigger("restore-open-fast-opponent-trigger", opponentTrigger!.uid, 1));
    registerEffect(session, openOnlyQuick("restore-open-fast-turn-open-quick", turnQuick!.uid, 0));
    registerEffect(session, chainOnlyQuick("restore-open-fast-turn-chain-quick", turnQuick!.uid, 0));

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);

    const restoredTurnBucket = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredTurnBucket).pendingTriggerBuckets.map((bucket) => bucket.triggerBucket)).toEqual(["turnOptional", "opponentOptional"]);
    const turnDecline = getDuelLegalActions(restoredTurnBucket, 0).find((action) => action.type === "declineTrigger" && action.effectId === "restore-open-fast-turn-trigger");
    expect(turnDecline).toBeDefined();
    const afterTurnDecline = applyAndAssert(restoredTurnBucket, turnDecline!);
    expect(afterTurnDecline.state).toMatchObject({ waitingFor: 1, windowKind: "triggerBucket" });
    expect(afterTurnDecline.state.pendingTriggerBuckets.map((bucket) => bucket.triggerBucket)).toEqual(["opponentOptional"]);
    expect(afterTurnDecline.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["restore-open-fast-opponent-trigger"]);
    const staleTurnDecline = applyResponse(restoredTurnBucket, turnDecline!);
    expect(staleTurnDecline.ok).toBe(false);
    expect(staleTurnDecline.error).toContain("Response is not currently legal");
    expect(staleTurnDecline.legalActions).toEqual(getDuelLegalActions(restoredTurnBucket, 1));
    expect(staleTurnDecline.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredTurnBucket, 1));

    const restoredOpponentBucket = restoreDuel(serializeDuel(restoredTurnBucket), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpponentBucket)).toMatchObject({ waitingFor: 1, windowKind: "triggerBucket" });
    expect(queryPublicState(restoredOpponentBucket).pendingTriggerBuckets.map((bucket) => bucket.triggerBucket)).toEqual(["opponentOptional"]);
    expect(restoredOpponentBucket.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["restore-open-fast-opponent-trigger"]);
    expect(getDuelLegalActions(restoredOpponentBucket, 0)).toEqual([]);
    const opponentActivation = getDuelLegalActions(restoredOpponentBucket, 1).find((action) => action.type === "activateTrigger" && action.effectId === "restore-open-fast-opponent-trigger");
    expect(opponentActivation).toBeDefined();
    applyAndAssert(restoredOpponentBucket, opponentActivation!);

    const restoredChainWindow = restoreDuel(serializeDuel(restoredOpponentBucket), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredChainWindow)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(getDuelLegalActions(restoredChainWindow, 0).some((action) => action.type === "activateEffect" && action.effectId === "restore-open-fast-turn-chain-quick")).toBe(true);
    expect(getDuelLegalActions(restoredChainWindow, 0).some((action) => action.type === "activateEffect" && action.effectId === "restore-open-fast-turn-open-quick")).toBe(false);
    expect(hasGroupedEffect(restoredChainWindow, 0, "restore-open-fast-turn-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(restoredChainWindow, 0, "restore-open-fast-turn-open-quick", "chainResponse")).toBe(false);

    const pass = getDuelLegalActions(restoredChainWindow, 0).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyAndAssert(restoredChainWindow, pass!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredChainWindow.state.chainPasses).toEqual([]);
    expect(resolved.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-open-fast-turn-open-quick")).toBe(true);
    expect(resolved.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-open-fast-turn-chain-quick")).toBe(false);
    expect(hasGroupedEffect(restoredChainWindow, 0, "restore-open-fast-turn-open-quick", "open")).toBe(true);
    expect(hasGroupedEffect(restoredChainWindow, 0, "restore-open-fast-turn-chain-quick", "open")).toBe(false);
    expect(getDuelLegalActions(restoredChainWindow, 1)).toEqual([]);
    expect(restoredChainWindow.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining(["restore-open-fast-opponent-trigger resolved"]));

    const restoredOpenWindow = restoreDuel(serializeDuel(restoredChainWindow), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpenWindow)).toMatchObject({ waitingFor: 0, windowKind: "open", pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredOpenWindow.state.chainPasses).toEqual([]);
    expect(getDuelLegalActions(restoredOpenWindow, 0).filter((action) => action.type === "activateEffect").map((action) => action.effectId)).toEqual(["restore-open-fast-turn-open-quick"]);
    expect(getGroupedDuelLegalActions(restoredOpenWindow, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restoredOpenWindow, 0));
    expect(hasGroupedEffect(restoredOpenWindow, 0, "restore-open-fast-turn-open-quick", "open")).toBe(true);
    expect(hasGroupedEffect(restoredOpenWindow, 0, "restore-open-fast-turn-chain-quick", "open")).toBe(false);
    expect(getDuelLegalActions(restoredOpenWindow, 1)).toEqual([]);
    const stalePass = applyResponse(restoredChainWindow, pass!);
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    expect(stalePass.legalActions).toEqual(getDuelLegalActions(restoredChainWindow, 0));
    expect(stalePass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredChainWindow, 0));
  });

  it("alternates restored trigger-chain fast-effect priority after the first response chains", () => {
    const session = createDuel({ seed: 234, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "500", "300"] },
    });
    startDuel(session);

    const summoned = findHandCard(session, 0, "100");
    const turnTrigger = findHandCard(session, 0, "300");
    const turnQuick = findHandCard(session, 0, "500");
    const opponentTrigger = findHandCard(session, 1, "400");
    const opponentQuick = findHandCard(session, 1, "500");
    expect(summoned).toBeDefined();
    expect(turnTrigger).toBeDefined();
    expect(turnQuick).toBeDefined();
    expect(opponentTrigger).toBeDefined();
    expect(opponentQuick).toBeDefined();

    registerEffect(session, normalSummonTrigger("restore-fast-alt-turn-trigger", turnTrigger!.uid, 0));
    registerEffect(session, normalSummonTrigger("restore-fast-alt-opponent-trigger", opponentTrigger!.uid, 1));
    registerEffect(session, chainOnlyQuick("restore-fast-alt-turn-chain-quick", turnQuick!.uid, 0, true));
    registerEffect(session, openOnlyQuick("restore-fast-alt-turn-open-quick", turnQuick!.uid, 0));
    registerEffect(session, chainOnlyQuick("restore-fast-alt-opponent-chain-quick", opponentQuick!.uid, 1, true));
    registerEffect(session, openOnlyQuick("restore-fast-alt-opponent-open-quick", opponentQuick!.uid, 1));

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);

    const restoredTurnBucket = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    const turnDecline = getDuelLegalActions(restoredTurnBucket, 0).find((action) => action.type === "declineTrigger" && action.effectId === "restore-fast-alt-turn-trigger");
    expect(turnDecline).toBeDefined();
    applyAndAssert(restoredTurnBucket, turnDecline!);

    const restoredOpponentBucket = restoreDuel(serializeDuel(restoredTurnBucket), createCardReader(cards), restoreRegistry());
    const opponentActivation = getDuelLegalActions(restoredOpponentBucket, 1).find((action) => action.type === "activateTrigger" && action.effectId === "restore-fast-alt-opponent-trigger");
    expect(opponentActivation).toBeDefined();
    applyAndAssert(restoredOpponentBucket, opponentActivation!);

    const restoredTurnResponse = restoreDuel(serializeDuel(restoredOpponentBucket), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredTurnResponse)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    const turnChain = getDuelLegalActions(restoredTurnResponse, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-fast-alt-turn-chain-quick");
    expect(turnChain).toBeDefined();
    expect(hasGroupedEffect(restoredTurnResponse, 0, "restore-fast-alt-turn-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(restoredTurnResponse, 0, "restore-fast-alt-turn-open-quick", "chainResponse")).toBe(false);
    const staleBeforeTurnChain = applyResponse(restoredTurnResponse, { ...turnChain!, windowId: turnChain!.windowId! - 1 });
    expect(staleBeforeTurnChain.ok).toBe(false);
    expect(staleBeforeTurnChain.error).toContain("Response is not currently legal");
    expect(staleBeforeTurnChain.legalActions).toEqual(getDuelLegalActions(restoredTurnResponse, 0));
    expect(staleBeforeTurnChain.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredTurnResponse, 0));

    const turnChained = applyAndAssert(restoredTurnResponse, turnChain!);
    expect(turnChained.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(turnChained.state.chain.map((link) => link.effectId)).toEqual(["restore-fast-alt-opponent-trigger", "restore-fast-alt-turn-chain-quick"]);
    expect(turnChained.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-fast-alt-opponent-chain-quick")).toBe(true);
    expect(turnChained.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-fast-alt-opponent-open-quick")).toBe(false);

    const restoredOpponentResponse = restoreDuel(serializeDuel(restoredTurnResponse), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpponentResponse)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(getDuelLegalActions(restoredOpponentResponse, 0)).toEqual([]);
    expect(hasGroupedEffect(restoredOpponentResponse, 1, "restore-fast-alt-opponent-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(restoredOpponentResponse, 1, "restore-fast-alt-opponent-open-quick", "chainResponse")).toBe(false);
    const opponentPass = getDuelLegalActions(restoredOpponentResponse, 1).find((action) => action.type === "passChain");
    expect(opponentPass).toBeDefined();
    const resolved = applyAndAssert(restoredOpponentResponse, opponentPass!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredOpponentResponse.state.chainPasses).toEqual([]);
    expect(resolved.legalActions.filter((action) => action.type === "activateEffect").map((action) => action.effectId)).toEqual(["restore-fast-alt-turn-open-quick"]);
    expect(resolved.legalActionGroups.flatMap((group) => group.actions)).toEqual(resolved.legalActions);
    expect(hasGroupedEffect(restoredOpponentResponse, 0, "restore-fast-alt-turn-open-quick", "open")).toBe(true);
    expect(hasGroupedEffect(restoredOpponentResponse, 0, "restore-fast-alt-turn-chain-quick", "open")).toBe(false);
    expect(hasGroupedEffect(restoredOpponentResponse, 1, "restore-fast-alt-opponent-open-quick", "open")).toBe(false);
    expect(getDuelLegalActions(restoredOpponentResponse, 1)).toEqual([]);
    const staleTurnChain = applyResponse(restoredTurnResponse, turnChain!);
    expect(staleTurnChain.ok).toBe(false);
    expect(staleTurnChain.error).toContain("Response is not currently legal");
    expect(staleTurnChain.legalActions).toEqual(getDuelLegalActions(restoredTurnResponse, 1));
    expect(staleTurnChain.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredTurnResponse, 1));
  });

  it("opens restored fast-effect priority after cross-player optional trigger activations complete", () => {
    const session = createDuel({ seed: 236, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "500", "300"] },
    });
    startDuel(session);

    const summoned = findHandCard(session, 0, "100");
    const turnTrigger = findHandCard(session, 0, "300");
    const turnQuick = findHandCard(session, 0, "500");
    const opponentTrigger = findHandCard(session, 1, "400");
    expect(summoned).toBeDefined();
    expect(turnTrigger).toBeDefined();
    expect(turnQuick).toBeDefined();
    expect(opponentTrigger).toBeDefined();

    registerEffect(session, normalSummonTrigger("restore-cross-optional-turn-trigger", turnTrigger!.uid, 0));
    registerEffect(session, normalSummonTrigger("restore-cross-optional-opponent-trigger", opponentTrigger!.uid, 1));
    registerEffect(session, chainOnlyQuick("restore-cross-optional-turn-chain-quick", turnQuick!.uid, 0));
    registerEffect(session, openOnlyQuick("restore-cross-optional-turn-open-quick", turnQuick!.uid, 0));

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);

    const restoredTurnBucket = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredTurnBucket).pendingTriggerBuckets.map((bucket) => bucket.triggerBucket)).toEqual(["turnOptional", "opponentOptional"]);
    const turnActivation = getDuelLegalActions(restoredTurnBucket, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-cross-optional-turn-trigger");
    expect(turnActivation).toBeDefined();
    const turnActivated = applyAndAssert(restoredTurnBucket, turnActivation!);
    expect(turnActivated.state).toMatchObject({ waitingFor: 1, windowKind: "triggerBucket" });
    expect(turnActivated.state.chain.map((link) => link.effectId)).toEqual(["restore-cross-optional-turn-trigger"]);
    expect(turnActivated.state.pendingTriggerBuckets.map((bucket) => bucket.triggerBucket)).toEqual(["opponentOptional"]);
    expect(getDuelLegalActions(restoredTurnBucket, 0)).toEqual([]);

    const restoredOpponentBucket = restoreDuel(serializeDuel(restoredTurnBucket), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpponentBucket)).toMatchObject({ waitingFor: 1, windowKind: "triggerBucket" });
    const opponentActivation = getDuelLegalActions(restoredOpponentBucket, 1).find((action) => action.type === "activateTrigger" && action.effectId === "restore-cross-optional-opponent-trigger");
    expect(opponentActivation).toBeDefined();
    const opponentActivated = applyAndAssert(restoredOpponentBucket, opponentActivation!);
    expect(opponentActivated.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse", pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(opponentActivated.state.chain.map((link) => link.effectId)).toEqual(["restore-cross-optional-turn-trigger", "restore-cross-optional-opponent-trigger"]);
    expect(getDuelLegalActions(restoredOpponentBucket, 1)).toEqual([]);
    expect(hasGroupedEffect(restoredOpponentBucket, 0, "restore-cross-optional-turn-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(restoredOpponentBucket, 0, "restore-cross-optional-turn-open-quick", "chainResponse")).toBe(false);

    const restoredChainWindow = restoreDuel(serializeDuel(restoredOpponentBucket), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredChainWindow)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse", pendingTriggers: [], pendingTriggerBuckets: [] });
    const pass = getDuelLegalActions(restoredChainWindow, 0).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyAndAssert(restoredChainWindow, pass!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredChainWindow.state.chainPasses).toEqual([]);
    expect(resolved.legalActions.filter((action) => action.type === "activateEffect").map((action) => action.effectId)).toEqual(["restore-cross-optional-turn-open-quick"]);
    expect(hasGroupedEffect(restoredChainWindow, 0, "restore-cross-optional-turn-open-quick", "open")).toBe(true);
    expect(hasGroupedEffect(restoredChainWindow, 0, "restore-cross-optional-turn-chain-quick", "open")).toBe(false);
    expect(restoredChainWindow.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining([
      "restore-cross-optional-turn-trigger resolved",
      "restore-cross-optional-opponent-trigger resolved",
    ]));
    const stalePass = applyResponse(restoredChainWindow, pass!);
    expect(stalePass.ok).toBe(false);
    expect(stalePass.error).toContain("Response is not currently legal");
    expect(stalePass.legalActions).toEqual(getDuelLegalActions(restoredChainWindow, 0));
    expect(stalePass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredChainWindow, 0));
  });

  it("resolves restored trigger-chain fast-effect alternation after the opponent chains", () => {
    const session = createDuel({ seed: 235, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "500", "300"] },
    });
    startDuel(session);

    const summoned = findHandCard(session, 0, "100");
    const turnTrigger = findHandCard(session, 0, "300");
    const turnQuick = findHandCard(session, 0, "500");
    const opponentTrigger = findHandCard(session, 1, "400");
    const opponentQuick = findHandCard(session, 1, "500");
    expect(summoned).toBeDefined();
    expect(turnTrigger).toBeDefined();
    expect(turnQuick).toBeDefined();
    expect(opponentTrigger).toBeDefined();
    expect(opponentQuick).toBeDefined();

    registerEffect(session, normalSummonTrigger("restore-fast-resolve-turn-trigger", turnTrigger!.uid, 0));
    registerEffect(session, normalSummonTrigger("restore-fast-resolve-opponent-trigger", opponentTrigger!.uid, 1));
    registerEffect(session, chainOnlyQuick("restore-fast-resolve-turn-chain-quick", turnQuick!.uid, 0, true));
    registerEffect(session, openOnlyQuick("restore-fast-resolve-turn-open-quick", turnQuick!.uid, 0));
    registerEffect(session, chainOnlyQuick("restore-fast-resolve-opponent-chain-quick", opponentQuick!.uid, 1, true));
    registerEffect(session, openOnlyQuick("restore-fast-resolve-opponent-open-quick", opponentQuick!.uid, 1));

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);

    const restoredTurnBucket = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    const turnDecline = getDuelLegalActions(restoredTurnBucket, 0).find((action) => action.type === "declineTrigger" && action.effectId === "restore-fast-resolve-turn-trigger");
    expect(turnDecline).toBeDefined();
    applyAndAssert(restoredTurnBucket, turnDecline!);

    const restoredOpponentBucket = restoreDuel(serializeDuel(restoredTurnBucket), createCardReader(cards), restoreRegistry());
    const opponentTriggerAction = getDuelLegalActions(restoredOpponentBucket, 1).find((action) => action.type === "activateTrigger" && action.effectId === "restore-fast-resolve-opponent-trigger");
    expect(opponentTriggerAction).toBeDefined();
    applyAndAssert(restoredOpponentBucket, opponentTriggerAction!);

    const restoredTurnResponse = restoreDuel(serializeDuel(restoredOpponentBucket), createCardReader(cards), restoreRegistry());
    const turnChain = getDuelLegalActions(restoredTurnResponse, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-fast-resolve-turn-chain-quick");
    expect(turnChain).toBeDefined();
    applyAndAssert(restoredTurnResponse, turnChain!);

    const restoredOpponentResponse = restoreDuel(serializeDuel(restoredTurnResponse), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpponentResponse)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    const opponentChain = getDuelLegalActions(restoredOpponentResponse, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-fast-resolve-opponent-chain-quick");
    expect(opponentChain).toBeDefined();
    expect(hasGroupedEffect(restoredOpponentResponse, 1, "restore-fast-resolve-opponent-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(restoredOpponentResponse, 1, "restore-fast-resolve-opponent-open-quick", "chainResponse")).toBe(false);
    const staleBeforeOpponentChain = applyResponse(restoredOpponentResponse, { ...opponentChain!, windowId: opponentChain!.windowId! - 1 });
    expect(staleBeforeOpponentChain.ok).toBe(false);
    expect(staleBeforeOpponentChain.error).toContain("Response is not currently legal");
    expect(staleBeforeOpponentChain.legalActions).toEqual(getDuelLegalActions(restoredOpponentResponse, 1));
    expect(staleBeforeOpponentChain.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredOpponentResponse, 1));

    const resolved = applyAndAssert(restoredOpponentResponse, opponentChain!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredOpponentResponse.state.chainPasses).toEqual([]);
    expect(resolved.legalActions.filter((action) => action.type === "activateEffect").map((action) => action.effectId)).toEqual(["restore-fast-resolve-turn-open-quick"]);
    expect(getDuelLegalActions(restoredOpponentResponse, 1)).toEqual([]);
    expect(restoredOpponentResponse.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining([
      "restore-fast-resolve-opponent-chain-quick resolved",
      "restore-fast-resolve-turn-chain-quick resolved",
      "restore-fast-resolve-opponent-trigger resolved",
    ]));

    const restoredOpenWindow = restoreDuel(serializeDuel(restoredOpponentResponse), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpenWindow)).toMatchObject({ waitingFor: 0, windowKind: "open", pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredOpenWindow.state.chainPasses).toEqual([]);
    expect(getDuelLegalActions(restoredOpenWindow, 0).filter((action) => action.type === "activateEffect").map((action) => action.effectId)).toEqual(["restore-fast-resolve-turn-open-quick"]);
    expect(getGroupedDuelLegalActions(restoredOpenWindow, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restoredOpenWindow, 0));
    expect(hasGroupedEffect(restoredOpenWindow, 0, "restore-fast-resolve-turn-open-quick", "open")).toBe(true);
    expect(hasGroupedEffect(restoredOpenWindow, 0, "restore-fast-resolve-turn-chain-quick", "open")).toBe(false);
    expect(hasGroupedEffect(restoredOpenWindow, 1, "restore-fast-resolve-opponent-open-quick", "open")).toBe(false);
    expect(getDuelLegalActions(restoredOpenWindow, 1)).toEqual([]);
    const staleOpponentChain = applyResponse(restoredOpponentResponse, opponentChain!);
    expect(staleOpponentChain.ok).toBe(false);
    expect(staleOpponentChain.error).toContain("Response is not currently legal");
    expect(staleOpponentChain.legalActions).toEqual(getDuelLegalActions(restoredOpponentResponse, 0));
    expect(staleOpponentChain.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredOpponentResponse, 0));
  });

  it("restores trigger-chain response priority after the opponent passes", () => {
    const session = createDuel({ seed: 237, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500", "700", "600"] },
      1: { main: ["500", "700", "600", "400", "400"] },
    });
    startDuel(session);

    const summoned = findHandCard(session, 0, "100");
    const turnTrigger = findHandCard(session, 0, "300");
    const turnQuick = findHandCard(session, 0, "500");
    const secondTurnQuick = findHandCard(session, 0, "700");
    const thirdTurnQuick = findHandCard(session, 0, "600");
    const opponentQuick = findHandCard(session, 1, "500");
    const secondOpponentQuick = findHandCard(session, 1, "700");
    const thirdOpponentQuick = findHandCard(session, 1, "600");
    expect(summoned).toBeDefined();
    expect(turnTrigger).toBeDefined();
    expect(turnQuick).toBeDefined();
    expect(secondTurnQuick).toBeDefined();
    expect(thirdTurnQuick).toBeDefined();
    expect(opponentQuick).toBeDefined();
    expect(secondOpponentQuick).toBeDefined();
    expect(thirdOpponentQuick).toBeDefined();

    registerEffect(session, normalSummonTrigger("restore-trigger-pass-handoff-success", turnTrigger!.uid, 0, false));
    registerEffect(session, chainOnlyQuick("restore-trigger-pass-handoff-turn-chain", turnQuick!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-trigger-pass-handoff-second-turn-chain", secondTurnQuick!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-trigger-pass-handoff-third-turn-chain", thirdTurnQuick!.uid, 0, true));
    registerEffect(session, openOnlyQuick("restore-trigger-pass-handoff-turn-open", turnQuick!.uid, 0));
    registerEffect(session, chainOnlyQuick("restore-trigger-pass-handoff-opponent-chain", opponentQuick!.uid, 1, true));
    registerEffect(session, chainOnlyQuick("restore-trigger-pass-handoff-second-opponent-chain", secondOpponentQuick!.uid, 1, true));
    registerEffect(session, chainOnlyQuick("restore-trigger-pass-handoff-third-opponent-chain", thirdOpponentQuick!.uid, 1, true));

    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);

    const restoredBucket = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredBucket)).toMatchObject({ waitingFor: 0, windowKind: "triggerBucket" });
    expect(queryPublicState(restoredBucket).pendingTriggerBuckets.map((bucket) => bucket.triggerBucket)).toEqual(["turnMandatory"]);
    const triggerAction = getDuelLegalActions(restoredBucket, 0).find((action) => action.type === "activateTrigger" && action.effectId === "restore-trigger-pass-handoff-success");
    expect(triggerAction).toBeDefined();
    const opponentWindow = applyAndAssert(restoredBucket, triggerAction!);
    expect(opponentWindow.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(opponentWindow.state.chain.map((link) => link.effectId)).toEqual(["restore-trigger-pass-handoff-success"]);

    const restoredOpponentWindow = restoreDuel(serializeDuel(restoredBucket), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpponentWindow)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    const opponentChain = getDuelLegalActions(restoredOpponentWindow, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-trigger-pass-handoff-opponent-chain");
    const opponentPass = getDuelLegalActions(restoredOpponentWindow, 1).find((action) => action.type === "passChain");
    expect(opponentChain).toBeDefined();
    expect(opponentPass).toBeDefined();
    expect(getDuelLegalActions(restoredOpponentWindow, 0)).toEqual([]);
    expect(hasGroupedEffect(restoredOpponentWindow, 1, "restore-trigger-pass-handoff-opponent-chain", "chainResponse")).toBe(true);

    const handoff = applyAndAssert(restoredOpponentWindow, opponentPass!);
    expect(handoff.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(handoff.state.chain.map((link) => link.effectId)).toEqual(["restore-trigger-pass-handoff-success"]);
    expect(restoredOpponentWindow.state.chainPasses).toEqual([1]);
    expect(getDuelLegalActions(restoredOpponentWindow, 1)).toEqual([]);
    expect(hasGroupedEffect(restoredOpponentWindow, 0, "restore-trigger-pass-handoff-turn-chain", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(restoredOpponentWindow, 0, "restore-trigger-pass-handoff-turn-open", "chainResponse")).toBe(false);

    const restoredHandoff = restoreDuel(serializeDuel(restoredOpponentWindow), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredHandoff)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(restoredHandoff.state.chainPasses).toEqual([1]);
    expect(getDuelLegalActions(restoredHandoff, 1)).toEqual([]);
    expect(getDuelLegalActions(restoredHandoff, 0)).toEqual(getDuelLegalActions(restoredOpponentWindow, 0));
    expect(getGroupedDuelLegalActions(restoredHandoff, 0)).toEqual(getGroupedDuelLegalActions(restoredOpponentWindow, 0));

    const staleOpponentChain = applyResponse(restoredHandoff, opponentChain!);
    expect(staleOpponentChain.ok).toBe(false);
    expect(staleOpponentChain.error).toContain("Response is not currently legal");
    expect(staleOpponentChain.legalActions).toEqual(getDuelLegalActions(restoredHandoff, 0));
    expect(staleOpponentChain.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredHandoff, 0));

    const turnChain = getDuelLegalActions(restoredHandoff, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-trigger-pass-handoff-turn-chain");
    expect(turnChain).toBeDefined();
    const opponentReturn = applyAndAssert(restoredHandoff, turnChain!);
    expect(opponentReturn.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(opponentReturn.state.chain.map((link) => link.effectId)).toEqual(["restore-trigger-pass-handoff-success", "restore-trigger-pass-handoff-turn-chain"]);
    expect(restoredHandoff.state.chainPasses).toEqual([]);

    const restoredOpponentReturn = restoreDuel(serializeDuel(restoredHandoff), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpponentReturn)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(hasGroupedEffect(restoredOpponentReturn, 1, "restore-trigger-pass-handoff-opponent-chain", "chainResponse")).toBe(true);

    const opponentBranch = restoreDuel(serializeDuel(restoredOpponentReturn), createCardReader(cards), restoreRegistry());
    const opponentResponse = getDuelLegalActions(opponentBranch, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-trigger-pass-handoff-opponent-chain");
    expect(opponentResponse).toBeDefined();
    const turnReturn = applyAndAssert(opponentBranch, opponentResponse!);
    expect(turnReturn.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(turnReturn.state.chain.map((link) => link.effectId)).toEqual([
      "restore-trigger-pass-handoff-success",
      "restore-trigger-pass-handoff-turn-chain",
      "restore-trigger-pass-handoff-opponent-chain",
    ]);
    expect(getDuelLegalActions(opponentBranch, 1)).toEqual([]);
    expect(hasGroupedEffect(opponentBranch, 0, "restore-trigger-pass-handoff-second-turn-chain", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(opponentBranch, 0, "restore-trigger-pass-handoff-turn-open", "chainResponse")).toBe(false);

    const restoredTurnReturn = restoreDuel(serializeDuel(opponentBranch), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredTurnReturn)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(getDuelLegalActions(restoredTurnReturn, 1)).toEqual([]);
    expect(getDuelLegalActions(restoredTurnReturn, 0)).toEqual(getDuelLegalActions(opponentBranch, 0));
    expect(getGroupedDuelLegalActions(restoredTurnReturn, 0)).toEqual(getGroupedDuelLegalActions(opponentBranch, 0));
    const secondTurnChain = getDuelLegalActions(restoredTurnReturn, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-trigger-pass-handoff-second-turn-chain");
    expect(secondTurnChain).toBeDefined();
    const finalOpponentWindow = applyAndAssert(restoredTurnReturn, secondTurnChain!);
    expect(finalOpponentWindow.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(finalOpponentWindow.state.chain.map((link) => link.effectId)).toEqual([
      "restore-trigger-pass-handoff-success",
      "restore-trigger-pass-handoff-turn-chain",
      "restore-trigger-pass-handoff-opponent-chain",
      "restore-trigger-pass-handoff-second-turn-chain",
    ]);
    expect(finalOpponentWindow.legalActionGroups.some((group) =>
      group.windowKind === "chainResponse" && group.actions.some((action) =>
        action.type === "activateEffect" &&
        action.player === 1 &&
        action.effectId === "restore-trigger-pass-handoff-second-opponent-chain" &&
        action.windowKind === "chainResponse",
      ),
    )).toBe(true);
    expect(restoredTurnReturn.state.log.map((entry) => entry.detail)).not.toContain("restore-trigger-pass-handoff-success resolved");

    const restoredSecondOpponentWindow = restoreDuel(serializeDuel(restoredTurnReturn), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredSecondOpponentWindow)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(getDuelLegalActions(restoredSecondOpponentWindow, 1)).toEqual(finalOpponentWindow.legalActions);
    expect(getGroupedDuelLegalActions(restoredSecondOpponentWindow, 1)).toEqual(finalOpponentWindow.legalActionGroups);
    const secondOpponentResponse = getDuelLegalActions(restoredSecondOpponentWindow, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-trigger-pass-handoff-second-opponent-chain");
    expect(secondOpponentResponse).toBeDefined();
    const thirdTurnReturn = applyAndAssert(restoredSecondOpponentWindow, secondOpponentResponse!);
    expect(thirdTurnReturn.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(thirdTurnReturn.state.chain.map((link) => link.effectId)).toEqual([
      "restore-trigger-pass-handoff-success",
      "restore-trigger-pass-handoff-turn-chain",
      "restore-trigger-pass-handoff-opponent-chain",
      "restore-trigger-pass-handoff-second-turn-chain",
      "restore-trigger-pass-handoff-second-opponent-chain",
    ]);
    expect(getDuelLegalActions(restoredSecondOpponentWindow, 1)).toEqual([]);
    expect(hasGroupedEffect(restoredSecondOpponentWindow, 0, "restore-trigger-pass-handoff-third-turn-chain", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(restoredSecondOpponentWindow, 0, "restore-trigger-pass-handoff-turn-chain", "chainResponse")).toBe(false);
    expect(hasGroupedEffect(restoredSecondOpponentWindow, 0, "restore-trigger-pass-handoff-second-turn-chain", "chainResponse")).toBe(false);
    expect(hasGroupedEffect(restoredSecondOpponentWindow, 0, "restore-trigger-pass-handoff-turn-open", "chainResponse")).toBe(false);

    const restoredThirdTurnReturn = restoreDuel(serializeDuel(restoredSecondOpponentWindow), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredThirdTurnReturn)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(getDuelLegalActions(restoredThirdTurnReturn, 1)).toEqual([]);
    expect(getDuelLegalActions(restoredThirdTurnReturn, 0)).toEqual(getDuelLegalActions(restoredSecondOpponentWindow, 0));
    expect(getGroupedDuelLegalActions(restoredThirdTurnReturn, 0)).toEqual(getGroupedDuelLegalActions(restoredSecondOpponentWindow, 0));
    const thirdTurnChain = getDuelLegalActions(restoredThirdTurnReturn, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-trigger-pass-handoff-third-turn-chain");
    expect(thirdTurnChain).toBeDefined();
    const thirdOpponentWindow = applyAndAssert(restoredThirdTurnReturn, thirdTurnChain!);
    expect(thirdOpponentWindow.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(thirdOpponentWindow.state.chain.map((link) => link.effectId)).toEqual([
      "restore-trigger-pass-handoff-success",
      "restore-trigger-pass-handoff-turn-chain",
      "restore-trigger-pass-handoff-opponent-chain",
      "restore-trigger-pass-handoff-second-turn-chain",
      "restore-trigger-pass-handoff-second-opponent-chain",
      "restore-trigger-pass-handoff-third-turn-chain",
    ]);
    expect(thirdOpponentWindow.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-trigger-pass-handoff-third-opponent-chain")).toBe(true);
    expect(restoredThirdTurnReturn.state.log.map((entry) => entry.detail)).not.toContain("restore-trigger-pass-handoff-success resolved");

    const finalOpponentPass = getDuelLegalActions(restoredOpponentReturn, 1).find((action) => action.type === "passChain");
    expect(finalOpponentPass).toBeDefined();
    const finalTurnHandoff = applyAndAssert(restoredOpponentReturn, finalOpponentPass!);
    expect(finalTurnHandoff.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse", pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(finalTurnHandoff.state.chain.map((link) => link.effectId)).toEqual(["restore-trigger-pass-handoff-success", "restore-trigger-pass-handoff-turn-chain"]);
    expect(restoredOpponentReturn.state.chainPasses).toEqual([1]);
    expect(hasGroupedEffect(restoredOpponentReturn, 0, "restore-trigger-pass-handoff-second-turn-chain", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(restoredOpponentReturn, 0, "restore-trigger-pass-handoff-turn-open", "chainResponse")).toBe(false);

    const restoredFinalTurnHandoff = restoreDuel(serializeDuel(restoredOpponentReturn), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredFinalTurnHandoff)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(restoredFinalTurnHandoff.state.chainPasses).toEqual([1]);
    expect(getDuelLegalActions(restoredFinalTurnHandoff, 0)).toEqual(getDuelLegalActions(restoredOpponentReturn, 0));
    expect(getGroupedDuelLegalActions(restoredFinalTurnHandoff, 0)).toEqual(getGroupedDuelLegalActions(restoredOpponentReturn, 0));

    const finalTurnPass = getDuelLegalActions(restoredFinalTurnHandoff, 0).find((action) => action.type === "passChain");
    expect(finalTurnPass).toBeDefined();
    const resolved = applyAndAssert(restoredFinalTurnHandoff, finalTurnPass!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredFinalTurnHandoff.state.chainPasses).toEqual([]);
    expect(restoredFinalTurnHandoff.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining([
      "restore-trigger-pass-handoff-turn-chain resolved",
      "restore-trigger-pass-handoff-success resolved",
    ]));
    expect(restoredFinalTurnHandoff.state.log.map((entry) => entry.detail)).not.toContain("restore-trigger-pass-handoff-opponent-chain resolved");
    expect(restoredFinalTurnHandoff.state.log.map((entry) => entry.detail)).not.toContain("restore-trigger-pass-handoff-second-turn-chain resolved");
    expect(getDuelLegalActions(restoredFinalTurnHandoff, 0).filter((action) => action.type === "activateEffect").map((action) => action.effectId)).toEqual(["restore-trigger-pass-handoff-turn-open"]);
  });

  it("restores trigger-chain turn-player limits after an opponent handoff response", () => {
    for (const testCase of [
      {
        prefix: "restore-trigger-pass-limit",
        seed: 238,
        untilChainEnd: false,
        limitKey: TRIGGER_HANDOFF_TURN_ONLY_CHAIN_LIMIT_KEY,
        expectedLimit: { registryKey: TRIGGER_HANDOFF_TURN_ONLY_CHAIN_LIMIT_KEY, untilChainEnd: false, expiresAtChainLength: 4 },
      },
      {
        prefix: "restore-trigger-pass-until",
        seed: 239,
        untilChainEnd: true,
        limitKey: TRIGGER_HANDOFF_TURN_ONLY_UNTIL_CHAIN_END_LIMIT_KEY,
        expectedLimit: { registryKey: TRIGGER_HANDOFF_TURN_ONLY_UNTIL_CHAIN_END_LIMIT_KEY, untilChainEnd: true },
      },
    ]) {
      const id = (suffix: string) => `${testCase.prefix}-${suffix}`;
      const session = createDuel({ seed: testCase.seed, startingHandSize: 5, cardReader: createCardReader(cards) });
      loadDecks(session, {
        0: { main: ["100", "300", "500", "700", "600"] },
        1: { main: ["500", "700", "600", "400", "400"] },
      });
      startDuel(session);

      const summoned = findHandCard(session, 0, "100");
      const turnTrigger = findHandCard(session, 0, "300");
      const firstTurnQuick = findHandCard(session, 0, "500");
      const limiter = findHandCard(session, 0, "700");
      const followup = findHandCard(session, 0, "600");
      const firstOpponentQuick = findHandCard(session, 1, "500");
      const blockedOpponentQuick = findHandCard(session, 1, "700");
      const opponentOpenQuick = findHandCard(session, 1, "600");
      expect(summoned).toBeDefined();
      expect(turnTrigger).toBeDefined();
      expect(firstTurnQuick).toBeDefined();
      expect(limiter).toBeDefined();
      expect(followup).toBeDefined();
      expect(firstOpponentQuick).toBeDefined();
      expect(blockedOpponentQuick).toBeDefined();
      expect(opponentOpenQuick).toBeDefined();

      registerEffect(session, normalSummonTrigger(id("success"), turnTrigger!.uid, 0, false));
      registerEffect(session, chainOnlyQuick(id("first-turn-chain"), firstTurnQuick!.uid, 0, true));
      registerEffect(session, chainOnlyQuickWithTurnLimit(id("limiter"), limiter!.uid, 0, testCase.untilChainEnd, true));
      registerEffect(session, chainOnlyQuick(id("followup"), followup!.uid, 0));
      registerEffect(session, chainOnlyQuick(id("opponent-chain"), firstOpponentQuick!.uid, 1, true));
      registerEffect(session, chainOnlyQuick(id("opponent-blocked"), blockedOpponentQuick!.uid, 1));
      registerEffect(session, openOnlyQuick(id("opponent-open"), opponentOpenQuick!.uid, 1));

      const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summoned!.uid);
      expect(summon).toBeDefined();
      applyAndAssert(session, summon!);

      const restoredBucket = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
      const triggerAction = getDuelLegalActions(restoredBucket, 0).find((action) => action.type === "activateTrigger" && action.effectId === id("success"));
      expect(triggerAction).toBeDefined();
      applyAndAssert(restoredBucket, triggerAction!);

      const opponentPass = getDuelLegalActions(restoredBucket, 1).find((action) => action.type === "passChain");
      expect(opponentPass).toBeDefined();
      applyAndAssert(restoredBucket, opponentPass!);

      const firstTurnChain = getDuelLegalActions(restoredBucket, 0).find((action) => action.type === "activateEffect" && action.effectId === id("first-turn-chain"));
      expect(firstTurnChain).toBeDefined();
      applyAndAssert(restoredBucket, firstTurnChain!);

      const opponentChain = getDuelLegalActions(restoredBucket, 1).find((action) => action.type === "activateEffect" && action.effectId === id("opponent-chain"));
      expect(opponentChain).toBeDefined();
      applyAndAssert(restoredBucket, opponentChain!);

      const restoredTurnWindow = restoreDuel(serializeDuel(restoredBucket), createCardReader(cards), restoreRegistry());
      expect(queryPublicState(restoredTurnWindow)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
      expect(restoredTurnWindow.state.chainLimits).toEqual([]);
      expect(hasGroupedEffect(restoredTurnWindow, 0, id("limiter"), "chainResponse")).toBe(true);
      expect(hasGroupedEffect(restoredTurnWindow, 0, id("followup"), "chainResponse")).toBe(true);
      expect(hasGroupedEffect(restoredTurnWindow, 1, id("opponent-blocked"), "chainResponse")).toBe(false);
      expect(hasGroupedEffect(restoredTurnWindow, 1, id("opponent-open"), "chainResponse")).toBe(false);

      const limitAction = getDuelLegalActions(restoredTurnWindow, 0).find((action) => action.type === "activateEffect" && action.effectId === id("limiter"));
      expect(limitAction).toBeDefined();
      const limitedWindow = applyAndAssert(restoredTurnWindow, limitAction!);
      expect(limitedWindow.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
      expect(limitedWindow.state.chain.map((link) => link.effectId)).toEqual([
        id("success"),
        id("first-turn-chain"),
        id("opponent-chain"),
        id("limiter"),
      ]);
      expect(restoredTurnWindow.state.chainLimits).toHaveLength(1);
      expect(restoredTurnWindow.state.chainLimits[0]).toMatchObject(testCase.expectedLimit);
      expect(serializeDuel(restoredTurnWindow).state.chainLimits).toEqual([testCase.expectedLimit]);
      expect(limitedWindow.legalActions.filter((action) => action.type === "activateEffect").map((action) => action.effectId)).toEqual([id("followup")]);
      expect(getDuelLegalActions(restoredTurnWindow, 1)).toEqual([]);

      const restoredLimitedWindow = restoreDuel(serializeDuel(restoredTurnWindow), createCardReader(cards), restoreRegistry(), restoreChainLimitRegistry());
      expect(queryPublicState(restoredLimitedWindow)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
      expect(restoredLimitedWindow.state.chainLimits).toHaveLength(1);
      expect(restoredLimitedWindow.state.chainLimits[0]).toMatchObject(testCase.expectedLimit);
      expect(getDuelLegalActions(restoredLimitedWindow, 0)).toEqual(getDuelLegalActions(restoredTurnWindow, 0));
      expect(getGroupedDuelLegalActions(restoredLimitedWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredTurnWindow, 0));
      expect(getDuelLegalActions(restoredLimitedWindow, 1)).toEqual([]);

      const limitedPass = getDuelLegalActions(restoredLimitedWindow, 0).find((action) => action.type === "passChain");
      expect(limitedPass).toBeDefined();
      const resolved = applyAndAssert(restoredLimitedWindow, limitedPass!);
      expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
      expect(restoredLimitedWindow.state.chainLimits).toEqual([]);
      expect(restoredLimitedWindow.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining([
        `${id("limiter")} resolved`,
        `${id("opponent-chain")} resolved`,
        `${id("first-turn-chain")} resolved`,
        `${id("success")} resolved`,
      ]));
      expect(restoredLimitedWindow.state.log.map((entry) => entry.detail)).not.toContain(`${id("followup")} resolved`);
      expect(restoredLimitedWindow.state.log.map((entry) => entry.detail)).not.toContain(`${id("opponent-blocked")} resolved`);
    }
  });
});

function normalSummonTrigger(id: string, sourceUid: string, controller: 0 | 1, optional = true): DuelEffectDefinition {
  return {
    id,
    registryKey: id,
    sourceUid,
    controller,
    event: "trigger",
    triggerEvent: "normalSummoned",
    ...(optional ? {} : { optional: false }),
    range: ["hand"],
    operation(ctx) {
      ctx.log(`${id} resolved`);
    },
  };
}

function openOnlyQuick(id: string, sourceUid: string, controller: 0 | 1): DuelEffectDefinition {
  return quickEffect(id, sourceUid, controller, 0);
}

function chainOnlyQuick(id: string, sourceUid: string, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
  return quickEffect(id, sourceUid, controller, 1, oncePerTurn);
}

function chainOnlyQuickWithTurnLimit(id: string, sourceUid: string, controller: 0 | 1, untilChainEnd: boolean, oncePerTurn = false): DuelEffectDefinition {
  return {
    ...chainOnlyQuick(id, sourceUid, controller, oncePerTurn),
    target(ctx) {
      if (!ctx.checkOnly) addDuelChainLimit(ctx.duel, triggerHandoffTurnOnlyChainLimit(untilChainEnd));
      return true;
    },
  };
}

function quickEffect(id: string, sourceUid: string, controller: 0 | 1, minimumChainLength: number, oncePerTurn = false): DuelEffectDefinition {
  return {
    id,
    registryKey: id,
    sourceUid,
    controller,
    event: "quick",
    ...(oncePerTurn ? { oncePerTurn: true } : {}),
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
    "restore-open-fast-turn-trigger": restoreLoggedEffect,
    "restore-open-fast-opponent-trigger": restoreLoggedEffect,
    "restore-open-fast-turn-open-quick": (effect) => ({ ...restoreLoggedEffect(effect), canActivate: (ctx) => ctx.duel.chain.length === 0 }),
    "restore-open-fast-turn-chain-quick": (effect) => ({ ...restoreLoggedEffect(effect), canActivate: (ctx) => ctx.duel.chain.length > 0 }),
    "restore-fast-alt-turn-trigger": restoreLoggedEffect,
    "restore-fast-alt-opponent-trigger": restoreLoggedEffect,
    "restore-fast-alt-turn-chain-quick": (effect) => ({ ...restoreLoggedEffect(effect), oncePerTurn: true, canActivate: (ctx) => ctx.duel.chain.length > 0 }),
    "restore-fast-alt-turn-open-quick": (effect) => ({ ...restoreLoggedEffect(effect), canActivate: (ctx) => ctx.duel.chain.length === 0 }),
    "restore-fast-alt-opponent-chain-quick": (effect) => ({ ...restoreLoggedEffect(effect), oncePerTurn: true, canActivate: (ctx) => ctx.duel.chain.length > 0 }),
    "restore-fast-alt-opponent-open-quick": (effect) => ({ ...restoreLoggedEffect(effect), canActivate: (ctx) => ctx.duel.chain.length === 0 }),
    "restore-cross-optional-turn-trigger": restoreLoggedEffect,
    "restore-cross-optional-opponent-trigger": restoreLoggedEffect,
    "restore-cross-optional-turn-chain-quick": (effect) => ({ ...restoreLoggedEffect(effect), canActivate: (ctx) => ctx.duel.chain.length > 0 }),
    "restore-cross-optional-turn-open-quick": (effect) => ({ ...restoreLoggedEffect(effect), canActivate: (ctx) => ctx.duel.chain.length === 0 }),
    "restore-fast-resolve-turn-trigger": restoreLoggedEffect,
    "restore-fast-resolve-opponent-trigger": restoreLoggedEffect,
    "restore-fast-resolve-turn-chain-quick": (effect) => ({ ...restoreLoggedEffect(effect), oncePerTurn: true, canActivate: (ctx) => ctx.duel.chain.length > 0 }),
    "restore-fast-resolve-turn-open-quick": (effect) => ({ ...restoreLoggedEffect(effect), canActivate: (ctx) => ctx.duel.chain.length === 0 }),
    "restore-fast-resolve-opponent-chain-quick": (effect) => ({ ...restoreLoggedEffect(effect), oncePerTurn: true, canActivate: (ctx) => ctx.duel.chain.length > 0 }),
    "restore-fast-resolve-opponent-open-quick": (effect) => ({ ...restoreLoggedEffect(effect), canActivate: (ctx) => ctx.duel.chain.length === 0 }),
    "restore-trigger-pass-handoff-success": restoreLoggedEffect,
    "restore-trigger-pass-handoff-turn-chain": (effect) => ({ ...restoreLoggedEffect(effect), oncePerTurn: true, canActivate: (ctx) => ctx.duel.chain.length > 0 }),
    "restore-trigger-pass-handoff-second-turn-chain": (effect) => ({ ...restoreLoggedEffect(effect), oncePerTurn: true, canActivate: (ctx) => ctx.duel.chain.length > 0 }),
    "restore-trigger-pass-handoff-third-turn-chain": (effect) => ({ ...restoreLoggedEffect(effect), oncePerTurn: true, canActivate: (ctx) => ctx.duel.chain.length > 0 }),
    "restore-trigger-pass-handoff-turn-open": (effect) => ({ ...restoreLoggedEffect(effect), canActivate: (ctx) => ctx.duel.chain.length === 0 }),
    "restore-trigger-pass-handoff-opponent-chain": (effect) => ({ ...restoreLoggedEffect(effect), oncePerTurn: true, canActivate: (ctx) => ctx.duel.chain.length > 0 }),
    "restore-trigger-pass-handoff-second-opponent-chain": (effect) => ({ ...restoreLoggedEffect(effect), oncePerTurn: true, canActivate: (ctx) => ctx.duel.chain.length > 0 }),
    "restore-trigger-pass-handoff-third-opponent-chain": (effect) => ({ ...restoreLoggedEffect(effect), oncePerTurn: true, canActivate: (ctx) => ctx.duel.chain.length > 0 }),
    "restore-trigger-pass-limit-success": restoreLoggedEffect,
    "restore-trigger-pass-limit-first-turn-chain": (effect) => ({ ...restoreLoggedEffect(effect), oncePerTurn: true, canActivate: (ctx) => ctx.duel.chain.length > 0 }),
    "restore-trigger-pass-limit-limiter": restoreChainOnlyQuickWithTurnLimit(false, true),
    "restore-trigger-pass-limit-followup": (effect) => ({ ...restoreLoggedEffect(effect), canActivate: (ctx) => ctx.duel.chain.length > 0 }),
    "restore-trigger-pass-limit-opponent-chain": (effect) => ({ ...restoreLoggedEffect(effect), oncePerTurn: true, canActivate: (ctx) => ctx.duel.chain.length > 0 }),
    "restore-trigger-pass-limit-opponent-blocked": (effect) => ({ ...restoreLoggedEffect(effect), canActivate: (ctx) => ctx.duel.chain.length > 0 }),
    "restore-trigger-pass-limit-opponent-open": (effect) => ({ ...restoreLoggedEffect(effect), canActivate: (ctx) => ctx.duel.chain.length === 0 }),
    "restore-trigger-pass-until-success": restoreLoggedEffect,
    "restore-trigger-pass-until-first-turn-chain": (effect) => ({ ...restoreLoggedEffect(effect), oncePerTurn: true, canActivate: (ctx) => ctx.duel.chain.length > 0 }),
    "restore-trigger-pass-until-limiter": restoreChainOnlyQuickWithTurnLimit(true, true),
    "restore-trigger-pass-until-followup": (effect) => ({ ...restoreLoggedEffect(effect), canActivate: (ctx) => ctx.duel.chain.length > 0 }),
    "restore-trigger-pass-until-opponent-chain": (effect) => ({ ...restoreLoggedEffect(effect), oncePerTurn: true, canActivate: (ctx) => ctx.duel.chain.length > 0 }),
    "restore-trigger-pass-until-opponent-blocked": (effect) => ({ ...restoreLoggedEffect(effect), canActivate: (ctx) => ctx.duel.chain.length > 0 }),
    "restore-trigger-pass-until-opponent-open": (effect) => ({ ...restoreLoggedEffect(effect), canActivate: (ctx) => ctx.duel.chain.length === 0 }),
  };
}

function restoreChainLimitRegistry(): Record<string, (limit: ChainLimit) => ChainLimit> {
  return {
    [TRIGGER_HANDOFF_TURN_ONLY_CHAIN_LIMIT_KEY]: restoreTurnOnlyChainLimit,
    [TRIGGER_HANDOFF_TURN_ONLY_UNTIL_CHAIN_END_LIMIT_KEY]: restoreTurnOnlyChainLimit,
  };
}

function restoreChainOnlyQuickWithTurnLimit(untilChainEnd: boolean, oncePerTurn = false): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...restoreLoggedEffect({ ...effect, ...(oncePerTurn ? { oncePerTurn: true } : {}) }),
    canActivate(ctx) {
      return ctx.duel.chain.length > 0;
    },
    target(ctx) {
      if (!ctx.checkOnly) addDuelChainLimit(ctx.duel, triggerHandoffTurnOnlyChainLimit(untilChainEnd));
      return true;
    },
  });
}

function restoreTurnOnlyChainLimit(limit: ChainLimit): ChainLimit {
  return {
    ...limit,
    allows(_effect, player) {
      return player === 0;
    },
  };
}

function triggerHandoffTurnOnlyChainLimit(untilChainEnd: boolean): Omit<ChainLimit, "expiresAtChainLength"> {
  return {
    registryKey: untilChainEnd ? TRIGGER_HANDOFF_TURN_ONLY_UNTIL_CHAIN_END_LIMIT_KEY : TRIGGER_HANDOFF_TURN_ONLY_CHAIN_LIMIT_KEY,
    untilChainEnd,
    allows(_effect, player) {
      return player === 0;
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

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function findHandCard(session: ReturnType<typeof createDuel>, controller: 0 | 1, code: string) {
  return queryPublicState(session).cards.find((card) => card.controller === controller && card.location === "hand" && card.code === code);
}

function hasGroupedEffect(session: ReturnType<typeof createDuel>, player: 0 | 1, effectId: string, windowKind: "chainResponse" | "open"): boolean {
  return getGroupedDuelLegalActions(session, player).some((group) =>
    group.windowKind === windowKind && group.actions.some((action) => action.type === "activateEffect" && action.player === player && action.effectId === effectId && action.windowKind === windowKind),
  );
}
