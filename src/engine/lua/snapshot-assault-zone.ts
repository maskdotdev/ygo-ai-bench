import { currentCardMatchesCode } from "#duel/card-code-state.js";
import { registerDuelFlagEffect } from "#duel/flags.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelEffectDefinition, SerializedDuelEffect } from "#duel/types.js";

const luaAssaultZoneCode = "91002901";
const luaAssaultModeActivateCode = "80280737";
const luaEffectExtraReleaseNonsum = 158;
const luaEventRelease = 1017;
const luaPhaseEndResetFlags = 0x40000200;

type ValueContext = Parameters<NonNullable<DuelEffectDefinition["valuePredicate"]>>[0];

export function isAssaultZoneExtraDeckReleaseRestoreEffect(effect: SerializedDuelEffect): boolean {
  return isAssaultZoneExtraDeckReleaseEffect(effect) || isAssaultZoneReleaseFlagEffect(effect);
}

export function isAssaultZoneExtraDeckReleaseEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.sourceUid !== undefined &&
    effect.registryKey?.startsWith(`lua:${luaAssaultZoneCode}:`) === true &&
    effect.reset?.flags === luaPhaseEndResetFlags &&
    effect.code === luaEffectExtraReleaseNonsum &&
    effect.targetRange?.[0] === 0x40
  );
}

export function isAssaultZoneReleaseFlagEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.sourceUid !== undefined &&
    effect.registryKey?.startsWith(`lua:${luaAssaultZoneCode}:`) === true &&
    effect.reset?.flags === luaPhaseEndResetFlags &&
    effect.code === luaEventRelease
  );
}

export function assaultZoneExtraDeckReleaseValueCallbacks(effect: SerializedDuelEffect): Pick<DuelEffectDefinition, "valuePredicate"> {
  if (!isAssaultZoneExtraDeckReleaseEffect(effect)) return {};
  return { valuePredicate: (ctx) => ((ctx.eventReason ?? 0) & duelReason.cost) !== 0 && relatedEffectHandlerHasCode(ctx, luaAssaultModeActivateCode) };
}

export function assaultZoneReleaseFlagConditionCallbacks(effect: SerializedDuelEffect): Pick<DuelEffectDefinition, "canActivate"> {
  if (!isAssaultZoneReleaseFlagEffect(effect)) return {};
  return {
    canActivate: (ctx) => ((ctx.eventReason ?? 0) & duelReason.cost) !== 0 && relatedEffectHandlerHasCode(ctx, luaAssaultModeActivateCode) && ctx.eventCard?.previousLocation === "extraDeck",
  };
}

export function assaultZoneReleaseFlagOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] | undefined {
  if (!isAssaultZoneReleaseFlagEffect(effect)) return undefined;
  return (ctx) => { registerDuelFlagEffect(ctx.duel, { ownerType: "player", ownerId: ctx.player }, Number(luaAssaultZoneCode), luaPhaseEndResetFlags, 0, 0); };
}

function relatedEffectHandlerHasCode(ctx: ValueContext, code: string): boolean {
  const relatedEffect = relatedEffectFromContext(ctx);
  const handler = ctx.duel.cards.find((card) => card.uid === relatedEffect?.sourceUid);
  return Boolean(handler && currentCardMatchesCode(handler, ctx.duel, code));
}

function relatedEffectFromContext(ctx: ValueContext): DuelEffectDefinition | undefined {
  const relatedEffectId = ctx.relatedEffectId === undefined ? ctx.chainLink?.effectId : `lua-${ctx.relatedEffectId}`;
  return ctx.duel.effects.find((effect) => effect.id === relatedEffectId || (relatedEffectId !== undefined && effect.id.startsWith(`${relatedEffectId}-`)));
}
