import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { addDuelChainLimit, applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { ChainLimit, DuelEffectDefinition, DuelLocation, DuelState } from "#duel/types.js";
import { cards } from "./full-duel-engine-fixtures.js";

const OPPONENT_ONLY_CHAIN_LIMIT_KEY = "restore-chain-ended-opponent-only";
const OPPONENT_ONLY_UNTIL_CHAIN_END_LIMIT_KEY = "restore-chain-ended-opponent-until-only";
const TURN_ONLY_CHAIN_LIMIT_KEY = "restore-chain-ended-turn-only";
const TURN_ONLY_UNTIL_CHAIN_END_LIMIT_KEY = "restore-chain-ended-turn-until-only";

const limitCases = [
  {
    name: "one-chain",
    prefix: "restore-chain-ended-limit",
    seed: 247,
    untilChainEnd: false,
    expectedLimit: { registryKey: OPPONENT_ONLY_CHAIN_LIMIT_KEY, untilChainEnd: false, expiresAtChainLength: 3 },
  },
  {
    name: "until-chain-end",
    prefix: "restore-chain-ended-until",
    seed: 246,
    untilChainEnd: true,
    expectedLimit: { registryKey: OPPONENT_ONLY_UNTIL_CHAIN_END_LIMIT_KEY, untilChainEnd: true, expiresAtChainLength: undefined },
  },
] as const;

const deepLimitCases = [
  {
    name: "one-chain",
    prefix: "restore-chain-ended-deep-limit",
    seed: 249,
    untilChainEnd: false,
    expectedLimit: { registryKey: TURN_ONLY_CHAIN_LIMIT_KEY, untilChainEnd: false, expiresAtChainLength: 5 },
  },
  {
    name: "until-chain-end",
    prefix: "restore-chain-ended-deep-until",
    seed: 248,
    untilChainEnd: true,
    expectedLimit: { registryKey: TURN_ONLY_UNTIL_CHAIN_END_LIMIT_KEY, untilChainEnd: true, expiresAtChainLength: undefined },
  },
] as const;

describe("chain-ended open fast handoff chain-limit restore", () => {
  for (const testCase of limitCases) {
    it(`restores post-chainEnded opponent ${testCase.name} response limits`, () => {
      const session = createDuel({ seed: testCase.seed, startingHandSize: 5, cardReader: createCardReader(cards) });
      loadDecks(session, {
        0: { main: ["100", "300", "400", "500", "700"] },
        1: { main: ["600", "700"] },
      });
      startDuel(session);

      const starter = findHandCard(session, 0, "100");
      const cleanup = findHandCard(session, 0, "300");
      const openQuick = findHandCard(session, 0, "400");
      const turnChain = findHandCard(session, 0, "500");
      const turnBlocked = findHandCard(session, 0, "700");
      const opponentLimiter = findHandCard(session, 1, "600");
      const opponentFollowup = findHandCard(session, 1, "700");
      expect(starter).toBeDefined();
      expect(cleanup).toBeDefined();
      expect(openQuick).toBeDefined();
      expect(turnChain).toBeDefined();
      expect(turnBlocked).toBeDefined();
      expect(opponentLimiter).toBeDefined();
      expect(opponentFollowup).toBeDefined();
      moveDuelCard(session.state, turnChain!.uid, "graveyard", 0);
      moveDuelCard(session.state, turnBlocked!.uid, "graveyard", 0);
      moveDuelCard(session.state, opponentLimiter!.uid, "graveyard", 1);
      moveDuelCard(session.state, opponentFollowup!.uid, "graveyard", 1);

      registerEffect(session, loggedEffect(`${testCase.prefix}-starter`, starter!.uid, 0, "ignition"));
      registerEffect(session, cleanupTrigger(`${testCase.prefix}-cleanup`, cleanup!.uid));
      registerEffect(session, openOnlyQuick(`${testCase.prefix}-open`, openQuick!.uid, 0, true));
      registerEffect(session, chainOnlyQuick(`${testCase.prefix}-turn-chain`, turnChain!.uid, 0, true));
      registerEffect(session, chainOnlyQuick(`${testCase.prefix}-turn-blocked`, turnBlocked!.uid, 0));
      registerEffect(session, chainOnlyQuickWithOpponentLimit(`${testCase.prefix}-opponent-limiter`, opponentLimiter!.uid, testCase.untilChainEnd, 1, true));
      registerEffect(session, chainOnlyQuick(`${testCase.prefix}-opponent-followup`, opponentFollowup!.uid, 1));

      const starterAction = findEffectAction(session, 0, `${testCase.prefix}-starter`);
      expect(starterAction).toBeDefined();
      applyAndAssert(session, starterAction!);

      const cleanupAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === `${testCase.prefix}-cleanup`);
      expect(cleanupAction).toBeDefined();
      applyAndAssert(session, cleanupAction!);

      const openAction = findEffectAction(session, 0, `${testCase.prefix}-open`);
      expect(openAction).toBeDefined();
      applyAndAssert(session, openAction!);

      const opponentPass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
      expect(opponentPass).toBeDefined();
      applyAndAssert(session, opponentPass!);

      const turnChainAction = findEffectAction(session, 0, `${testCase.prefix}-turn-chain`);
      expect(turnChainAction).toBeDefined();
      const opponentWindow = applyAndAssert(session, turnChainAction!);
      expect(opponentWindow.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
      expect(opponentWindow.state.chain.map((link) => link.effectId)).toEqual([`${testCase.prefix}-open`, `${testCase.prefix}-turn-chain`]);
      expect(hasGroupedEffect(opponentWindow.legalActionGroups, 1, `${testCase.prefix}-opponent-limiter`)).toBe(true);
      expect(hasGroupedEffect(opponentWindow.legalActionGroups, 1, `${testCase.prefix}-opponent-followup`)).toBe(true);

      const opponentLimiterAction = findEffectAction(session, 1, `${testCase.prefix}-opponent-limiter`);
      expect(opponentLimiterAction).toBeDefined();
      const limitedWindow = applyAndAssert(session, opponentLimiterAction!);
      expect(limitedWindow.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
      expect(limitedWindow.state.chain.map((link) => link.effectId)).toEqual([
        `${testCase.prefix}-open`,
        `${testCase.prefix}-turn-chain`,
        `${testCase.prefix}-opponent-limiter`,
      ]);
      expect(session.state.chainPasses).toEqual([]);
      expect(session.state.chainLimits.map(serializeChainLimitForAssert)).toEqual([testCase.expectedLimit]);
      expect(getDuelLegalActions(session, 0)).toEqual([]);
      expect(hasGroupedEffect(limitedWindow.legalActionGroups, 1, `${testCase.prefix}-opponent-followup`)).toBe(true);
      expect(hasGroupedEffect(limitedWindow.legalActionGroups, 0, `${testCase.prefix}-turn-blocked`)).toBe(false);
      expect(hasGroupedPass(limitedWindow.legalActionGroups, 1)).toBe(true);

      const restored = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry(testCase.prefix, testCase.untilChainEnd), restoreChainLimitRegistry());
      expect(queryPublicState(restored)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
      expect(restored.state.chainLimits.map(serializeChainLimitForAssert)).toEqual([testCase.expectedLimit]);
      expect(getDuelLegalActions(restored, 0)).toEqual([]);
      expect(getDuelLegalActions(restored, 1)).toEqual(getDuelLegalActions(session, 1));
      expect(getGroupedDuelLegalActions(restored, 1)).toEqual(getGroupedDuelLegalActions(session, 1));

      const staleTurnChain = applyResponse(restored, turnChainAction!);
      expect(staleTurnChain.ok).toBe(false);
      expect(staleTurnChain.error).toContain("Response is not currently legal");
      expect(staleTurnChain.legalActions).toEqual(getDuelLegalActions(restored, 1));
      expect(staleTurnChain.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 1));

      const opponentFollowupAction = findEffectAction(restored, 1, `${testCase.prefix}-opponent-followup`);
      expect(opponentFollowupAction).toBeDefined();
      const forgedTurnBlocked = applyResponse(restored, {
        type: "activateEffect",
        player: 0,
        uid: turnBlocked!.uid,
        effectId: `${testCase.prefix}-turn-blocked`,
        label: "Forge turn-player response into restored opponent-only limit",
        windowId: opponentFollowupAction!.windowId,
        windowKind: opponentFollowupAction!.windowKind,
        windowToken: opponentFollowupAction!.windowToken,
      });
      expect(forgedTurnBlocked.ok).toBe(false);
      expect(forgedTurnBlocked.error).toContain("Response is not currently legal");
      expect(forgedTurnBlocked.legalActions).toEqual(getDuelLegalActions(restored, 1));
      expect(forgedTurnBlocked.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 1));
      expect(restored.state.log.map((entry) => entry.detail)).not.toContain(`${testCase.prefix}-turn-blocked resolved`);

      const restoredOpponentPass = getDuelLegalActions(restored, 1).find((action) => action.type === "passChain");
      expect(restoredOpponentPass).toBeDefined();
      const resolved = applyAndAssert(restored, restoredOpponentPass!);
      expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [] });
      expect(restored.state.chainPasses).toEqual([]);
      expect(restored.state.chainLimits).toEqual([]);
      expect(restored.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining([
        `${testCase.prefix}-opponent-limiter resolved`,
        `${testCase.prefix}-turn-chain resolved`,
        `${testCase.prefix}-open resolved`,
        `${testCase.prefix}-cleanup resolved`,
        `${testCase.prefix}-starter resolved`,
      ]));
      expect(restored.state.log.map((entry) => entry.detail)).not.toContain(`${testCase.prefix}-opponent-followup resolved`);
      expect(restored.state.log.map((entry) => entry.detail)).not.toContain(`${testCase.prefix}-turn-blocked resolved`);

      const restoredOpen = restoreDuel(serializeDuel(restored), createCardReader(cards), restoreRegistry(testCase.prefix, testCase.untilChainEnd), restoreChainLimitRegistry());
      expect(queryPublicState(restoredOpen)).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
      expect(restoredOpen.state.chainLimits).toEqual([]);
      expect(getGroupedDuelLegalActions(restoredOpen, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restoredOpen, 0));
    });
  }

  for (const testCase of deepLimitCases) {
    it(`restores post-chainEnded returned turn-player ${testCase.name} response limits`, () => {
      const session = createDuel({ seed: testCase.seed, startingHandSize: 6, cardReader: createCardReader(cards) });
      loadDecks(session, {
        0: { main: ["100", "300", "400", "500", "700", "900"] },
        1: { main: ["600", "700", "400"] },
      });
      startDuel(session);

      const starter = findHandCard(session, 0, "100");
      const cleanup = findHandCard(session, 0, "300");
      const openQuick = findHandCard(session, 0, "400");
      const firstTurnChain = findHandCard(session, 0, "500");
      const secondTurnChain = findHandCard(session, 0, "700");
      const turnFollowup = findHandCard(session, 0, "900");
      const opponentFirst = findHandCard(session, 1, "600");
      const opponentLimiter = findHandCard(session, 1, "700");
      const opponentFollowup = findHandCard(session, 1, "400");
      expect(starter).toBeDefined();
      expect(cleanup).toBeDefined();
      expect(openQuick).toBeDefined();
      expect(firstTurnChain).toBeDefined();
      expect(secondTurnChain).toBeDefined();
      expect(turnFollowup).toBeDefined();
      expect(opponentFirst).toBeDefined();
      expect(opponentLimiter).toBeDefined();
      expect(opponentFollowup).toBeDefined();
      moveDuelCard(session.state, firstTurnChain!.uid, "graveyard", 0);
      moveDuelCard(session.state, secondTurnChain!.uid, "graveyard", 0);
      moveDuelCard(session.state, turnFollowup!.uid, "graveyard", 0);
      moveDuelCard(session.state, opponentFirst!.uid, "graveyard", 1);
      moveDuelCard(session.state, opponentLimiter!.uid, "graveyard", 1);
      moveDuelCard(session.state, opponentFollowup!.uid, "graveyard", 1);

      registerEffect(session, loggedEffect(`${testCase.prefix}-starter`, starter!.uid, 0, "ignition"));
      registerEffect(session, cleanupTrigger(`${testCase.prefix}-cleanup`, cleanup!.uid));
      registerEffect(session, openOnlyQuick(`${testCase.prefix}-open`, openQuick!.uid, 0, true));
      registerEffect(session, chainOnlyQuick(`${testCase.prefix}-first-turn`, firstTurnChain!.uid, 0, true));
      registerEffect(session, chainOnlyQuick(`${testCase.prefix}-second-turn`, secondTurnChain!.uid, 0, true));
      registerEffect(session, chainOnlyQuick(`${testCase.prefix}-turn-followup`, turnFollowup!.uid, 0));
      registerEffect(session, chainOnlyQuick(`${testCase.prefix}-opponent-first`, opponentFirst!.uid, 1, true));
      registerEffect(session, chainOnlyQuickWithTurnLimit(`${testCase.prefix}-opponent-turn-limiter`, opponentLimiter!.uid, testCase.untilChainEnd, 1, true));
      registerEffect(session, chainOnlyQuick(`${testCase.prefix}-opponent-followup`, opponentFollowup!.uid, 1));

      const starterAction = findEffectAction(session, 0, `${testCase.prefix}-starter`);
      expect(starterAction).toBeDefined();
      applyAndAssert(session, starterAction!);

      const cleanupAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === `${testCase.prefix}-cleanup`);
      expect(cleanupAction).toBeDefined();
      applyAndAssert(session, cleanupAction!);

      const openAction = findEffectAction(session, 0, `${testCase.prefix}-open`);
      expect(openAction).toBeDefined();
      applyAndAssert(session, openAction!);

      const opponentPass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
      expect(opponentPass).toBeDefined();
      applyAndAssert(session, opponentPass!);

      const firstTurnAction = findEffectAction(session, 0, `${testCase.prefix}-first-turn`);
      expect(firstTurnAction).toBeDefined();
      applyAndAssert(session, firstTurnAction!);

      const opponentFirstAction = findEffectAction(session, 1, `${testCase.prefix}-opponent-first`);
      expect(opponentFirstAction).toBeDefined();
      const returnedTurnWindow = applyAndAssert(session, opponentFirstAction!);
      expect(returnedTurnWindow.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
      expect(returnedTurnWindow.state.chain.map((link) => link.effectId)).toEqual([
        `${testCase.prefix}-open`,
        `${testCase.prefix}-first-turn`,
        `${testCase.prefix}-opponent-first`,
      ]);
      expect(hasGroupedEffect(returnedTurnWindow.legalActionGroups, 0, `${testCase.prefix}-second-turn`)).toBe(true);
      expect(hasGroupedEffect(returnedTurnWindow.legalActionGroups, 0, `${testCase.prefix}-turn-followup`)).toBe(true);
      expect(getDuelLegalActions(session, 1)).toEqual([]);

      const secondTurnAction = findEffectAction(session, 0, `${testCase.prefix}-second-turn`);
      expect(secondTurnAction).toBeDefined();
      const opponentReturnWindow = applyAndAssert(session, secondTurnAction!);
      expect(opponentReturnWindow.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
      expect(opponentReturnWindow.state.chain.map((link) => link.effectId)).toEqual([
        `${testCase.prefix}-open`,
        `${testCase.prefix}-first-turn`,
        `${testCase.prefix}-opponent-first`,
        `${testCase.prefix}-second-turn`,
      ]);
      expect(hasGroupedEffect(opponentReturnWindow.legalActionGroups, 1, `${testCase.prefix}-opponent-turn-limiter`)).toBe(true);
      expect(getDuelLegalActions(session, 0)).toEqual([]);

      const opponentLimiterAction = findEffectAction(session, 1, `${testCase.prefix}-opponent-turn-limiter`);
      expect(opponentLimiterAction).toBeDefined();
      const limitedWindow = applyAndAssert(session, opponentLimiterAction!);
      expect(limitedWindow.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
      expect(limitedWindow.state.chain.map((link) => link.effectId)).toEqual([
        `${testCase.prefix}-open`,
        `${testCase.prefix}-first-turn`,
        `${testCase.prefix}-opponent-first`,
        `${testCase.prefix}-second-turn`,
        `${testCase.prefix}-opponent-turn-limiter`,
      ]);
      expect(session.state.chainPasses).toEqual([]);
      expect(session.state.chainLimits.map(serializeChainLimitForAssert)).toEqual([testCase.expectedLimit]);
      expect(getDuelLegalActions(session, 1)).toEqual([]);
      expect(hasGroupedEffect(limitedWindow.legalActionGroups, 0, `${testCase.prefix}-turn-followup`)).toBe(true);
      expect(hasGroupedPass(limitedWindow.legalActionGroups, 0)).toBe(true);

      const restored = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry(testCase.prefix, testCase.untilChainEnd), restoreChainLimitRegistry());
      expect(queryPublicState(restored)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
      expect(restored.state.chainLimits.map(serializeChainLimitForAssert)).toEqual([testCase.expectedLimit]);
      expect(getDuelLegalActions(restored, 1)).toEqual([]);
      expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
      expect(getGroupedDuelLegalActions(restored, 0)).toEqual(getGroupedDuelLegalActions(session, 0));

      const staleOpponentLimiter = applyResponse(restored, opponentLimiterAction!);
      expect(staleOpponentLimiter.ok).toBe(false);
      expect(staleOpponentLimiter.error).toContain("Response is not currently legal");
      expect(staleOpponentLimiter.legalActions).toEqual(getDuelLegalActions(restored, 0));
      expect(staleOpponentLimiter.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));

      const turnFollowupAction = findEffectAction(restored, 0, `${testCase.prefix}-turn-followup`);
      expect(turnFollowupAction).toBeDefined();
      const forgedOpponentFollowup = applyResponse(restored, {
        type: "activateEffect",
        player: 1,
        uid: opponentFollowup!.uid,
        effectId: `${testCase.prefix}-opponent-followup`,
        label: "Forge opponent response into restored turn-only limit",
        windowId: turnFollowupAction!.windowId,
        windowKind: turnFollowupAction!.windowKind,
        windowToken: turnFollowupAction!.windowToken,
      });
      expect(forgedOpponentFollowup.ok).toBe(false);
      expect(forgedOpponentFollowup.error).toContain("Response is not currently legal");
      expect(forgedOpponentFollowup.legalActions).toEqual(getDuelLegalActions(restored, 0));
      expect(forgedOpponentFollowup.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
      expect(restored.state.log.map((entry) => entry.detail)).not.toContain(`${testCase.prefix}-opponent-followup resolved`);

      const restoredTurnPass = getDuelLegalActions(restored, 0).find((action) => action.type === "passChain");
      expect(restoredTurnPass).toBeDefined();
      const resolved = applyAndAssert(restored, restoredTurnPass!);
      expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [] });
      expect(restored.state.chainPasses).toEqual([]);
      expect(restored.state.chainLimits).toEqual([]);
      expect(restored.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining([
        `${testCase.prefix}-opponent-turn-limiter resolved`,
        `${testCase.prefix}-second-turn resolved`,
        `${testCase.prefix}-opponent-first resolved`,
        `${testCase.prefix}-first-turn resolved`,
        `${testCase.prefix}-open resolved`,
        `${testCase.prefix}-cleanup resolved`,
        `${testCase.prefix}-starter resolved`,
      ]));
      expect(restored.state.log.map((entry) => entry.detail)).not.toContain(`${testCase.prefix}-turn-followup resolved`);

      const restoredOpen = restoreDuel(serializeDuel(restored), createCardReader(cards), restoreRegistry(testCase.prefix, testCase.untilChainEnd), restoreChainLimitRegistry());
      expect(queryPublicState(restoredOpen)).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
      expect(restoredOpen.state.chainLimits).toEqual([]);
      expect(getGroupedDuelLegalActions(restoredOpen, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restoredOpen, 0));
    });

    it(`restores post-chainEnded continued ${testCase.name} follow-up windows`, () => {
      const session = createDuel({ seed: testCase.seed + 20, startingHandSize: 7, cardReader: createCardReader(cards) });
      loadDecks(session, {
        0: { main: ["100", "300", "400", "500", "700", "900", "950"] },
        1: { main: ["600", "700", "400"] },
      });
      startDuel(session);

      const starter = findHandCard(session, 0, "100");
      const cleanup = findHandCard(session, 0, "300");
      const openQuick = findHandCard(session, 0, "400");
      const firstTurnChain = findHandCard(session, 0, "500");
      const secondTurnChain = findHandCard(session, 0, "700");
      const turnFollowup = findHandCard(session, 0, "900");
      const finalTurn = findHandCard(session, 0, "950");
      const opponentFirst = findHandCard(session, 1, "600");
      const opponentLimiter = findHandCard(session, 1, "700");
      const opponentFollowup = findHandCard(session, 1, "400");
      expect(starter).toBeDefined();
      expect(cleanup).toBeDefined();
      expect(openQuick).toBeDefined();
      expect(firstTurnChain).toBeDefined();
      expect(secondTurnChain).toBeDefined();
      expect(turnFollowup).toBeDefined();
      expect(finalTurn).toBeDefined();
      expect(opponentFirst).toBeDefined();
      expect(opponentLimiter).toBeDefined();
      expect(opponentFollowup).toBeDefined();
      moveDuelCard(session.state, firstTurnChain!.uid, "graveyard", 0);
      moveDuelCard(session.state, secondTurnChain!.uid, "graveyard", 0);
      moveDuelCard(session.state, turnFollowup!.uid, "graveyard", 0);
      moveDuelCard(session.state, finalTurn!.uid, "graveyard", 0);
      moveDuelCard(session.state, opponentFirst!.uid, "graveyard", 1);
      moveDuelCard(session.state, opponentLimiter!.uid, "graveyard", 1);
      moveDuelCard(session.state, opponentFollowup!.uid, "graveyard", 1);

      registerEffect(session, loggedEffect(`${testCase.prefix}-starter`, starter!.uid, 0, "ignition"));
      registerEffect(session, cleanupTrigger(`${testCase.prefix}-cleanup`, cleanup!.uid));
      registerEffect(session, openOnlyQuick(`${testCase.prefix}-open`, openQuick!.uid, 0, true));
      registerEffect(session, chainOnlyQuick(`${testCase.prefix}-first-turn`, firstTurnChain!.uid, 0, true));
      registerEffect(session, chainOnlyQuick(`${testCase.prefix}-second-turn`, secondTurnChain!.uid, 0, true));
      registerEffect(session, chainOnlyQuick(`${testCase.prefix}-turn-followup`, turnFollowup!.uid, 0, true));
      registerEffect(session, chainOnlyQuick(`${testCase.prefix}-final-turn`, finalTurn!.uid, 0, true));
      registerEffect(session, chainOnlyQuick(`${testCase.prefix}-opponent-first`, opponentFirst!.uid, 1, true));
      registerEffect(session, chainOnlyQuickWithTurnLimit(`${testCase.prefix}-opponent-turn-limiter`, opponentLimiter!.uid, testCase.untilChainEnd, 1, true));
      registerEffect(session, chainOnlyQuick(`${testCase.prefix}-opponent-followup`, opponentFollowup!.uid, 1, true));

      applyAndAssert(session, findEffectAction(session, 0, `${testCase.prefix}-starter`)!);
      applyAndAssert(session, getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === `${testCase.prefix}-cleanup`)!);
      applyAndAssert(session, findEffectAction(session, 0, `${testCase.prefix}-open`)!);
      applyAndAssert(session, getDuelLegalActions(session, 1).find((action) => action.type === "passChain")!);
      applyAndAssert(session, findEffectAction(session, 0, `${testCase.prefix}-first-turn`)!);
      applyAndAssert(session, findEffectAction(session, 1, `${testCase.prefix}-opponent-first`)!);
      applyAndAssert(session, findEffectAction(session, 0, `${testCase.prefix}-second-turn`)!);
      const staleOpponentFollowup = findEffectAction(session, 1, `${testCase.prefix}-opponent-followup`);
      expect(staleOpponentFollowup).toBeDefined();
      applyAndAssert(session, findEffectAction(session, 1, `${testCase.prefix}-opponent-turn-limiter`)!);

      const turnFollowupAction = findEffectAction(session, 0, `${testCase.prefix}-turn-followup`);
      expect(turnFollowupAction).toBeDefined();
      const continuedWindow = applyAndAssert(session, turnFollowupAction!);
      expect(continuedWindow.state.chain.map((link) => link.effectId)).toEqual([
        `${testCase.prefix}-open`,
        `${testCase.prefix}-first-turn`,
        `${testCase.prefix}-opponent-first`,
        `${testCase.prefix}-second-turn`,
        `${testCase.prefix}-opponent-turn-limiter`,
        `${testCase.prefix}-turn-followup`,
      ]);

      const restored = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry(testCase.prefix, testCase.untilChainEnd), restoreChainLimitRegistry());
      expect(restored.state.chain.map((link) => link.effectId)).toEqual(continuedWindow.state.chain.map((link) => link.effectId));

      if (testCase.untilChainEnd) {
        expect(queryPublicState(restored)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
        expect(restored.state.chainLimits.map(serializeChainLimitForAssert)).toEqual([testCase.expectedLimit]);
        expect(getDuelLegalActions(restored, 1)).toEqual([]);
        expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
        expect(hasGroupedEffect(getGroupedDuelLegalActions(restored, 0), 0, `${testCase.prefix}-final-turn`)).toBe(true);

        const finalTurnAction = findEffectAction(restored, 0, `${testCase.prefix}-final-turn`);
        expect(finalTurnAction).toBeDefined();
        const finalResolution = restoreDuel(serializeDuel(restored), createCardReader(cards), restoreRegistry(testCase.prefix, testCase.untilChainEnd), restoreChainLimitRegistry());
        const finalResolved = applyAndAssert(finalResolution, finalTurnAction!);
        expect(finalResolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [] });
        expect(finalResolution.state.chainLimits).toEqual([]);
        expect(finalResolution.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining([
          `${testCase.prefix}-final-turn resolved`,
          `${testCase.prefix}-turn-followup resolved`,
          `${testCase.prefix}-opponent-turn-limiter resolved`,
        ]));
        expect(finalResolution.state.log.map((entry) => entry.detail)).not.toContain(`${testCase.prefix}-opponent-followup resolved`);

        const staleOpponent = applyResponse(restored, staleOpponentFollowup!);
        expect(staleOpponent.ok).toBe(false);
        expect(staleOpponent.error).toContain("Response is not currently legal");
        expect(staleOpponent.legalActions).toEqual(getDuelLegalActions(restored, 0));

        const restoredTurnPass = getDuelLegalActions(restored, 0).find((action) => action.type === "passChain");
        expect(restoredTurnPass).toBeDefined();
        const resolved = applyAndAssert(restored, restoredTurnPass!);
        expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [] });
        expect(restored.state.chainLimits).toEqual([]);
        expect(restored.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining([
          `${testCase.prefix}-turn-followup resolved`,
          `${testCase.prefix}-opponent-turn-limiter resolved`,
          `${testCase.prefix}-second-turn resolved`,
        ]));
        expect(restored.state.log.map((entry) => entry.detail)).not.toContain(`${testCase.prefix}-final-turn resolved`);
        expect(restored.state.log.map((entry) => entry.detail)).not.toContain(`${testCase.prefix}-opponent-followup resolved`);
      } else {
        expect(queryPublicState(restored)).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });
        expect(restored.state.chainLimits).toEqual([]);
        expect(getDuelLegalActions(restored, 0)).toEqual([]);
        expect(getDuelLegalActions(restored, 1)).toEqual(getDuelLegalActions(session, 1));
        expect(hasGroupedEffect(getGroupedDuelLegalActions(restored, 1), 1, `${testCase.prefix}-opponent-followup`)).toBe(true);

        const staleTurnFollowup = applyResponse(restored, turnFollowupAction!);
        expect(staleTurnFollowup.ok).toBe(false);
        expect(staleTurnFollowup.error).toContain("Response is not currently legal");
        expect(staleTurnFollowup.legalActions).toEqual(getDuelLegalActions(restored, 1));

        const opponentFollowupAction = findEffectAction(restored, 1, `${testCase.prefix}-opponent-followup`);
        expect(opponentFollowupAction).toBeDefined();
        applyAndAssert(restored, opponentFollowupAction!);
        const restoredTurnReturn = restoreDuel(serializeDuel(restored), createCardReader(cards), restoreRegistry(testCase.prefix, testCase.untilChainEnd), restoreChainLimitRegistry());
        expect(queryPublicState(restoredTurnReturn)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
        expect(restoredTurnReturn.state.chainLimits).toEqual([]);
        expect(getDuelLegalActions(restoredTurnReturn, 1)).toEqual([]);
        expect(hasGroupedEffect(getGroupedDuelLegalActions(restoredTurnReturn, 0), 0, `${testCase.prefix}-final-turn`)).toBe(true);

        const finalTurnAction = findEffectAction(restoredTurnReturn, 0, `${testCase.prefix}-final-turn`);
        expect(finalTurnAction).toBeDefined();
        const finalResolution = restoreDuel(serializeDuel(restoredTurnReturn), createCardReader(cards), restoreRegistry(testCase.prefix, testCase.untilChainEnd), restoreChainLimitRegistry());
        const finalResolved = applyAndAssert(finalResolution, finalTurnAction!);
        expect(finalResolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [] });
        expect(finalResolution.state.chainLimits).toEqual([]);
        expect(finalResolution.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining([
          `${testCase.prefix}-final-turn resolved`,
          `${testCase.prefix}-opponent-followup resolved`,
          `${testCase.prefix}-turn-followup resolved`,
        ]));

        const restoredTurnPass = getDuelLegalActions(restoredTurnReturn, 0).find((action) => action.type === "passChain");
        expect(restoredTurnPass).toBeDefined();
        const resolved = applyAndAssert(restoredTurnReturn, restoredTurnPass!);
        expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [] });
        expect(restoredTurnReturn.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining([
          `${testCase.prefix}-opponent-followup resolved`,
          `${testCase.prefix}-turn-followup resolved`,
          `${testCase.prefix}-opponent-turn-limiter resolved`,
        ]));
        expect(restoredTurnReturn.state.log.map((entry) => entry.detail)).not.toContain(`${testCase.prefix}-final-turn resolved`);
      }
    });
  }
});

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function findEffectAction(session: ReturnType<typeof createDuel>, player: 0 | 1, effectId: string) {
  return getDuelLegalActions(session, player).find((action) => action.type === "activateEffect" && action.effectId === effectId);
}

