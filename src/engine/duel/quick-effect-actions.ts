import { currentBattleWindowKind } from "#duel/battle-window-state.js";
import { findCard } from "#duel/card-state.js";
import { canUseEffectCount } from "#duel/effect-counts.js";
import type { DuelAction, DuelCardInstance, DuelEffectDefinition, DuelState, PlayerId } from "#duel/types.js";

export type DuelEffectChooser = (state: DuelState, effect: DuelEffectDefinition, source: DuelCardInstance, player: PlayerId) => boolean;

export function quickEffectActions(state: DuelState, player: PlayerId, canChooseEffect: DuelEffectChooser): DuelAction[] {
  const actions: DuelAction[] = [];
  for (const effect of state.effects) {
    if (effect.controller !== player || effect.event !== "quick") continue;
    if (!quickEffectTimingAllows(state, effect)) continue;
    if (!chainLimitsAllow(state, effect, player)) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    if (!canUseEffectCount(state, effect)) continue;
    if (!canChooseEffect(state, effect, source, player)) continue;
    actions.push({ type: "activateEffect", player, uid: source.uid, effectId: effect.id, label: `${source.name}: ${effect.id}` });
  }
  return actions;
}

export function hasQuickEffectResponses(state: DuelState, player: PlayerId, canChooseEffect: DuelEffectChooser): boolean {
  return quickEffectActions(state, player, canChooseEffect).length > 0;
}

function quickEffectTimingAllows(state: DuelState, effect: DuelEffectDefinition): boolean {
  const kind = currentBattleWindowKind(state);
  if (kind === "duringDamageCalculation") return Boolean((effect.property ?? 0) & 0x8000);
  if (kind === "startDamageStep" || kind === "beforeDamageCalculation" || kind === "afterDamageCalculation" || kind === "endDamageStep") {
    return Boolean((effect.property ?? 0) & 0x4000);
  }
  return true;
}

function chainLimitsAllow(state: DuelState, effect: DuelEffectDefinition, player: PlayerId): boolean {
  const link = state.chain[state.chain.length - 1];
  if (!link) return true;
  for (const limit of state.chainLimits) {
    if (!limit.untilChainEnd && limit.expiresAtChainLength !== state.chain.length) continue;
    if (!limit.allows(effect, player, link.player)) return false;
  }
  return true;
}
