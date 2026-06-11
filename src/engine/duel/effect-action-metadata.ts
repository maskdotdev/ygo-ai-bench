import type { DuelActionEffectMetadata, DuelEffectDefinition } from "#duel/types.js";

export function duelEffectActionMetadata(effect: DuelEffectDefinition): DuelActionEffectMetadata {
  return {
    ...(effect.description === undefined ? {} : { effectDescription: effect.description }),
    ...(effect.label === undefined ? {} : { effectLabel: effect.label }),
    ...(effect.labels === undefined || effect.labels.length === 0 ? {} : { effectLabels: [...effect.labels] }),
  };
}