function findHandCard(session: ReturnType<typeof createDuel>, controller: 0 | 1, code: string) {
  return queryPublicState(session).cards.find((card) => card.controller === controller && card.location === "hand" && card.code === code);
}

function loggedEffect(id: string, sourceUid: string, controller: 0 | 1, event: "ignition" | "quick" | "trigger", triggerEvent?: DuelEffectDefinition["triggerEvent"]): DuelEffectDefinition {
  return {
    id,
    registryKey: id,
    sourceUid,
    controller,
    event,
    ...(triggerEvent === undefined ? {} : { triggerEvent }),
    range: ["hand"],
    operation(ctx) {
      ctx.log(`${id} resolved`);
    },
  };
}

function cleanupTrigger(id: string, sourceUid: string): DuelEffectDefinition {
  return {
    ...loggedEffect(id, sourceUid, 0, "trigger", "chainEnded"),
    optional: false,
    oncePerTurn: true,
    operation(ctx) {
      moveFirstCard(ctx.duel, 0, "500", "graveyard", "hand");
      moveFirstCard(ctx.duel, 0, "700", "graveyard", "hand");
      moveFirstCard(ctx.duel, 0, "900", "graveyard", "hand");
      moveFirstCard(ctx.duel, 0, "950", "graveyard", "hand");
      moveFirstCard(ctx.duel, 1, "400", "graveyard", "hand");
      moveFirstCard(ctx.duel, 1, "600", "graveyard", "hand");
      moveFirstCard(ctx.duel, 1, "700", "graveyard", "hand");
      ctx.log(`${id} resolved`);
    },
  };
}

