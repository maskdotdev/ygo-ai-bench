import { cardCodes } from "#lua/card-code-utils.js";
import { matchingLuaEffects } from "#lua/card-effect-query-api.js";
import type { DuelCardInstance, DuelState } from "#duel/types.js";
import type { LuaCardApiEffectRecord } from "#lua/card-api-types.js";

const luaEffectAddCode = 113;
const luaEffectChangeCode = 114;

export function effectiveCardCodes<EffectRecord extends LuaCardApiEffectRecord>(
  state: DuelState,
  card: DuelCardInstance,
  hostState: { effects: ReadonlyMap<number, EffectRecord> },
): string[] {
  let codes = cardCodes(card);
  for (const effect of matchingLuaEffects(state, card, luaEffectChangeCode, hostState)) {
    const code = finiteEffectCode(effect);
    if (code !== undefined) codes = [code];
  }
  for (const effect of matchingLuaEffects(state, card, luaEffectAddCode, hostState)) {
    const code = finiteEffectCode(effect);
    if (code !== undefined) codes.push(code);
  }
  return [...new Set(codes)];
}

export function effectiveCardCode<EffectRecord extends LuaCardApiEffectRecord>(
  state: DuelState,
  card: DuelCardInstance | undefined,
  hostState: { effects: ReadonlyMap<number, EffectRecord> },
): number {
  if (!card) return 0;
  return Number(effectiveCardCodes(state, card, hostState)[0] ?? 0);
}

function finiteEffectCode(effect: LuaCardApiEffectRecord): string | undefined {
  return effect.value !== undefined && Number.isFinite(effect.value) ? String(effect.value) : undefined;
}
