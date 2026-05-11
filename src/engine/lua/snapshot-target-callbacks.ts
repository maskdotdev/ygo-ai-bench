import { currentCardMatchesCode, currentCardMatchesSetcode } from "#duel/card-code-state.js";
import { cardTypeFlags, currentAttack, currentAttribute, currentBaseAttack, currentLevel, currentRace, currentRank } from "#duel/card-stats.js";
import { effectiveSpecialSummonTypeCode } from "#duel/summon-type-codes.js";
import { cardSetcodes, isSetcodeMatch } from "#lua/card-code-utils.js";
import { specialSummonTypeNotTargetDescriptor } from "#lua/effect-target-descriptor.js";
import type { DuelEffectDefinition, SerializedDuelEffect } from "#duel/types.js";

const luaSetcodeOrCodeTypeTargetDescriptorPrefix = "target:setcode-or-code-type:";
const luaTypeTargetDescriptorPrefix = "target:type:";
const luaFaceupTypeTargetDescriptorPrefix = "target:faceup-type:";

export function restoredLuaTargetCallbacks(effect: SerializedDuelEffect): Pick<DuelEffectDefinition, "targetCardPredicate"> {
  const notTypeExtra = effect.luaTargetDescriptor === "special-summon-limit:non-fusion-extra" ? 0x40 : effect.luaTargetDescriptor?.startsWith("special-summon-limit:not-type-extra:") ? Number(effect.luaTargetDescriptor.slice("special-summon-limit:not-type-extra:".length)) : undefined; if (notTypeExtra !== undefined && Number.isSafeInteger(notTypeExtra) && notTypeExtra > 0) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && (cardTypeFlags(card, ctx.duel) & notTypeExtra) === 0 };
  const notTypeAttributeExtra = typeAttributeExtraDescriptor(effect.luaTargetDescriptor); if (notTypeAttributeExtra) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && ((cardTypeFlags(card, ctx.duel) & notTypeAttributeExtra.type) === 0 || (currentAttribute(card, ctx.duel) & notTypeAttributeExtra.attribute) === 0) };
  const notTypeRankExtra = typeRankExtraDescriptor(effect.luaTargetDescriptor); if (notTypeRankExtra) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && ((cardTypeFlags(card, ctx.duel) & notTypeRankExtra.type) === 0 || currentRank(card, ctx.duel) !== notTypeRankExtra.rank) };
  const notTypeRankAboveExtra = typeRankAboveExtraDescriptor(effect.luaTargetDescriptor); if (notTypeRankAboveExtra) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && ((cardTypeFlags(card, ctx.duel) & notTypeRankAboveExtra.type) === 0 || currentRank(card, ctx.duel) < notTypeRankAboveExtra.rank) };
  const notTypeLevelExtra = typeLevelExtraDescriptor(effect.luaTargetDescriptor); if (notTypeLevelExtra) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && ((cardTypeFlags(card, ctx.duel) & notTypeLevelExtra.type) === 0 || currentLevel(card, ctx.duel) !== notTypeLevelExtra.level) };
  const notLevelAboveAttributeExtra = levelAboveAttributeExtraDescriptor(effect.luaTargetDescriptor); if (notLevelAboveAttributeExtra) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && (currentLevel(card, ctx.duel) < notLevelAboveAttributeExtra.level || (currentAttribute(card, ctx.duel) & notLevelAboveAttributeExtra.attribute) === 0) };
  const notLevelAboveRaceExtra = levelAboveRaceExtraDescriptor(effect.luaTargetDescriptor); if (notLevelAboveRaceExtra) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && (currentLevel(card, ctx.duel) < notLevelAboveRaceExtra.level || (currentRace(card, ctx.duel) & notLevelAboveRaceExtra.race) === 0) };
  const notRaceBaseAttackExtra = raceBaseAttackExtraDescriptor(effect.luaTargetDescriptor); if (notRaceBaseAttackExtra) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && ((currentRace(card, ctx.duel) & notRaceBaseAttackExtra.race) === 0 || currentBaseAttack(card, ctx.duel) > notRaceBaseAttackExtra.attack) };
  const notRaceAttackExtra = raceAttackExtraDescriptor(effect.luaTargetDescriptor); if (notRaceAttackExtra) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && ((currentRace(card, ctx.duel) & notRaceAttackExtra.race) === 0 || currentAttack(card, ctx.duel) > notRaceAttackExtra.attack) };
  const notSetcodeTypeExtra = setcodeTypeExtraDescriptor(effect.luaTargetDescriptor); if (notSetcodeTypeExtra) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && (!currentCardMatchesSetcode(card, ctx.duel, notSetcodeTypeExtra.setcode) || (cardTypeFlags(card, ctx.duel) & notSetcodeTypeExtra.type) === 0) };
  const notTypeRaceExtra = typeRaceExtraDescriptor(effect.luaTargetDescriptor); if (notTypeRaceExtra) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && ((cardTypeFlags(card, ctx.duel) & notTypeRaceExtra.type) === 0 || (currentRace(card, ctx.duel) & notTypeRaceExtra.race) === 0) };
  const notTypeAttributeRaceExtra = typeAttributeRaceExtraDescriptor(effect.luaTargetDescriptor); if (notTypeAttributeRaceExtra) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && ((cardTypeFlags(card, ctx.duel) & notTypeAttributeRaceExtra.type) === 0 || (currentAttribute(card, ctx.duel) & notTypeAttributeRaceExtra.attribute) === 0 || (currentRace(card, ctx.duel) & notTypeAttributeRaceExtra.race) === 0) };
  const notAttributeRaceExtra = attributeRaceExtraDescriptor(effect.luaTargetDescriptor); if (notAttributeRaceExtra) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && ((currentAttribute(card, ctx.duel) & notAttributeRaceExtra.attribute) === 0 || (currentRace(card, ctx.duel) & notAttributeRaceExtra.race) === 0) };
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

