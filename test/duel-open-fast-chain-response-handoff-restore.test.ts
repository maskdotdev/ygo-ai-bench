import { describe, expect, it } from "vitest";
import { addDuelChainLimit, applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { ChainLimit, DuelEffectDefinition } from "#duel/types.js";
import { cards } from "./full-duel-engine-fixtures.js";

const RESPONSE_HANDOFF_OPPONENT_ONLY_CHAIN_LIMIT_KEY = "restore-chain-handoff-opponent-only";
const RESPONSE_HANDOFF_OPPONENT_ONLY_UNTIL_CHAIN_END_LIMIT_KEY = "restore-chain-handoff-opponent-until-only";

describe("open fast chain-response handoff restore", () => {
  it("restores the opponent response window after the turn player passes an opponent chain link", () => {
    const session = createDuel({ seed: 256, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "700"] },
      1: { main: ["300", "500", "600"] },
    });
    startDuel(session);

    const turnOpenQuick = findHandCard(session, 0, "100");
    const turnChainQuick = findHandCard(session, 0, "200");
    const opponentFirst = findHandCard(session, 1, "300");
    const opponentSecond = findHandCard(session, 1, "500");
    const opponentOpenOnly = findHandCard(session, 1, "600");
    expect(turnOpenQuick).toBeDefined();
    expect(turnChainQuick).toBeDefined();
    expect(opponentFirst).toBeDefined();
    expect(opponentSecond).toBeDefined();
    expect(opponentOpenOnly).toBeDefined();

    registerEffect(session, openOnlyQuick("restore-chain-handoff-turn-open-quick", turnOpenQuick!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-chain-handoff-turn-chain-quick", turnChainQuick!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-chain-handoff-opponent-first-chain-quick", opponentFirst!.uid, 1, true));
    registerEffect(session, chainOnlyQuick("restore-chain-handoff-opponent-second-chain-quick", opponentSecond!.uid, 1, true));
    registerEffect(session, openOnlyQuick("restore-chain-handoff-opponent-open-quick", opponentOpenOnly!.uid, 1, true));

    const openQuick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-chain-handoff-turn-open-quick");
    expect(openQuick).toBeDefined();
    const opponentWindow = applyAndAssert(session, openQuick!);
    expect(opponentWindow.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(hasGroupedEffect(opponentWindow.legalActionGroups, 1, "restore-chain-handoff-opponent-first-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(opponentWindow.legalActionGroups, 1, "restore-chain-handoff-opponent-second-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(opponentWindow.legalActionGroups, 1, "restore-chain-handoff-opponent-open-quick", "chainResponse")).toBe(false);

    const opponentFirstAction = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-chain-handoff-opponent-first-chain-quick");
    expect(opponentFirstAction).toBeDefined();
    const turnWindow = applyAndAssert(session, opponentFirstAction!);
    expect(turnWindow.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(turnWindow.state.chain.map((link) => link.effectId)).toEqual(["restore-chain-handoff-turn-open-quick", "restore-chain-handoff-opponent-first-chain-quick"]);
    expect(session.state.chainPasses).toEqual([]);
    expect(getDuelLegalActions(session, 1)).toEqual([]);
    expect(hasGroupedEffect(turnWindow.legalActionGroups, 0, "restore-chain-handoff-turn-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedPass(turnWindow.legalActionGroups, 0)).toBe(true);

    const restoredTurnWindow = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredTurnWindow)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(restoredTurnWindow.state.chain.map((link) => link.effectId)).toEqual(["restore-chain-handoff-turn-open-quick", "restore-chain-handoff-opponent-first-chain-quick"]);
    expect(restoredTurnWindow.state.chainPasses).toEqual([]);
    expect(getDuelLegalActions(restoredTurnWindow, 1)).toEqual([]);
    expect(getDuelLegalActions(restoredTurnWindow, 0)).toEqual(getDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restoredTurnWindow, 0)).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restoredTurnWindow, 0), 0, "restore-chain-handoff-turn-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restoredTurnWindow, 1), 1, "restore-chain-handoff-opponent-second-chain-quick", "chainResponse")).toBe(false);

    const staleOpponentFirst = applyResponse(restoredTurnWindow, opponentFirstAction!);
    expect(staleOpponentFirst.ok).toBe(false);
    expect(staleOpponentFirst.error).toContain("Response is not currently legal");
    expect(staleOpponentFirst.legalActions).toEqual(getDuelLegalActions(restoredTurnWindow, 0));
    expect(staleOpponentFirst.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredTurnWindow, 0));

    const turnPass = getDuelLegalActions(restoredTurnWindow, 0).find((action) => action.type === "passChain");
    expect(turnPass).toBeDefined();
    const returnedOpponentWindow = applyAndAssert(restoredTurnWindow, turnPass!);
    expect(returnedOpponentWindow.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(restoredTurnWindow.state.chain.map((link) => link.effectId)).toEqual(["restore-chain-handoff-turn-open-quick", "restore-chain-handoff-opponent-first-chain-quick"]);
    expect(restoredTurnWindow.state.chainPasses).toEqual([0]);
    expect(getDuelLegalActions(restoredTurnWindow, 0)).toEqual([]);
    expect(hasGroupedEffect(returnedOpponentWindow.legalActionGroups, 1, "restore-chain-handoff-opponent-second-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(returnedOpponentWindow.legalActionGroups, 1, "restore-chain-handoff-opponent-open-quick", "chainResponse")).toBe(false);
    expect(hasGroupedPass(returnedOpponentWindow.legalActionGroups, 1)).toBe(true);

    const restoredOpponentWindow = restoreDuel(serializeDuel(restoredTurnWindow), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpponentWindow)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(restoredOpponentWindow.state.chain.map((link) => link.effectId)).toEqual(["restore-chain-handoff-turn-open-quick", "restore-chain-handoff-opponent-first-chain-quick"]);
    expect(restoredOpponentWindow.state.chainPasses).toEqual([0]);
    expect(getDuelLegalActions(restoredOpponentWindow, 0)).toEqual([]);
    expect(getDuelLegalActions(restoredOpponentWindow, 1)).toEqual(getDuelLegalActions(restoredTurnWindow, 1));
    expect(getGroupedDuelLegalActions(restoredOpponentWindow, 1)).toEqual(getGroupedDuelLegalActions(restoredTurnWindow, 1));
    expect(getGroupedDuelLegalActions(restoredOpponentWindow, 1).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restoredOpponentWindow, 1));

    const staleTurnPass = applyResponse(restoredOpponentWindow, turnPass!);
    expect(staleTurnPass.ok).toBe(false);
    expect(staleTurnPass.error).toContain("Response is not currently legal");
    expect(staleTurnPass.legalActions).toEqual(getDuelLegalActions(restoredOpponentWindow, 1));
    expect(staleTurnPass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restoredOpponentWindow, 1));

    const opponentPass = getDuelLegalActions(restoredOpponentWindow, 1).find((action) => action.type === "passChain");
    expect(opponentPass).toBeDefined();
    const resolved = applyAndAssert(restoredOpponentWindow, opponentPass!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [] });
    expect(restoredOpponentWindow.state.chainPasses).toEqual([]);
    expect(restoredOpponentWindow.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining([
      "restore-chain-handoff-opponent-first-chain-quick resolved",
      "restore-chain-handoff-turn-open-quick resolved",
    ]));
    expect(restoredOpponentWindow.state.log.map((entry) => entry.detail)).not.toContain("restore-chain-handoff-opponent-second-chain-quick resolved");
    expect(restoredOpponentWindow.state.log.map((entry) => entry.detail)).not.toContain("restore-chain-handoff-turn-chain-quick resolved");
    expect(getDuelLegalActions(restoredOpponentWindow, 1)).toEqual([]);

    const restoredOpenWindow = restoreDuel(serializeDuel(restoredOpponentWindow), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpenWindow)).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredOpenWindow.state.chainPasses).toEqual([]);
    expect(getGroupedDuelLegalActions(restoredOpenWindow, 0)).toEqual(getGroupedDuelLegalActions(restoredOpponentWindow, 0));
    expect(getGroupedDuelLegalActions(restoredOpenWindow, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restoredOpenWindow, 0));
  });

  it("restores one-chain limits after the opponent chains from a returned chain-response handoff", () => {
    const session = createDuel({ seed: 255, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "500"] },
      1: { main: ["300", "400", "600"] },
    });
    startDuel(session);

    const turnOpenQuick = findHandCard(session, 0, "100");
    const turnBlocked = findHandCard(session, 0, "500");
    const opponentFirst = findHandCard(session, 1, "300");
    const opponentLimiter = findHandCard(session, 1, "400");
    const opponentFollowup = findHandCard(session, 1, "600");
    expect(turnOpenQuick).toBeDefined();
    expect(turnBlocked).toBeDefined();
    expect(opponentFirst).toBeDefined();
    expect(opponentLimiter).toBeDefined();
    expect(opponentFollowup).toBeDefined();

    registerEffect(session, openOnlyQuick("restore-chain-limit-turn-open-quick", turnOpenQuick!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-chain-limit-turn-blocked", turnBlocked!.uid, 0));
    registerEffect(session, chainOnlyQuick("restore-chain-limit-opponent-first", opponentFirst!.uid, 1, true));
    registerEffect(session, chainOnlyQuickWithOpponentLimit("restore-chain-limit-opponent-limiter", opponentLimiter!.uid, 1, true));
    registerEffect(session, chainOnlyQuick("restore-chain-limit-opponent-followup", opponentFollowup!.uid, 1));

    const openQuick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-chain-limit-turn-open-quick");
    expect(openQuick).toBeDefined();
    applyAndAssert(session, openQuick!);

    const opponentFirstAction = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-chain-limit-opponent-first");
    expect(opponentFirstAction).toBeDefined();
    const turnWindow = applyAndAssert(session, opponentFirstAction!);
    expect(turnWindow.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(turnWindow.state.chain.map((link) => link.effectId)).toEqual(["restore-chain-limit-turn-open-quick", "restore-chain-limit-opponent-first"]);
    expect(hasGroupedEffect(turnWindow.legalActionGroups, 0, "restore-chain-limit-turn-blocked", "chainResponse")).toBe(true);

    const turnBlockedAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-chain-limit-turn-blocked");
    expect(turnBlockedAction).toBeDefined();
    const turnPass = getDuelLegalActions(session, 0).find((action) => action.type === "passChain");
    expect(turnPass).toBeDefined();
    const opponentHandoffWindow = applyAndAssert(session, turnPass!);
    expect(opponentHandoffWindow.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(session.state.chainPasses).toEqual([0]);
    expect(getDuelLegalActions(session, 0)).toEqual([]);
    expect(hasGroupedEffect(opponentHandoffWindow.legalActionGroups, 1, "restore-chain-limit-opponent-limiter", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(opponentHandoffWindow.legalActionGroups, 1, "restore-chain-limit-opponent-followup", "chainResponse")).toBe(true);

    const opponentLimiterAction = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-chain-limit-opponent-limiter");
    expect(opponentLimiterAction).toBeDefined();
    const limitedWindow = applyAndAssert(session, opponentLimiterAction!);
    expect(limitedWindow.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(limitedWindow.state.chain.map((link) => link.effectId)).toEqual([
      "restore-chain-limit-turn-open-quick",
      "restore-chain-limit-opponent-first",
      "restore-chain-limit-opponent-limiter",
    ]);
    expect(session.state.chainPasses).toEqual([]);
    expect(session.state.chainLimits.map(serializeChainLimitForAssert)).toEqual([
      { registryKey: RESPONSE_HANDOFF_OPPONENT_ONLY_CHAIN_LIMIT_KEY, untilChainEnd: false, expiresAtChainLength: 3 },
    ]);
    expect(getDuelLegalActions(session, 0)).toEqual([]);
    expect(hasGroupedEffect(limitedWindow.legalActionGroups, 1, "restore-chain-limit-opponent-followup", "chainResponse")).toBe(true);
    expect(hasGroupedPass(limitedWindow.legalActionGroups, 1)).toBe(true);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry(), restoreChainLimitRegistry());
    expect(queryPublicState(restored)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(restored.state.chain.map((link) => link.effectId)).toEqual([
      "restore-chain-limit-turn-open-quick",
      "restore-chain-limit-opponent-first",
      "restore-chain-limit-opponent-limiter",
    ]);
    expect(restored.state.chainLimits.map(serializeChainLimitForAssert)).toEqual([
      { registryKey: RESPONSE_HANDOFF_OPPONENT_ONLY_CHAIN_LIMIT_KEY, untilChainEnd: false, expiresAtChainLength: 3 },
    ]);
    expect(getDuelLegalActions(restored, 0)).toEqual([]);
    expect(getDuelLegalActions(restored, 1)).toEqual(getDuelLegalActions(session, 1));
    expect(getGroupedDuelLegalActions(restored, 1)).toEqual(getGroupedDuelLegalActions(session, 1));

    const staleTurnBlocked = applyResponse(restored, turnBlockedAction!);
    expect(staleTurnBlocked.ok).toBe(false);
    expect(staleTurnBlocked.error).toContain("Response is not currently legal");
    expect(staleTurnBlocked.legalActions).toEqual(getDuelLegalActions(restored, 1));
    expect(staleTurnBlocked.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 1));

    const opponentPass = getDuelLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(opponentPass).toBeDefined();
    const resolved = applyAndAssert(restored, opponentPass!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [] });
    expect(restored.state.chainPasses).toEqual([]);
    expect(restored.state.chainLimits).toEqual([]);
    expect(restored.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining([
      "restore-chain-limit-opponent-limiter resolved",
      "restore-chain-limit-opponent-first resolved",
      "restore-chain-limit-turn-open-quick resolved",
    ]));
    expect(restored.state.log.map((entry) => entry.detail)).not.toContain("restore-chain-limit-opponent-followup resolved");
    expect(restored.state.log.map((entry) => entry.detail)).not.toContain("restore-chain-limit-turn-blocked resolved");
    expect(getDuelLegalActions(restored, 1)).toEqual([]);

    const restoredOpenWindow = restoreDuel(serializeDuel(restored), createCardReader(cards), restoreRegistry(), restoreChainLimitRegistry());
    expect(queryPublicState(restoredOpenWindow)).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredOpenWindow.state.chainLimits).toEqual([]);
    expect(getGroupedDuelLegalActions(restoredOpenWindow, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restoredOpenWindow, 0));
  });

  it("restores until-chain-end limits after the opponent chains from a returned chain-response handoff", () => {
    const session = createDuel({ seed: 254, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "500"] },
      1: { main: ["300", "400", "600"] },
    });
    startDuel(session);

    const turnOpenQuick = findHandCard(session, 0, "100");
    const turnBlocked = findHandCard(session, 0, "500");
    const opponentFirst = findHandCard(session, 1, "300");
    const opponentLimiter = findHandCard(session, 1, "400");
    const opponentFollowup = findHandCard(session, 1, "600");
    expect(turnOpenQuick).toBeDefined();
    expect(turnBlocked).toBeDefined();
    expect(opponentFirst).toBeDefined();
    expect(opponentLimiter).toBeDefined();
    expect(opponentFollowup).toBeDefined();

    registerEffect(session, openOnlyQuick("restore-chain-until-turn-open-quick", turnOpenQuick!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-chain-until-turn-blocked", turnBlocked!.uid, 0));
    registerEffect(session, chainOnlyQuick("restore-chain-until-opponent-first", opponentFirst!.uid, 1, true));
    registerEffect(session, chainOnlyQuickWithOpponentUntilLimit("restore-chain-until-opponent-limiter", opponentLimiter!.uid, 1, true));
    registerEffect(session, chainOnlyQuick("restore-chain-until-opponent-followup", opponentFollowup!.uid, 1));

    const openQuick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-chain-until-turn-open-quick");
    expect(openQuick).toBeDefined();
    applyAndAssert(session, openQuick!);

    const opponentFirstAction = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-chain-until-opponent-first");
    expect(opponentFirstAction).toBeDefined();
    applyAndAssert(session, opponentFirstAction!);

    const turnBlockedAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-chain-until-turn-blocked");
    expect(turnBlockedAction).toBeDefined();
    const turnPass = getDuelLegalActions(session, 0).find((action) => action.type === "passChain");
    expect(turnPass).toBeDefined();
    const opponentHandoffWindow = applyAndAssert(session, turnPass!);
    expect(opponentHandoffWindow.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(session.state.chainPasses).toEqual([0]);
    expect(getDuelLegalActions(session, 0)).toEqual([]);
    expect(hasGroupedEffect(opponentHandoffWindow.legalActionGroups, 1, "restore-chain-until-opponent-limiter", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(opponentHandoffWindow.legalActionGroups, 1, "restore-chain-until-opponent-followup", "chainResponse")).toBe(true);

    const opponentLimiterAction = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-chain-until-opponent-limiter");
    expect(opponentLimiterAction).toBeDefined();
    const limitedWindow = applyAndAssert(session, opponentLimiterAction!);
    expect(limitedWindow.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(limitedWindow.state.chain.map((link) => link.effectId)).toEqual([
      "restore-chain-until-turn-open-quick",
      "restore-chain-until-opponent-first",
      "restore-chain-until-opponent-limiter",
    ]);
    expect(session.state.chainPasses).toEqual([]);
    expect(session.state.chainLimits.map(serializeChainLimitForAssert)).toEqual([
      { registryKey: RESPONSE_HANDOFF_OPPONENT_ONLY_UNTIL_CHAIN_END_LIMIT_KEY, untilChainEnd: true, expiresAtChainLength: undefined },
    ]);
    expect(getDuelLegalActions(session, 0)).toEqual([]);
    expect(hasGroupedEffect(limitedWindow.legalActionGroups, 1, "restore-chain-until-opponent-followup", "chainResponse")).toBe(true);
    expect(hasGroupedPass(limitedWindow.legalActionGroups, 1)).toBe(true);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry(), restoreChainLimitRegistry());
    expect(queryPublicState(restored)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(restored.state.chain.map((link) => link.effectId)).toEqual([
      "restore-chain-until-turn-open-quick",
      "restore-chain-until-opponent-first",
      "restore-chain-until-opponent-limiter",
    ]);
    expect(restored.state.chainLimits.map(serializeChainLimitForAssert)).toEqual([
      { registryKey: RESPONSE_HANDOFF_OPPONENT_ONLY_UNTIL_CHAIN_END_LIMIT_KEY, untilChainEnd: true, expiresAtChainLength: undefined },
    ]);
    expect(getDuelLegalActions(restored, 0)).toEqual([]);
    expect(getDuelLegalActions(restored, 1)).toEqual(getDuelLegalActions(session, 1));
    expect(getGroupedDuelLegalActions(restored, 1)).toEqual(getGroupedDuelLegalActions(session, 1));

    const staleTurnBlocked = applyResponse(restored, turnBlockedAction!);
    expect(staleTurnBlocked.ok).toBe(false);
    expect(staleTurnBlocked.error).toContain("Response is not currently legal");
    expect(staleTurnBlocked.legalActions).toEqual(getDuelLegalActions(restored, 1));
    expect(staleTurnBlocked.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 1));

    const opponentPass = getDuelLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(opponentPass).toBeDefined();
    const resolved = applyAndAssert(restored, opponentPass!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [] });
    expect(restored.state.chainPasses).toEqual([]);
    expect(restored.state.chainLimits).toEqual([]);
    expect(restored.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining([
      "restore-chain-until-opponent-limiter resolved",
      "restore-chain-until-opponent-first resolved",
      "restore-chain-until-turn-open-quick resolved",
    ]));
    expect(restored.state.log.map((entry) => entry.detail)).not.toContain("restore-chain-until-opponent-followup resolved");
    expect(restored.state.log.map((entry) => entry.detail)).not.toContain("restore-chain-until-turn-blocked resolved");
    expect(getDuelLegalActions(restored, 1)).toEqual([]);

    const restoredOpenWindow = restoreDuel(serializeDuel(restored), createCardReader(cards), restoreRegistry(), restoreChainLimitRegistry());
    expect(queryPublicState(restoredOpenWindow)).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredOpenWindow.state.chainLimits).toEqual([]);
    expect(getGroupedDuelLegalActions(restoredOpenWindow, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restoredOpenWindow, 0));
  });

  it("restores turn-player priority after the opponent chains from a returned chain-response handoff", () => {
    const session = createDuel({ seed: 253, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "700"] },
      1: { main: ["300", "500", "600"] },
    });
    startDuel(session);

    const turnOpenQuick = findHandCard(session, 0, "100");
    const turnChainQuick = findHandCard(session, 0, "200");
    const opponentFirst = findHandCard(session, 1, "300");
    const opponentSecond = findHandCard(session, 1, "500");
    const opponentOpenOnly = findHandCard(session, 1, "600");
    expect(turnOpenQuick).toBeDefined();
    expect(turnChainQuick).toBeDefined();
    expect(opponentFirst).toBeDefined();
    expect(opponentSecond).toBeDefined();
    expect(opponentOpenOnly).toBeDefined();

    registerEffect(session, openOnlyQuick("restore-chain-return-turn-open-quick", turnOpenQuick!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-chain-return-turn-chain-quick", turnChainQuick!.uid, 0, true));
    registerEffect(session, chainOnlyQuick("restore-chain-return-opponent-first-chain-quick", opponentFirst!.uid, 1, true));
    registerEffect(session, chainOnlyQuick("restore-chain-return-opponent-second-chain-quick", opponentSecond!.uid, 1, true));
    registerEffect(session, openOnlyQuick("restore-chain-return-opponent-open-quick", opponentOpenOnly!.uid, 1, true));

    const openQuick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.effectId === "restore-chain-return-turn-open-quick");
    expect(openQuick).toBeDefined();
    applyAndAssert(session, openQuick!);

    const opponentFirstAction = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-chain-return-opponent-first-chain-quick");
    expect(opponentFirstAction).toBeDefined();
    applyAndAssert(session, opponentFirstAction!);

    const turnPass = getDuelLegalActions(session, 0).find((action) => action.type === "passChain");
    expect(turnPass).toBeDefined();
    const opponentHandoffWindow = applyAndAssert(session, turnPass!);
    expect(opponentHandoffWindow.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
    expect(opponentHandoffWindow.state.chain.map((link) => link.effectId)).toEqual(["restore-chain-return-turn-open-quick", "restore-chain-return-opponent-first-chain-quick"]);
    expect(session.state.chainPasses).toEqual([0]);
    expect(getDuelLegalActions(session, 0)).toEqual([]);
    expect(hasGroupedEffect(opponentHandoffWindow.legalActionGroups, 1, "restore-chain-return-opponent-second-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedEffect(opponentHandoffWindow.legalActionGroups, 1, "restore-chain-return-opponent-open-quick", "chainResponse")).toBe(false);

    const opponentSecondAction = getDuelLegalActions(session, 1).find((action) => action.type === "activateEffect" && action.effectId === "restore-chain-return-opponent-second-chain-quick");
    expect(opponentSecondAction).toBeDefined();
    const turnReturnWindow = applyAndAssert(session, opponentSecondAction!);
    expect(turnReturnWindow.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(turnReturnWindow.state.chain.map((link) => link.effectId)).toEqual([
      "restore-chain-return-turn-open-quick",
      "restore-chain-return-opponent-first-chain-quick",
      "restore-chain-return-opponent-second-chain-quick",
    ]);
    expect(session.state.chainPasses).toEqual([]);
    expect(getDuelLegalActions(session, 1)).toEqual([]);
    expect(hasGroupedEffect(turnReturnWindow.legalActionGroups, 0, "restore-chain-return-turn-chain-quick", "chainResponse")).toBe(true);
    expect(hasGroupedPass(turnReturnWindow.legalActionGroups, 0)).toBe(true);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restored)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
    expect(restored.state.chain.map((link) => link.effectId)).toEqual([
      "restore-chain-return-turn-open-quick",
      "restore-chain-return-opponent-first-chain-quick",
      "restore-chain-return-opponent-second-chain-quick",
    ]);
    expect(restored.state.chainPasses).toEqual([]);
    expect(getDuelLegalActions(restored, 1)).toEqual([]);
    expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
    expect(getGroupedDuelLegalActions(restored, 0)).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(hasGroupedEffect(getGroupedDuelLegalActions(restored, 0), 0, "restore-chain-return-turn-chain-quick", "chainResponse")).toBe(true);

    const staleOpponentSecond = applyResponse(restored, opponentSecondAction!);
    expect(staleOpponentSecond.ok).toBe(false);
    expect(staleOpponentSecond.error).toContain("Response is not currently legal");
    expect(staleOpponentSecond.legalActions).toEqual(getDuelLegalActions(restored, 0));
    expect(staleOpponentSecond.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));

    const restoredTurnPass = getDuelLegalActions(restored, 0).find((action) => action.type === "passChain");
    expect(restoredTurnPass).toBeDefined();
    const resolved = applyAndAssert(restored, restoredTurnPass!);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [] });
    expect(restored.state.chainPasses).toEqual([]);
    expect(restored.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining([
      "restore-chain-return-opponent-second-chain-quick resolved",
      "restore-chain-return-opponent-first-chain-quick resolved",
      "restore-chain-return-turn-open-quick resolved",
    ]));
    expect(restored.state.log.map((entry) => entry.detail)).not.toContain("restore-chain-return-turn-chain-quick resolved");
    expect(getDuelLegalActions(restored, 1)).toEqual([]);

    const restoredOpenWindow = restoreDuel(serializeDuel(restored), createCardReader(cards), restoreRegistry());
    expect(queryPublicState(restoredOpenWindow)).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
    expect(restoredOpenWindow.state.chainPasses).toEqual([]);
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

function loggedEffect(id: string, sourceUid: string, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
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
    },
  };
}

