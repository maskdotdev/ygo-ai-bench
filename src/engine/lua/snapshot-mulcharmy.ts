import { drawDuelCards, moveDuelCardWithRedirects } from "#duel/core.js";
import { duelLocations } from "#duel/location-kinds.js";
import { otherPlayer } from "#duel/player-id.js";
import { duelReason } from "#duel/reasons.js";
import { locationMatchesCardMask } from "#lua/api-utils.js";
import type { DuelCardInstance, DuelEffectDefinition, SerializedDuelEffect } from "#duel/types.js";

const luaMulcharmyFuwalosCode = "42141493";
const luaMulcharmyPuruliaCode = "84192580";
const luaLocationDeck = 0x1;
const luaLocationHand = 0x2;
const luaLocationExtra = 0x40;
const luaResetPhase = 0x40000000;
const luaResetChain = 0x80000000;
const luaPhaseEnd = 0x200;
const luaChainSolvedEventCode = 1022;
const luaResetEvent = 0x1000;
const luaPhaseEndEventCode = luaResetEvent | luaPhaseEnd;
const luaPhaseEndResetFlags = luaResetPhase | luaPhaseEnd;

export function isKnownMulcharmyDrawWatcherEffect(effect: SerializedDuelEffect): boolean {
  const code = mulcharmyCodeFromRegistryKey(effect);
  if (code !== luaMulcharmyFuwalosCode && code !== luaMulcharmyPuruliaCode) return false;
  if (effect.event !== "continuous" || effect.sourceUid === undefined || effect.reset?.flags !== luaPhaseEndResetFlags || !hasDefaultLuaFieldRange(effect)) return false;
  if (code === luaMulcharmyPuruliaCode) return effect.code === 1100 || effect.code === 1102;
  return effect.code === 1102;
}

export function isKnownMulcharmyEndPhaseShuffleEffect(effect: SerializedDuelEffect): boolean {
  const code = mulcharmyCodeFromRegistryKey(effect);
  return (
    (code === luaMulcharmyFuwalosCode || code === luaMulcharmyPuruliaCode) &&
    effect.event === "continuous" &&
    effect.code === luaPhaseEndEventCode &&
    effect.sourceUid !== undefined &&
    effect.reset?.flags === luaPhaseEndResetFlags &&
    effect.countLimit === 1 &&
    hasDefaultLuaFieldRange(effect)
  );
}

export function mulcharmyDrawWatcherOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const code = mulcharmyCodeFromRegistryKey(effect);
    const eventCards = (ctx.eventUids ?? (ctx.eventCard ? [ctx.eventCard.uid] : []))
      .map((uid) => ctx.duel.cards.find((card) => card.uid === uid))
      .filter((card): card is DuelCardInstance => Boolean(card));
    const matched = eventCards.some((card) => {
      if (card.summonPlayer !== otherPlayer(effect.controller)) return false;
      if (code === luaMulcharmyPuruliaCode) return effect.code === 1100 || locationMatchesCardMask(card, luaLocationHand, card.previousLocation, card.previousSequence);
      if (code === luaMulcharmyFuwalosCode) return locationMatchesCardMask(card, luaLocationDeck | luaLocationExtra, card.previousLocation, card.previousSequence);
      return false;
    });
    if (!matched) return;
    if (ctx.duel.status === "resolving") {
      registerOrIncrementMulcharmyChainSolvedDraw(effect, ctx.duel);
      return;
    }
    drawDuelCards(ctx.duel, effect.controller, 1, "Mulcharmy restored draw", {
      eventReason: duelReason.effect,
      eventReasonPlayer: effect.controller,
      eventReasonCardUid: effect.sourceUid,
    });
  };
}

function registerOrIncrementMulcharmyChainSolvedDraw(effect: SerializedDuelEffect, duel: Parameters<DuelEffectDefinition["operation"]>[0]["duel"]): void {
  const sourceUid = effect.sourceUid;
  if (!sourceUid) return;
  const registryKey = `${effect.registryKey}:chain-solved-draw`;
  const existing = duel.effects.find((candidate) => candidate.event === "continuous" && candidate.code === luaChainSolvedEventCode && candidate.registryKey === registryKey && candidate.sourceUid === sourceUid);
  if (existing) {
    existing.label = (existing.label ?? 0) + 1;
    return;
  }
  const delayedEffect: DuelEffectDefinition = {
    id: `${effect.id}:chain-solved-draw`,
    sourceUid,
    controller: effect.controller,
    registryKey,
    event: "continuous",
    code: luaChainSolvedEventCode,
    range: [...effect.range],
    reset: { flags: luaResetChain },
    label: 1,
    operation(ctx) {
      const count = Math.max(0, delayedEffect.label ?? 0);
      if (count === 0) return;
      drawDuelCards(ctx.duel, effect.controller, count, "Mulcharmy restored chain-solved draw", {
        eventReason: duelReason.effect,
        eventReasonPlayer: effect.controller,
        eventReasonCardUid: sourceUid,
      });
    },
  };
  if (effect.ownerPlayer !== undefined) delayedEffect.ownerPlayer = effect.ownerPlayer;
  duel.effects.push(delayedEffect);
}

export function mulcharmyEndPhaseShuffleOperation(effect: SerializedDuelEffect): DuelEffectDefinition["operation"] {
  return (ctx) => {
    const opponentFieldCount = ctx.duel.cards.filter((card) => card.controller === otherPlayer(effect.controller) && (card.location === "monsterZone" || card.location === "spellTrapZone")).length;
    const hand = ctx.duel.cards.filter((card) => card.controller === effect.controller && card.location === "hand").sort((left, right) => left.sequence - right.sequence);
    const count = Math.max(0, hand.length - (opponentFieldCount + 6));
    for (const card of hand.slice(0, count)) {
      try {
        moveDuelCardWithRedirects(ctx.duel, card.uid, "deck", effect.controller, duelReason.effect, effect.controller, {
          eventReasonCardUid: effect.sourceUid,
        });
      } catch {
        // EDOPro-style cleanup skips cards that can no longer be returned.
      }
    }
  };
}

function hasDefaultLuaFieldRange(effect: SerializedDuelEffect): boolean {
  const allLocations = new Set(duelLocations);
  return effect.range.length === allLocations.size && effect.range.every((location) => allLocations.has(location));
}

function mulcharmyCodeFromRegistryKey(effect: SerializedDuelEffect): string | undefined {
  const [, code] = effect.registryKey?.split(":") ?? [];
  return code;
}
