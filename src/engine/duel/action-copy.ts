import type { DuelAction } from "#duel/types.js";

export function copyDuelAction(action: DuelAction): DuelAction {
  if (action.type === "tributeSummon" || action.type === "tributeSet") return copyActionEffectLabels({ ...action, tributeUids: [...action.tributeUids] });
  if (action.type === "fusionSummon" || action.type === "synchroSummon" || action.type === "xyzSummon" || action.type === "linkSummon" || action.type === "ritualSummon") return copyActionEffectLabels({ ...action, materialUids: [...action.materialUids] });
  if (action.type === "pendulumSummon") return { ...action, summonUids: [...action.summonUids] };
  return copyActionEffectLabels({ ...action });
}

function copyActionEffectLabels<T extends DuelAction>(action: T): T {
  if (!("effectLabels" in action) || action.effectLabels === undefined) return action;
  return { ...action, effectLabels: [...action.effectLabels] };
}
