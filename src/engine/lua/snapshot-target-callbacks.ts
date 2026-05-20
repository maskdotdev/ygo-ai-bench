import { currentCardMatchesCode, currentCardMatchesSetcode } from "#duel/card-code-state.js";
import { cardLink, cardRank, cardTypeFlags, currentAttack, currentAttribute, currentBaseAttack, currentLevel, currentLink, currentRace, currentRank, printedCardTypeFlags } from "#duel/card-stats.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { effectiveSpecialSummonTypeCode } from "#duel/summon-type-codes.js";
import { locationMatchesCardMask } from "#lua/api-utils.js";
import { cardSetcodes, isSetcodeMatch } from "#lua/card-code-utils.js";
import { specialSummonTypeIsAnyTargetDescriptor, specialSummonTypeIsTargetDescriptor, specialSummonTypeNotTargetDescriptor } from "#lua/effect-target-descriptor.js";
import type { DuelEffectDefinition, SerializedDuelEffect } from "#duel/types.js";

const luaSetcodeOrCodeTypeTargetDescriptorPrefix = "target:setcode-or-code-type:";
const luaSetcodeTargetDescriptorPrefix = "target:setcode:";
const luaFaceupSetcodeTargetDescriptorPrefix = "target:faceup-setcode:";
const luaTypeTargetDescriptorPrefix = "target:type:";
const luaFaceupTypeTargetDescriptorPrefix = "target:faceup-type:";
const luaEffectGeminiStatus = 75;
const luaSummonTypeGemini = 0x12000000;
const luaLocationMonsterZone = 0x4;
const luaTypeSpecialSummon = 0x2000000;

