import fengari from "fengari";
import { luaFunctionParams, luaFunctionSourceSnippet } from "#lua/effect-descriptor-source.js";
import type { LuaHostState } from "#lua/host-types.js";

const { lua, to_jsstring, to_luastring } = fengari;
const numericOrIdentifierPattern = String.raw`(?:0x[0-9A-Fa-f]+|\d+|[A-Za-z_]\w*)`;
const numericExpressionPattern = String.raw`${numericOrIdentifierPattern}(?:\s*\+\s*${numericOrIdentifierPattern})*`;
const numericMaskExpressionPattern = String.raw`${numericOrIdentifierPattern}(?:\s*(?:\+|\|)\s*${numericOrIdentifierPattern})*`;
const effectTypeActivatePattern = "(?:EFFECT_TYPE_ACTIVATE|16|0x10)";
const effectTypeActionsPattern = "(?:EFFECT_TYPE_ACTIONS|8|0x8)";
const effectTypeContinuousPattern = "(?:EFFECT_TYPE_CONTINUOUS|2048|0x800)";
const locationExtraPattern = "(?:LOCATION_EXTRA|64|0x40)";
const locationMonsterZonePattern = "(?:LOCATION_MZONE|4|0x4)";
const reasonBattlePattern = "(?:REASON_BATTLE|32|0x20)";
const reasonEffectPattern = "(?:REASON_EFFECT|64|0x40)";
const typeSpiritPattern = "(?:TYPE_SPIRIT|512|0x200)";
const summonTypeOnlyLimitDescriptors: Record<string, number> = {
  fuslimit: 0x43000000,
  ritlimit: 0x45000000,
  synlimit: 0x46000000,
  xyzlimit: 0x49000000,
  penlimit: 0x4a000000,
  lnklimit: 0x4c000000,
};
const summonTypeExtraOrTypeLimitDescriptors: Record<string, number> = {
  fusfirstlimit: 0x43000000,
  synfirstlimit: 0x46000000,
  xyzfirstlimit: 0x49000000,
  lnkfirstlimit: 0x4c000000,
};
const summonTypeProcCompleteOrTypeLimitDescriptors: Record<string, number> = {
  ritfirstlimit: 0x45000000,
  penfirstlimit: 0x4a000000,
};

export function knownLuaEffectValueDescriptor(L: unknown, index: number, hostState: LuaHostState): string | undefined {
  if (isNamedTableFunction(L, index, "aux", "tgoval")) return "cannot-be-effect-target:opponent";
  if (isNamedTableFunction(L, index, "aux", "indoval")) return "indestructible:opponent";
  if (isNamedTableFunction(L, index, "aux", "indsval")) return "indestructible:self";
  if (isNamedTableFunction(L, index, "aux", "FALSE")) return "special-summon-condition:false";
  if (isNamedTableFunction(L, index, "aux", "EvilHeroLimit")) return "special-summon-condition:evil-hero-limit";
  if (isNamedTableFunction(L, index, "aux", "FossilLimit")) return "special-summon-condition:fossil-limit";
  const namedSummonTypeLimit = knownNamedSummonTypeLimitDescriptor(L, index);
  if (namedSummonTypeLimit) return namedSummonTypeLimit;
  const cannotMaterialSummonTypesFromUpvalues = cannotMaterialSummonTypesUpvalueDescriptor(L, index);
  if (cannotMaterialSummonTypesFromUpvalues) return cannotMaterialSummonTypesFromUpvalues;
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  if (/Duel\s*\.\s*GetMatchingGroupCount\s*\(\s*Card\s*\.\s*IsMonster\s*,\s*0\s*,\s*LOCATION_GRAVE\s*,\s*LOCATION_GRAVE\s*,\s*nil\s*\)\s*\*\s*100/.test(snippet)) {
    return "stat:all-grave-monster-count-x100";
  }
  const params = luaFunctionParams(snippet);
  const summonTypeCondition = specialSummonConditionDescriptor(L, index, snippet, params);
  if (summonTypeCondition) return summonTypeCondition;
  const reasonMaskPredicate = reasonMaskPredicateDescriptor(snippet, params);
  if (reasonMaskPredicate) return reasonMaskPredicate;
  const valueCardPredicate = valueCardPredicateDescriptor(snippet, params);
  if (valueCardPredicate) return valueCardPredicate;
  const specialSummonedMonsterActivationPredicate = specialSummonedMonsterActivationPredicateDescriptor(snippet, params);
  if (specialSummonedMonsterActivationPredicate) return specialSummonedMonsterActivationPredicate;
  const nonSpiritMonsterActivationPredicate = nonSpiritMonsterActivationPredicateDescriptor(snippet, params);
  if (nonSpiritMonsterActivationPredicate) return nonSpiritMonsterActivationPredicate;
  const spellTrapActivationPredicate = spellTrapActivationPredicateDescriptor(snippet, params);
  if (spellTrapActivationPredicate) return spellTrapActivationPredicate;
  const typedCardActivationPredicate = typedCardActivationPredicateDescriptor(snippet, params);
  if (typedCardActivationPredicate) return typedCardActivationPredicate;
  const cardActivationPredicate = cardActivationPredicateDescriptor(snippet, params);
  if (cardActivationPredicate) return cardActivationPredicate;
  const sameCodeActivationPredicate = sameCodeActivationPredicateDescriptor(snippet, params);
  if (sameCodeActivationPredicate) return sameCodeActivationPredicate;
  const setcodeMonsterActivationPredicate = setcodeMonsterActivationPredicateDescriptor(L, index, snippet, params);
  if (setcodeMonsterActivationPredicate) return setcodeMonsterActivationPredicate;
  const monsterAttributeExceptActivationPredicate = monsterAttributeExceptActivationPredicateDescriptor(L, index, snippet, params);
  if (monsterAttributeExceptActivationPredicate) return monsterAttributeExceptActivationPredicate;
  const cannotMaterialSummonTypes = cannotMaterialSummonTypesDescriptor(L, index, snippet);
  if (cannotMaterialSummonTypes) return cannotMaterialSummonTypes;
  const controllerCannotMaterialSummonTypes = controllerCannotMaterialSummonTypesDescriptor(L, index, snippet, params);
  if (controllerCannotMaterialSummonTypes) return controllerCannotMaterialSummonTypes;
  const materialTargetPredicate = materialTargetPredicateDescriptor(L, index, snippet, params);
  if (materialTargetPredicate) return materialTargetPredicate;
  const effectParam = params?.[0];
  const reasonPlayerParam = params?.[2];
  if (effectParam && reasonPlayerParam) {
    const effect = escapeRegExp(effectParam);
    const reasonPlayer = escapeRegExp(reasonPlayerParam);
    const opponentTargeting = new RegExp(`\\breturn\\s+${reasonPlayer}\\s*~=\\s*${effect}\\s*:\\s*GetHandlerPlayer\\s*\\(\\s*\\)`);
    if (opponentTargeting.test(snippet)) return "cannot-be-effect-target:opponent";
    const opponentIndestructible = new RegExp(`\\breturn\\s+${reasonPlayer}\\s*==\\s*1\\s*-\\s*${effect}\\s*:\\s*GetHandlerPlayer\\s*\\(\\s*\\)`);
    if (opponentIndestructible.test(snippet)) return "indestructible:opponent";
    const selfIndestructible = new RegExp(`\\breturn\\s+${reasonPlayer}\\s*==\\s*${effect}\\s*:\\s*GetHandlerPlayer\\s*\\(\\s*\\)`);
    if (selfIndestructible.test(snippet)) return "indestructible:self";
  }
  const amountParam = params?.[2];
  const reasonParam = params?.[3];
  if (!amountParam || !reasonParam) return undefined;
  const amount = escapeRegExp(amountParam);
  const reason = escapeRegExp(reasonParam);
  const doubleEffectDamage = new RegExp(`\\breturn\\s+${reason}\\s*&\\s*${reasonEffectPattern}\\s*>\\s*0\\s+and\\s+${amount}\\s*\\*\\s*2\\s+or\\s+${amount}\\b`);
  if (doubleEffectDamage.test(snippet)) return "change-damage:effect-double";
  const zeroEffectDamage = new RegExp(`\\bif\\s+\\(?\\s*${reason}\\s*&\\s*${reasonEffectPattern}\\s*\\)?\\s*(?:~=|>)\\s*0\\s+then\\s+return\\s+0\\s+else\\s+return\\s+${amount}\\s+end\\b`);
  if (params?.[5] && zeroEffectDamage.test(snippet)) return "change-damage:effect-zero";
  const relatedEffectParam = params?.[1];
  const reflectedReasonPlayerParam = params?.[4];
  if (!effectParam || !relatedEffectParam || !reflectedReasonPlayerParam) return undefined;
  const effect = escapeRegExp(effectParam);
  const relatedEffect = escapeRegExp(relatedEffectParam);
  const reasonPlayer = escapeRegExp(reflectedReasonPlayerParam);
  const reflectOpponentNonContinuous = new RegExp(
    `\\breturn\\s+${relatedEffect}\\s+and\\s+not\\s+${relatedEffect}\\s*:\\s*IsHasType\\s*\\(\\s*${effectTypeContinuousPattern}\\s*\\)\\s+and\\s+${reasonPlayer}\\s*==\\s*1\\s*-\\s*${effect}\\s*:\\s*GetOwnerPlayer\\s*\\(\\s*\\)`,
  );
  return reflectOpponentNonContinuous.test(snippet) ? "reflect-damage:opponent-non-continuous" : undefined;
}

