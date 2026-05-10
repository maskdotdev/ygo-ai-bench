import { cardSetcodes, isSetcodeMatch } from "#lua/card-code-utils.js";
import { matchingLuaEffects } from "#lua/card-effect-query-api.js";
import type { DuelCardInstance, DuelState } from "#duel/types.js";
import type { LuaCardApiEffectRecord } from "#lua/card-api-types.js";

const luaEffectAddSetcode = 334;
const luaEffectRemoveSetcode = 349;
const luaEffectChangeSetcode = 350;

export function effectiveCardSetcodes<EffectRecord extends LuaCardApiEffectRecord>(
  state: DuelState,
  card: DuelCardInstance,
  hostState: { effects: ReadonlyMap<number, EffectRecord> },
): number[] {
  let setcodes = [...cardSetcodes(card)];
  for (const effect of matchingLuaEffects(state, card, luaEffectChangeSetcode, hostState)) {
    const setcode = finiteEffectSetcode(effect);
    if (setcode !== undefined) setcodes = [setcode];
  }
  for (const effect of matchingLuaEffects(state, card, luaEffectAddSetcode, hostState)) {
    const setcode = finiteEffectSetcode(effect);
    if (setcode !== undefined) setcodes.push(setcode);
  }
  for (const effect of matchingLuaEffects(state, card, luaEffectRemoveSetcode, hostState)) {
    const setcode = finiteEffectSetcode(effect);
    if (setcode !== undefined) setcodes = setcodes.filter((current) => !isSetcodeMatch(setcode, current));
  }
  return [...new Set(setcodes)];
}

function finiteEffectSetcode(effect: LuaCardApiEffectRecord): number | undefined {
  return effect.value !== undefined && Number.isFinite(effect.value) ? effect.value : undefined;
}