function openOnlyQuick(id: string, sourceUid: string, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
  return {
    ...loggedEffect(id, sourceUid, controller, "quick"),
    ...(oncePerTurn ? { oncePerTurn: true } : {}),
    canActivate(ctx) {
      return ctx.duel.chain.length === 0;
    },
  };
}

function chainOnlyQuick(id: string, sourceUid: string, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
  return {
    ...loggedEffect(id, sourceUid, controller, "quick"),
    ...(oncePerTurn ? { oncePerTurn: true } : {}),
    canActivate(ctx) {
      return ctx.duel.chain.length > 0;
    },
  };
}

function chainOnlyQuickWithOpponentLimit(id: string, sourceUid: string, untilChainEnd: boolean, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
  return {
    ...chainOnlyQuick(id, sourceUid, controller, oncePerTurn),
    target(ctx) {
      if (!ctx.checkOnly) addDuelChainLimit(ctx.duel, opponentOnlyChainLimit(untilChainEnd));
      return true;
    },
  };
}

function chainOnlyQuickWithTurnLimit(id: string, sourceUid: string, untilChainEnd: boolean, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
  return {
    ...chainOnlyQuick(id, sourceUid, controller, oncePerTurn),
    target(ctx) {
      if (!ctx.checkOnly) addDuelChainLimit(ctx.duel, turnOnlyChainLimit(untilChainEnd));
      return true;
    },
  };
}