function knownNamedSummonTypeLimitDescriptor(L: unknown, index: number): string | undefined {
  for (const [name, value] of Object.entries(summonTypeOnlyLimitDescriptors)) {
    if (isNamedTableFunction(L, index, "aux", name)) return `special-summon-condition:type:${value}`;
  }
  for (const [name, value] of Object.entries(summonTypeExtraOrTypeLimitDescriptors)) {
    if (isNamedTableFunction(L, index, "aux", name)) return `special-summon-condition:extra-or-type:${value}`;
  }
  for (const [name, value] of Object.entries(summonTypeProcCompleteOrTypeLimitDescriptors)) {
    if (isNamedTableFunction(L, index, "aux", name)) return `special-summon-condition:proc-complete-or-type:${value}`;
  }
  return undefined;
}

function specialSummonConditionDescriptor(L: unknown, index: number, snippet: string, params: string[] | undefined): string | undefined {
  const effectParam = params?.[0];
  const relatedEffectParam = params?.[1];
  const summonTypeParam = params?.[3];
  if (!effectParam) return undefined;
  const effect = escapeRegExp(effectParam);
  const relatedEffect = relatedEffectParam ? escapeRegExp(relatedEffectParam) : undefined;
  const handler = `${effect}\\s*:\\s*GetHandler\\s*\\(\\s*\\)`;
  const sourceLocationAndPreviousLocation = new RegExp(`\\breturn\\s+${handler}\\s*:\\s*IsLocation\\s*\\(\\s*(${numericMaskExpressionPattern})\\s*\\)\\s+and\\s+${handler}\\s*:\\s*IsPreviousLocation\\s*\\(\\s*(${numericMaskExpressionPattern})\\s*\\)\\s*(?:end\\b|$)`).exec(snippet);
  if (sourceLocationAndPreviousLocation?.[1] && sourceLocationAndPreviousLocation[2]) {
    const location = luaNumberMaskExpressionValue(L, index, sourceLocationAndPreviousLocation[1]);
    const previousLocation = luaNumberMaskExpressionValue(L, index, sourceLocationAndPreviousLocation[2]);
    if (location !== undefined && previousLocation !== undefined) return `special-summon-condition:source-location-and-previous-location:${location}:${previousLocation}`;
  }
  if (relatedEffect && new RegExp(`\\breturn\\s+not\\s+${relatedEffect}\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsMonster\\s*\\(\\s*\\)\\s*(?:end\\b|$)`).test(snippet)) return "special-summon-condition:not-related-handler-monster";
  if (relatedEffect && new RegExp(`\\breturn\\s+(?:${relatedEffect}\\s+and\\s+)?${relatedEffect}\\s*:\\s*IsHasType\\s*\\(\\s*${effectTypeActionsPattern}\\s*\\)(?:\\s+or\\s+false)?\\s*(?:end\\b|$)`).test(snippet)) return "special-summon-condition:card-effect";
  if (relatedEffect) {
    const relatedHandler = `${relatedEffect}\\s*:\\s*GetHandler\\s*\\(\\s*\\)`;
    const localRelatedHandler = new RegExp(`\\blocal\\s+(\\w+)\\s*=\\s*${relatedHandler}`).exec(snippet)?.[1];
    const relatedHandlerAlias = localRelatedHandler ? `(?:${relatedHandler}|${escapeRegExp(localRelatedHandler)})` : relatedHandler;
    const relatedHandlerSpellTrapSetcode = new RegExp(`\\breturn\\s+(?:${relatedHandlerAlias}\\s+and\\s+)?${relatedHandlerAlias}\\s*:\\s*IsSpellTrap\\s*\\(\\s*\\)\\s+and\\s+${relatedHandlerAlias}\\s*:\\s*IsSetCard\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*(?:end\\b|$)`).exec(snippet)?.[1];
    const spellTrapSetcode = relatedHandlerSpellTrapSetcode ? luaNumberTokenValue(L, index, relatedHandlerSpellTrapSetcode) : undefined;
    if (spellTrapSetcode !== undefined) return `special-summon-condition:related-handler-spelltrap-setcode:${spellTrapSetcode}`;
    const relatedHandlerSetcodeSpell = new RegExp(`\\breturn\\s+${relatedHandlerAlias}\\s*:\\s*IsSetCard\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+${relatedHandlerAlias}\\s*:\\s*IsSpell\\s*\\(\\s*\\)\\s*(?:end\\b|$)`).exec(snippet)?.[1];
    const spellSetcode = relatedHandlerSetcodeSpell ? luaNumberTokenValue(L, index, relatedHandlerSetcodeSpell) : undefined;
    if (spellSetcode !== undefined) return `special-summon-condition:related-handler-spell-setcode:${spellSetcode}`;
    const relatedHandlerTypeRace = new RegExp(`\\breturn\\s+(?:${relatedHandlerAlias}\\s+and\\s+)?${relatedHandlerAlias}\\s*:\\s*IsType\\s*\\(\\s*(${numericMaskExpressionPattern})\\s*\\)\\s+and\\s+${relatedHandlerAlias}\\s*:\\s*IsRace\\s*\\(\\s*(${numericMaskExpressionPattern})\\s*\\)\\s*(?:end\\b|$)`).exec(snippet);
    if (relatedHandlerTypeRace?.[1] && relatedHandlerTypeRace[2]) {
      const type = luaNumberMaskExpressionValue(L, index, relatedHandlerTypeRace[1]);
      const race = luaNumberMaskExpressionValue(L, index, relatedHandlerTypeRace[2]);
      if (type !== undefined && race !== undefined) return `special-summon-condition:related-handler-type-race:${type}:${race}`;
    }
    const guardedMonsterRelatedHandlerRace = new RegExp(`\\bif\\s+not\\s+${relatedEffect}\\s*:\\s*IsMonsterEffect\\s*\\(\\s*\\)\\s+then\\s+return\\s+false\\s+end[\\s\\S]+\\breturn\\s+${relatedHandlerAlias}\\s*:\\s*IsRace\\s*\\(\\s*(${numericMaskExpressionPattern})\\s*\\)`).exec(snippet)?.[1];
    const guardedRace = guardedMonsterRelatedHandlerRace ? luaNumberMaskExpressionValue(L, index, guardedMonsterRelatedHandlerRace) : undefined;
    if (guardedRace !== undefined) return `special-summon-condition:monster-related-handler-race:${guardedRace}`;
  }
  if (!summonTypeParam) return undefined;
  const summonType = escapeRegExp(summonTypeParam);
  if (relatedEffect) {
    const actionNoActivityPhaseTurnPlayer = new RegExp(
      `\\breturn\\s+${relatedEffect}\\s*:\\s*IsHasType\\s*\\(\\s*${effectTypeActionsPattern}\\s*\\)\\s+and\\s+Duel\\s*\\.\\s*GetActivityCount\\s*\\(\\s*${effect}\\s*:\\s*GetHandlerPlayer\\s*\\(\\s*\\)\\s*,\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*==\\s*0\\s+and\\s+Duel\\s*\\.\\s*IsPhase\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+Duel\\s*\\.\\s*GetTurnPlayer\\s*\\(\\s*\\)\\s*==\\s*${effect}\\s*:\\s*GetHandlerPlayer\\s*\\(\\s*\\)`,
    ).exec(snippet);
    if (actionNoActivityPhaseTurnPlayer?.[1] && actionNoActivityPhaseTurnPlayer[2]) {
      const activity = luaNumberTokenValue(L, index, actionNoActivityPhaseTurnPlayer[1]);
      const phase = luaNumberTokenValue(L, index, actionNoActivityPhaseTurnPlayer[2]);
      if (activity !== undefined && phase !== undefined) return `special-summon-condition:action-no-activity-phase-turn-player:${activity}:${phase}`;
    }
    const actionRelatedHandlerSetcode = new RegExp(`\\breturn\\s+${relatedEffect}\\s*:\\s*IsHasType\\s*\\(\\s*${effectTypeActionsPattern}\\s*\\)\\s+and\\s+${relatedEffect}\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsSetCard\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`).exec(snippet)?.[1];
    const setcode = actionRelatedHandlerSetcode ? luaNumberTokenValue(L, index, actionRelatedHandlerSetcode) : undefined;
    if (setcode !== undefined) return `special-summon-condition:card-effect-handler-setcode:${setcode}`;
    const relatedHandlerSetcode = new RegExp(`\\breturn\\s+${relatedEffect}\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsSetCard\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*(?:end\\b|$)`).exec(snippet)?.[1];
    const relatedSetcode = relatedHandlerSetcode ? luaNumberTokenValue(L, index, relatedHandlerSetcode) : undefined;
    if (relatedSetcode !== undefined) return `special-summon-condition:related-handler-setcode:${relatedSetcode}`;
    const monsterRelatedHandlerRace = new RegExp(`\\breturn\\s+${relatedEffect}\\s*:\\s*IsMonsterEffect\\s*\\(\\s*\\)\\s+and\\s+${relatedEffect}\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*(?:end\\b|$)`).exec(snippet)?.[1];
    const race = monsterRelatedHandlerRace ? luaNumberTokenValue(L, index, monsterRelatedHandlerRace) : undefined;
    if (race !== undefined) return `special-summon-condition:monster-related-handler-race:${race}`;
    const monsterRelatedHandlerSetcodeOrSetcode = new RegExp(`\\breturn\\s+\\(\\s*${relatedEffect}\\s*:\\s*IsMonsterEffect\\s*\\(\\s*\\)\\s+and\\s+${relatedEffect}\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsSetCard\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*\\)\\s+or\\s+${relatedEffect}\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsSetCard\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*(?:end\\b|$)`).exec(snippet);
    if (monsterRelatedHandlerSetcodeOrSetcode?.[1] && monsterRelatedHandlerSetcodeOrSetcode[2]) {
      const monsterSetcode = luaNumberTokenValue(L, index, monsterRelatedHandlerSetcodeOrSetcode[1]);
      const setcode = luaNumberTokenValue(L, index, monsterRelatedHandlerSetcodeOrSetcode[2]);
      if (monsterSetcode !== undefined && setcode !== undefined) return `special-summon-condition:monster-related-handler-setcode-or-setcode:${monsterSetcode}:${setcode}`;
    }
  }
  const auxTypeCalls = auxSummonTypeLimitCalls(snippet, effectParam, summonTypeParam);
  if (auxTypeCalls.length > 0) {
    const extraDeck = `${effect}\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsLocation\\s*\\(\\s*${locationExtraPattern}\\s*\\)`;
    const extraDeckBypass = new RegExp(`(?:not\\s+${extraDeck}\\s+or\\s+.*\\baux\\s*\\.\\s*\\w+limit\\s*\\(|\\baux\\s*\\.\\s*\\w+limit\\s*\\([^\\n]+\\)\\s+or\\s+not\\s+${extraDeck})`);
    if (extraDeckBypass.test(snippet)) {
      return auxTypeCalls.length === 1
        ? `special-summon-condition:extra-or-type:${auxTypeCalls[0]}`
        : `special-summon-condition:extra-or-types:${auxTypeCalls.join(",")}`;
    }
    const relatedHandlerCode = relatedEffect === undefined ? undefined : new RegExp(`\\b${relatedEffect}\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsCode\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`).exec(snippet)?.[1];
    if (relatedHandlerCode !== undefined && auxTypeCalls.length === 1) {
      const value = luaNumberTokenValue(L, index, relatedHandlerCode);
      if (value !== undefined) return `special-summon-condition:type-or-related-handler-code:${auxTypeCalls[0]}:${value}`;
    }
    const typeOnlyAux = new RegExp(`\\breturn\\s+aux\\s*\\.\\s*\\w+limit\\s*\\(\\s*${effect}\\s*,\\s*[^,]+\\s*,\\s*[^,]+\\s*,\\s*${summonType}\\s*\\)\\s*(?:end\\b|$)`);
    if (typeOnlyAux.test(snippet) && auxTypeCalls.length === 1) return `special-summon-condition:type:${auxTypeCalls[0]}`;
  }
  const summonTypeMask = `\\(*\\s*${summonType}\\s*&\\s*(${numericOrIdentifierPattern})\\s*\\)*\\s*==\\s*\\1`;
  const notExtraDeck = `(?:not\\s+${handler}\\s*:\\s*IsLocation\\s*\\(\\s*${locationExtraPattern}\\s*\\)|${handler}\\s*:\\s*GetLocation\\s*\\(\\s*\\)\\s*~=\\s*${locationExtraPattern})`;
  const extraDeckOrTypeValue = (new RegExp(`\\breturn\\s+${notExtraDeck}\\s+or\\s+${summonTypeMask}`).exec(snippet) ?? new RegExp(`\\breturn\\s+${summonTypeMask}\\s+or\\s+${notExtraDeck}`).exec(snippet))?.[1];
  if (extraDeckOrTypeValue !== undefined) {
    const value = luaNumberTokenValue(L, index, extraDeckOrTypeValue);
    if (value !== undefined) return new RegExp(`${summonTypeMask}\\s+and\\s+not\\s+${relatedEffect}`).test(snippet) ? `special-summon-condition:extra-or-type-no-related:${value}` : `special-summon-condition:extra-or-type:${value}`;
  }
  const notExtraOrGraveHelperCount = new RegExp(`\\breturn\\s+${notExtraDeck}\\s+or\\s+Duel\\s*\\.\\s*IsExistingMatchingCard\\s*\\(\\s*s\\s*\\.\\s*spcostfilter\\s*,\\s*${summonTypeParam ? escapeRegExp(params?.[2] ?? "") : ""}\\s*,\\s*LOCATION_GRAVE\\s*,\\s*0\\s*,\\s*(${numericOrIdentifierPattern})\\s*,\\s*nil\\s*\\)`).exec(snippet)?.[1];
  const graveHelperCount = notExtraOrGraveHelperCount ? luaNumberTokenValue(L, index, notExtraOrGraveHelperCount) : undefined;
  if (graveHelperCount !== undefined) return `special-summon-condition:not-extra-or-player-grave-spelltrap-setcode-count:335:${graveHelperCount}`;
  if (relatedEffect) {
    const relatedHandlerCode = `${relatedEffect}\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsCode\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`;
    const directTypeOrRelatedHandlerCode = new RegExp(`\\breturn\\s+(?:${summonTypeMask}\\s+or\\s+${relatedHandlerCode}|${relatedHandlerCode}\\s+or\\s+${summonTypeMask})\\s*(?:end\\b|$)`).exec(snippet);
    const summonTypeValue = directTypeOrRelatedHandlerCode?.[1] ?? directTypeOrRelatedHandlerCode?.[4];
    const codeValue = directTypeOrRelatedHandlerCode?.[2] ?? directTypeOrRelatedHandlerCode?.[3];
    if (summonTypeValue !== undefined && codeValue !== undefined) {
      const type = luaNumberTokenValue(L, index, summonTypeValue);
      const code = luaNumberTokenValue(L, index, codeValue);
      if (type !== undefined && code !== undefined) return `special-summon-condition:type-or-related-handler-code:${type}:${code}`;
    }
  }
  const notLocations = new RegExp(`\\breturn\\s+not\\s+${handler}\\s*:\\s*IsLocation\\s*\\(\\s*(${numericMaskExpressionPattern})\\s*\\)\\s*(?:end\\b|$)`).exec(snippet)?.[1];
  const notLocationsMask = notLocations ? luaNumberMaskExpressionValue(L, index, notLocations) : undefined;
  if (notLocationsMask !== undefined) return `special-summon-condition:not-locations:${notLocationsMask}`;
  if (new RegExp(`\\breturn\\s+${notExtraDeck}\\s*(?:end\\b|$)`).test(snippet)) return "special-summon-condition:not-extra";
  const sourceLocationAndType = new RegExp(`\\breturn\\s+${handler}\\s*:\\s*IsLocation\\s*\\(\\s*(${numericMaskExpressionPattern})\\s*\\)\\s+and\\s+\\(*\\s*${summonType}\\s*&\\s*(${numericOrIdentifierPattern})\\s*\\)*\\s*==\\s*(${numericOrIdentifierPattern})\\s*(?:end\\b|$)`).exec(snippet);
  if (sourceLocationAndType?.[1] && sourceLocationAndType[2] && sourceLocationAndType[3]) {
    const location = luaNumberMaskExpressionValue(L, index, sourceLocationAndType[1]);
    const type = luaNumberTokenValue(L, index, sourceLocationAndType[2]);
    const matchedType = luaNumberTokenValue(L, index, sourceLocationAndType[3]);
    if (location !== undefined && type !== undefined && matchedType === type) return `special-summon-condition:source-location-and-type:${location}:${type}`;
  }
  const typeAndSourceLocation = new RegExp(`\\breturn\\s+\\(*\\s*${summonType}\\s*&\\s*(${numericOrIdentifierPattern})\\s*\\)*\\s*==\\s*(${numericOrIdentifierPattern})\\s+and\\s+${handler}\\s*:\\s*IsLocation\\s*\\(\\s*(${numericMaskExpressionPattern})\\s*\\)\\s*(?:end\\b|$)`).exec(snippet);
  if (typeAndSourceLocation?.[1] && typeAndSourceLocation[2] && typeAndSourceLocation[3]) {
    const type = luaNumberTokenValue(L, index, typeAndSourceLocation[1]);
    const matchedType = luaNumberTokenValue(L, index, typeAndSourceLocation[2]);
    const location = luaNumberMaskExpressionValue(L, index, typeAndSourceLocation[3]);
    if (type !== undefined && type === matchedType && location !== undefined) return `special-summon-condition:source-location-and-type:${location}:${type}`;
  }
  const summonTypeCompare = `\\(*\\s*${summonType}\\s*&\\s*(${numericOrIdentifierPattern})\\s*\\)*\\s*==\\s*(${numericOrIdentifierPattern})`;
  const typeOrSourceLocationAndType = new RegExp(`\\breturn\\s+(?:${summonTypeCompare}\\s+or\\s+\\(\\s*${summonTypeCompare}\\s+and\\s+${handler}\\s*:\\s*IsLocation\\s*\\(\\s*(${numericMaskExpressionPattern})\\s*\\)\\s*\\)|\\(\\s*${summonTypeCompare}\\s+and\\s+${handler}\\s*:\\s*IsLocation\\s*\\(\\s*(${numericMaskExpressionPattern})\\s*\\)\\s*\\)\\s+or\\s+${summonTypeCompare})\\s*(?:end\\b|$)`).exec(snippet);
  if (typeOrSourceLocationAndType) {
    const type = luaNumberTokenValue(L, index, typeOrSourceLocationAndType[1] ?? typeOrSourceLocationAndType[8] ?? "");
    const matchedType = luaNumberTokenValue(L, index, typeOrSourceLocationAndType[2] ?? typeOrSourceLocationAndType[9] ?? "");
    const sourceLocationType = luaNumberTokenValue(L, index, typeOrSourceLocationAndType[3] ?? typeOrSourceLocationAndType[6] ?? "");
    const matchedSourceLocationType = luaNumberTokenValue(L, index, typeOrSourceLocationAndType[4] ?? typeOrSourceLocationAndType[7] ?? "");
    const location = luaNumberMaskExpressionValue(L, index, typeOrSourceLocationAndType[5] ?? typeOrSourceLocationAndType[10] ?? "");
    if (type !== undefined && type === matchedType && sourceLocationType !== undefined && sourceLocationType === matchedSourceLocationType && location !== undefined) return `special-summon-condition:type-or-source-location-and-type:${type}:${location}:${sourceLocationType}`;
  }
  if (relatedEffect) {
    const typeNoRelated = new RegExp(`\\breturn\\s+\\(*\\s*${summonType}\\s*&\\s*(${numericOrIdentifierPattern})\\s*\\)*\\s*==\\s*(${numericOrIdentifierPattern})\\s+and\\s+not\\s+${relatedEffect}\\s*(?:end\\b|$)`).exec(snippet);
    if (typeNoRelated?.[1] && typeNoRelated[2]) {
      const type = luaNumberTokenValue(L, index, typeNoRelated[1]);
      const matchedType = luaNumberTokenValue(L, index, typeNoRelated[2]);
      if (type !== undefined && type === matchedType) return `special-summon-condition:type-no-related:${type}`;
    }
  }
  const summonPlayerParam = params?.[2];
  if (summonPlayerParam) {
    const summonPlayer = escapeRegExp(summonPlayerParam);
    if (new RegExp(`\\breturn\\s+Duel\\s*\\.\\s*GetFieldGroupCount\\s*\\(\\s*${summonPlayer}\\s*,\\s*${locationMonsterZonePattern}\\s*,\\s*0\\s*\\)\\s*==\\s*0\\s*(?:end\\b|$)`).test(snippet)) return "special-summon-condition:summon-player-empty-mzone";
    const notTypeOrGraveSetcode = new RegExp(`\\breturn\\s+\\(*\\s*${summonType}\\s*&\\s*(${numericOrIdentifierPattern})\\s*\\)*\\s*~=\\s*(${numericOrIdentifierPattern})\\s+or\\s+Duel\\s*\\.\\s*IsExistingMatchingCard\\s*\\(\\s*Card\\s*\\.\\s*IsSetCard\\s*,\\s*${summonPlayer}\\s*,\\s*LOCATION_GRAVE\\s*,\\s*0\\s*,\\s*1\\s*,\\s*nil\\s*,\\s*(${numericOrIdentifierPattern})\\s*\\)`).exec(snippet);
    if (notTypeOrGraveSetcode?.[1] && notTypeOrGraveSetcode[2] && notTypeOrGraveSetcode[3]) {
      const type = luaNumberTokenValue(L, index, notTypeOrGraveSetcode[1]);
      const matchedType = luaNumberTokenValue(L, index, notTypeOrGraveSetcode[2]);
      const setcode = luaNumberTokenValue(L, index, notTypeOrGraveSetcode[3]);
      if (type !== undefined && type === matchedType && setcode !== undefined) return `special-summon-condition:not-type-or-player-grave-setcode:${type}:${setcode}`;
    }
    const notTypeOrPhase = new RegExp(`\\breturn\\s+\\(*\\s*${summonType}\\s*&\\s*(${numericOrIdentifierPattern})\\s*\\)*\\s*~=\\s*(${numericOrIdentifierPattern})\\s+or\\s+Duel\\s*\\.\\s*IsPhase\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`).exec(snippet);
    if (notTypeOrPhase?.[1] && notTypeOrPhase[2] && notTypeOrPhase[3]) {
      const type = luaNumberTokenValue(L, index, notTypeOrPhase[1]);
      const matchedType = luaNumberTokenValue(L, index, notTypeOrPhase[2]);
      const phase = luaNumberTokenValue(L, index, notTypeOrPhase[3]);
      if (type !== undefined && type === matchedType && phase !== undefined) return `special-summon-condition:not-type-or-phase:${type}:${phase}`;
    }
    const pzoneOriginalRaceCounterSum = new RegExp(`\\breturn\\s+\\(*\\s*${summonType}\\s*&\\s*(${numericOrIdentifierPattern})\\s*\\)*\\s*~=\\s*(${numericOrIdentifierPattern})\\s+or\\s+Duel\\s*\\.\\s*GetMatchingGroup\\s*\\(\\s*aux\\s*\\.\\s*FaceupFilter\\s*\\(\\s*Card\\s*\\.\\s*IsOriginalRace\\s*,\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*,\\s*${summonPlayer}\\s*,\\s*LOCATION_PZONE\\s*,\\s*0\\s*,\\s*nil\\s*\\)\\s*:\\s*GetSum\\s*\\(\\s*Card\\s*\\.\\s*GetCounter\\s*,\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*>=\\s*(${numericOrIdentifierPattern})`).exec(snippet);
    if (pzoneOriginalRaceCounterSum?.[1] && pzoneOriginalRaceCounterSum[2] && pzoneOriginalRaceCounterSum[3] && pzoneOriginalRaceCounterSum[4] && pzoneOriginalRaceCounterSum[5]) {
      const type = luaNumberTokenValue(L, index, pzoneOriginalRaceCounterSum[1]);
      const matchedType = luaNumberTokenValue(L, index, pzoneOriginalRaceCounterSum[2]);
      const race = luaNumberTokenValue(L, index, pzoneOriginalRaceCounterSum[3]);
      const counter = luaNumberTokenValue(L, index, pzoneOriginalRaceCounterSum[4]);
      const min = luaNumberTokenValue(L, index, pzoneOriginalRaceCounterSum[5]);
      if (type !== undefined && type === matchedType && race !== undefined && counter !== undefined && min !== undefined) return `special-summon-condition:not-type-or-player-pzone-original-race-counter-sum:${type}:${race}:${counter}:${min}`;
    }
  }
  const procCompleteOrType = new RegExp(`\\breturn\\s+${effect}\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsStatus\\s*\\(\\s*(?:STATUS_PROC_COMPLETE|8|0x8)\\s*\\)\\s+or\\s+${summonTypeMask}`);
  const procCompleteOrTypeValue = procCompleteOrType.exec(snippet)?.[1];
  if (procCompleteOrTypeValue !== undefined) {
    const value = luaNumberTokenValue(L, index, procCompleteOrTypeValue);
    if (value !== undefined) return `special-summon-condition:proc-complete-or-type:${value}`;
  }
  const targetPlayerParam = params?.[5];
  if (targetPlayerParam) {
    const targetPlayer = escapeRegExp(targetPlayerParam);
    const targetPlayerOnFieldFaceupCode = new RegExp(`\\breturn\\s+(not\\s+)?Duel\\s*\\.\\s*IsExistingMatchingCard\\s*\\(\\s*aux\\s*\\.\\s*FaceupFilter\\s*\\(\\s*Card\\s*\\.\\s*IsCode\\s*,\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*,\\s*${targetPlayer}\\s*,\\s*LOCATION_(?:MZONE|ONFIELD)\\s*,\\s*0\\s*,\\s*1\\s*,\\s*nil\\s*\\)`).exec(snippet);
    if (targetPlayerOnFieldFaceupCode?.[2]) {
      const code = luaNumberTokenValue(L, index, targetPlayerOnFieldFaceupCode[2]);
      if (code !== undefined) return `special-summon-condition:target-player-${targetPlayerOnFieldFaceupCode[1] ? "no-" : ""}field-faceup-code:${code}`;
    }
    const summonTypeMismatch = `\\(?\\s*${summonType}\\s*&\\s*(${numericOrIdentifierPattern})\\s*\\)?\\s*~=\\s*\\1`;
    const absentPlayerFlag = new RegExp(`\\breturn\\s+${summonTypeMismatch}\\s+or\\s+Duel\\s*\\.\\s*GetFlagEffect\\s*\\(\\s*${targetPlayer}\\s*,\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*==\\s*0`).exec(snippet);
    if (absentPlayerFlag?.[1] && absentPlayerFlag[2]) {
      const summonTypeValue = luaNumberTokenValue(L, index, absentPlayerFlag[1]);
      const flagCode = luaNumberTokenValue(L, index, absentPlayerFlag[2]);
      if (summonTypeValue !== undefined && flagCode !== undefined) return `special-summon-condition:not-type-or-player-flag-absent:${summonTypeValue}:${flagCode}`;
    }
  }
  if (summonPlayerParam) {
    const summonPlayer = escapeRegExp(summonPlayerParam);
    const exactTypePlayerAffectedController = new RegExp(
      `\\breturn\\s+${summonType}\\s*==\\s*(${numericExpressionPattern})\\s+and\\s+Duel\\s*\\.\\s*IsPlayerAffectedByEffect\\s*\\(\\s*${summonPlayer}\\s*,\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+${handler}\\s*:\\s*IsControler\\s*\\(\\s*${summonPlayer}\\s*\\)`,
    ).exec(snippet);
    if (exactTypePlayerAffectedController?.[1] && exactTypePlayerAffectedController[2]) {
      const summonTypeValue = luaNumberExpressionValue(L, index, exactTypePlayerAffectedController[1]);
      const effectCode = luaNumberTokenValue(L, index, exactTypePlayerAffectedController[2]);
      if (summonTypeValue !== undefined && effectCode !== undefined) return `special-summon-condition:exact-type-player-affected-controller:${summonTypeValue}:${effectCode}`;
    }
  }
  const exactSummonType = `\\(*\\s*${summonType}\\s*==\\s*\\(?\\s*(${numericExpressionPattern})\\s*\\)?\\s*\\)*`;
  const typeOnlyExpression = new RegExp(`\\breturn\\s+([^\\n]+?)\\s*(?:end\\b|$)`).exec(snippet)?.[1];
  if (!typeOnlyExpression) return undefined;
  const typeOnlyTerms = typeOnlyExpression.split(/\s+or\s+/).map((term) => term.trim());
  const exactTypeValues = typeOnlyTerms.map((term) => new RegExp(`^${exactSummonType}$`).exec(term)?.[1]).filter((token): token is string => token !== undefined);
  const maskTypeValues = typeOnlyTerms.map((term) => new RegExp(`^${summonTypeMask}$`).exec(term)?.[1]).filter((token): token is string => token !== undefined);
  if (exactTypeValues.length > 0 && exactTypeValues.length + maskTypeValues.length === typeOnlyTerms.length) {
    const exactValues = exactTypeValues.map((token) => luaNumberExpressionValue(L, index, token));
    const maskValues = maskTypeValues.map((token) => luaNumberTokenValue(L, index, token));
    if (exactValues.every((value): value is number => value !== undefined) && maskValues.every((value): value is number => value !== undefined)) return `special-summon-condition:exact-types:${exactValues.join(",")}:types:${maskValues.join(",")}`;
  }
  if (!typeOnlyTerms.every((term) => new RegExp(`^${summonTypeMask}$`).test(term))) return undefined;
  const typeOnlyValues = typeOnlyTerms.map((term) => new RegExp(`^${summonTypeMask}$`).exec(term)?.[1]).filter((token): token is string => token !== undefined);
  if (typeOnlyValues.length > 1) {
    const values = typeOnlyValues.map((token) => luaNumberTokenValue(L, index, token));
    if (values.every((value): value is number => value !== undefined)) return `special-summon-condition:types:${values.join(",")}`;
  }
  const typeOnlyValue = typeOnlyValues[0];
  if (typeOnlyValue === undefined) return undefined;
  const value = luaNumberTokenValue(L, index, typeOnlyValue);
  return value === undefined ? undefined : `special-summon-condition:type:${value}`;
}