function typeAttributeExtraDescriptor(descriptor: string | undefined): { type: number; attribute: number } | undefined {
  if (!descriptor?.startsWith("special-summon-limit:not-type-attribute-extra:")) return undefined;
  const [type, attribute] = descriptor.slice("special-summon-limit:not-type-attribute-extra:".length).split(":").map(Number);
  return type !== undefined && attribute !== undefined && [type, attribute].every((value) => Number.isSafeInteger(value) && value > 0) ? { type, attribute } : undefined;
}

function typeRaceExtraDescriptor(descriptor: string | undefined): { type: number; race: number } | undefined {
  if (!descriptor?.startsWith("special-summon-limit:not-type-race-extra:")) return undefined;
  const [type, race] = descriptor.slice("special-summon-limit:not-type-race-extra:".length).split(":").map(Number);
  return type !== undefined && race !== undefined && [type, race].every((value) => Number.isSafeInteger(value) && value > 0) ? { type, race } : undefined;
}

function typeRankExtraDescriptor(descriptor: string | undefined): { type: number; rank: number } | undefined {
  if (!descriptor?.startsWith("special-summon-limit:not-type-rank-extra:")) return undefined;
  const [type, rank] = descriptor.slice("special-summon-limit:not-type-rank-extra:".length).split(":").map(Number);
  return type !== undefined && rank !== undefined && [type, rank].every((value) => Number.isSafeInteger(value) && value > 0) ? { type, rank } : undefined;
}

function typeRankAboveExtraDescriptor(descriptor: string | undefined): { type: number; rank: number } | undefined {
  if (!descriptor?.startsWith("special-summon-limit:not-type-rank-above-extra:")) return undefined;
  const [type, rank] = descriptor.slice("special-summon-limit:not-type-rank-above-extra:".length).split(":").map(Number);
  return type !== undefined && rank !== undefined && [type, rank].every((value) => Number.isSafeInteger(value) && value > 0) ? { type, rank } : undefined;
}

