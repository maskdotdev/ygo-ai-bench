import { describe, expect, it } from "vitest";
import { addDuelChainLimit, applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { ChainLimit, DuelEffectDefinition } from "#duel/types.js";
import { cards } from "./full-duel-engine-fixtures.js";

const TURN_ONLY_CHAIN_LIMIT_KEY = "restore-chain-followup-turn-only";
const TURN_ONLY_UNTIL_CHAIN_END_LIMIT_KEY = "restore-chain-followup-turn-until-only";

const limitCases = [
  {
    name: "one-chain",
    prefix: "restore-chain-followup-limit",
    seed: 251,
    untilChainEnd: false,
    registryKey: TURN_ONLY_CHAIN_LIMIT_KEY,
    expectedLimit: { registryKey: TURN_ONLY_CHAIN_LIMIT_KEY, untilChainEnd: false, expiresAtChainLength: 4 },
  },
  {
    name: "until-chain-end",
    prefix: "restore-chain-followup-until",
    seed: 250,
    untilChainEnd: true,
    registryKey: TURN_ONLY_UNTIL_CHAIN_END_LIMIT_KEY,
    expectedLimit: { registryKey: TURN_ONLY_UNTIL_CHAIN_END_LIMIT_KEY, untilChainEnd: true, expiresAtChainLength: undefined },
  },
] as const;

describe("open fast chain-response handoff turn follow-up chain-limit restore", () => {
  for (const testCase of limitCases) {
    it(`restores ${testCase.name} limits after the turn player responds from a returned handoff`, () => {
      const session = createDuel({ seed: testCase.seed, startingHandSize: 4, cardReader: createCardReader(cards) });
      loadDecks(session, {
        0: { main: ["100", "200", "700", "900"] },
        1: { main: ["300", "500", "400", "600"] },
      });
      startDuel(session);

      const turnOpenQuick = findHandCard(session, 0, "100");
      const turnLimiter = findHandCard(session, 0, "200");
      const turnFollowup = findHandCard(session, 0, "700");
      const opponentFirst = findHandCard(session, 1, "300");
      const opponentSecond = findHandCard(session, 1, "500");
      const opponentBlocked = findHandCard(session, 1, "400");
      expect(turnOpenQuick).toBeDefined();
      expect(turnLimiter).toBeDefined();
      expect(turnFollowup).toBeDefined();
      expect(opponentFirst).toBeDefined();
      expect(opponentSecond).toBeDefined();
      expect(opponentBlocked).toBeDefined();

      registerEffect(session, openOnlyQuick(`${testCase.prefix}-turn-open`, turnOpenQuick!.uid, 0, true));
      registerEffect(session, chainOnlyQuickWithTurnLimit(`${testCase.prefix}-turn-limiter`, turnLimiter!.uid, testCase.untilChainEnd, 0, true));
      registerEffect(session, chainOnlyQuick(`${testCase.prefix}-turn-followup`, turnFollowup!.uid, 0));
      registerEffect(session, chainOnlyQuick(`${testCase.prefix}-opponent-first`, opponentFirst!.uid, 1, true));
      registerEffect(session, chainOnlyQuick(`${testCase.prefix}-opponent-second`, opponentSecond!.uid, 1, true));
      registerEffect(session, chainOnlyQuick(`${testCase.prefix}-opponent-blocked`, opponentBlocked!.uid, 1));

      const openQuick = findEffectAction(session, 0, `${testCase.prefix}-turn-open`);
      expect(openQuick).toBeDefined();
      applyAndAssert(session, openQuick!);

      const opponentFirstAction = findEffectAction(session, 1, `${testCase.prefix}-opponent-first`);
      expect(opponentFirstAction).toBeDefined();
      applyAndAssert(session, opponentFirstAction!);

      const turnPass = getDuelLegalActions(session, 0).find((action) => action.type === "passChain");
      expect(turnPass).toBeDefined();
      applyAndAssert(session, turnPass!);

      const opponentSecondAction = findEffectAction(session, 1, `${testCase.prefix}-opponent-second`);
      expect(opponentSecondAction).toBeDefined();
      const turnReturnWindow = applyAndAssert(session, opponentSecondAction!);
      expect(turnReturnWindow.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
      expect(turnReturnWindow.state.chain.map((link) => link.effectId)).toEqual([
        `${testCase.prefix}-turn-open`,
        `${testCase.prefix}-opponent-first`,
        `${testCase.prefix}-opponent-second`,
      ]);
      expect(hasGroupedEffect(turnReturnWindow.legalActionGroups, 0, `${testCase.prefix}-turn-limiter`)).toBe(true);
      expect(hasGroupedEffect(turnReturnWindow.legalActionGroups, 0, `${testCase.prefix}-turn-followup`)).toBe(true);
      expect(getDuelLegalActions(session, 1)).toEqual([]);

      const turnLimiterAction = findEffectAction(session, 0, `${testCase.prefix}-turn-limiter`);
      expect(turnLimiterAction).toBeDefined();
      const limitedWindow = applyAndAssert(session, turnLimiterAction!);
      expect(limitedWindow.state).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
      expect(limitedWindow.state.chain.map((link) => link.effectId)).toEqual([
        `${testCase.prefix}-turn-open`,
        `${testCase.prefix}-opponent-first`,
        `${testCase.prefix}-opponent-second`,
        `${testCase.prefix}-turn-limiter`,
      ]);
      expect(session.state.chainPasses).toEqual([]);
      expect(session.state.chainLimits.map(serializeChainLimitForAssert)).toEqual([testCase.expectedLimit]);
      expect(getDuelLegalActions(session, 1)).toEqual([]);
      expect(hasGroupedEffect(limitedWindow.legalActionGroups, 0, `${testCase.prefix}-turn-followup`)).toBe(true);
      expect(hasGroupedEffect(limitedWindow.legalActionGroups, 1, `${testCase.prefix}-opponent-blocked`)).toBe(false);
      expect(hasGroupedPass(limitedWindow.legalActionGroups, 0)).toBe(true);

      const restored = restoreDuel(serializeDuel(session), createCardReader(cards), restoreRegistry(testCase.prefix, testCase.untilChainEnd), restoreChainLimitRegistry());
      expect(queryPublicState(restored)).toMatchObject({ waitingFor: 0, windowKind: "chainResponse" });
      expect(restored.state.chain.map((link) => link.effectId)).toEqual([
        `${testCase.prefix}-turn-open`,
        `${testCase.prefix}-opponent-first`,
        `${testCase.prefix}-opponent-second`,
        `${testCase.prefix}-turn-limiter`,
      ]);
      expect(restored.state.chainLimits.map(serializeChainLimitForAssert)).toEqual([testCase.expectedLimit]);
      expect(getDuelLegalActions(restored, 1)).toEqual([]);
      expect(getDuelLegalActions(restored, 0)).toEqual(getDuelLegalActions(session, 0));
      expect(getGroupedDuelLegalActions(restored, 0)).toEqual(getGroupedDuelLegalActions(session, 0));

      const staleTurnLimiter = applyResponse(restored, turnLimiterAction!);
      expect(staleTurnLimiter.ok).toBe(false);
      expect(staleTurnLimiter.error).toContain("Response is not currently legal");
      expect(staleTurnLimiter.legalActions).toEqual(getDuelLegalActions(restored, 0));
      expect(staleTurnLimiter.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));

      const turnFollowupAction = findEffectAction(restored, 0, `${testCase.prefix}-turn-followup`);
      expect(turnFollowupAction).toBeDefined();
      const forgedOpponentBlocked = applyResponse(restored, {
        type: "activateEffect",
        player: 1,
        uid: opponentBlocked!.uid,
        effectId: `${testCase.prefix}-opponent-blocked`,
        label: "Forge opponent response into restored turn-only follow-up limit",
        windowId: turnFollowupAction!.windowId,
        windowKind: turnFollowupAction!.windowKind,
        windowToken: turnFollowupAction!.windowToken,
      });
      expect(forgedOpponentBlocked.ok).toBe(false);
      expect(forgedOpponentBlocked.error).toContain("Response is not currently legal");
      expect(forgedOpponentBlocked.legalActions).toEqual(getDuelLegalActions(restored, 0));
      expect(forgedOpponentBlocked.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored, 0));
      expect(restored.state.log.map((entry) => entry.detail)).not.toContain(`${testCase.prefix}-opponent-blocked resolved`);

      const restoredTurnPass = getDuelLegalActions(restored, 0).find((action) => action.type === "passChain");
      expect(restoredTurnPass).toBeDefined();
      const resolved = applyAndAssert(restored, restoredTurnPass!);
      expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [] });
      expect(restored.state.chainPasses).toEqual([]);
      expect(restored.state.chainLimits).toEqual([]);
      expect(restored.state.log.map((entry) => entry.detail)).toEqual(expect.arrayContaining([
        `${testCase.prefix}-turn-limiter resolved`,
        `${testCase.prefix}-opponent-second resolved`,
        `${testCase.prefix}-opponent-first resolved`,
        `${testCase.prefix}-turn-open resolved`,
      ]));
      expect(restored.state.log.map((entry) => entry.detail)).not.toContain(`${testCase.prefix}-turn-followup resolved`);
      expect(restored.state.log.map((entry) => entry.detail)).not.toContain(`${testCase.prefix}-opponent-blocked resolved`);

      const restoredOpenWindow = restoreDuel(serializeDuel(restored), createCardReader(cards), restoreRegistry(testCase.prefix, testCase.untilChainEnd), restoreChainLimitRegistry());
      expect(queryPublicState(restoredOpenWindow)).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [], pendingTriggers: [], pendingTriggerBuckets: [] });
      expect(restoredOpenWindow.state.chainLimits).toEqual([]);
      expect(getGroupedDuelLegalActions(restoredOpenWindow, 0).flatMap((group) => group.actions)).toEqual(getDuelLegalActions(restoredOpenWindow, 0));
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
    [`${prefix}-turn-open`]: restoreOpenOnlyQuick(true),
    [`${prefix}-turn-limiter`]: restoreChainOnlyQuickWithTurnLimit(untilChainEnd, true),
    [`${prefix}-turn-followup`]: restoreChainOnlyQuick(),
    [`${prefix}-opponent-first`]: restoreChainOnlyQuick(true),
    [`${prefix}-opponent-second`]: restoreChainOnlyQuick(true),
    [`${prefix}-opponent-blocked`]: restoreChainOnlyQuick(),
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

function restoreChainOnlyQuickWithTurnLimit(untilChainEnd: boolean, oncePerTurn = false): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...restoreChainOnlyQuick(oncePerTurn)(effect),
    target(ctx) {
      if (!ctx.checkOnly) addDuelChainLimit(ctx.duel, turnOnlyChainLimit(untilChainEnd));
      return true;
    },
  });
}

function restoreChainLimitRegistry(): Record<string, (limit: ChainLimit) => ChainLimit> {
  return {
    [TURN_ONLY_CHAIN_LIMIT_KEY]: restoreTurnOnlyChainLimit,
    [TURN_ONLY_UNTIL_CHAIN_END_LIMIT_KEY]: restoreTurnOnlyChainLimit,
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