function auxSummonTypeLimitCalls(snippet: string, effectParam: string, summonTypeParam: string): number[] {
  const effect = escapeRegExp(effectParam);
  const summonType = escapeRegExp(summonTypeParam);
  const values = new Set<number>();
  for (const match of snippet.matchAll(new RegExp(`\\baux\\s*\\.\\s*([A-Za-z_]\\w*)\\s*\\(\\s*${effect}\\s*,\\s*[^,]+\\s*,\\s*[^,]+\\s*,\\s*${summonType}\\s*\\)`, "g"))) {
    const name = match[1];
    const value = name ? summonTypeOnlyLimitDescriptors[name] : undefined;
    if (value !== undefined) values.add(value);
  }
  return [...values];
}

function materialTargetPredicateDescriptor(L: unknown, index: number, snippet: string, params: string[] | undefined): string | undefined {
  const cardParam = params?.[1];
  if (!cardParam) return undefined;
  const card = escapeRegExp(cardParam);
  const notSetcode = snippet.match(new RegExp(`\\breturn\\s+not\\s+${card}\\s*:\\s*IsSetCard\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`));
  const setcode = notSetcode?.[1] ? luaNumberTokenValue(L, index, notSetcode[1]) : undefined;
  if (setcode !== undefined) return `cannot-material:target-not-setcode:${setcode}`;
  const notRace = snippet.match(new RegExp(`\\breturn\\s+not\\s+${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`));
  const race = notRace?.[1] ? luaNumberTokenValue(L, index, notRace[1]) : undefined;
  if (race !== undefined) return `cannot-material:target-not-race:${race}`;
  const notAttribute = snippet.match(new RegExp(`\\breturn\\s+not\\s+${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`));
  const attribute = notAttribute?.[1] ? luaNumberTokenValue(L, index, notAttribute[1]) : undefined;
  return attribute !== undefined ? `cannot-material:target-not-attribute:${attribute}` : undefined;
}