export function restoredLuaTargetCallbacks(effect: SerializedDuelEffect): Pick<DuelEffectDefinition, "targetCardPredicate"> {
  const battleTargetType = effect.luaTargetDescriptor?.startsWith("target:source-battle-target-type:") ? Number(effect.luaTargetDescriptor.slice("target:source-battle-target-type:".length)) : undefined; if (battleTargetType !== undefined && Number.isSafeInteger(battleTargetType) && battleTargetType > 0) return { targetCardPredicate: (ctx, card) => { const source = ctx.duel.cards.find((candidate) => candidate.uid === effect.sourceUid); const battle = ctx.duel.currentAttack ?? ctx.duel.pendingBattle; const battleTargetUid = source?.uid === battle?.attackerUid ? battle?.targetUid : source?.uid === battle?.targetUid ? battle?.attackerUid : undefined; return card.uid === battleTargetUid && (cardTypeFlags(card, ctx.duel) & battleTargetType) !== 0; } };
  if (effect.luaTargetDescriptor === "target:source-battle-target" || effect.luaTargetDescriptor === "target:source-or-battle-target") return { targetCardPredicate: (ctx, card) => { const source = ctx.duel.cards.find((candidate) => candidate.uid === effect.sourceUid); const battle = ctx.duel.currentAttack ?? ctx.duel.pendingBattle; const battleTargetUid = source?.uid === battle?.attackerUid ? battle?.targetUid : source?.uid === battle?.targetUid ? battle?.attackerUid : undefined; return card.uid === battleTargetUid || (effect.luaTargetDescriptor === "target:source-or-battle-target" && card.uid === source?.uid); } };
  const statusSummonLocation = statusSummonLocationDescriptor(effect.luaTargetDescriptor); if (statusSummonLocation) return { targetCardPredicate: (_ctx, card) => (targetCardStatusMask(card) & statusSummonLocation.status) !== 0 && Boolean(card.summonType && locationMatchesCardMask(card, statusSummonLocation.location, card.previousLocation, card.previousSequence)) };
  const notStatus = notStatusDescriptor(effect.luaTargetDescriptor); if (notStatus !== undefined) return { targetCardPredicate: (_ctx, card) => (targetCardStatusMask(card) & notStatus) === 0 };
  const status = statusDescriptor(effect.luaTargetDescriptor); if (status !== undefined) return { targetCardPredicate: (_ctx, card) => (targetCardStatusMask(card) & status) !== 0 };
  if (effect.luaTargetDescriptor === "target:gemini-status") return { targetCardPredicate: (ctx, card) => hasRestoredGeminiStatus(ctx.duel, card) };
  const notLocationNotSpellTrap = notLocationNotSpellTrapDescriptor(effect.luaTargetDescriptor);
  if (notLocationNotSpellTrap !== undefined) return { targetCardPredicate: (ctx, card) => !locationMatchesCardMask(card, notLocationNotSpellTrap, card.previousLocation, card.previousSequence) && (cardTypeFlags(card, ctx.duel) & 0x6) === 0 };
  const notRaceDeckOrExtra = effect.luaTargetDescriptor?.startsWith("special-summon-limit:not-race-deck-or-extra:") ? Number(effect.luaTargetDescriptor.slice("special-summon-limit:not-race-deck-or-extra:".length)) : undefined;
  if (notRaceDeckOrExtra !== undefined && Number.isSafeInteger(notRaceDeckOrExtra) && notRaceDeckOrExtra > 0) return { targetCardPredicate: (ctx, card) => (card.location === "deck" || card.location === "extraDeck") && (currentRace(card, ctx.duel) & notRaceDeckOrExtra) === 0 };
  if (effect.luaTargetDescriptor === "special-summon-limit:summonable-card") return { targetCardPredicate: (ctx, card) => card.kind === "monster" && (cardTypeFlags(card, ctx.duel) & luaTypeSpecialSummon) === 0 };
  if (effect.luaTargetDescriptor === "special-summon-limit:deck-or-extra") return { targetCardPredicate: (_ctx, card) => card.location === "deck" || card.location === "extraDeck" };
  if (effect.luaTargetDescriptor === "special-summon-limit:extra") return { targetCardPredicate: (_ctx, card) => card.location === "extraDeck" };
  const sameCodeNotLocation = effect.luaTargetDescriptor?.startsWith("special-summon-limit:same-code-label-not-location:") ? Number(effect.luaTargetDescriptor.slice("special-summon-limit:same-code-label-not-location:".length)) : undefined;
  if (sameCodeNotLocation !== undefined && Number.isSafeInteger(sameCodeNotLocation)) return { targetCardPredicate: (ctx, card) => effect.label !== undefined && currentCardMatchesCode(card, ctx.duel, String(effect.label)) && !locationMatchesCardMask(card, sameCodeNotLocation) };
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
  const notCodeStatus = notCodeStatusDescriptor(effect.luaTargetDescriptor);
  if (notCodeStatus) return { targetCardPredicate: (ctx, card) => !currentCardMatchesCode(card, ctx.duel, String(notCodeStatus.code)) && (targetCardStatusMask(card) & notCodeStatus.status) !== 0 };
  const notSetcode = notSetcodeTargetDescriptor(effect.luaTargetDescriptor); const notSetcodeAny = notSetcodeAnyTargetDescriptor(effect.luaTargetDescriptor); const notRaceExtra = effect.luaTargetDescriptor?.startsWith("special-summon-limit:not-race-extra:") ? Number(effect.luaTargetDescriptor.slice("special-summon-limit:not-race-extra:".length)) : undefined; const notAttributeExtra = effect.luaTargetDescriptor?.startsWith("special-summon-limit:not-attribute-extra:") ? Number(effect.luaTargetDescriptor.slice("special-summon-limit:not-attribute-extra:".length)) : undefined; const notAttribute = effect.luaTargetDescriptor?.startsWith("target:not-attribute:") ? Number(effect.luaTargetDescriptor.slice("target:not-attribute:".length)) : undefined; const attribute = effect.luaTargetDescriptor?.startsWith("target:attribute:") ? Number(effect.luaTargetDescriptor.slice("target:attribute:".length)) : undefined; const race = effect.luaTargetDescriptor?.startsWith("target:race:") ? Number(effect.luaTargetDescriptor.slice("target:race:".length)) : undefined; const notRace = effect.luaTargetDescriptor?.startsWith("target:not-race:") ? Number(effect.luaTargetDescriptor.slice("target:not-race:".length)) : undefined; const notCode = effect.luaTargetDescriptor?.startsWith("target:not-code:") ? Number(effect.luaTargetDescriptor.slice("target:not-code:".length)) : undefined; const code = effect.luaTargetDescriptor?.startsWith("target:code:") ? Number(effect.luaTargetDescriptor.slice("target:code:".length)) : undefined;
  if (notSetcode !== undefined) return { targetCardPredicate: (_ctx, card) => !cardSetcodes(card).some((setcode) => isSetcodeMatch(notSetcode, setcode)) }; if (notRaceExtra !== undefined && Number.isSafeInteger(notRaceExtra) && notRaceExtra > 0) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && (currentRace(card, ctx.duel) & notRaceExtra) === 0 }; if (notAttributeExtra !== undefined && Number.isSafeInteger(notAttributeExtra) && notAttributeExtra > 0) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && (currentAttribute(card, ctx.duel) & notAttributeExtra) === 0 }; if (notAttribute !== undefined && Number.isSafeInteger(notAttribute) && notAttribute > 0) return { targetCardPredicate: (ctx, card) => (currentAttribute(card, ctx.duel) & notAttribute) === 0 }; if (attribute !== undefined && Number.isSafeInteger(attribute) && attribute > 0) return { targetCardPredicate: (ctx, card) => (currentAttribute(card, ctx.duel) & attribute) !== 0 }; if (race !== undefined && Number.isSafeInteger(race) && race > 0) return { targetCardPredicate: (ctx, card) => (currentRace(card, ctx.duel) & race) !== 0 }; if (notRace !== undefined && Number.isSafeInteger(notRace) && notRace > 0) return { targetCardPredicate: (ctx, card) => (currentRace(card, ctx.duel) & notRace) === 0 }; if (notCode !== undefined && Number.isSafeInteger(notCode) && notCode > 0) return { targetCardPredicate: (ctx, card) => !currentCardMatchesCode(card, ctx.duel, String(notCode)) }; if (code !== undefined && Number.isSafeInteger(code) && code > 0) return { targetCardPredicate: (ctx, card) => currentCardMatchesCode(card, ctx.duel, String(code)) };
  const notOriginalAttribute = effect.luaTargetDescriptor?.startsWith("target:not-original-attribute:") ? Number(effect.luaTargetDescriptor.slice("target:not-original-attribute:".length)) : undefined;
  if (notOriginalAttribute !== undefined && Number.isSafeInteger(notOriginalAttribute) && notOriginalAttribute > 0) return { targetCardPredicate: (_ctx, card) => ((card.data.attribute ?? 0) & notOriginalAttribute) === 0 };
  const notOriginalRace = effect.luaTargetDescriptor?.startsWith("target:not-original-race:") ? Number(effect.luaTargetDescriptor.slice("target:not-original-race:".length)) : undefined;
  if (notOriginalRace !== undefined && Number.isSafeInteger(notOriginalRace) && notOriginalRace > 0) return { targetCardPredicate: (_ctx, card) => ((card.data.race ?? 0) & notOriginalRace) === 0 };
  const notOriginalRaceTextAttack = originalRaceTextAttackDescriptor(effect.luaTargetDescriptor); if (notOriginalRaceTextAttack) return { targetCardPredicate: (ctx, card) => ((card.data.race ?? 0) & notOriginalRaceTextAttack.race) === 0 || currentAttack(card, ctx.duel) === -2 || currentAttack(card, ctx.duel) > notOriginalRaceTextAttack.attack };
  const notOriginalSetcode = effect.luaTargetDescriptor?.startsWith("target:not-original-setcode:") ? Number(effect.luaTargetDescriptor.slice("target:not-original-setcode:".length)) : undefined;
  if (notOriginalSetcode !== undefined && Number.isSafeInteger(notOriginalSetcode) && notOriginalSetcode > 0) return { targetCardPredicate: (_ctx, card) => !cardSetcodes(card).some((setcode) => isSetcodeMatch(notOriginalSetcode, setcode)) };
  if (notSetcodeAny !== undefined) return { targetCardPredicate: (_ctx, card) => !notSetcodeAny.some((blocked) => cardSetcodes(card).some((setcode) => isSetcodeMatch(blocked, setcode))) };
  const notOriginalSetcodeAny = notOriginalSetcodeAnyTargetDescriptor(effect.luaTargetDescriptor);
  if (notOriginalSetcodeAny !== undefined) return { targetCardPredicate: (_ctx, card) => !notOriginalSetcodeAny.some((blocked) => cardSetcodes(card).some((setcode) => isSetcodeMatch(blocked, setcode))) };
  const originalAttribute = effect.luaTargetDescriptor?.startsWith("target:original-attribute:") ? Number(effect.luaTargetDescriptor.slice("target:original-attribute:".length)) : undefined;
  if (originalAttribute !== undefined && Number.isSafeInteger(originalAttribute) && originalAttribute > 0) return { targetCardPredicate: (_ctx, card) => ((card.data.attribute ?? 0) & originalAttribute) !== 0 };
  const originalSetcode = effect.luaTargetDescriptor?.startsWith("target:original-setcode:") ? Number(effect.luaTargetDescriptor.slice("target:original-setcode:".length)) : undefined;
  if (originalSetcode !== undefined && Number.isSafeInteger(originalSetcode) && originalSetcode > 0) return { targetCardPredicate: (_ctx, card) => cardSetcodes(card).some((setcode) => isSetcodeMatch(originalSetcode, setcode)) };
  const originalSetcodeAny = originalSetcodeAnyTargetDescriptor(effect.luaTargetDescriptor);
  if (originalSetcodeAny !== undefined) return { targetCardPredicate: (_ctx, card) => originalSetcodeAny.some((blocked) => cardSetcodes(card).some((setcode) => isSetcodeMatch(blocked, setcode))) };
  const setcode = setcodeTargetDescriptor(effect.luaTargetDescriptor);
  if (setcode !== undefined) return { targetCardPredicate: (ctx, card) => currentCardMatchesSetcode(card, ctx.duel, setcode) && (!effect.luaTargetDescriptor?.startsWith(luaFaceupSetcodeTargetDescriptorPrefix) || card.faceUp) };
  const setcodeAny = setcodeAnyTargetDescriptor(effect.luaTargetDescriptor);
  if (setcodeAny !== undefined) return { targetCardPredicate: (ctx, card) => setcodeAny.some((candidate) => currentCardMatchesSetcode(card, ctx.duel, candidate)) };
  if (effect.luaTargetDescriptor === "target:same-code-label" || effect.luaTargetDescriptor === "target:same-code-label-object-label") return { targetCardPredicate: (ctx, card) => effect.label !== undefined && currentCardMatchesCode(card, ctx.duel, String(effect.label)) };
  const pendulumSummonNotSetcode = pendulumSummonNotSetcodeDescriptor(effect.luaTargetDescriptor);
  if (pendulumSummonNotSetcode !== undefined) return { targetCardPredicate: (ctx, card) => effectiveSpecialSummonTypeCode(ctx.summonTypeCode) === 0x4a000000 && !pendulumSummonNotSetcode.some((setcode) => currentCardMatchesSetcode(card, ctx.duel, setcode)) };
  const pendulumSummonNotAttribute = pendulumSummonNotAttributeDescriptor(effect.luaTargetDescriptor);
  if (pendulumSummonNotAttribute !== undefined) return { targetCardPredicate: (ctx, card) => effectiveSpecialSummonTypeCode(ctx.summonTypeCode) === 0x4a000000 && (currentAttribute(card, ctx.duel) & pendulumSummonNotAttribute) === 0 };
  const pendulumSummonNotRace = pendulumSummonNotRaceDescriptor(effect.luaTargetDescriptor);
  if (pendulumSummonNotRace !== undefined) return { targetCardPredicate: (ctx, card) => effectiveSpecialSummonTypeCode(ctx.summonTypeCode) === 0x4a000000 && (currentRace(card, ctx.duel) & pendulumSummonNotRace) === 0 };
  const pendulumSummonNotSetcodeMonster = pendulumSummonNotSetcodeMonsterDescriptor(effect.luaTargetDescriptor);
  if (pendulumSummonNotSetcodeMonster !== undefined) return { targetCardPredicate: (ctx, card) => effectiveSpecialSummonTypeCode(ctx.summonTypeCode) === 0x4a000000 && (!currentCardMatchesSetcode(card, ctx.duel, pendulumSummonNotSetcodeMonster) || (cardTypeFlags(card, ctx.duel) & 0x1) === 0) };
  const ritualSummonNotRace = ritualSummonNotRaceDescriptor(effect.luaTargetDescriptor);
  if (ritualSummonNotRace !== undefined) return { targetCardPredicate: (ctx, card) => effectiveSpecialSummonTypeCode(ctx.summonTypeCode) === 0x45000000 && (currentRace(card, ctx.duel) & ritualSummonNotRace) === 0 };
  const extraSummonTypeNot = extraSummonTypeNotDescriptor(effect.luaTargetDescriptor);
  if (extraSummonTypeNot !== undefined) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && effectiveSpecialSummonTypeCode(ctx.summonTypeCode) !== extraSummonTypeNot };
  const extraSummonTypeNotOrNoProcedure = extraSummonTypeNotOrNoProcedureDescriptor(effect.luaTargetDescriptor);
  if (extraSummonTypeNotOrNoProcedure !== undefined) return { targetCardPredicate: (ctx, card) => card.location === "extraDeck" && (effectiveSpecialSummonTypeCode(ctx.summonTypeCode) !== extraSummonTypeNotOrNoProcedure || ctx.relatedEffectId === undefined) };
  const linkSummonLinkAbove = linkSummonLinkAboveDescriptor(effect.luaTargetDescriptor);
  if (linkSummonLinkAbove !== undefined) return { targetCardPredicate: (ctx, card) => effectiveSpecialSummonTypeCode(ctx.summonTypeCode) === 0x4c000000 && (cardTypeFlags(card, ctx.duel) & 0x4000000) !== 0 && currentLink(card, ctx.duel) >= linkSummonLinkAbove };
  const linkSummonLinkAboveHandlerCounter = linkSummonLinkAboveHandlerCounterDescriptor(effect.luaTargetDescriptor);
  if (linkSummonLinkAboveHandlerCounter !== undefined) return { targetCardPredicate: (ctx, card) => {
    const source = ctx.duel.cards.find((candidate) => candidate.uid === effect.sourceUid);
    return effectiveSpecialSummonTypeCode(ctx.summonTypeCode) === 0x4c000000 && currentLink(card, ctx.duel) > getDuelCardCounter(source, linkSummonLinkAboveHandlerCounter);
  } };
  if (effect.luaTargetDescriptor === "target:link-summon-below-field-max-link") return { targetCardPredicate: (ctx, card) => {
    const maxFieldLink = ctx.duel.cards.reduce((max, candidate) => candidate.location === "monsterZone" && candidate.faceUp ? Math.max(max, currentLink(candidate, ctx.duel)) : max, 0);
    return effectiveSpecialSummonTypeCode(ctx.summonTypeCode) === 0x4c000000 && maxFieldLink > currentLink(card, ctx.duel);
  } };
  const linkSummonCode = linkSummonCodeDescriptor(effect.luaTargetDescriptor);
  if (linkSummonCode !== undefined) return { targetCardPredicate: (ctx, card) => effectiveSpecialSummonTypeCode(ctx.summonTypeCode) === 0x4c000000 && currentCardMatchesCode(card, ctx.duel, String(linkSummonCode)) };
  const summonTypeCode = summonTypeCodeDescriptor(effect.luaTargetDescriptor);
  if (summonTypeCode !== undefined) return { targetCardPredicate: (ctx, card) => effectiveSpecialSummonTypeCode(ctx.summonTypeCode) === summonTypeCode.summonType && currentCardMatchesCode(card, ctx.duel, String(summonTypeCode.code)) };
  const summonTypeCodeAny = summonTypeCodeAnyDescriptor(effect.luaTargetDescriptor);
  if (summonTypeCodeAny !== undefined) return { targetCardPredicate: (ctx, card) => summonTypeCodeAny.summonTypes.includes(effectiveSpecialSummonTypeCode(ctx.summonTypeCode)) && (summonTypeCodeAny.original ? card.code === String(summonTypeCodeAny.code) : currentCardMatchesCode(card, ctx.duel, String(summonTypeCodeAny.code))) };
  const summonTypeIsAny = specialSummonTypeIsAnyTargetDescriptor(effect.luaTargetDescriptor);
  if (summonTypeIsAny !== undefined) return { targetCardPredicate: (ctx) => summonTypeIsAny.includes(effectiveSpecialSummonTypeCode(ctx.summonTypeCode)) };
  const summonTypeIs = specialSummonTypeIsTargetDescriptor(effect.luaTargetDescriptor);
  if (summonTypeIs !== undefined) return { targetCardPredicate: (ctx) => effectiveSpecialSummonTypeCode(ctx.summonTypeCode) === summonTypeIs };
  const summonTypeNot = specialSummonTypeNotTargetDescriptor(effect.luaTargetDescriptor);
  if (summonTypeNot !== undefined) return { targetCardPredicate: (ctx) => effectiveSpecialSummonTypeCode(ctx.summonTypeCode) !== summonTypeNot };
  if (effect.luaTargetDescriptor === "special-summon-limit:not-label-object-effect") return { targetCardPredicate: (ctx) => {
    const relatedEffectId = ctx.relatedEffectId === undefined ? undefined : `lua-${ctx.relatedEffectId}`;
    const relatedEffect = relatedEffectId === undefined ? undefined : ctx.duel.effects.find((candidate) => candidate.id === relatedEffectId || candidate.id.startsWith(`${relatedEffectId}-`));
    return relatedEffect?.sourceUid !== effect.sourceUid;
  } };
  const notRelatedEffect = effect.luaTargetDescriptor?.startsWith("special-summon-limit:not-related-effect:") ? Number(effect.luaTargetDescriptor.slice("special-summon-limit:not-related-effect:".length)) : undefined;
  if (notRelatedEffect !== undefined && Number.isSafeInteger(notRelatedEffect)) return { targetCardPredicate: (ctx) => ctx.relatedEffectId !== notRelatedEffect };
  if (effect.luaTargetDescriptor === "target:special-summon-position-facedown") return { targetCardPredicate: (ctx) => ctx.summonPosition === "faceDownDefense" };
  const xyzSummonNotRelatedSetcode = xyzSummonNotRelatedSetcodeDescriptor(effect.luaTargetDescriptor); if (xyzSummonNotRelatedSetcode !== undefined) return { targetCardPredicate: (ctx) => effectiveSpecialSummonTypeCode(ctx.summonTypeCode) === 0x49000000 && !relatedEffectHandlerMatchesSetcode(ctx, xyzSummonNotRelatedSetcode) };
  const levelAbove = effect.luaTargetDescriptor?.startsWith("target:level-above:") ? Number(effect.luaTargetDescriptor.slice("target:level-above:".length)) : undefined; if (levelAbove !== undefined && Number.isSafeInteger(levelAbove) && levelAbove > 0) return { targetCardPredicate: (ctx, card) => currentLevel(card, ctx.duel) >= levelAbove };
  const attackBelow = effect.luaTargetDescriptor?.startsWith("target:attack-below:") ? Number(effect.luaTargetDescriptor.slice("target:attack-below:".length)) : undefined; if (attackBelow !== undefined && Number.isSafeInteger(attackBelow) && attackBelow > 0) return { targetCardPredicate: (ctx, card) => currentAttack(card, ctx.duel) <= attackBelow };
  const notLinkBelow = effect.luaTargetDescriptor?.startsWith("target:not-link-below:") ? Number(effect.luaTargetDescriptor.slice("target:not-link-below:".length)) : undefined; if (notLinkBelow !== undefined && Number.isSafeInteger(notLinkBelow) && notLinkBelow > 0) return { targetCardPredicate: (ctx, card) => currentLink(card, ctx.duel) > notLinkBelow };
  const notLevelAboveRace = levelAboveRaceDescriptor(effect.luaTargetDescriptor); if (notLevelAboveRace) return { targetCardPredicate: (ctx, card) => currentLevel(card, ctx.duel) < notLevelAboveRace.level || (currentRace(card, ctx.duel) & notLevelAboveRace.race) === 0 };
  const notLevelOrRankAbove = effect.luaTargetDescriptor?.startsWith("target:not-level-or-rank-above:") ? Number(effect.luaTargetDescriptor.slice("target:not-level-or-rank-above:".length)) : undefined; if (notLevelOrRankAbove !== undefined && Number.isSafeInteger(notLevelOrRankAbove) && notLevelOrRankAbove > 0) return { targetCardPredicate: (ctx, card) => !(((cardTypeFlags(card, ctx.duel) & 0x1) !== 0 && currentRank(card, ctx.duel) === 0 && currentLink(card, ctx.duel) === 0 && currentLevel(card, ctx.duel) >= notLevelOrRankAbove) || currentRank(card, ctx.duel) >= notLevelOrRankAbove) };
  const notOriginalTypeAttribute = originalTypeAttributeDescriptor(effect.luaTargetDescriptor); if (notOriginalTypeAttribute) return { targetCardPredicate: (_ctx, card) => (printedCardTypeFlags(card) & notOriginalTypeAttribute.type) === 0 || ((card.data.attribute ?? 0) & notOriginalTypeAttribute.attribute) === 0 };
  const notOriginalTypeRace = originalTypeRaceDescriptor(effect.luaTargetDescriptor); if (notOriginalTypeRace) return { targetCardPredicate: (_ctx, card) => (printedCardTypeFlags(card) & notOriginalTypeRace.type) === 0 || ((card.data.race ?? 0) & notOriginalTypeRace.race) === 0 };
  const notOriginalTypeRank = originalTypeRankDescriptor(effect.luaTargetDescriptor); if (notOriginalTypeRank) return { targetCardPredicate: (_ctx, card) => (printedCardTypeFlags(card) & notOriginalTypeRank.type) === 0 || cardRank(card) !== notOriginalTypeRank.rank };
  const notOriginalLevelCurrentType = originalLevelCurrentTypeDescriptor(effect.luaTargetDescriptor); if (notOriginalLevelCurrentType) return { targetCardPredicate: (ctx, card) => (cardTypeFlags(card, ctx.duel) & 0x1) === 0 || cardRank(card) !== 0 || cardLink(card) !== 0 || (card.data.level ?? 0) !== notOriginalLevelCurrentType.level || (cardTypeFlags(card, ctx.duel) & notOriginalLevelCurrentType.type) === 0 };
  const notOriginalLevelAboveAttribute = originalLevelAboveAttributeDescriptor(effect.luaTargetDescriptor); if (notOriginalLevelAboveAttribute) return { targetCardPredicate: (_ctx, card) => (card.data.level ?? 0) < notOriginalLevelAboveAttribute.level || ((card.data.attribute ?? 0) & notOriginalLevelAboveAttribute.attribute) === 0 };
  const notOriginalAttributeRace = originalAttributeRaceDescriptor(effect.luaTargetDescriptor); if (notOriginalAttributeRace) return { targetCardPredicate: (_ctx, card) => ((card.data.attribute ?? 0) & notOriginalAttributeRace.attribute) === 0 || ((card.data.race ?? 0) & notOriginalAttributeRace.race) === 0 };
  const notOriginalTypeCurrentAttribute = originalTypeCurrentAttributeDescriptor(effect.luaTargetDescriptor); if (notOriginalTypeCurrentAttribute) return { targetCardPredicate: (ctx, card) => (printedCardTypeFlags(card) & notOriginalTypeCurrentAttribute.type) === 0 || (currentAttribute(card, ctx.duel) & notOriginalTypeCurrentAttribute.attribute) === 0 };
  const notOriginalTypeAttributeRace = originalTypeAttributeRaceDescriptor(effect.luaTargetDescriptor); if (notOriginalTypeAttributeRace) return { targetCardPredicate: (_ctx, card) => (printedCardTypeFlags(card) & notOriginalTypeAttributeRace.type) === 0 || ((card.data.attribute ?? 0) & notOriginalTypeAttributeRace.attribute) === 0 || ((card.data.race ?? 0) & notOriginalTypeAttributeRace.race) === 0 };
  const notOriginalType = effect.luaTargetDescriptor?.startsWith("target:not-original-type:") ? Number(effect.luaTargetDescriptor.slice("target:not-original-type:".length)) : undefined; if (notOriginalType !== undefined && Number.isSafeInteger(notOriginalType) && notOriginalType > 0) return { targetCardPredicate: (_ctx, card) => (printedCardTypeFlags(card) & notOriginalType) === 0 };
  const originalType = effect.luaTargetDescriptor?.startsWith("target:original-type:") ? Number(effect.luaTargetDescriptor.slice("target:original-type:".length)) : undefined; if (originalType !== undefined && Number.isSafeInteger(originalType) && originalType > 0) return { targetCardPredicate: (_ctx, card) => (printedCardTypeFlags(card) & originalType) !== 0 };
  const notType = effect.luaTargetDescriptor?.startsWith("target:not-type:") ? Number(effect.luaTargetDescriptor.slice("target:not-type:".length)) : undefined; if (notType !== undefined && Number.isSafeInteger(notType) && notType > 0) return { targetCardPredicate: (ctx, card) => (cardTypeFlags(card, ctx.duel) & notType) === 0 };
  const type = typeTargetDescriptor(effect.luaTargetDescriptor); if (type !== undefined) return { targetCardPredicate: (ctx, card) => (cardTypeFlags(card, ctx.duel) & type) !== 0 && (!effect.luaTargetDescriptor?.startsWith(luaFaceupTypeTargetDescriptorPrefix) || card.faceUp) };
  return {};
}

