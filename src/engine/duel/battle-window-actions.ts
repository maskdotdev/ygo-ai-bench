import { replayAttackActions } from "#duel/battle.js";
import { currentBattleWindowKind, isBattleDamageStep } from "#duel/battle-window-state.js";
import type { DuelAction, DuelState, PlayerId } from "#duel/types.js";

export function battleWindowActions(
  state: DuelState,
  player: PlayerId,
  quickEffectActions: (state: DuelState, player: PlayerId) => DuelAction[],
  replayActions: (state: DuelState, player: PlayerId) => DuelAction[] = replayAttackActions,
): DuelAction[] {
  if (currentBattleWindowKind(state) === "replayDecision") return replayActions(state, player);
  if (isBattleDamageStep(state)) {
    return [
      ...quickEffectActions(state, player),
      { type: "passDamage", player, label: "Pass damage response" },
    ];
  }
  return [
    ...quickEffectActions(state, player),
    { type: "passAttack", player, label: "Pass attack response" },
  ];
}