function cannotMaterialSummonTypesDescriptor(L: unknown, index: number, snippet: string): string | undefined {
  if (!/\blocal\s+sum\s*=\s*total\s*&\s*sumtype\b/.test(snippet)) return undefined;
  if (!/\bpairs\s*\(\s*allowed\s*\)/.test(snippet) || !/\breturn\s+false\b/.test(snippet)) return undefined;
  const values = luaNumberArrayUpvalueValue(L, index, "allowed");
  return values !== undefined ? `cannot-material:summon-types:${[...values].sort((a, b) => a - b).join(",")}` : undefined;
}

function controllerCannotMaterialSummonTypesDescriptor(L: unknown, index: number, snippet: string, params: string[] | undefined): string | undefined {
  const effectParam = params?.[0];
  const summonedCardParam = params?.[1];
  const summonTypeParam = params?.[2];
  const summonPlayerParam = params?.[3];
  if (!effectParam || !summonedCardParam || !summonTypeParam || !summonPlayerParam) return undefined;
  const effect = escapeRegExp(effectParam);
  const summonedCard = escapeRegExp(summonedCardParam);
  const summonType = escapeRegExp(summonTypeParam);
  const summonPlayer = escapeRegExp(summonPlayerParam);
  if (!new RegExp(`\\blocal\\s+tp\\s*=\\s*${effect}\\s*:\\s*GetHandlerPlayer\\s*\\(\\s*\\)`).test(snippet)) return undefined;
  if (!new RegExp(`\\breturn\\s+${summonPlayer}\\s*==\\s*tp\\s+and\\s+${summonedCard}\\s*:\\s*IsControler\\s*\\(\\s*tp\\s*\\)`).test(snippet)) return undefined;
  const cannotFilterCall = snippet.match(new RegExp(`aux\\.cannotmatfilter\\s*\\(\\s*(${numericOrIdentifierPattern}(?:\\s*,\\s*${numericOrIdentifierPattern})*)\\s*\\)\\s*\\(\\s*${effect}\\s*,\\s*${summonedCard}\\s*,\\s*${summonType}\\s*,\\s*${summonPlayer}\\s*\\)`));
  const values = cannotFilterCall?.[1] ? luaNumberListValue(L, index, cannotFilterCall[1]) : undefined;
  return values !== undefined && values.length > 0 ? `cannot-material:controller-summon-types:${values.join(",")}` : undefined;
}

