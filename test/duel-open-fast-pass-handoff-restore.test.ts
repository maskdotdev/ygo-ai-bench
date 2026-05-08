import { describe, expect, it } from "vitest";
import { addDuelChainLimit, applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { ChainLimit, DuelEffectDefinition } from "#duel/types.js";
import { cards } from "./full-duel-engine-fixtures.js";

const OPEN_HANDOFF_TURN_ONLY_CHAIN_LIMIT_KEY = "restore-open-limit-turn-only";
const OPEN_HANDOFF_TURN_ONLY_UNTIL_CHAIN_END_LIMIT_KEY = "restore-open-until-turn-only";
const OPEN_HANDOFF_OPPONENT_ONLY_CHAIN_LIMIT_KEY = "restore-open-opponent-limit-opponent-only";

describe("open fast pass handoff restore", () => {
  it("restores open priority after an open fast effect has no legal response", () => {
    const session = createDuel({ seed: 263, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const turnOpenQuick = findHandCard(session, 0, "100");
    expect(turnOpenQuick).toBeDefined();
    registerEffect(session, openOnlyQuick("restore-open-no-response-turn-quick", turnOpenQuick!.uid, 0, true));

    const quick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-open-no-response-turn-quick");
    expect(quick).toBeDefined();
    const resolved = applyAndAssert(session, quick!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [] });
    expect(session.state.chainPasses).toEqual([]);
    expect(session.state.log.map((entry) => entry.detail)).toContain("restore-open-no-response-turn-quick resolved");
    expect(resolved.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-open-no-response-turn-quick")).toBe(false);
    expect(getDuelLegalActions(session, 1)).toEqual([]);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restored)).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [] });
    expect(restored.state.chainPasses).toEqual([]);
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(getGroupedDuelLegalActions(restored, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restored, 0));
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restored, 0), 0, "restore-open-no-response-turn-quick", "open")).toBe(false);
    expect(hasGroupedPass(getGroupedDuelLegalActions(restored, 0), 0)).toBe(false);

    const staleQuick = applyResponse(restored, quick!);
    expect(staleQuick.ok).toBe(false);
    expect(staleQuick.error).toContain("Response is not currently legal");
    expect(staleQuick.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleQuick.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
  });

  it("restores chain-response priority to the turn player after the opponent passes", () => {
    const session = createDuel({ seed: 262, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const turnOpenQuick = findHandCard(session, 0, "100");
    const turnChainQuick = findHandCard(session, 0, "300");
    const opponentChainQuick = findHandCard(session, 1, "400");
    const opponentOpenQuick = findHandCard(session, 1, "500");
    expect(turnOpenQuick).toBeDefined();
    expect(turnChainQuick).toBeDefined();
    expect(opponentChainQuick).toBeDefined();
    expect(opponentOpenQuick).toBeDefined();

    registerEffect(session, openOnlyQuick("restore-open-pass-turn-open-quick", turnOpenQuick!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-open-pass-turn-chain-quick", turnChainQuick!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-open-pass-opponent-chain-quick", opponentChainQuick!.uid, 1));
    registerEffect(session, openOnlyQuick("restore-open-pass-opponent-open-quick", opponentOpenQuick!.uid, 1));

    const openQuick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-open-pass-turn-open-quick");
    expect(openQuick).toBeDefined();
    const opponentWindow = applyAndAssert(session, openQuick!);
    expect(opponentWindow.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(hasGroupedEffect(opponentWindow.legalActionGroups, 1, "restore-open-pass-opponent-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(opponentWindow.legalActionGroups, 1, "restore-open-pass-opponent-open-quick", "chainResponse")).toBe(false);

    const opponentPass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(opponentPass).toBeDefined();
    const turnWindow = applyAndAssert(session, opponentPass!);
    expect(turnWindow.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(session.state.chainPasses).toEqual([1]);
    expect(turnWindow.state.chain.map((link) => link.effectId)).toEqual(["restore-open-pass-turn-open-quick"]);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restored)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(restored.state.chain.map((link) => link.effectId)).toEqual(["restore-open-pass-turn-open-quick"]);
    expect(restored.state.chainPasses).toEqual([1]);
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restored, 0), 0, "restore-open-pass-turn-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restored, 0), 0, "restore-open-pass-turn-open-quick", "chainResponse")).toBe(false);
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restored, 1), 1, "restore-open-pass-opponent-chain-quick", "chainResponse")).toBe(false);
    expect(hasGroupedPass(getGroupedDuelLegalActions(restored, 0), 0)).toBe(true);

    const staleOpponentPass = applyResponse(restored, opponentPass!);
    expect(staleOpponentPass.ok).toBe(false);
    expect(staleOpponentPass.error).toContain("Response is not currently legal");
    expect(staleOpponentPass.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleOpponentPass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));

    const turnPass = getDuelLegalActions(restored, 0).find((action) => action.type === "passChain");
    expect(turnPass).toBeDefined();
    const wrongTokenPass = applyResponse(restored, { ...turnPass!, windowToken: `${turnPass!.windowToken}-stale` });
    expect(wrongTokenPass.ok).toBe(false);
    expect(wrongTokenPass.error).toContain("Response is not currently legal");
    expect(wrongTokenPass.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(wrongTokenPass.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(wrongTokenPass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));

    const resolved = applyAndAssert(restored, turnPass!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [] });
    expect(restored.state.chainPasses).toEqual([]);
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(resolved.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-open-pass-turn-open-quick")).toBe(false);
    expect(resolved.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-open-pass-turn-chain-quick")).toBe(false);
    expect(resolved.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-open-pass-opponent-open-quick")).toBe(false);

    const restoredOpenWindow = restoreDuel(serializeDuel(restored), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpenWindow)).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredOpenWindow.state.chainPasses).toEqual([]);
    expect(getDuelLegalActions(restoredOpenWindow, 1)).toEqual([]);
    expect(getGroupedDuelLegalActions(restoredOpenWindow, 0)).toEqual(getGroupedDuelLegalActions(restored, 0));
    expect(getGroupedDuelLegalActions(restoredOpenWindow, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restoredOpenWindow, 0));
  });

  it("restores one-chain limits after the turn player chains from an open fast-effect pass handoff", () => {
    const session = createDuel({ seed: 260, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "500", "500"] },
    });
    startDuel(session);

    const turnOpenQuick = findHandCard(session, 0, "100");
    const turnChainLimiter = findHandCard(session, 0, "300");
    const turnFollowup = findHandCard(session, 0, "500");
    const opponentBlocked = findHandCard(session, 1, "400");
    expect(turnOpenQuick).toBeDefined();
    expect(turnChainLimiter).toBeDefined();
    expect(turnFollowup).toBeDefined();
    expect(opponentBlocked).toBeDefined();

    registerEffect(session, openOnlyQuick("restore-open-limit-turn-open-quick", turnOpenQuick!.uid, 0, true));
    registerEffect(session, chainOnlyQuickWithTurnLimit("restore-open-limit-turn-chain-limiter", turnChainLimiter!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-open-limit-turn-followup", turnFollowup!.uid, 0));
    registerEffect(session, chainOnlyQuick("restore-open-limit-opponent-blocked", opponentBlocked!.uid, 1));

    const openQuick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-open-limit-turn-open-quick");
    expect(openQuick).toBeDefined();
    const opponentWindow = applyAndAssert(session, openQuick!);
    expect(opponentWindow.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(hasGroupedEffect(opponentWindow.legalActionGroups, 1, "restore-open-limit-opponent-blocked", "chainResponse")).toBe(true);

    const opponentBlockedAction = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-open-limit-opponent-blocked");
    expect(opponentBlockedAction).toBeDefined();
    const opponentPass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(opponentPass).toBeDefined();
    const turnWindow = applyAndAssert(session, opponentPass!);
    expect(turnWindow.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(turnWindow.state.chain.map((link) => link.effectId)).toEqual(["restore-open-limit-turn-open-quick"]);
    expect(session.state.chainPasses).toEqual([1]);
    expect(hasGroupedEffect(turnWindow.legalActionGroups, 0, "restore-open-limit-turn-chain-limiter", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(turnWindow.legalActionGroups, 0, "restore-open-limit-turn-followup", "chainResponse")).toBe(true);

    const chainLimiter = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-open-limit-turn-chain-limiter");
    expect(chainLimiter).toBeDefined();
    const limitedWindow = applyAndAssert(session, chainLimiter!);
    expect(limitedWindow.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(limitedWindow.state.chain.map((link) => link.effectId)).toEqual(["restore-open-limit-turn-open-quick", "restore-open-limit-turn-chain-limiter"]);
    expect(session.state.chainPasses).toEqual([]);
    expect(session.state.chainLimits.map(serializeChainLimitForAssert)).toEqual([
      { registryKey: OPEN_HANDOFF_TURN_ONLY_CHAIN_LIMIT_KEY, untilChainEnd: false, expiresAtChainLength: 2 },
    ]);
    expect(getDuelLegalActions(session, 1)).toEqual([]);
    expect(hasGroupedEffect(limitedWindow.legalActionGroups, 0, "restore-open-limit-turn-followup", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(getGroupedDuelLegalActions(session, 1), 1, "restore-open-limit-opponent-blocked", "chainResponse")).toBe(false);
    expect(hasGroupedPass(limitedWindow.legalActionGroups, 0)).toBe(true);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry(), restoreChainLimitRegistry());
    expect(queryPublicState(restored)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(restored.state.chain.map((link) => link.effectId)).toEqual(["restore-open-limit-turn-open-quick", "restore-open-limit-turn-chain-limiter"]);
    expect(restored.state.chainPasses).toEqual([]);
    expect(restored.state.chainLimits.map(serializeChainLimitForAssert)).toEqual([
      { registryKey: OPEN_HANDOFF_TURN_ONLY_CHAIN_LIMIT_KEY, untilChainEnd: false, expiresAtChainLength: 2 },
    ]);
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restored, 0)).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restored, 0), 0, "restore-open-limit-turn-followup", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restored, 1), 1, "restore-open-limit-opponent-blocked", "chainResponse")).toBe(false);
    expect(hasGroupedPass(getGroupedDuelLegalActions(restored, 0), 0)).toBe(true);

    const staleOpponentBlocked = applyResponse(restored, opponentBlockedAction!);
    expect(staleOpponentBlocked.ok).toBe(false);
    expect(staleOpponentBlocked.error).toContain("Response is not currently legal");
    expect(staleOpponentBlocked.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleOpponentBlocked.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));

    const turnPass = getDuelLegalActions(restored, 0).find((action) => action.type === "passChain");
    expect(turnPass).toBeDefined();
    const resolved = applyAndAssert(restored, turnPass!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [] });
    expect(restored.state.chainPasses).toEqual([]);
    expect(restored.state.chainLimits).toEqual([]);
    expect(restored.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining([
      "restore-open-limit-turn-chain-limiter resolved",
      "restore-open-limit-turn-open-quick resolved",
    ]));
    expect(restored.state.log.map((entry) => entry.detail)).not.toContain("restore-open-limit-turn-followup resolved");
    expect(restored.state.log.map((entry) => entry.detail)).not.toContain("restore-open-limit-opponent-blocked resolved");
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(resolved.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-open-limit-turn-open-quick")).toBe(false);
    expect(resolved.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-open-limit-turn-chain-limiter")).toBe(false);
    expect(resolved.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-open-limit-turn-followup")).toBe(false);

    const restoredOpenWindow = restoreDuel(serializeDuel(restored), createCardReader(cards), restoreRegistry(), restoreChainLimitRegistry());
    expect(queryPublicState(restoredOpenWindow)).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredOpenWindow.state.chainPasses).toEqual([]);
    expect(restoredOpenWindow.state.chainLimits).toEqual([]);
    expect(getDuelLegalActions(restoredOpenWindow, 1)).toEqual([]);
    expect(getGroupedDuelLegalActions(restoredOpenWindow, 0)).toEqual(getGroupedDuelLegalActions(restored, 0));
    expect(getGroupedDuelLegalActions(restoredOpenWindow, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restoredOpenWindow, 0));
  });

  it("restores until-chain-end limits after the turn player chains from an open fast-effect pass handoff", () => {
    const session = createDuel({ seed: 259, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "500", "500"] },
    });
    startDuel(session);

    const turnOpenQuick = findHandCard(session, 0, "100");
    const turnChainLimiter = findHandCard(session, 0, "300");
    const turnFollowup = findHandCard(session, 0, "500");
    const opponentBlocked = findHandCard(session, 1, "400");
    expect(turnOpenQuick).toBeDefined();
    expect(turnChainLimiter).toBeDefined();
    expect(turnFollowup).toBeDefined();
    expect(opponentBlocked).toBeDefined();

    registerEffect(session, openOnlyQuick("restore-open-until-turn-open-quick", turnOpenQuick!.uid, 0, true));
    registerEffect(session, chainOnlyQuickWithTurnUntilLimit("restore-open-until-turn-chain-limiter", turnChainLimiter!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-open-until-turn-followup", turnFollowup!.uid, 0));
    registerEffect(session, chainOnlyQuick("restore-open-until-opponent-blocked", opponentBlocked!.uid, 1));

    const openQuick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-open-until-turn-open-quick");
    expect(openQuick).toBeDefined();
    const opponentWindow = applyAndAssert(session, openQuick!);
    expect(opponentWindow.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(hasGroupedEffect(opponentWindow.legalActionGroups, 1, "restore-open-until-opponent-blocked", "chainResponse")).toBe(true);

    const opponentBlockedAction = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-open-until-opponent-blocked");
    expect(opponentBlockedAction).toBeDefined();
    const opponentPass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(opponentPass).toBeDefined();
    const turnWindow = applyAndAssert(session, opponentPass!);
    expect(turnWindow.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(turnWindow.state.chain.map((link) => link.effectId)).toEqual(["restore-open-until-turn-open-quick"]);
    expect(session.state.chainPasses).toEqual([1]);
    expect(hasGroupedEffect(turnWindow.legalActionGroups, 0, "restore-open-until-turn-chain-limiter", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(turnWindow.legalActionGroups, 0, "restore-open-until-turn-followup", "chainResponse")).toBe(true);

    const chainLimiter = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-open-until-turn-chain-limiter");
    expect(chainLimiter).toBeDefined();
    const limitedWindow = applyAndAssert(session, chainLimiter!);
    expect(limitedWindow.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(limitedWindow.state.chain.map((link) => link.effectId)).toEqual(["restore-open-until-turn-open-quick", "restore-open-until-turn-chain-limiter"]);
    expect(session.state.chainPasses).toEqual([]);
    expect(session.state.chainLimits.map(serializeChainLimitForAssert)).toEqual([
      { registryKey: OPEN_HANDOFF_TURN_ONLY_UNTIL_CHAIN_END_LIMIT_KEY, untilChainEnd: true, expiresAtChainLength: undefined },
    ]);
    expect(getDuelLegalActions(session, 1)).toEqual([]);
    expect(hasGroupedEffect(limitedWindow.legalActionGroups, 0, "restore-open-until-turn-followup", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(getGroupedDuelLegalActions(session, 1), 1, "restore-open-until-opponent-blocked", "chainResponse")).toBe(false);
    expect(hasGroupedPass(limitedWindow.legalActionGroups, 0)).toBe(true);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry(), restoreChainLimitRegistry());
    expect(queryPublicState(restored)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(restored.state.chain.map((link) => link.effectId)).toEqual(["restore-open-until-turn-open-quick", "restore-open-until-turn-chain-limiter"]);
    expect(restored.state.chainPasses).toEqual([]);
    expect(restored.state.chainLimits.map(serializeChainLimitForAssert)).toEqual([
      { registryKey: OPEN_HANDOFF_TURN_ONLY_UNTIL_CHAIN_END_LIMIT_KEY, untilChainEnd: true, expiresAtChainLength: undefined },
    ]);
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restored, 0)).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restored, 0), 0, "restore-open-until-turn-followup", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restored, 1), 1, "restore-open-until-opponent-blocked", "chainResponse")).toBe(false);
    expect(hasGroupedPass(getGroupedDuelLegalActions(restored, 0), 0)).toBe(true);

    const staleOpponentBlocked = applyResponse(restored, opponentBlockedAction!);
    expect(staleOpponentBlocked.ok).toBe(false);
    expect(staleOpponentBlocked.error).toContain("Response is not currently legal");
    expect(staleOpponentBlocked.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleOpponentBlocked.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));

    const turnPass = getDuelLegalActions(restored, 0).find((action) => action.type === "passChain");
    expect(turnPass).toBeDefined();
    const resolved = applyAndAssert(restored, turnPass!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [] });
    expect(restored.state.chainPasses).toEqual([]);
    expect(restored.state.chainLimits).toEqual([]);
    expect(restored.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining([
      "restore-open-until-turn-chain-limiter resolved",
      "restore-open-until-turn-open-quick resolved",
    ]));
    expect(restored.state.log.map((entry) => entry.detail)).not.toContain("restore-open-until-turn-followup resolved");
    expect(restored.state.log.map((entry) => entry.detail)).not.toContain("restore-open-until-opponent-blocked resolved");
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(resolved.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-open-until-turn-open-quick")).toBe(false);
    expect(resolved.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-open-until-turn-chain-limiter")).toBe(false);
    expect(resolved.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-open-until-turn-followup")).toBe(false);

    const restoredOpenWindow = restoreDuel(serializeDuel(restored), createCardReader(cards), restoreRegistry(), restoreChainLimitRegistry());
    expect(queryPublicState(restoredOpenWindow)).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredOpenWindow.state.chainPasses).toEqual([]);
    expect(restoredOpenWindow.state.chainLimits).toEqual([]);
    expect(getDuelLegalActions(restoredOpenWindow, 1)).toEqual([]);
    expect(getGroupedDuelLegalActions(restoredOpenWindow, 0)).toEqual(getGroupedDuelLegalActions(restored, 0));
    expect(getGroupedDuelLegalActions(restoredOpenWindow, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restoredOpenWindow, 0));
  });

  it("restores one-chain limits after the opponent responds to an open fast-effect pass handoff", () => {
    const session = createDuel({ seed: 258, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "500"] },
      1: { main: ["300", "400", "600"] },
    });
    startDuel(session);

    const turnOpenQuick = findHandCard(session, 0, "100");
    const turnChainQuick = findHandCard(session, 0, "200");
    const turnBlocked = findHandCard(session, 0, "500");
    const opponentChainLimiter = findHandCard(session, 1, "300");
    const opponentFollowup = findHandCard(session, 1, "400");
    expect(turnOpenQuick).toBeDefined();
    expect(turnChainQuick).toBeDefined();
    expect(turnBlocked).toBeDefined();
    expect(opponentChainLimiter).toBeDefined();
    expect(opponentFollowup).toBeDefined();

    registerEffect(session, openOnlyQuick("restore-open-opponent-limit-turn-open-quick", turnOpenQuick!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-open-opponent-limit-turn-chain-quick", turnChainQuick!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-open-opponent-limit-turn-blocked", turnBlocked!.uid, 0));
    registerEffect(session, chainOnlyQuickWithOpponentLimit("restore-open-opponent-limit-opponent-chain-limiter", opponentChainLimiter!.uid, 1, true));
    registerEffect(session, chainOnlyQuick("restore-open-opponent-limit-opponent-followup", opponentFollowup!.uid, 1));

    const openQuick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-open-opponent-limit-turn-open-quick");
    expect(openQuick).toBeDefined();
    const opponentWindow = applyAndAssert(session, openQuick!);
    expect(opponentWindow.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(hasGroupedEffect(opponentWindow.legalActionGroups, 1, "restore-open-opponent-limit-opponent-chain-limiter", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(opponentWindow.legalActionGroups, 1, "restore-open-opponent-limit-opponent-followup", "chainResponse")).toBe(true);

    const opponentPass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(opponentPass).toBeDefined();
    const turnWindow = applyAndAssert(session, opponentPass!);
    expect(turnWindow.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(turnWindow.state.chain.map((link) => link.effectId)).toEqual(["restore-open-opponent-limit-turn-open-quick"]);
    expect(session.state.chainPasses).toEqual([1]);
    expect(hasGroupedEffect(turnWindow.legalActionGroups, 0, "restore-open-opponent-limit-turn-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(turnWindow.legalActionGroups, 0, "restore-open-opponent-limit-turn-blocked", "chainResponse")).toBe(true);

    const turnBlockedAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-open-opponent-limit-turn-blocked");
    expect(turnBlockedAction).toBeDefined();
    const turnChain = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-open-opponent-limit-turn-chain-quick");
    expect(turnChain).toBeDefined();
    const secondOpponentWindow = applyAndAssert(session, turnChain!);
    expect(secondOpponentWindow.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(secondOpponentWindow.state.chain.map((link) => link.effectId)).toEqual(["restore-open-opponent-limit-turn-open-quick", "restore-open-opponent-limit-turn-chain-quick"]);
    expect(session.state.chainPasses).toEqual([]);
    expect(getDuelLegalActions(session, 0)).toEqual([]);
    expect(hasGroupedEffect(secondOpponentWindow.legalActionGroups, 1, "restore-open-opponent-limit-opponent-chain-limiter", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(secondOpponentWindow.legalActionGroups, 1, "restore-open-opponent-limit-opponent-followup", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(getGroupedDuelLegalActions(session, 0), 0, "restore-open-opponent-limit-turn-blocked", "chainResponse")).toBe(false);

    const opponentLimiter = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-open-opponent-limit-opponent-chain-limiter");
    expect(opponentLimiter).toBeDefined();
    const limitedWindow = applyAndAssert(session, opponentLimiter!);
    expect(limitedWindow.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(limitedWindow.state.chain.map((link) => link.effectId)).toEqual([
      "restore-open-opponent-limit-turn-open-quick",
      "restore-open-opponent-limit-turn-chain-quick",
      "restore-open-opponent-limit-opponent-chain-limiter",
    ]);
    expect(session.state.chainPasses).toEqual([]);
    expect(session.state.chainLimits.map(serializeChainLimitForAssert)).toEqual([
      { registryKey: OPEN_HANDOFF_OPPONENT_ONLY_CHAIN_LIMIT_KEY, untilChainEnd: false, expiresAtChainLength: 3 },
    ]);
    expect(getDuelLegalActions(session, 0)).toEqual([]);
    expect(hasGroupedEffect(limitedWindow.legalActionGroups, 1, "restore-open-opponent-limit-opponent-followup", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(getGroupedDuelLegalActions(session, 0), 0, "restore-open-opponent-limit-turn-blocked", "chainResponse")).toBe(false);
    expect(hasGroupedPass(limitedWindow.legalActionGroups, 1)).toBe(true);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry(), restoreChainLimitRegistry());
    expect(queryPublicState(restored)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(restored.state.chain.map((link) => link.effectId)).toEqual([
      "restore-open-opponent-limit-turn-open-quick",
      "restore-open-opponent-limit-turn-chain-quick",
      "restore-open-opponent-limit-opponent-chain-limiter",
    ]);
    expect(restored.state.chainPasses).toEqual([]);
    expect(restored.state.chainLimits.map(serializeChainLimitForAssert)).toEqual([
      { registryKey: OPEN_HANDOFF_OPPONENT_ONLY_CHAIN_LIMIT_KEY, untilChainEnd: false, expiresAtChainLength: 3 },
    ]);
    expect(getDuelLegalActions(restored, 0)).toEqual([]);
    expect(getDuelLegalActions(restored, 1)).toEqual(getDuelLegalActions(session, 1));
    expect(getGroupedDuelLegalActions(restored, 1)).toEqual(getGroupedDuelLegalActions(session, 1));
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restored, 1), 1, "restore-open-opponent-limit-opponent-followup", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restored, 0), 0, "restore-open-opponent-limit-turn-blocked", "chainResponse")).toBe(false);
    expect(hasGroupedPass(getGroupedDuelLegalActions(restored, 1), 1)).toBe(true);

    const staleTurnBlocked = applyResponse(restored, turnBlockedAction!);
    expect(staleTurnBlocked.ok).toBe(false);
    expect(staleTurnBlocked.error).toContain("Response is not currently legal");
    expect(staleTurnBlocked.legalActions).toEqual(getDuelLegalActions(restored, 1));
    expect(staleTurnBlocked.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 1));

    const opponentPassAfterLimit = getDuelLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(opponentPassAfterLimit).toBeDefined();
    const resolved = applyAndAssert(restored, opponentPassAfterLimit!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [] });
    expect(restored.state.chainPasses).toEqual([]);
    expect(restored.state.chainLimits).toEqual([]);
    expect(restored.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining([
      "restore-open-opponent-limit-opponent-chain-limiter resolved",
      "restore-open-opponent-limit-turn-chain-quick resolved",
      "restore-open-opponent-limit-turn-open-quick resolved",
    ]));
    expect(restored.state.log.map((entry) => entry.detail)).not.toContain("restore-open-opponent-limit-opponent-followup resolved");
    expect(restored.state.log.map((entry) => entry.detail)).not.toContain("restore-open-opponent-limit-turn-blocked resolved");
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(resolved.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-open-opponent-limit-turn-open-quick")).toBe(false);
    expect(resolved.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-open-opponent-limit-turn-chain-quick")).toBe(false);
    expect(resolved.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-open-opponent-limit-turn-blocked")).toBe(false);

    const restoredOpenWindow = restoreDuel(serializeDuel(restored), createCardReader(cards), restoreRegistry(), restoreChainLimitRegistry());
    expect(queryPublicState(restoredOpenWindow)).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredOpenWindow.state.chainPasses).toEqual([]);
    expect(restoredOpenWindow.state.chainLimits).toEqual([]);
    expect(getDuelLegalActions(restoredOpenWindow, 1)).toEqual([]);
    expect(getGroupedDuelLegalActions(restoredOpenWindow, 0)).toEqual(getGroupedDuelLegalActions(restored, 0));
    expect(getGroupedDuelLegalActions(restoredOpenWindow, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restoredOpenWindow, 0));
  });

  it("restores chain-response priority to the turn player after the opponent chains", () => {
    const session = createDuel({ seed: 261, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300", "500"] },
      1: { main: ["400", "500", "500"] },
    });
    startDuel(session);

    const turnOpenQuick = findHandCard(session, 0, "100");
    const turnChainQuick = findHandCard(session, 0, "300");
    const turnOpenOnly = findHandCard(session, 0, "500");
    const opponentChainQuick = findHandCard(session, 1, "400");
    expect(turnOpenQuick).toBeDefined();
    expect(turnChainQuick).toBeDefined();
    expect(turnOpenOnly).toBeDefined();
    expect(opponentChainQuick).toBeDefined();

    registerEffect(session, openOnlyQuick("restore-open-alt-turn-open-quick", turnOpenQuick!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-open-alt-turn-chain-quick", turnChainQuick!.uid, 0, true));
    registerEffect(session, openOnlyQuick("restore-open-alt-turn-open-only", turnOpenOnly!.uid, 0));
    registerEffect(session, chainOnlyQuick("restore-open-alt-opponent-chain-quick", opponentChainQuick!.uid, 1, true));

    const openQuick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-open-alt-turn-open-quick");
    expect(openQuick).toBeDefined();
    const opponentWindow = applyAndAssert(session, openQuick!);
    expect(opponentWindow.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(hasGroupedEffect(opponentWindow.legalActionGroups, 1, "restore-open-alt-opponent-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(opponentWindow.legalActionGroups, 0, "restore-open-alt-turn-chain-quick", "chainResponse")).toBe(false);

    const opponentChain = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-open-alt-opponent-chain-quick");
    expect(opponentChain).toBeDefined();
    const turnWindow = applyAndAssert(session, opponentChain!);
    expect(turnWindow.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(turnWindow.state.chain.map((link) => link.effectId)).toEqual(["restore-open-alt-turn-open-quick", "restore-open-alt-opponent-chain-quick"]);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restored)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(restored.state.chain.map((link) => link.effectId)).toEqual(["restore-open-alt-turn-open-quick", "restore-open-alt-opponent-chain-quick"]);
    expect(restored.state.chainPasses).toEqual([]);
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restored, 0), 0, "restore-open-alt-turn-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restored, 0), 0, "restore-open-alt-turn-open-only", "chainResponse")).toBe(false);
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restored, 1), 1, "restore-open-alt-opponent-chain-quick", "chainResponse")).toBe(false);
    expect(hasGroupedPass(getGroupedDuelLegalActions(restored, 0), 0)).toBe(true);

    const staleOpponentChain = applyResponse(restored, opponentChain!);
    expect(staleOpponentChain.ok).toBe(false);
    expect(staleOpponentChain.error).toContain("Response is not currently legal");
    expect(staleOpponentChain.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleOpponentChain.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));

    const turnChain = getDuelLegalActions(restored, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-open-alt-turn-chain-quick");
    expect(turnChain).toBeDefined();
    const resolved = applyAndAssert(restored, turnChain!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [] });
    expect(restored.state.chainPasses).toEqual([]);
    expect(restored.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining([
      "restore-open-alt-turn-chain-quick resolved",
      "restore-open-alt-opponent-chain-quick resolved",
      "restore-open-alt-turn-open-quick resolved",
    ]));
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(resolved.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-open-alt-turn-open-quick")).toBe(false);
    expect(resolved.legalActions.some((action) => action.type === "activateEffect" && action.effectId === "restore-open-alt-turn-chain-quick")).toBe(false);

    const restoredOpenWindow = restoreDuel(serializeDuel(restored), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpenWindow)).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredOpenWindow.state.chainPasses).toEqual([]);
    expect(getDuelLegalActions(restoredOpenWindow, 1)).toEqual([]);
    expect(getGroupedDuelLegalActions(restoredOpenWindow, 0)).toEqual(getGroupedDuelLegalActions(restored, 0));
    expect(getGroupedDuelLegalActions(restoredOpenWindow, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restoredOpenWindow, 0));
  });
});

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

function loggedEffect(id: string, sourceUid: string, controller: 0 | 1, detail: string, oncePerTurn = false): DuelEffectDefinition {
  return {
    id,
    registryKey: id,
    sourceUid,
    controller,
    event: "quick",
    range: ["hand"],
    ...(oncePerTurn ? { oncePerTurn: true } : {}),
    operation(ctx) {
      ctx.log(`${id} resolved`);
      ctx.log(detail);
    },
  };
}

function openOnlyQuick(id: string, sourceUid: string, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
  return {
    ...loggedEffect(id, sourceUid, controller, "open", oncePerTurn),
    canActivate(ctx) {
      return ctx.duel.chain.length === 0;
    },
  };
}

function chainOnlyQuick(id: string, sourceUid: string, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
  return {
    ...loggedEffect(id, sourceUid, controller, "chain", oncePerTurn),
    canActivate(ctx) {
      return ctx.duel.chain.length > 0;
    },
  };
}

function chainOnlyQuickWithTurnLimit(id: string, sourceUid: string, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
  return {
    ...chainOnlyQuick(id, sourceUid, controller, oncePerTurn),
    target(ctx) {
      if (!ctx.checkOnly) addDuelChainLimit(ctx.duel, turnOnlyChainLimit());
      return true;
    },
  };
}

function chainOnlyQuickWithTurnUntilLimit(id: string, sourceUid: string, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
  return {
    ...chainOnlyQuick(id, sourceUid, controller, oncePerTurn),
    target(ctx) {
      if (!ctx.checkOnly) addDuelChainLimit(ctx.duel, turnOnlyUntilChainEndLimit());
      return true;
    },
  };
}

function chainOnlyQuickWithOpponentLimit(id: string, sourceUid: string, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
  return {
    ...chainOnlyQuick(id, sourceUid, controller, oncePerTurn),
    target(ctx) {
      if (!ctx.checkOnly) addDuelChainLimit(ctx.duel, opponentOnlyChainLimit());
      return true;
    },
  };
}

function restoreRegistry(): Record<string, (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition> {
  return {
    "restore-open-no-response-turn-quick": restoreOpenOnlyQuick(true),
    "restore-open-pass-turn-open-quick": restoreOpenOnlyQuick(true),
    "restore-open-pass-turn-chain-quick": restoreChainOnlyQuick(true),
    "restore-open-pass-opponent-chain-quick": restoreChainOnlyQuick(),
    "restore-open-pass-opponent-open-quick": restoreOpenOnlyQuick(),
    "restore-open-limit-turn-open-quick": restoreOpenOnlyQuick(true),
    "restore-open-limit-turn-chain-limiter": restoreChainOnlyQuickWithTurnLimit(true),
    "restore-open-limit-turn-followup": restoreChainOnlyQuick(),
    "restore-open-limit-opponent-blocked": restoreChainOnlyQuick(),
    "restore-open-until-turn-open-quick": restoreOpenOnlyQuick(true),
    "restore-open-until-turn-chain-limiter": restoreChainOnlyQuickWithTurnUntilLimit(true),
    "restore-open-until-turn-followup": restoreChainOnlyQuick(),
    "restore-open-until-opponent-blocked": restoreChainOnlyQuick(),
    "restore-open-opponent-limit-turn-open-quick": restoreOpenOnlyQuick(true),
    "restore-open-opponent-limit-turn-chain-quick": restoreChainOnlyQuick(true),
    "restore-open-opponent-limit-turn-blocked": restoreChainOnlyQuick(),
    "restore-open-opponent-limit-opponent-chain-limiter": restoreChainOnlyQuickWithOpponentLimit(true),
    "restore-open-opponent-limit-opponent-followup": restoreChainOnlyQuick(),
    "restore-open-alt-turn-open-quick": restoreOpenOnlyQuick(true),
    "restore-open-alt-turn-chain-quick": restoreChainOnlyQuick(true),
    "restore-open-alt-turn-open-only": restoreOpenOnlyQuick(),
    "restore-open-alt-opponent-chain-quick": restoreChainOnlyQuick(true),
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

function restoreOpenOnlyQuick(oncePerTurn = false): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...restoreLoggedEffect({ ...effect, ...(oncePerTurn ? { oncePerTurn: true } : {}) }),
    canActivate(ctx) {
      return ctx.duel.chain.length === 0;
    },
  });
}

function restoreChainOnlyQuick(oncePerTurn = false): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...restoreLoggedEffect({ ...effect, ...(oncePerTurn ? { oncePerTurn: true } : {}) }),
    canActivate(ctx) {
      return ctx.duel.chain.length > 0;
    },
  });
}

