import { cardSetcodes } from "#lua/card-code-utils.js";
import { matchingLuaEffects } from "#lua/card-effect-query-api.js";
import type { DuelCardInstance, DuelState } from "#duel/types.js";
import type { LuaCardApiEffectRecord } from "#lua/card-api-types.js";

const luaEffectAddSetcode = 334;

export function effectiveCardSetcodes<EffectRecord extends LuaCardApiEffectRecord>(
  state: DuelState,
  card: DuelCardInstance,
  hostState: { effects: ReadonlyMap<number, EffectRecord> },
): number[] {
  const setcodes = [...cardSetcodes(card)];
  for (const effect of matchingLuaEffects(state, card, luaEffectAddSetcode, hostState)) {
    if (effect.value !== undefined && Number.isFinite(effect.value)) setcodes.push(effect.value);
  }
  return [...new Set(setcodes)];
}
