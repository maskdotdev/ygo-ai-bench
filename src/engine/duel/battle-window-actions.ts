import type { DuelAction, DuelState, PlayerId } from "#duel/types.js";

export function battleWindowActions(state: DuelState, player: PlayerId, quickEffectActions: (state: DuelState, player: PlayerId) => DuelAction[]): DuelAction[] {
  if (state.battleStep === "damage") return [{ type: "passDamage", player, label: "Pass damage response" }];
  return [
    ...quickEffectActions(state, player),
    { type: "passAttack", player, label: "Pass attack response" },
  ];
}