function cannotMaterialSummonTypesUpvalueDescriptor(L: unknown, index: number): string | undefined {
  if (luaNumberUpvalueValue(L, index, "total") === undefined) return undefined;
  const values = luaNumberArrayUpvalueValue(L, index, "allowed");
  return values !== undefined ? `cannot-material:summon-types:${[...values].sort((a, b) => a - b).join(",")}` : undefined;
}

function luaNumberArrayUpvalueValue(L: unknown, index: number, token: string): number[] | undefined {
  const absoluteIndex = lua.lua_absindex(L, index);
  for (let upvalueIndex = 1;; upvalueIndex += 1) {
    const nameBytes = lua.lua_getupvalue(L, absoluteIndex, upvalueIndex);
    if (nameBytes === null) return undefined;
    const name = typeof nameBytes === "string" ? nameBytes : to_jsstring(nameBytes);
    const values = name === token && lua.lua_istable(L, -1) ? luaNumberArrayFromTable(L, -1) : undefined;
    lua.lua_pop(L, 1);
    if (values !== undefined) return values;
  }
}

function luaNumberArrayFromTable(L: unknown, index: number): number[] | undefined {
  const absoluteIndex = lua.lua_absindex(L, index);
  const values: number[] = [];
  lua.lua_pushnil(L);
  while (lua.lua_next(L, absoluteIndex) !== 0) {
    if (!lua.lua_isnumber(L, -1)) {
      lua.lua_pop(L, 2);
      return undefined;
    }
    values.push(lua.lua_tointeger(L, -1));
    lua.lua_pop(L, 1);
  }
  return values.length > 0 ? values : undefined;
}

