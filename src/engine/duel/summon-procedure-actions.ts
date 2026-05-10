import { findCard } from "#duel/card-state.js";
import { canUseEffectCount } from "#duel/effect-counts.js";
import { hasNormalSummonCountAvailable } from "#duel/extra-normal-summon.js";
import { summonProcedureTypeCodeFromValue } from "#duel/summon-type-codes.js";
import type { DuelAction, DuelCardInstance, DuelEffectDefinition, DuelState, PlayerId } from "#duel/types.js";

const luaEffectLimitSummonProc = 33;

type EffectChoicePredicate = (effect: DuelEffectDefinition, source: DuelCardInstance, player: PlayerId) => boolean;
type NormalSummonPredicate = (player: PlayerId, card: DuelCardInstance) => boolean;
type SpecialSummonProcedurePredicate = (uid: string, summonTypeCode?: number) => boolean;

export function normalSummonProcedureActions(state: DuelState, player: PlayerId, canChooseEffect: EffectChoicePredicate, canNormalSummon: NormalSummonPredicate): DuelAction[] {
  const actions: DuelAction[] = [];
  for (const effect of state.effects) {
    if (effect.controller !== player || effect.code !== luaEffectLimitSummonProc) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || source.controller !== player || source.location !== "hand" || !effect.range.includes(source.location)) continue;
    if (hasNormalTributeMetadata(source)) continue;
    if (!hasNormalSummonCountAvailable(state, player, source) || !canUseEffectCount(state, effect)) continue;
    if (!canNormalSummon(player, source) || !canChooseEffect(effect, source, player)) continue;
    actions.push({ type: "tributeSummon", player, uid: source.uid, tributeUids: [], effectId: effect.id, label: `Tribute Summon ${source.name}` });
  }
  return actions;
}

export function specialSummonProcedureActions(state: DuelState, player: PlayerId, canChooseEffect: EffectChoicePredicate, canAttempt: SpecialSummonProcedurePredicate): DuelAction[] {
  const actions: DuelAction[] = [];
  for (const effect of state.effects) {
    if (effect.controller !== player || effect.event !== "summonProcedure") continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location) || !canUseEffectCount(state, effect)) continue;
    if (!canAttempt(source.uid, summonProcedureTypeCodeFromValue(effect.value)) || !canChooseEffect(effect, source, player)) continue;
    actions.push({ type: "specialSummonProcedure", player, uid: source.uid, effectId: effect.id, label: `Special Summon ${source.name}` });
  }
  return actions;
}

export function hasLuaLimitNormalSummonProcedure(state: DuelState, player: PlayerId, card: DuelCardInstance): boolean {
  return !hasNormalTributeMetadata(card) && state.effects.some((effect) => effect.controller === player && effect.sourceUid === card.uid && effect.code === luaEffectLimitSummonProc && effect.range.includes(card.location));
}

function hasNormalTributeMetadata(card: DuelCardInstance): boolean {
  return card.data.normalTributes !== undefined || card.data.normalTributeMin !== undefined || card.data.normalTributeMax !== undefined;
}
