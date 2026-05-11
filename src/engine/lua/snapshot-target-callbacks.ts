import { currentCardMatchesCode, currentCardMatchesSetcode } from "#duel/card-code-state.js";
import { cardTypeFlags, currentAttack, currentAttribute, currentBaseAttack, currentLevel, currentLink, currentRace, currentRank } from "#duel/card-stats.js";
import { effectiveSpecialSummonTypeCode } from "#duel/summon-type-codes.js";
import { cardSetcodes, isSetcodeMatch } from "#lua/card-code-utils.js";
import { specialSummonTypeIsAnyTargetDescriptor, specialSummonTypeIsTargetDescriptor, specialSummonTypeNotTargetDescriptor } from "#lua/effect-target-descriptor.js";
import type { DuelEffectDefinition, SerializedDuelEffect } from "#duel/types.js";

const luaSetcodeOrCodeTypeTargetDescriptorPrefix = "target:setcode-or-code-type:";
const luaTypeTargetDescriptorPrefix = "target:type:";
const luaFaceupTypeTargetDescriptorPrefix = "target:faceup-type:";

export function restoredLuaTargetCallbacks(effect: SerializedDuelEffect): Pick<DuelEffectDefinition, "targetCardPredicate"> {
  if (effect.luaTargetDescriptor === "special-summon-limit:extra") return { targetCardPredicate: (_ctx, card) => card.location === "extraDeck" };
  const notTypeExtra = effect.luaTargetDescriptor === "special-summon-limit:non-fusion-extra" ? 0x40 : effect.luaTargetDescriptor?.startsWith("special-summon-limit:not-type-extra:") ? Number(effect.luaTargetDescriptor.slice("special-summon-limit:not-type-extra:".length)) : undefined; if (notTypeExtra !== undefined && Number.isSafeInteger(notTypeExtra) && notTypeExtra > 0) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && (cardTypeFlags(card, ctx.duel) & notTypeExtra) === 0 };
  const linkBelowExtra = effect.luaTargetDescriptor?.startsWith("special-summon-limit:link-below-extra:") ? Number(effect.luaTargetDescriptor.slice("special-summon-limit:link-below-extra:".length)) : undefined; if (linkBelowExtra !== undefined && Number.isSafeInteger(linkBelowExtra) && linkBelowExtra > 0) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && (cardTypeFlags(card, ctx.duel) & 0x4000000) !== 0 && currentLink(card, ctx.duel) <= linkBelowExtra };
  const notTypeAttributeExtra = typeAttributeExtraDescriptor(effect.luaTargetDescriptor); if (notTypeAttributeExtra) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && ((cardTypeFlags(card, ctx.duel) & notTypeAttributeExtra.type) === 0 || (currentAttribute(card, ctx.duel) & notTypeAttributeExtra.attribute) === 0) };
  const notTypeRankExtra = typeRankExtraDescriptor(effect.luaTargetDescriptor); if (notTypeRankExtra) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && ((cardTypeFlags(card, ctx.duel) & notTypeRankExtra.type) === 0 || currentRank(card, ctx.duel) !== notTypeRankExtra.rank) };
  const notTypeRankAboveExtra = typeRankAboveExtraDescriptor(effect.luaTargetDescriptor); if (notTypeRankAboveExtra) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && ((cardTypeFlags(card, ctx.duel) & notTypeRankAboveExtra.type) === 0 || currentRank(card, ctx.duel) < notTypeRankAboveExtra.rank) };
  const notTypeLevelExtra = typeLevelExtraDescriptor(effect.luaTargetDescriptor); if (notTypeLevelExtra) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && ((cardTypeFlags(card, ctx.duel) & notTypeLevelExtra.type) === 0 || currentLevel(card, ctx.duel) !== notTypeLevelExtra.level) };
  const notLevelAboveAttributeExtra = levelAboveAttributeExtraDescriptor(effect.luaTargetDescriptor); if (notLevelAboveAttributeExtra) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && (currentLevel(card, ctx.duel) < notLevelAboveAttributeExtra.level || (currentAttribute(card, ctx.duel) & notLevelAboveAttributeExtra.attribute) === 0) };
  const notLevelAboveRaceExtra = levelAboveRaceExtraDescriptor(effect.luaTargetDescriptor); if (notLevelAboveRaceExtra) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && (currentLevel(card, ctx.duel) < notLevelAboveRaceExtra.level || (currentRace(card, ctx.duel) & notLevelAboveRaceExtra.race) === 0) };
  const notRaceBaseAttackExtra = raceBaseAttackExtraDescriptor(effect.luaTargetDescriptor); if (notRaceBaseAttackExtra) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && ((currentRace(card, ctx.duel) & notRaceBaseAttackExtra.race) === 0 || currentBaseAttack(card, ctx.duel) > notRaceBaseAttackExtra.attack) };
  const notRaceAttackExtra = raceAttackExtraDescriptor(effect.luaTargetDescriptor); if (notRaceAttackExtra) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && ((currentRace(card, ctx.duel) & notRaceAttackExtra.race) === 0 || currentAttack(card, ctx.duel) > notRaceAttackExtra.attack) };
  const notSetcodeTypeExtra = setcodeTypeExtraDescriptor(effect.luaTargetDescriptor); if (notSetcodeTypeExtra) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && (!currentCardMatchesSetcode(card, ctx.duel, notSetcodeTypeExtra.setcode) || (cardTypeFlags(card, ctx.duel) & notSetcodeTypeExtra.type) === 0) };
  const notSetcodeExtra = setcodeExtraDescriptor(effect.luaTargetDescriptor); if (notSetcodeExtra !== undefined) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && !currentCardMatchesSetcode(card, ctx.duel, notSetcodeExtra) };
  const notTypeRaceExtra = typeRaceExtraDescriptor(effect.luaTargetDescriptor); if (notTypeRaceExtra) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && ((cardTypeFlags(card, ctx.duel) & notTypeRaceExtra.type) === 0 || (currentRace(card, ctx.duel) & notTypeRaceExtra.race) === 0) };
  const notTypeAttributeRaceExtra = typeAttributeRaceExtraDescriptor(effect.luaTargetDescriptor); if (notTypeAttributeRaceExtra) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && ((cardTypeFlags(card, ctx.duel) & notTypeAttributeRaceExtra.type) === 0 || (currentAttribute(card, ctx.duel) & notTypeAttributeRaceExtra.attribute) === 0 || (currentRace(card, ctx.duel) & notTypeAttributeRaceExtra.race) === 0) };
  const notRaceAttribute = raceAttributeDescriptor(effect.luaTargetDescriptor); if (notRaceAttribute) return { targetCardPredicate: (ctx, card) => (currentRace(card, ctx.duel) & notRaceAttribute.race) === 0 || (currentAttribute(card, ctx.duel) & notRaceAttribute.attribute) === 0 };
  const notRaceTypeOrSetcode = raceTypeOrSetcodeDescriptor(effect.luaTargetDescriptor); if (notRaceTypeOrSetcode) return { targetCardPredicate: (ctx, card) => !currentCardMatchesSetcode(card, ctx.duel, notRaceTypeOrSetcode.setcode) && ((currentRace(card, ctx.duel) & notRaceTypeOrSetcode.race) === 0 || (cardTypeFlags(card, ctx.duel) & notRaceTypeOrSetcode.type) === 0) };
  const notAttributeRaceExtra = attributeRaceExtraDescriptor(effect.luaTargetDescriptor); if (notAttributeRaceExtra) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && ((currentAttribute(card, ctx.duel) & notAttributeRaceExtra.attribute) === 0 || (currentRace(card, ctx.duel) & notAttributeRaceExtra.race) === 0) };
  const setcodeOrCodeType = setcodeOrCodeTypeTargetDescriptor(effect.luaTargetDescriptor);
  if (setcodeOrCodeType !== undefined) {
    return { targetCardPredicate: (ctx, card) => currentCardMatchesSetcode(card, ctx.duel, setcodeOrCodeType.setcode) || (currentCardMatchesCode(card, ctx.duel, String(setcodeOrCodeType.code)) && (cardTypeFlags(card, ctx.duel) & setcodeOrCodeType.type) !== 0) };
  }
  const notSetcode = notSetcodeTargetDescriptor(effect.luaTargetDescriptor); const notRaceExtra = effect.luaTargetDescriptor?.startsWith("special-summon-limit:not-race-extra:") ? Number(effect.luaTargetDescriptor.slice("special-summon-limit:not-race-extra:".length)) : undefined; const notAttributeExtra = effect.luaTargetDescriptor?.startsWith("special-summon-limit:not-attribute-extra:") ? Number(effect.luaTargetDescriptor.slice("special-summon-limit:not-attribute-extra:".length)) : undefined; const notAttribute = effect.luaTargetDescriptor?.startsWith("target:not-attribute:") ? Number(effect.luaTargetDescriptor.slice("target:not-attribute:".length)) : undefined; const notRace = effect.luaTargetDescriptor?.startsWith("target:not-race:") ? Number(effect.luaTargetDescriptor.slice("target:not-race:".length)) : undefined; const notCode = effect.luaTargetDescriptor?.startsWith("target:not-code:") ? Number(effect.luaTargetDescriptor.slice("target:not-code:".length)) : undefined;
  if (notSetcode !== undefined) return { targetCardPredicate: (_ctx, card) => !cardSetcodes(card).some((setcode) => isSetcodeMatch(notSetcode, setcode)) }; if (notRaceExtra !== undefined && Number.isSafeInteger(notRaceExtra) && notRaceExtra > 0) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && (currentRace(card, ctx.duel) & notRaceExtra) === 0 }; if (notAttributeExtra !== undefined && Number.isSafeInteger(notAttributeExtra) && notAttributeExtra > 0) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && (currentAttribute(card, ctx.duel) & notAttributeExtra) === 0 }; if (notAttribute !== undefined && Number.isSafeInteger(notAttribute) && notAttribute > 0) return { targetCardPredicate: (ctx, card) => (currentAttribute(card, ctx.duel) & notAttribute) === 0 }; if (notRace !== undefined && Number.isSafeInteger(notRace) && notRace > 0) return { targetCardPredicate: (ctx, card) => (currentRace(card, ctx.duel) & notRace) === 0 }; if (notCode !== undefined && Number.isSafeInteger(notCode) && notCode > 0) return { targetCardPredicate: (ctx, card) => !currentCardMatchesCode(card, ctx.duel, String(notCode)) };
  if (effect.luaTargetDescriptor === "target:same-code-label") return { targetCardPredicate: (ctx, card) => effect.label !== undefined && currentCardMatchesCode(card, ctx.duel, String(effect.label)) };
  const pendulumSummonNotSetcode = pendulumSummonNotSetcodeDescriptor(effect.luaTargetDescriptor);
  if (pendulumSummonNotSetcode !== undefined) return { targetCardPredicate: (ctx, card) => effectiveSpecialSummonTypeCode(ctx.summonTypeCode) === 0x4a000000 && !pendulumSummonNotSetcode.some((setcode) => currentCardMatchesSetcode(card, ctx.duel, setcode)) };
  const ritualSummonNotRace = ritualSummonNotRaceDescriptor(effect.luaTargetDescriptor);
  if (ritualSummonNotRace !== undefined) return { targetCardPredicate: (ctx, card) => effectiveSpecialSummonTypeCode(ctx.summonTypeCode) === 0x45000000 && (currentRace(card, ctx.duel) & ritualSummonNotRace) === 0 };
  const extraSummonTypeNot = extraSummonTypeNotDescriptor(effect.luaTargetDescriptor);
  if (extraSummonTypeNot !== undefined) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && effectiveSpecialSummonTypeCode(ctx.summonTypeCode) !== extraSummonTypeNot };
  const summonTypeIsAny = specialSummonTypeIsAnyTargetDescriptor(effect.luaTargetDescriptor);
  if (summonTypeIsAny !== undefined) return { targetCardPredicate: (ctx) => summonTypeIsAny.includes(effectiveSpecialSummonTypeCode(ctx.summonTypeCode)) };
  const summonTypeIs = specialSummonTypeIsTargetDescriptor(effect.luaTargetDescriptor);
  if (summonTypeIs !== undefined) return { targetCardPredicate: (ctx) => effectiveSpecialSummonTypeCode(ctx.summonTypeCode) === summonTypeIs };
  const summonTypeNot = specialSummonTypeNotTargetDescriptor(effect.luaTargetDescriptor);
  if (summonTypeNot !== undefined) return { targetCardPredicate: (ctx) => effectiveSpecialSummonTypeCode(ctx.summonTypeCode) !== summonTypeNot };
  if (effect.luaTargetDescriptor === "target:special-summon-position-facedown") return { targetCardPredicate: (ctx) => ctx.summonPosition === "faceDownDefense" };
  const xyzSummonNotRelatedSetcode = xyzSummonNotRelatedSetcodeDescriptor(effect.luaTargetDescriptor); if (xyzSummonNotRelatedSetcode !== undefined) return { targetCardPredicate: (ctx) => effectiveSpecialSummonTypeCode(ctx.summonTypeCode) === 0x49000000 && !relatedEffectHandlerMatchesSetcode(ctx, xyzSummonNotRelatedSetcode) };
  const levelAbove = effect.luaTargetDescriptor?.startsWith("target:level-above:") ? Number(effect.luaTargetDescriptor.slice("target:level-above:".length)) : undefined; if (levelAbove !== undefined && Number.isSafeInteger(levelAbove) && levelAbove > 0) return { targetCardPredicate: (ctx, card) => currentLevel(card, ctx.duel) >= levelAbove };
  const attackBelow = effect.luaTargetDescriptor?.startsWith("target:attack-below:") ? Number(effect.luaTargetDescriptor.slice("target:attack-below:".length)) : undefined; if (attackBelow !== undefined && Number.isSafeInteger(attackBelow) && attackBelow > 0) return { targetCardPredicate: (ctx, card) => currentAttack(card, ctx.duel) <= attackBelow };
  const notLevelOrRankAbove = effect.luaTargetDescriptor?.startsWith("target:not-level-or-rank-above:") ? Number(effect.luaTargetDescriptor.slice("target:not-level-or-rank-above:".length)) : undefined; if (notLevelOrRankAbove !== undefined && Number.isSafeInteger(notLevelOrRankAbove) && notLevelOrRankAbove > 0) return { targetCardPredicate: (ctx, card) => !(((cardTypeFlags(card, ctx.duel) & 0x1) !== 0 && currentRank(card, ctx.duel) === 0 && currentLink(card, ctx.duel) === 0 && currentLevel(card, ctx.duel) >= notLevelOrRankAbove) || currentRank(card, ctx.duel) >= notLevelOrRankAbove) };
  const notType = effect.luaTargetDescriptor?.startsWith("target:not-type:") ? Number(effect.luaTargetDescriptor.slice("target:not-type:".length)) : undefined; if (notType !== undefined && Number.isSafeInteger(notType) && notType > 0) return { targetCardPredicate: (ctx, card) => (cardTypeFlags(card, ctx.duel) & notType) === 0 };
  const type = typeTargetDescriptor(effect.luaTargetDescriptor); if (type !== undefined) return { targetCardPredicate: (ctx, card) => (cardTypeFlags(card, ctx.duel) & type) !== 0 && (!effect.luaTargetDescriptor?.startsWith(luaFaceupTypeTargetDescriptorPrefix) || card.faceUp) };
  return {};
}