function valueCardPredicateDescriptor(snippet: string, params: string[] | undefined): string | undefined {
  const effectParam = params?.[0];
  const cardParam = params?.[1];
  if (!effectParam || !cardParam) return undefined;
  const effect = escapeRegExp(effectParam);
  const card = escapeRegExp(cardParam);
  const notHandler = new RegExp(`\\breturn\\s+${card}\\s*~=\\s*${effect}\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*(?:end\\b|$)`);
  return notHandler.test(snippet) ? "value-card:not-handler" : undefined;
}

function specialSummonedMonsterActivationPredicateDescriptor(snippet: string, params: string[] | undefined): string | undefined {
  const relatedEffectParam = params?.[1];
  if (!relatedEffectParam) return undefined;
  const relatedEffect = escapeRegExp(relatedEffectParam);
  const handler = `${relatedEffect}\\s*:\\s*GetHandler\\s*\\(\\s*\\)`;
  const monsterEffect = `${relatedEffect}\\s*:\\s*IsMonsterEffect\\s*\\(\\s*\\)`;
  const specialSummoned = `${handler}\\s*:\\s*IsSpecialSummoned\\s*\\(\\s*\\)`;
  const monsterZone = `${handler}\\s*:\\s*IsLocation\\s*\\(\\s*${locationMonsterZonePattern}\\s*\\)`;
  const predicate = new RegExp(`\\breturn\\s+${monsterEffect}\\s+and\\s+${specialSummoned}\\s+and\\s+${monsterZone}\\s*(?:end\\b|$)`);
  return predicate.test(snippet) ? "cannot-activate:special-summoned-monster-on-field" : undefined;
}