function restoreRegistry(prefix: string, untilChainEnd: boolean): Record<string, (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition> {
  return {
    [`${prefix}-starter`]: restoreLoggedEffect(),
    [`${prefix}-cleanup`]: restoreCleanupTrigger,
    [`${prefix}-open`]: restoreOpenOnlyQuick,
    [`${prefix}-first-turn`]: restoreChainOnlyQuick,
    [`${prefix}-second-turn`]: restoreChainOnlyQuick,
    [`${prefix}-final-turn`]: restoreChainOnlyQuick,
    [`${prefix}-turn-chain`]: restoreChainOnlyQuick,
    [`${prefix}-turn-blocked`]: restoreChainOnlyQuick,
    [`${prefix}-turn-followup`]: restoreChainOnlyQuick,
    [`${prefix}-opponent-first`]: restoreChainOnlyQuick,
    [`${prefix}-opponent-limiter`]: restoreChainOnlyQuickWithOpponentLimit(untilChainEnd),
    [`${prefix}-opponent-turn-limiter`]: restoreChainOnlyQuickWithTurnLimit(untilChainEnd),
    [`${prefix}-opponent-followup`]: restoreChainOnlyQuick,
  };
}

function restoreLoggedEffect(): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...effect,
    operation(ctx) {
      ctx.log(`${effect.id} resolved`);
    },
  });
}

