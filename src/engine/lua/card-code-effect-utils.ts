import { currentCardCodes } from "#duel/card-code-state.js";
import type { DuelCardInstance, DuelState } from "#duel/types.js";
import type { LuaCardApiEffectRecord } from "#lua/card-api-types.js";

export function effectiveCardCodes<EffectRecord extends LuaCardApiEffectRecord>(
  state: DuelState,
  card: DuelCardInstance,
  _hostState: { effects: ReadonlyMap<number, EffectRecord> },
): string[] {
  return currentCardCodes(card, state);
}

export function effectiveCardCode<EffectRecord extends LuaCardApiEffectRecord>(
  state: DuelState,
  card: DuelCardInstance | undefined,
  hostState: { effects: ReadonlyMap<number, EffectRecord> },
): number {
  if (!card) return 0;
  return Number(effectiveCardCodes(state, card, hostState)[0] ?? 0);
}