function restoreChainOnlyQuickWithTurnLimit(oncePerTurn = false): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...restoreChainOnlyQuick(oncePerTurn)(effect),
    target(ctx) {
      if (!ctx.checkOnly) addDuelChainLimit(ctx.duel, turnOnlyChainLimit());
      return true;
    },
  });
}

function restoreChainOnlyQuickWithTurnUntilLimit(oncePerTurn = false): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...restoreChainOnlyQuick(oncePerTurn)(effect),
    target(ctx) {
      if (!ctx.checkOnly) addDuelChainLimit(ctx.duel, turnOnlyUntilChainEndLimit());
      return true;
    },
  });
}

function restoreChainOnlyQuickWithOpponentLimit(oncePerTurn = false): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...restoreChainOnlyQuick(oncePerTurn)(effect),
    target(ctx) {
      if (!ctx.checkOnly) addDuelChainLimit(ctx.duel, opponentOnlyChainLimit());
      return true;
    },
  });
}

function restoreChainLimitRegistry(): Record<string, (limit: ChainLimit) => ChainLimit> {
  return {
    [OPEN_HANDOFF_TURN_ONLY_CHAIN_LIMIT_KEY]: restoreTurnOnlyChainLimit,
    [OPEN_HANDOFF_TURN_ONLY_UNTIL_CHAIN_END_LIMIT_KEY]: restoreTurnOnlyChainLimit,
    [OPEN_HANDOFF_OPPONENT_ONLY_CHAIN_LIMIT_KEY]: restoreOpponentOnlyChainLimit,
  };
}