function nonSpiritMonsterActivationPredicateDescriptor(snippet: string, params: string[] | undefined): string | undefined {
  const relatedEffectParam = params?.[1];
  if (!relatedEffectParam) return undefined;
  const relatedEffect = escapeRegExp(relatedEffectParam);
  const handler = `${relatedEffect}\\s*:\\s*GetHandler\\s*\\(\\s*\\)`;
  const nonSpirit = `not\\s+${handler}\\s*:\\s*IsType\\s*\\(\\s*${typeSpiritPattern}\\s*\\)`;
  const monsterEffect = `${relatedEffect}\\s*:\\s*IsMonsterEffect\\s*\\(\\s*\\)`;
  const predicate = new RegExp(`\\breturn\\s+${nonSpirit}\\s+and\\s+${monsterEffect}\\s*(?:end\\b|$)`);
  return predicate.test(snippet) ? "cannot-activate:non-spirit-monster-effect" : undefined;
}

function spellTrapActivationPredicateDescriptor(snippet: string, params: string[] | undefined): string | undefined {
  const relatedEffectParam = params?.[1];
  if (!relatedEffectParam) return undefined;
  const relatedEffect = escapeRegExp(relatedEffectParam);
  const predicate = new RegExp(`\\breturn\\s+${relatedEffect}\\s*:\\s*IsSpellTrapEffect\\s*\\(\\s*\\)\\s*(?:end\\b|$)`);
  return predicate.test(snippet) ? "cannot-activate:spell-trap-effect" : undefined;
}

function cardActivationPredicateDescriptor(snippet: string, params: string[] | undefined): string | undefined {
  const relatedEffectParam = params?.[1];
  if (!relatedEffectParam) return undefined;
  const relatedEffect = escapeRegExp(relatedEffectParam);
  const predicate = new RegExp(`\\breturn\\s+${relatedEffect}\\s*:\\s*IsHasType\\s*\\(\\s*${effectTypeActivatePattern}\\s*\\)\\s*(?:end\\b|$)`);
  return predicate.test(snippet) ? "cannot-activate:card-activation" : undefined;
}

function typedCardActivationPredicateDescriptor(snippet: string, params: string[] | undefined): string | undefined {
  const relatedEffectParam = params?.[1];
  if (!relatedEffectParam) return undefined;
  const relatedEffect = escapeRegExp(relatedEffectParam);
  const typeMethod = `${relatedEffect}\\s*:\\s*(IsSpellEffect|IsTrapEffect)\\s*\\(\\s*\\)`;
  const cardActivation = `${relatedEffect}\\s*:\\s*IsHasType\\s*\\(\\s*${effectTypeActivatePattern}\\s*\\)`;
  const match = snippet.match(new RegExp(`\\breturn\\s+(?:${cardActivation}\\s+and\\s+${typeMethod}|${typeMethod}\\s+and\\s+${cardActivation})\\s*(?:end\\b|$)`));
  if (match?.[1] === "IsSpellEffect" || match?.[2] === "IsSpellEffect") return "cannot-activate:spell-card-activation";
  if (match?.[1] === "IsTrapEffect" || match?.[2] === "IsTrapEffect") return "cannot-activate:trap-card-activation";
  return undefined;
}

function sameCodeActivationPredicateDescriptor(snippet: string, params: string[] | undefined): string | undefined {
  const effectParam = params?.[0];
  const relatedEffectParam = params?.[1];
  if (!effectParam || !relatedEffectParam) return undefined;
  const effect = escapeRegExp(effectParam);
  const relatedEffect = escapeRegExp(relatedEffectParam);
  const sameCode = `${relatedEffect}\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsCode\\s*\\(\\s*${effect}\\s*:\\s*GetLabel\\s*\\(\\s*\\)\\s*\\)`;
  const monsterEffect = `${relatedEffect}\\s*:\\s*IsMonsterEffect\\s*\\(\\s*\\)`;
  if (new RegExp(`\\breturn\\s+(?:${monsterEffect}\\s+and\\s+${sameCode}|${sameCode}\\s+and\\s+${monsterEffect})\\s*(?:end\\b|$)`).test(snippet)) return "cannot-activate:same-code-monster-effect";
  const predicate = new RegExp(`\\breturn\\s+(?:${relatedEffect}\\s*:\\s*IsHasType\\s*\\(\\s*${effectTypeActivatePattern}\\s*\\)\\s+and\\s+)?${sameCode}\\s*(?:end\\b|$)`);
  return predicate.test(snippet) ? "cannot-activate:same-code" : undefined;
}

