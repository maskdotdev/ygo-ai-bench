import type { DuelEffectContext } from "#duel/types.js";
import type { LuaEffectRecord } from "#lua/host-types.js";

export function applyKnownLuaTargetFallback(ctx: DuelEffectContext, luaEffect: LuaEffectRecord): void {
  if (ctx.checkOnly || ctx.targetUids.length > 0) return;
  if (luaEffect.targetDescriptor === "target:select-opponent-pzone-able-control") {
    const target = ctx.duel.cards.find((card) => card.controller !== ctx.player && card.location === "spellTrapZone" && card.sequence >= 0 && card.sequence <= 1);
    if (target) ctx.setTargets([target.uid]);
  }
  if (ctx.eventName === "customEvent" && ((luaEffect.property ?? 0) & 0x10) !== 0 && ctx.eventCard?.location === "graveyard") {
    ctx.setTargets([ctx.eventCard.uid]);
  }
}