function xyzSummonNotRelatedSetcodeDescriptor(descriptor: string | undefined): number | undefined {
  if (!descriptor?.startsWith("target:xyz-summon-not-related-setcode:")) return undefined;
  const setcode = Number(descriptor.slice("target:xyz-summon-not-related-setcode:".length));
  return Number.isSafeInteger(setcode) && setcode > 0 ? setcode : undefined;
}

function pendulumSummonNotSetcodeDescriptor(descriptor: string | undefined): number[] | undefined {
  if (!descriptor?.startsWith("target:pendulum-summon-not-setcode:")) return undefined;
  const setcodes = descriptor.slice("target:pendulum-summon-not-setcode:".length).split(",").map(Number);
  return setcodes.length > 0 && setcodes.every((setcode) => Number.isSafeInteger(setcode) && setcode > 0) ? setcodes : undefined;
}

function ritualSummonNotRaceDescriptor(descriptor: string | undefined): number | undefined {
  if (!descriptor?.startsWith("target:ritual-summon-not-race:")) return undefined;
  const race = Number(descriptor.slice("target:ritual-summon-not-race:".length));
  return Number.isSafeInteger(race) && race > 0 ? race : undefined;
}

function extraSummonTypeNotDescriptor(descriptor: string | undefined): number | undefined {
  if (!descriptor?.startsWith("target:extra-summon-type-not:")) return undefined;
  const summonType = Number(descriptor.slice("target:extra-summon-type-not:".length));
  return Number.isSafeInteger(summonType) && summonType > 0 ? summonType : undefined;
}