function restoreCleanupTrigger(effect: Omit<DuelEffectDefinition, "operation">): DuelEffectDefinition {
  return {
    ...effect,
    operation(ctx) {
      moveFirstCard(ctx.duel, 0, "500", "graveyard", "hand");
      moveFirstCard(ctx.duel, 0, "700", "graveyard", "hand");
      moveFirstCard(ctx.duel, 0, "900", "graveyard", "hand");
      moveFirstCard(ctx.duel, 0, "950", "graveyard", "hand");
      moveFirstCard(ctx.duel, 1, "400", "graveyard", "hand");
      moveFirstCard(ctx.duel, 1, "600", "graveyard", "hand");
      moveFirstCard(ctx.duel, 1, "700", "graveyard", "hand");
      ctx.log(`${effect.id} resolved`);
    },
  };
}

function restoreOpenOnlyQuick(effect: Omit<DuelEffectDefinition, "operation">): DuelEffectDefinition {
  return {
    ...restoreLoggedEffect()(effect),
    canActivate(ctx) {
      return ctx.duel.chain.length === 0;
    },
  };
}

function restoreChainOnlyQuick(effect: Omit<DuelEffectDefinition, "operation">): DuelEffectDefinition {
  return {
    ...restoreLoggedEffect()(effect),
    canActivate(ctx) {
      return ctx.duel.chain.length > 0;
    },
  };
}