function targetCardStatusMask(card: Parameters<NonNullable<DuelEffectDefinition["targetCardPredicate"]>>[1]): number {
  return (card.customStatusMask ?? 0) | (card.summonType === "normal" || card.summonType === "tribute" ? 0x800 : 0) | (card.summonType === "flip" ? 0x20000000 : 0) | (card.summonType && card.summonType !== "normal" && card.summonType !== "tribute" && card.summonType !== "flip" ? 0x40000000 : 0);
}

function hasRestoredGeminiStatus(
  duel: Parameters<NonNullable<DuelEffectDefinition["targetCardPredicate"]>>[0]["duel"],
  card: Parameters<NonNullable<DuelEffectDefinition["targetCardPredicate"]>>[1],
): boolean {
  return (
    card.location === "monsterZone" &&
    ((card.faceUp && isSummonTypeMatch(card.summonTypeCode, luaSummonTypeGemini) && locationMatchesCardMask(card, luaLocationMonsterZone, card.previousLocation, card.previousSequence))
      || duel.effects.some((candidate) => candidate.code === luaEffectGeminiStatus && candidate.sourceUid === card.uid))
  );
}

function isSummonTypeMatch(actual: number | undefined, requested: number): boolean {
  return actual !== undefined && actual !== 0 && requested !== 0 && (actual === requested || (actual & requested) === requested);
}

