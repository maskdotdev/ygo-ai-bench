import { findCard } from "#duel/card-state.js";
import { createEffectContext } from "#duel/effect-context.js";
import { canUseEffectCount } from "#duel/effect-counts.js";
import { hasNormalSummonCountAvailable } from "#duel/extra-normal-summon.js";
import { luaSummonTypeTribute, summonProcedureTypeCodeFromValue } from "#duel/summon-type-codes.js";
import type { DuelAction, DuelCardInstance, DuelEffectDefinition, DuelState, PlayerId } from "#duel/types.js";

const luaEffectLimitSummonProc = 33;
const luaEffectSummonProc = 32;

type EffectChoicePredicate = (effect: DuelEffectDefinition, source: DuelCardInstance, player: PlayerId) => boolean;
type NormalSummonPredicate = (player: PlayerId, card: DuelCardInstance) => boolean;
type SpecialSummonProcedurePredicate = (uid: string, summonTypeCode?: number, relatedEffectId?: number) => boolean;

export function normalSummonProcedureActions(state: DuelState, player: PlayerId, canChooseEffect: EffectChoicePredicate, canNormalSummon: NormalSummonPredicate): DuelAction[] {
  const actions: DuelAction[] = [];
  for (const effect of state.effects) {
    if (!isLuaNormalSummonProcedure(effect.code) || !procedureAffectsPlayer(effect, player)) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !canUseEffectCount(state, effect)) continue;
    const candidates = source.controller === player && source.location === "hand" && effect.range.includes(source.location) ? [source] : state.cards.filter((card) => card.controller === player && card.location === "hand" && procedureTargetsHand(effect, player));
    for (const candidate of candidates) {
      if (!hasNormalSummonCountAvailable(state, player, candidate) || !canNormalSummon(player, candidate)) continue;
      const ctx = createEffectContext(state, candidate, player);
      if (effect.targetCardPredicate && !effect.targetCardPredicate(ctx, candidate)) continue;
      if (!canChooseEffect(effect, candidate, player)) continue;
      actions.push({ type: "tributeSummon", player, uid: candidate.uid, tributeUids: [], effectId: effect.id, label: `Tribute Summon ${candidate.name}` });
    }
  }
  return actions;
}

export function specialSummonProcedureActions(state: DuelState, player: PlayerId, canChooseEffect: EffectChoicePredicate, canAttempt: SpecialSummonProcedurePredicate): DuelAction[] {
  const actions: DuelAction[] = [];
  for (const effect of state.effects) {
    if (effect.controller !== player || effect.event !== "summonProcedure") continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location) || !canUseEffectCount(state, effect)) continue;
    if (!canAttempt(source.uid, summonProcedureTypeCodeFromValue(effect.value), luaRelatedEffectId(effect)) || !canChooseEffect(effect, source, player)) continue;
    actions.push({ type: "specialSummonProcedure", player, uid: source.uid, effectId: effect.id, label: `Special Summon ${source.name}` });
  }
  return actions;
}

export function hasLuaLimitNormalSummonProcedure(state: DuelState, player: PlayerId, card: DuelCardInstance): boolean {
  if (hasNormalTributeMetadata(card)) return false;
  return state.effects.some((effect) => {
    if (effect.code !== luaEffectLimitSummonProc || !procedureAffectsPlayer(effect, player)) return false;
    if (effect.sourceUid === card.uid && effect.range.includes(card.location)) return true;
    if (!procedureTargetsHand(effect, player) || card.location !== "hand") return false;
    return !effect.targetCardPredicate || effect.targetCardPredicate(createEffectContext(state, card, player), card);
  });
}

export function luaLimitNormalSummonProcedureValue(state: DuelState, player: PlayerId, sourceUid: string): number | undefined {
  const value = state.effects.find((effect) => effect.controller === player && effect.sourceUid === sourceUid && effect.code === luaEffectLimitSummonProc && effect.value !== undefined)?.value;
  return value !== undefined && (value & luaSummonTypeTribute) === luaSummonTypeTribute ? value : undefined;
}

function hasNormalTributeMetadata(card: DuelCardInstance): boolean {
  return card.data.normalTributes !== undefined || card.data.normalTributeMin !== undefined || card.data.normalTributeMax !== undefined;
}

function isLuaNormalSummonProcedure(code: number | undefined): boolean {
  return code === luaEffectSummonProc || code === luaEffectLimitSummonProc;
}

function procedureAffectsPlayer(effect: DuelEffectDefinition, player: PlayerId): boolean {
  if (effect.targetRange === undefined) return effect.controller === player;
  return procedureTargetsHand(effect, player);
}

function procedureTargetsHand(effect: DuelEffectDefinition, player: PlayerId): boolean {
  const index = effect.controller === player ? 0 : 1;
  return ((effect.targetRange?.[index] ?? 0) & 0x02) !== 0;
}

function luaRelatedEffectId(effect: DuelEffectDefinition): number | undefined {
  const id = Number(effect.id.match(/^lua-(\d+)/)?.[1]);
  return Number.isFinite(id) ? id : undefined;
}
