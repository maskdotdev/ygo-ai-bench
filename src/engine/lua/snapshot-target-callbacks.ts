import { currentCardMatchesCode, currentCardMatchesSetcode } from "#duel/card-code-state.js";
import { cardTypeFlags, currentAttribute, currentRace } from "#duel/card-stats.js";
import { effectiveSpecialSummonTypeCode } from "#duel/summon-type-codes.js";
import { cardSetcodes, isSetcodeMatch } from "#lua/card-code-utils.js";
import { specialSummonTypeNotTargetDescriptor } from "#lua/effect-target-descriptor.js";
import type { DuelEffectDefinition, SerializedDuelEffect } from "#duel/types.js";

const luaSetcodeOrCodeTypeTargetDescriptorPrefix = "target:setcode-or-code-type:";
const luaTypeTargetDescriptorPrefix = "target:type:";
const luaFaceupTypeTargetDescriptorPrefix = "target:faceup-type:";

export function restoredLuaTargetCallbacks(effect: SerializedDuelEffect): Pick<DuelEffectDefinition, "targetCardPredicate"> {
  const notTypeExtra = effect.luaTargetDescriptor === "special-summon-limit:non-fusion-extra" ? 0x40 : effect.luaTargetDescriptor?.startsWith("special-summon-limit:not-type-extra:") ? Number(effect.luaTargetDescriptor.slice("special-summon-limit:not-type-extra:".length)) : undefined; if (notTypeExtra !== undefined && Number.isSafeInteger(notTypeExtra) && notTypeExtra > 0) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && (cardTypeFlags(card, ctx.duel) & notTypeExtra) === 0 };
  const setcodeOrCodeType = setcodeOrCodeTypeTargetDescriptor(effect.luaTargetDescriptor);
  if (setcodeOrCodeType !== undefined) {
    return { targetCardPredicate: (ctx, card) => currentCardMatchesSetcode(card, ctx.duel, setcodeOrCodeType.setcode) || (currentCardMatchesCode(card, ctx.duel, String(setcodeOrCodeType.code)) && (cardTypeFlags(card, ctx.duel) & setcodeOrCodeType.type) !== 0) };
  }
  const notSetcode = notSetcodeTargetDescriptor(effect.luaTargetDescriptor); const notRaceExtra = effect.luaTargetDescriptor?.startsWith("special-summon-limit:not-race-extra:") ? Number(effect.luaTargetDescriptor.slice("special-summon-limit:not-race-extra:".length)) : undefined; const notAttributeExtra = effect.luaTargetDescriptor?.startsWith("special-summon-limit:not-attribute-extra:") ? Number(effect.luaTargetDescriptor.slice("special-summon-limit:not-attribute-extra:".length)) : undefined; const notAttribute = effect.luaTargetDescriptor?.startsWith("target:not-attribute:") ? Number(effect.luaTargetDescriptor.slice("target:not-attribute:".length)) : undefined; const notRace = effect.luaTargetDescriptor?.startsWith("target:not-race:") ? Number(effect.luaTargetDescriptor.slice("target:not-race:".length)) : undefined;
  if (notSetcode !== undefined) return { targetCardPredicate: (_ctx, card) => !cardSetcodes(card).some((setcode) => isSetcodeMatch(notSetcode, setcode)) }; if (notRaceExtra !== undefined && Number.isSafeInteger(notRaceExtra) && notRaceExtra > 0) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && (currentRace(card, ctx.duel) & notRaceExtra) === 0 }; if (notAttributeExtra !== undefined && Number.isSafeInteger(notAttributeExtra) && notAttributeExtra > 0) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && (currentAttribute(card, ctx.duel) & notAttributeExtra) === 0 }; if (notAttribute !== undefined && Number.isSafeInteger(notAttribute) && notAttribute > 0) return { targetCardPredicate: (ctx, card) => (currentAttribute(card, ctx.duel) & notAttribute) === 0 }; if (notRace !== undefined && Number.isSafeInteger(notRace) && notRace > 0) return { targetCardPredicate: (ctx, card) => (currentRace(card, ctx.duel) & notRace) === 0 };
  if (effect.luaTargetDescriptor === "target:same-code-label") return { targetCardPredicate: (ctx, card) => effect.label !== undefined && currentCardMatchesCode(card, ctx.duel, String(effect.label)) };
  const summonTypeNot = specialSummonTypeNotTargetDescriptor(effect.luaTargetDescriptor);
  if (summonTypeNot !== undefined) return { targetCardPredicate: (ctx) => effectiveSpecialSummonTypeCode(ctx.summonTypeCode) !== summonTypeNot };
  const notType = effect.luaTargetDescriptor?.startsWith("target:not-type:") ? Number(effect.luaTargetDescriptor.slice("target:not-type:".length)) : undefined; if (notType !== undefined && Number.isSafeInteger(notType) && notType > 0) return { targetCardPredicate: (ctx, card) => (cardTypeFlags(card, ctx.duel) & notType) === 0 };
  const type = typeTargetDescriptor(effect.luaTargetDescriptor); if (type !== undefined) return { targetCardPredicate: (ctx, card) => (cardTypeFlags(card, ctx.duel) & type) !== 0 && (!effect.luaTargetDescriptor?.startsWith(luaFaceupTypeTargetDescriptorPrefix) || card.faceUp) };
  return {};
}

export function setcodeOrCodeTypeTargetDescriptor(descriptor: string | undefined): { setcode: number; code: number; type: number } | undefined {
  if (!descriptor?.startsWith(luaSetcodeOrCodeTypeTargetDescriptorPrefix)) return undefined;
  const [setcode, code, type] = descriptor.slice(luaSetcodeOrCodeTypeTargetDescriptorPrefix.length).split(":").map(Number);
  if (setcode === undefined || code === undefined || type === undefined) return undefined;
  return [setcode, code, type].every((value) => Number.isSafeInteger(value) && value > 0) ? { setcode, code, type } : undefined;
}

export function notSetcodeTargetDescriptor(descriptor: string | undefined): number | undefined {
  const match = descriptor?.match(/^target:not-setcode:(\d+)$/);
  const setcode = match?.[1] ? Number(match[1]) : undefined;
  return setcode !== undefined && Number.isSafeInteger(setcode) && setcode > 0 ? setcode : undefined;
}

export function typeTargetDescriptor(descriptor: string | undefined): number | undefined {
  const prefix = descriptor?.startsWith(luaFaceupTypeTargetDescriptorPrefix) ? luaFaceupTypeTargetDescriptorPrefix : luaTypeTargetDescriptorPrefix;
  if (!descriptor?.startsWith(prefix)) return undefined;
  const type = Number(descriptor.slice(prefix.length));
  return Number.isSafeInteger(type) && type > 0 ? type : undefined;
}
