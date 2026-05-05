import type { DuelAction } from "#duel/types.js";

export function copyDuelAction(action: DuelAction): DuelAction {
  if (action.type === "tributeSummon") return { ...action, tributeUids: [...action.tributeUids] };
  if (action.type === "fusionSummon" || action.type === "synchroSummon" || action.type === "xyzSummon" || action.type === "linkSummon" || action.type === "ritualSummon") return { ...action, materialUids: [...action.materialUids] };
  if (action.type === "pendulumSummon") return { ...action, summonUids: [...action.summonUids] };
  return { ...action };
}