function relatedEffectHandlerMatchesSetcode(ctx: Parameters<NonNullable<DuelEffectDefinition["targetCardPredicate"]>>[0], setcode: number): boolean {
  const effectId = ctx.relatedEffectId === undefined ? ctx.chainLink?.effectId : `lua-${ctx.relatedEffectId}`;
  const relatedEffect = ctx.duel.effects.find((candidate) => candidate.id === effectId || (effectId !== undefined && candidate.id.startsWith(`${effectId}-`)));
  const handler = ctx.duel.cards.find((card) => card.uid === relatedEffect?.sourceUid);
  return Boolean(handler && currentCardMatchesSetcode(handler, ctx.duel, setcode));
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

function setcodeExtraDescriptor(descriptor: string | undefined): number | undefined {
  if (!descriptor?.startsWith("special-summon-limit:not-setcode-extra:")) return undefined;
  const setcode = Number(descriptor.slice("special-summon-limit:not-setcode-extra:".length));
  return Number.isSafeInteger(setcode) && setcode > 0 ? setcode : undefined;
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

function raceTypeOrSetcodeDescriptor(descriptor: string | undefined): { race: number; type: number; setcode: number } | undefined {
  if (!descriptor?.startsWith("target:not-race-type-or-setcode:")) return undefined;
  const [race, type, setcode] = descriptor.slice("target:not-race-type-or-setcode:".length).split(":").map(Number);
  return race !== undefined && type !== undefined && setcode !== undefined && [race, type, setcode].every((value) => Number.isSafeInteger(value) && value > 0) ? { race, type, setcode } : undefined;
}

function raceAttributeDescriptor(descriptor: string | undefined): { race: number; attribute: number } | undefined {
  if (!descriptor?.startsWith("target:not-race-attribute:")) return undefined;
  const [race, attribute] = descriptor.slice("target:not-race-attribute:".length).split(":").map(Number);
  return race !== undefined && attribute !== undefined && [race, attribute].every((value) => Number.isSafeInteger(value) && value > 0) ? { race, attribute } : undefined;
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
