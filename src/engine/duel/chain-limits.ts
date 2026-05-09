import type { ChainLimit, DuelState } from "#duel/types.js";

export function addDuelChainLimit(state: DuelState, limit: Omit<ChainLimit, "expiresAtChainLength"> & Pick<Partial<ChainLimit>, "expiresAtChainLength">): void {
  state.chainLimits.push({
    ...limit,
    ...(limit.untilChainEnd ? {} : { expiresAtChainLength: limit.expiresAtChainLength ?? state.chain.length + 1 }),
  });
}

export function clearStaleChainLimits(state: DuelState): void {
  clearChainLimits(state, (limit) => !limit.untilChainEnd && (limit.expiresAtChainLength ?? 0) < state.chain.length);
}

export function clearChainLimits(state: DuelState, shouldClear: (limit: ChainLimit) => boolean = () => true): void {
  const remaining: ChainLimit[] = [];
  for (const limit of state.chainLimits) {
    if (shouldClear(limit)) limit.release?.();
    else remaining.push(limit);
  }
  state.chainLimits = remaining;
}