function restoreTurnOnlyChainLimit(limit: ChainLimit): ChainLimit {
  return {
    ...limit,
    allows(_effect, player) {
      return player === 0;
    },
  };
}

function restoreOpponentOnlyChainLimit(limit: ChainLimit): ChainLimit {
  return {
    ...limit,
    allows(_effect, player) {
      return player === 1;
    },
  };
}

function turnOnlyChainLimit(): Omit<ChainLimit, "expiresAtChainLength"> {
  return {
    registryKey: OPEN_HANDOFF_TURN_ONLY_CHAIN_LIMIT_KEY,
    untilChainEnd: false,
    allows(_effect, player) {
      return player === 0;
    },
  };
}

function opponentOnlyChainLimit(): Omit<ChainLimit, "expiresAtChainLength"> {
  return {
    registryKey: OPEN_HANDOFF_OPPONENT_ONLY_CHAIN_LIMIT_KEY,
    untilChainEnd: false,
    allows(_effect, player) {
      return player === 1;
    },
  };
}

function turnOnlyUntilChainEndLimit(): Omit<ChainLimit, "expiresAtChainLength"> {
  return {
    registryKey: OPEN_HANDOFF_TURN_ONLY_UNTIL_CHAIN_END_LIMIT_KEY,
    untilChainEnd: true,
    allows(_effect, player) {
      return player === 0;
    },
  };
}

function serializeChainLimitForAssert(limit: ChainLimit) {
  return {
    registryKey: limit.registryKey,
    untilChainEnd: limit.untilChainEnd,
    expiresAtChainLength: limit.expiresAtChainLength,
  };
}

function hasGroupedEffect(groups: ReturnType<typeof getGroupedDuelLegalActions>, player: 0 | 1, effectId: string, windowKind: "chainResponse" | "open"): boolean {
  return groups.some(
    (group) =>
      group.windowKind === windowKind &&
      group.actions.some((action) => action.type === "activateEffect" && action.player === player && action.effectId === effectId && action.windowId === group.windowId && action.windowKind === windowKind),
  );
}

function hasGroupedPass(groups: ReturnType<typeof getGroupedDuelLegalActions>, player: 0 | 1): boolean {
  return groups.some(
    (group) =>
      group.windowKind === "chainResponse" &&
      group.actions.some((action) => action.type === "passChain" && action.player === player && action.windowId === group.windowId && action.windowKind === "chainResponse"),
  );
}