function statusSummonLocationDescriptor(descriptor: string | undefined): { status: number; location: number } | undefined {
  if (!descriptor?.startsWith("target:status-summon-location:")) return undefined;
  const [status, location] = descriptor.slice("target:status-summon-location:".length).split(":").map(Number);
  return status !== undefined && location !== undefined && [status, location].every((value) => Number.isSafeInteger(value) && value > 0) ? { status, location } : undefined;
}

function notStatusDescriptor(descriptor: string | undefined): number | undefined {
  if (!descriptor?.startsWith("target:not-status:")) return undefined;
  const status = Number(descriptor.slice("target:not-status:".length));
  return Number.isSafeInteger(status) && status > 0 ? status : undefined;
}

function statusDescriptor(descriptor: string | undefined): number | undefined {
  if (!descriptor?.startsWith("target:status:")) return undefined;
  const status = Number(descriptor.slice("target:status:".length));
  return Number.isSafeInteger(status) && status > 0 ? status : undefined;
}

function notLocationNotSpellTrapDescriptor(descriptor: string | undefined): number | undefined {
  if (!descriptor?.startsWith("target:not-location-not-spelltrap:")) return undefined;
  const location = Number(descriptor.slice("target:not-location-not-spelltrap:".length));
  return Number.isSafeInteger(location) && location > 0 ? location : undefined;
}

