import { currentCardSetcodes } from "#duel/card-code-state.js";
import type { DuelCardInstance, DuelState } from "#duel/types.js";
import type { LuaCardApiEffectRecord } from "#lua/card-api-types.js";

export function effectiveCardSetcodes<EffectRecord extends LuaCardApiEffectRecord>(
  state: DuelState,
  card: DuelCardInstance,
  _hostState: { effects: ReadonlyMap<number, EffectRecord> },
): number[] {
  return currentCardSetcodes(card, state);
}
