import type { DuelPhase } from "#duel/types.js";

export function phaseMask(phase: DuelPhase): number {
  if (phase === "draw") return 0x1;
  if (phase === "standby") return 0x2;
  if (phase === "main1") return 0x4;
  if (phase === "battle") return 0x80;
  if (phase === "main2") return 0x100;
  return 0x200;
}