function openOnlyQuick(id: string, sourceUid: string, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
  return {
    ...loggedEffect(id, sourceUid, controller, oncePerTurn),
    canActivate(ctx) {
      return ctx.duel.chain.length === 0;
    },
  };
}

function chainOnlyQuick(id: string, sourceUid: string, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
  return {
    ...loggedEffect(id, sourceUid, controller, oncePerTurn),
    canActivate(ctx) {
      return ctx.duel.chain.length > 0;
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

function chainOnlyQuickWithOpponentUntilLimit(id: string, sourceUid: string, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
  return {
    ...chainOnlyQuick(id, sourceUid, controller, oncePerTurn),
    target(ctx) {
      if (!ctx.checkOnly) addDuelChainLimit(ctx.duel, opponentOnlyUntilChainEndLimit());
      return true;
    },
  };
}

function restoreRegistry(): Record<string, (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition> {
  return {
    "restore-chain-handoff-turn-open-quick": restoreOpenOnlyQuick(true),
    "restore-chain-handoff-turn-chain-quick": restoreChainOnlyQuick(true),
    "restore-chain-handoff-opponent-first-chain-quick": restoreChainOnlyQuick(true),
    "restore-chain-handoff-opponent-second-chain-quick": restoreChainOnlyQuick(true),
    "restore-chain-handoff-opponent-open-quick": restoreOpenOnlyQuick(true),
    "restore-chain-limit-turn-open-quick": restoreOpenOnlyQuick(true),
    "restore-chain-limit-turn-blocked": restoreChainOnlyQuick(),
    "restore-chain-limit-opponent-first": restoreChainOnlyQuick(true),
    "restore-chain-limit-opponent-limiter": restoreChainOnlyQuickWithOpponentLimit(true),
    "restore-chain-limit-opponent-followup": restoreChainOnlyQuick(),
    "restore-chain-until-turn-open-quick": restoreOpenOnlyQuick(true),
    "restore-chain-until-turn-blocked": restoreChainOnlyQuick(),
    "restore-chain-until-opponent-first": restoreChainOnlyQuick(true),
    "restore-chain-until-opponent-limiter": restoreChainOnlyQuickWithOpponentUntilLimit(true),
    "restore-chain-until-opponent-followup": restoreChainOnlyQuick(),
    "restore-chain-return-turn-open-quick": restoreOpenOnlyQuick(true),
    "restore-chain-return-turn-chain-quick": restoreChainOnlyQuick(true),
    "restore-chain-return-opponent-first-chain-quick": restoreChainOnlyQuick(true),
    "restore-chain-return-opponent-second-chain-quick": restoreChainOnlyQuick(true),
    "restore-chain-return-opponent-open-quick": restoreOpenOnlyQuick(true),
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

function restoreChainOnlyQuickWithOpponentLimit(oncePerTurn = false): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...restoreChainOnlyQuick(oncePerTurn)(effect),
    target(ctx) {
      if (!ctx.checkOnly) addDuelChainLimit(ctx.duel, opponentOnlyChainLimit());
      return true;
    },
  });
}

function restoreChainOnlyQuickWithOpponentUntilLimit(oncePerTurn = false): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...restoreChainOnlyQuick(oncePerTurn)(effect),
    target(ctx) {
      if (!ctx.checkOnly) addDuelChainLimit(ctx.duel, opponentOnlyUntilChainEndLimit());
      return true;
    },
  });
}

function restoreChainLimitRegistry(): Record<string, (limit: ChainLimit) => ChainLimit> {
  return {
    [RESPONSE_HANDOFF_OPPONENT_ONLY_CHAIN_LIMIT_KEY]: restoreOpponentOnlyChainLimit,
    [RESPONSE_HANDOFF_OPPONENT_ONLY_UNTIL_CHAIN_END_LIMIT_KEY]: restoreOpponentOnlyChainLimit,
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

function opponentOnlyChainLimit(): Omit<ChainLimit, "expiresAtChainLength"> {
  return {
    registryKey: RESPONSE_HANDOFF_OPPONENT_ONLY_CHAIN_LIMIT_KEY,
    untilChainEnd: false,
    allows(_effect, player) {
      return player === 1;
    },
  };
}

function opponentOnlyUntilChainEndLimit(): Omit<ChainLimit, "expiresAtChainLength"> {
  return {
    registryKey: RESPONSE_HANDOFF_OPPONENT_ONLY_UNTIL_CHAIN_END_LIMIT_KEY,
    untilChainEnd: true,
    allows(_effect, player) {
      return player === 1;
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