function typeLevelExtraDescriptor(descriptor: string | undefined): { type: number; level: number } | undefined {
  if (!descriptor?.startsWith("special-summon-limit:not-type-level-extra:")) return undefined;
  const [type, level] = descriptor.slice("special-summon-limit:not-type-level-extra:".length).split(":").map(Number);
  return type !== undefined && level !== undefined && [type, level].every((value) => Number.isSafeInteger(value) && value > 0) ? { type, level } : undefined;
}

function levelAboveAttributeExtraDescriptor(descriptor: string | undefined): { level: number; attribute: number } | undefined {
  if (!descriptor?.startsWith("special-summon-limit:not-level-above-attribute-extra:")) return undefined;
  const [level, attribute] = descriptor.slice("special-summon-limit:not-level-above-attribute-extra:".length).split(":").map(Number);
  return level !== undefined && attribute !== undefined && [level, attribute].every((value) => Number.isSafeInteger(value) && value > 0) ? { level, attribute } : undefined;
}

function levelAboveRaceExtraDescriptor(descriptor: string | undefined): { level: number; race: number } | undefined {
  if (!descriptor?.startsWith("special-summon-limit:not-level-above-race-extra:")) return undefined;
  const [level, race] = descriptor.slice("special-summon-limit:not-level-above-race-extra:".length).split(":").map(Number);
  return level !== undefined && race !== undefined && [level, race].every((value) => Number.isSafeInteger(value) && value > 0) ? { level, race } : undefined;
}

function raceBaseAttackExtraDescriptor(descriptor: string | undefined): { race: number; attack: number } | undefined {
  if (!descriptor?.startsWith("special-summon-limit:not-race-base-attack-lte-extra:")) return undefined;
  const [race, attack] = descriptor.slice("special-summon-limit:not-race-base-attack-lte-extra:".length).split(":").map(Number);
  return race !== undefined && attack !== undefined && [race, attack].every((value) => Number.isSafeInteger(value) && value > 0) ? { race, attack } : undefined;
}

function raceAttackExtraDescriptor(descriptor: string | undefined): { race: number; attack: number } | undefined {
  if (!descriptor?.startsWith("special-summon-limit:not-race-attack-lte-extra:")) return undefined;
  const [race, attack] = descriptor.slice("special-summon-limit:not-race-attack-lte-extra:".length).split(":").map(Number);
  return race !== undefined && attack !== undefined && [race, attack].every((value) => Number.isSafeInteger(value) && value > 0) ? { race, attack } : undefined;
}

function setcodeTypeExtraDescriptor(descriptor: string | undefined): { setcode: number; type: number } | undefined {
  if (!descriptor?.startsWith("special-summon-limit:not-setcode-type-extra:")) return undefined;
  const [setcode, type] = descriptor.slice("special-summon-limit:not-setcode-type-extra:".length).split(":").map(Number);
  return setcode !== undefined && type !== undefined && [setcode, type].every((value) => Number.isSafeInteger(value) && value > 0) ? { setcode, type } : undefined;
}

function typeAttributeRaceExtraDescriptor(descriptor: string | undefined): { type: number; attribute: number; race: number } | undefined {
  if (!descriptor?.startsWith("special-summon-limit:not-type-attribute-race-extra:")) return undefined;
  const [type, attribute, race] = descriptor.slice("special-summon-limit:not-type-attribute-race-extra:".length).split(":").map(Number);
  return type !== undefined && attribute !== undefined && race !== undefined && [type, attribute, race].every((value) => Number.isSafeInteger(value) && value > 0) ? { type, attribute, race } : undefined;
}

function attributeRaceExtraDescriptor(descriptor: string | undefined): { attribute: number; race: number } | undefined {
  if (!descriptor?.startsWith("special-summon-limit:not-attribute-race-extra:")) return undefined;
  const [attribute, race] = descriptor.slice("special-summon-limit:not-attribute-race-extra:".length).split(":").map(Number);
  return attribute !== undefined && race !== undefined && [attribute, race].every((value) => Number.isSafeInteger(value) && value > 0) ? { attribute, race } : undefined;
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