function notCodeStatusDescriptor(descriptor: string | undefined): { code: number; status: number } | undefined {
  if (!descriptor?.startsWith("target:not-code-status:")) return undefined;
  const [code, status] = descriptor.slice("target:not-code-status:".length).split(":").map(Number);
  return code !== undefined && status !== undefined && [code, status].every((value) => Number.isSafeInteger(value) && value > 0) ? { code, status } : undefined;
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

function pendulumSummonNotAttributeDescriptor(descriptor: string | undefined): number | undefined {
  if (!descriptor?.startsWith("target:pendulum-summon-not-attribute:")) return undefined;
  const attribute = Number(descriptor.slice("target:pendulum-summon-not-attribute:".length));
  return Number.isSafeInteger(attribute) && attribute > 0 ? attribute : undefined;
}

function pendulumSummonNotRaceDescriptor(descriptor: string | undefined): number | undefined {
  if (!descriptor?.startsWith("target:pendulum-summon-not-race:")) return undefined;
  const race = Number(descriptor.slice("target:pendulum-summon-not-race:".length));
  return Number.isSafeInteger(race) && race > 0 ? race : undefined;
}

function pendulumSummonNotSetcodeMonsterDescriptor(descriptor: string | undefined): number | undefined {
  if (!descriptor?.startsWith("target:pendulum-summon-not-setcode-monster:")) return undefined;
  const setcode = Number(descriptor.slice("target:pendulum-summon-not-setcode-monster:".length));
  return Number.isSafeInteger(setcode) && setcode > 0 ? setcode : undefined;
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

function extraSummonTypeNotOrNoProcedureDescriptor(descriptor: string | undefined): number | undefined {
  if (!descriptor?.startsWith("target:extra-summon-type-not-or-no-procedure:")) return undefined;
  const summonType = Number(descriptor.slice("target:extra-summon-type-not-or-no-procedure:".length));
  return Number.isSafeInteger(summonType) && summonType > 0 ? summonType : undefined;
}

function linkSummonLinkAboveDescriptor(descriptor: string | undefined): number | undefined {
  if (!descriptor?.startsWith("target:link-summon-link-above:")) return undefined;
  const link = Number(descriptor.slice("target:link-summon-link-above:".length));
  return Number.isSafeInteger(link) && link > 0 ? link : undefined;
}

function levelAboveRaceDescriptor(descriptor: string | undefined): { level: number; race: number } | undefined {
  if (!descriptor?.startsWith("target:not-level-above-race:")) return undefined;
  const [level, race] = descriptor.slice("target:not-level-above-race:".length).split(":").map(Number);
  return level !== undefined && race !== undefined && [level, race].every((value) => Number.isSafeInteger(value) && value > 0) ? { level, race } : undefined;
}

function linkSummonLinkAboveHandlerCounterDescriptor(descriptor: string | undefined): number | undefined {
  if (!descriptor?.startsWith("target:link-summon-link-above-handler-counter:")) return undefined;
  const counter = Number(descriptor.slice("target:link-summon-link-above-handler-counter:".length));
  return Number.isSafeInteger(counter) && counter > 0 ? counter : undefined;
}

function linkSummonCodeDescriptor(descriptor: string | undefined): number | undefined {
  if (!descriptor?.startsWith("target:link-summon-code:")) return undefined;
  const code = Number(descriptor.slice("target:link-summon-code:".length));
  return Number.isSafeInteger(code) && code > 0 ? code : undefined;
}

function summonTypeCodeDescriptor(descriptor: string | undefined): { summonType: number; code: number } | undefined {
  if (!descriptor?.startsWith("target:summon-type-code:")) return undefined;
  const [summonType, code] = descriptor.slice("target:summon-type-code:".length).split(":").map(Number);
  if (summonType === undefined || code === undefined) return undefined;
  return [summonType, code].every((value) => Number.isSafeInteger(value) && value > 0) ? { summonType, code } : undefined;
}

function summonTypeCodeAnyDescriptor(descriptor: string | undefined): { original: boolean; summonTypes: number[]; code: number } | undefined {
  if (!descriptor?.startsWith("target:summon-type-code-any:")) return undefined;
  const [mode, summonTypesText, codeText] = descriptor.slice("target:summon-type-code-any:".length).split(":");
  const summonTypes = summonTypesText?.split(",").map(Number) ?? [];
  const code = codeText === undefined ? undefined : Number(codeText);
  if ((mode !== "current" && mode !== "original") || code === undefined) return undefined;
  return summonTypes.length > 0 && [code, ...summonTypes].every((value) => Number.isSafeInteger(value) && value > 0) ? { original: mode === "original", summonTypes, code } : undefined;
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

function originalTypeAttributeDescriptor(descriptor: string | undefined): { type: number; attribute: number } | undefined {
  if (!descriptor?.startsWith("target:not-original-type-attribute:")) return undefined;
  const [type, attribute] = descriptor.slice("target:not-original-type-attribute:".length).split(":").map(Number);
  return type !== undefined && attribute !== undefined && [type, attribute].every((value) => Number.isSafeInteger(value) && value > 0) ? { type, attribute } : undefined;
}

function originalTypeRaceDescriptor(descriptor: string | undefined): { type: number; race: number } | undefined {
  if (!descriptor?.startsWith("target:not-original-type-race:")) return undefined;
  const [type, race] = descriptor.slice("target:not-original-type-race:".length).split(":").map(Number);
  return type !== undefined && race !== undefined && [type, race].every((value) => Number.isSafeInteger(value) && value > 0) ? { type, race } : undefined;
}

function originalTypeRankDescriptor(descriptor: string | undefined): { type: number; rank: number } | undefined {
  if (!descriptor?.startsWith("target:not-original-type-rank:")) return undefined;
  const [type, rank] = descriptor.slice("target:not-original-type-rank:".length).split(":").map(Number);
  return type !== undefined && rank !== undefined && [type, rank].every((value) => Number.isSafeInteger(value) && value > 0) ? { type, rank } : undefined;
}

function originalLevelCurrentTypeDescriptor(descriptor: string | undefined): { level: number; type: number } | undefined {
  if (!descriptor?.startsWith("target:not-original-level-current-type:")) return undefined;
  const [level, type] = descriptor.slice("target:not-original-level-current-type:".length).split(":").map(Number);
  return level !== undefined && type !== undefined && [level, type].every((value) => Number.isSafeInteger(value) && value > 0) ? { level, type } : undefined;
}

function originalLevelAboveAttributeDescriptor(descriptor: string | undefined): { level: number; attribute: number } | undefined {
  if (!descriptor?.startsWith("target:not-original-level-above-attribute:")) return undefined;
  const [level, attribute] = descriptor.slice("target:not-original-level-above-attribute:".length).split(":").map(Number);
  return level !== undefined && attribute !== undefined && [level, attribute].every((value) => Number.isSafeInteger(value) && value > 0) ? { level, attribute } : undefined;
}

function originalAttributeRaceDescriptor(descriptor: string | undefined): { attribute: number; race: number } | undefined {
  if (!descriptor?.startsWith("target:not-original-attribute-race:")) return undefined;
  const [attribute, race] = descriptor.slice("target:not-original-attribute-race:".length).split(":").map(Number);
  return attribute !== undefined && race !== undefined && [attribute, race].every((value) => Number.isSafeInteger(value) && value > 0) ? { attribute, race } : undefined;
}

function originalRaceTextAttackDescriptor(descriptor: string | undefined): { race: number; attack: number } | undefined {
  if (!descriptor?.startsWith("target:not-original-race-text-attack-lte:")) return undefined;
  const [race, attack] = descriptor.slice("target:not-original-race-text-attack-lte:".length).split(":").map(Number);
  return race !== undefined && attack !== undefined && [race, attack].every((value) => Number.isSafeInteger(value) && value > 0) ? { race, attack } : undefined;
}

function originalTypeCurrentAttributeDescriptor(descriptor: string | undefined): { type: number; attribute: number } | undefined {
  if (!descriptor?.startsWith("target:not-original-type-current-attribute:")) return undefined;
  const [type, attribute] = descriptor.slice("target:not-original-type-current-attribute:".length).split(":").map(Number);
  return type !== undefined && attribute !== undefined && [type, attribute].every((value) => Number.isSafeInteger(value) && value > 0) ? { type, attribute } : undefined;
}

function originalTypeAttributeRaceDescriptor(descriptor: string | undefined): { type: number; attribute: number; race: number } | undefined {
  if (!descriptor?.startsWith("target:not-original-type-attribute-race:")) return undefined;
  const [type, attribute, race] = descriptor.slice("target:not-original-type-attribute-race:".length).split(":").map(Number);
  return type !== undefined && attribute !== undefined && race !== undefined && [type, attribute, race].every((value) => Number.isSafeInteger(value) && value > 0) ? { type, attribute, race } : undefined;
}

export function notSetcodeTargetDescriptor(descriptor: string | undefined): number | undefined {
  const match = descriptor?.match(/^target:not-setcode:(\d+)$/);
  const setcode = match?.[1] ? Number(match[1]) : undefined;
  return setcode !== undefined && Number.isSafeInteger(setcode) && setcode > 0 ? setcode : undefined;
}

function notSetcodeAnyTargetDescriptor(descriptor: string | undefined): number[] | undefined {
  if (!descriptor?.startsWith("target:not-setcode-any:")) return undefined;
  const setcodes = descriptor.slice("target:not-setcode-any:".length).split(",").map(Number);
  return setcodes.length > 0 && setcodes.every((setcode) => Number.isSafeInteger(setcode) && setcode > 0) ? setcodes : undefined;
}

function notOriginalSetcodeAnyTargetDescriptor(descriptor: string | undefined): number[] | undefined {
  if (!descriptor?.startsWith("target:not-original-setcode-any:")) return undefined;
  const setcodes = descriptor.slice("target:not-original-setcode-any:".length).split(",").map(Number);
  return setcodes.length > 0 && setcodes.every((setcode) => Number.isSafeInteger(setcode) && setcode > 0) ? setcodes : undefined;
}

function originalSetcodeAnyTargetDescriptor(descriptor: string | undefined): number[] | undefined {
  if (!descriptor?.startsWith("target:original-setcode-any:")) return undefined;
  const setcodes = descriptor.slice("target:original-setcode-any:".length).split(",").map(Number);
  return setcodes.length > 0 && setcodes.every((setcode) => Number.isSafeInteger(setcode) && setcode > 0) ? setcodes : undefined;
}

export function typeTargetDescriptor(descriptor: string | undefined): number | undefined {
  const prefix = descriptor?.startsWith(luaFaceupTypeTargetDescriptorPrefix) ? luaFaceupTypeTargetDescriptorPrefix : luaTypeTargetDescriptorPrefix;
  if (!descriptor?.startsWith(prefix)) return undefined;
  const type = Number(descriptor.slice(prefix.length));
  return Number.isSafeInteger(type) && type > 0 ? type : undefined;
}

export function setcodeTargetDescriptor(descriptor: string | undefined): number | undefined {
  const prefix = descriptor?.startsWith(luaFaceupSetcodeTargetDescriptorPrefix) ? luaFaceupSetcodeTargetDescriptorPrefix : luaSetcodeTargetDescriptorPrefix;
  if (!descriptor?.startsWith(prefix)) return undefined;
  const setcode = Number(descriptor.slice(prefix.length));
  return Number.isSafeInteger(setcode) && setcode > 0 ? setcode : undefined;
}

function setcodeAnyTargetDescriptor(descriptor: string | undefined): number[] | undefined {
  if (!descriptor?.startsWith("target:setcode-any:")) return undefined;
  const setcodes = descriptor.slice("target:setcode-any:".length).split(",").map(Number);
  return setcodes.length > 0 && setcodes.every((setcode) => Number.isSafeInteger(setcode) && setcode > 0) ? setcodes : undefined;
}
