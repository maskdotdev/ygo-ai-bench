import { expect } from "vitest";
import { addDuelChainLimit, applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, queryPublicState } from "#duel/core.js";
import type { ChainLimit, DuelEffectDefinition } from "#duel/types.js";

export const OPEN_HANDOFF_TURN_ONLY_CHAIN_LIMIT_KEY = "restore-open-limit-turn-only";
export const OPEN_HANDOFF_TURN_ONLY_UNTIL_CHAIN_END_LIMIT_KEY = "restore-open-until-turn-only";
export const OPEN_HANDOFF_OPPONENT_ONLY_CHAIN_LIMIT_KEY = "restore-open-opponent-limit-opponent-only";
export const OPEN_HANDOFF_OPPONENT_ONLY_UNTIL_CHAIN_END_LIMIT_KEY = "restore-open-opponent-until-opponent-only";

export function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

export function findHandCard(session: ReturnType<typeof createDuel>, controller: 0 | 1, code: string) {
  return queryPublicState(session).cards.find((card) => card.controller === controller && card.location === "hand" && card.code === code);
}

export function openOnlyQuick(id: string, sourceUid: string, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
  return {
    ...loggedEffect(id, sourceUid, controller, "open", oncePerTurn),
    canActivate(ctx) {
      return ctx.duel.chain.length === 0;
    },
  };
}

export function chainOnlyQuick(id: string, sourceUid: string, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
  return {
    ...loggedEffect(id, sourceUid, controller, "chain", oncePerTurn),
    canActivate(ctx) {
      return ctx.duel.chain.length > 0;
    },
  };
}

export function chainOnlyQuickWithTurnLimit(id: string, sourceUid: string, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
  return {
    ...chainOnlyQuick(id, sourceUid, controller, oncePerTurn),
    target(ctx) {
      if (!ctx.checkOnly) addDuelChainLimit(ctx.duel, turnOnlyChainLimit());
      return true;
    },
  };
}

export function chainOnlyQuickWithTurnUntilLimit(id: string, sourceUid: string, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
  return {
    ...chainOnlyQuick(id, sourceUid, controller, oncePerTurn),
    target(ctx) {
      if (!ctx.checkOnly) addDuelChainLimit(ctx.duel, turnOnlyUntilChainEndLimit());
      return true;
    },
  };
}

export function chainOnlyQuickWithOpponentLimit(id: string, sourceUid: string, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
  return {
    ...chainOnlyQuick(id, sourceUid, controller, oncePerTurn),
    target(ctx) {
      if (!ctx.checkOnly) addDuelChainLimit(ctx.duel, opponentOnlyChainLimit());
      return true;
    },
  };
}

export function chainOnlyQuickWithOpponentUntilLimit(id: string, sourceUid: string, controller: 0 | 1, oncePerTurn = false): DuelEffectDefinition {
  return {
    ...chainOnlyQuick(id, sourceUid, controller, oncePerTurn),
    target(ctx) {
      if (!ctx.checkOnly) addDuelChainLimit(ctx.duel, opponentOnlyUntilChainEndLimit());
      return true;
    },
  };
}

export function restoreRegistry(): Record<string, (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition> {
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
    "restore-open-opponent-until-turn-open-quick": restoreOpenOnlyQuick(true),
    "restore-open-opponent-until-turn-chain-quick": restoreChainOnlyQuick(true),
    "restore-open-opponent-until-turn-blocked": restoreChainOnlyQuick(),
    "restore-open-opponent-until-opponent-chain-limiter": restoreChainOnlyQuickWithOpponentUntilLimit(true),
    "restore-open-opponent-until-opponent-followup": restoreChainOnlyQuick(),
    "restore-open-alt-turn-open-quick": restoreOpenOnlyQuick(true),
    "restore-open-alt-turn-chain-quick": restoreChainOnlyQuick(true),
    "restore-open-alt-turn-open-only": restoreOpenOnlyQuick(),
    "restore-open-alt-opponent-chain-quick": restoreChainOnlyQuick(true),
  };
}

export function restoreChainLimitRegistry(): Record<string, (limit: ChainLimit) => ChainLimit> {
  return {
    [OPEN_HANDOFF_TURN_ONLY_CHAIN_LIMIT_KEY]: restoreTurnOnlyChainLimit,
    [OPEN_HANDOFF_TURN_ONLY_UNTIL_CHAIN_END_LIMIT_KEY]: restoreTurnOnlyChainLimit,
    [OPEN_HANDOFF_OPPONENT_ONLY_CHAIN_LIMIT_KEY]: restoreOpponentOnlyChainLimit,
    [OPEN_HANDOFF_OPPONENT_ONLY_UNTIL_CHAIN_END_LIMIT_KEY]: restoreOpponentOnlyChainLimit,
  };
}

export function serializeChainLimitForAssert(limit: ChainLimit) {
  return {
    registryKey: limit.registryKey,
    untilChainEnd: limit.untilChainEnd,
    expiresAtChainLength: limit.expiresAtChainLength,
  };
}

export function hasGroupedEffect(groups: ReturnType<typeof getGroupedDuelLegalActions>, player: 0 | 1, effectId: string, windowKind: "chainResponse" | "open"): boolean {
  return groups.some(
    (group) =>
      group.windowKind === windowKind &&
      group.actions.some((action) => action.type === "activateEffect" && action.player === player && action.effectId === effectId && action.windowId === group.windowId && action.windowKind === windowKind),
  );
}

export function hasGroupedPass(groups: ReturnType<typeof getGroupedDuelLegalActions>, player: 0 | 1): boolean {
  return groups.some(
    (group) =>
      group.windowKind === "chainResponse" &&
      group.actions.some((action) => action.type === "passChain" && action.player === player && action.windowId === group.windowId && action.windowKind === "chainResponse"),
  );
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

function restoreChainOnlyQuickWithOpponentUntilLimit(oncePerTurn = false): (effect: Omit<DuelEffectDefinition, "operation">) => DuelEffectDefinition {
  return (effect) => ({
    ...restoreChainOnlyQuick(oncePerTurn)(effect),
    target(ctx) {
      if (!ctx.checkOnly) addDuelChainLimit(ctx.duel, opponentOnlyUntilChainEndLimit());
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

function opponentOnlyUntilChainEndLimit(): Omit<ChainLimit, "expiresAtChainLength"> {
  return {
    registryKey: OPEN_HANDOFF_OPPONENT_ONLY_UNTIL_CHAIN_END_LIMIT_KEY,
    untilChainEnd: true,
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