function restoreChainOnlyQuickWithOpponentLimit(untilChainEnd: boolean): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...restoreChainOnlyQuick(effect),
    target(ctx) {
      if (!ctx.checkOnly) addDuelChainLimit(ctx.duel, opponentOnlyChainLimit(untilChainEnd));
      return true;
    },
  });
}

function restoreChainOnlyQuickWithTurnLimit(untilChainEnd: boolean): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...restoreChainOnlyQuick(effect),
    target(ctx) {
      if (!ctx.checkOnly) addDuelChainLimit(ctx.duel, turnOnlyChainLimit(untilChainEnd));
      return true;
    },
  });
}

function restoreChainLimitRegistry(): Record<string, (limit: ChainLimit) => ChainLimit> {
  return {
    [OPPONENT_ONLY_CHAIN_LIMIT_KEY]: restoreOpponentOnlyChainLimit,
    [OPPONENT_ONLY_UNTIL_CHAIN_END_LIMIT_KEY]: restoreOpponentOnlyChainLimit,
    [TURN_ONLY_CHAIN_LIMIT_KEY]: restoreTurnOnlyChainLimit,
    [TURN_ONLY_UNTIL_CHAIN_END_LIMIT_KEY]: restoreTurnOnlyChainLimit,
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

function opponentOnlyChainLimit(untilChainEnd: boolean): Omit<ChainLimit, "expiresAtChainLength"> {
  return {
    registryKey: untilChainEnd ? OPPONENT_ONLY_UNTIL_CHAIN_END_LIMIT_KEY : OPPONENT_ONLY_CHAIN_LIMIT_KEY,
    untilChainEnd,
    allows(_effect, player) {
      return player === 1;
    },
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

function turnOnlyChainLimit(untilChainEnd: boolean): Omit<ChainLimit, "expiresAtChainLength"> {
  return {
    registryKey: untilChainEnd ? TURN_ONLY_UNTIL_CHAIN_END_LIMIT_KEY : TURN_ONLY_CHAIN_LIMIT_KEY,
    untilChainEnd,
    allows(_effect, player) {
      return player === 0;
    },
  };
}

function moveFirstCard(state: DuelState, controller: 0 | 1, code: string, from: DuelLocation, to: DuelLocation): void {
  const card = state.cards.find((candidate) => candidate.controller === controller && candidate.location === from && candidate.code === code);
  if (card) moveDuelCard(state, card.uid, to, controller);
}

function serializeChainLimitForAssert(limit: ChainLimit) {
  return {
    registryKey: limit.registryKey,
    untilChainEnd: limit.untilChainEnd,
    expiresAtChainLength: limit.expiresAtChainLength,
  };
}

function hasGroupedEffect(groups: ReturnType<typeof getGroupedDuelLegalActions>, player: 0 | 1, effectId: string): boolean {
  return groups.some(
    (group) =>
      group.windowKind === "chainResponse" &&
      group.actions.some((action) => action.type === "activateEffect" && action.player === player && action.effectId === effectId && action.windowId === group.windowId && action.windowKind === "chainResponse"),
  );
}

function hasGroupedPass(groups: ReturnType<typeof getGroupedDuelLegalActions>, player: 0 | 1): boolean {
  return groups.some(
    (group) =>
      group.windowKind === "chainResponse" &&
      group.actions.some((action) => action.type === "passChain" && action.player === player && action.windowId === group.windowId && action.windowKind === "chainResponse"),
  );
}