function setcodeMonsterActivationPredicateDescriptor(L: unknown, index: number, snippet: string, params: string[] | undefined): string | undefined {
  const relatedEffectParam = params?.[1];
  if (!relatedEffectParam) return undefined;
  const relatedEffect = escapeRegExp(relatedEffectParam);
  const handlerSetcode = `${relatedEffect}\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsSetCard\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`;
  const monsterEffect = `${relatedEffect}\\s*:\\s*IsMonsterEffect\\s*\\(\\s*\\)`;
  const match = snippet.match(new RegExp(`\\breturn\\s+(?:${handlerSetcode}\\s+and\\s+${monsterEffect}|${monsterEffect}\\s+and\\s+${handlerSetcode})\\s*(?:end\\b|$)`));
  const setcode = match?.[1] ?? match?.[2];
  const setcodeValue = setcode ? luaNumberTokenValue(L, index, setcode) : undefined;
  return setcodeValue === undefined ? undefined : `cannot-activate:setcode-monster-effect:${setcodeValue}`;
}

function monsterAttributeExceptActivationPredicateDescriptor(L: unknown, index: number, snippet: string, params: string[] | undefined): string | undefined {
  const relatedEffectParam = params?.[1];
  if (!relatedEffectParam) return undefined;
  const relatedEffect = escapeRegExp(relatedEffectParam);
  const match = snippet.match(new RegExp(`\\breturn\\s+${relatedEffect}\\s*:\\s*IsMonsterEffect\\s*\\(\\s*\\)\\s+and\\s+${relatedEffect}\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsAttributeExcept\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`));
  const attribute = match?.[1] ? luaNumberTokenValue(L, index, match[1]) : undefined;
  return attribute !== undefined ? `cannot-activate:monster-attribute-except:${attribute}` : undefined;
}

function luaNumberTokenValue(L: unknown, functionIndex: number, token: string): number | undefined {
  if (/^0x[0-9A-Fa-f]+$/.test(token)) return Number.parseInt(token.slice(2), 16);
  if (/^\d+$/.test(token)) return Number(token);
  if (!/^[A-Za-z_]\w*$/.test(token)) return undefined;
  lua.lua_getglobal(L, to_luastring(token));
  const value = lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : undefined;
  lua.lua_pop(L, 1);
  return value ?? luaNumberUpvalueValue(L, functionIndex, token);
}

function luaNumberExpressionValue(L: unknown, functionIndex: number, expression: string): number | undefined {
  const terms = expression.split(/\s*\+\s*/).map((term) => luaNumberTokenValue(L, functionIndex, term.trim()));
  return terms.length > 0 && terms.every((value): value is number => value !== undefined) ? terms.reduce((sum, value) => sum + value, 0) : undefined;
}

function luaNumberMaskExpressionValue(L: unknown, functionIndex: number, expression: string): number | undefined {
  const terms = expression.split(/\s*(?:\+|\|)\s*/).map((term) => luaNumberTokenValue(L, functionIndex, term.trim()));
  return terms.length > 0 && terms.every((value): value is number => value !== undefined) ? terms.reduce((mask, value) => mask | value, 0) : undefined;
}

function luaNumberListValue(L: unknown, functionIndex: number, token: string): number[] | undefined {
  const values = token.split(",").map((part) => luaNumberTokenValue(L, functionIndex, part.trim()));
  return values.length > 0 && values.every((value): value is number => value !== undefined) ? values : undefined;
}

function luaNumberUpvalueValue(L: unknown, index: number, token: string): number | undefined {
  const absoluteIndex = lua.lua_absindex(L, index);
  for (let upvalueIndex = 1;; upvalueIndex += 1) {
    const nameBytes = lua.lua_getupvalue(L, absoluteIndex, upvalueIndex);
    if (nameBytes === null) return undefined;
    const name = typeof nameBytes === "string" ? nameBytes : to_jsstring(nameBytes);
    const value = name === token && lua.lua_isnumber(L, -1) ? lua.lua_tointeger(L, -1) : undefined;
    lua.lua_pop(L, 1);
    if (value !== undefined) return value;
  }
}

function reasonMaskPredicateDescriptor(snippet: string, params: string[] | undefined): string | undefined {
  const reasonParam = params?.[2];
  if (!reasonParam) return undefined;
  const reason = escapeRegExp(reasonParam);
  const maskTerm = `(?:${reasonEffectPattern}|${reasonBattlePattern})`;
  const maskExpression = `${maskTerm}(?:\\s*(?:\\||\\+)\\s*${maskTerm})*`;
  const condition = `${reason}\\s*&\\s*\\(?\\s*(${maskExpression})\\s*\\)?\\s*\\)?\\s*(?:(?:~=|>)\\s*0|==\\s*(${maskExpression}))`;
  const returnPredicate = new RegExp(
    `\\breturn\\s+\\(?\\s*${condition}\\s*\\)?\\s*(?:and\\s+(?:1|true)\\s+or\\s+(?:0|false))?\\s*(?:end\\b|$)`,
  );
  const returnMatch = snippet.match(returnPredicate);
  const returnMask = reasonMaskFromMatch(returnMatch);
  if (returnMask !== undefined) return reasonMaskDescriptor(returnMask);
  const ifPredicate = new RegExp(`\\bif\\s+\\(?\\s*${condition}\\s*\\)?\\s+then\\b.*\\breturn\\s+(?:1|true)\\s*(?:end\\b|$)`);
  const ifMatch = snippet.match(ifPredicate);
  const ifMask = reasonMaskFromMatch(ifMatch);
  return ifMask === undefined ? undefined : reasonMaskDescriptor(ifMask);
}

function reasonMaskFromMatch(match: RegExpMatchArray | null): number | undefined {
  const expression = match?.[1] ?? match?.[2];
  if (!expression) return undefined;
  return reasonMaskFromExpression(expression);
}

function reasonMaskDescriptor(mask: number): string {
  return mask === 0x40 ? "value-predicate:effect-reason" : `value-predicate:reason-mask:${mask}`;
}

function reasonMaskFromExpression(expression: string): number | undefined {
  let mask = 0;
  for (const part of expression.split(/\s*(?:\||\+)\s*/)) {
    const value = reasonMaskTermValue(part.trim());
    if (value === undefined) return undefined;
    mask |= value;
  }
  return mask === 0 ? undefined : mask;
}

function reasonMaskTermValue(term: string): number | undefined {
  if (term === "REASON_EFFECT" || term === "64" || term === "0x40") return 0x40;
  if (term === "REASON_BATTLE" || term === "32" || term === "0x20") return 0x20;
  return undefined;
}

function isNamedTableFunction(L: unknown, index: number, tableName: string, fieldName: string): boolean {
  const absoluteIndex = lua.lua_absindex(L, index);
  lua.lua_getglobal(L, to_luastring(tableName));
  if (!lua.lua_istable(L, -1)) {
    lua.lua_pop(L, 1);
    return false;
  }
  lua.lua_getfield(L, -1, to_luastring(fieldName));
  const same = Boolean(lua.lua_isfunction(L, -1) && lua.lua_rawequal(L, absoluteIndex, -1));
  lua.lua_pop(L, 2);
  return same;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
