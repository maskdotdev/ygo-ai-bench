import fengari from "fengari";
import { luaFunctionParams, luaFunctionSourceSnippet } from "#lua/effect-descriptor-source.js";
import type { LuaHostState } from "#lua/host-types.js";

const { lua, to_jsstring, to_luastring } = fengari;

export function knownLuaEffectTargetDescriptor(L: unknown, index: number, hostState: LuaHostState): string | undefined {
  const fixed = knownFixedFunctionDescriptor(L, index, hostState);
  if (fixed !== undefined) return fixed;
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  const cardParam = luaFunctionParams(snippet)?.[1];
  if (!cardParam) return undefined;
  const card = escapeRegExp(cardParam);
  if (new RegExp(`\\breturn\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)(?!\\s+and\\b)`).test(snippet)) return "special-summon-limit:extra";
  const notTypeExtra = snippet.match(
    new RegExp(`\\breturn\\s+(?:not\\s+\\(?\\s*${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s*\\)?\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)|${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)\\s+and\\s+not\\s+\\(?\\s*${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s*\\)?(?!\\s*(?:and|or)\\b))`),
  );
  const notTypeExtraToken = notTypeExtra?.[1] ?? notTypeExtra?.[2];
  const notTypeExtraValue = notTypeExtraToken ? luaNumberExpressionValue(L, index, notTypeExtraToken) : undefined;
  if (notTypeExtraValue === 0x40) return "special-summon-limit:non-fusion-extra";
  if (notTypeExtraValue !== undefined) return `special-summon-limit:not-type-extra:${notTypeExtraValue}`;
  const linkBelowExtra = snippet.match(new RegExp(`\\breturn\\s+(?:${card}\\s*:\\s*IsLinkBelow\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)|${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLinkBelow\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\))`));
  const linkBelowExtraToken = linkBelowExtra?.[1] ?? linkBelowExtra?.[2];
  const linkBelowExtraValue = linkBelowExtraToken ? luaNumberTokenValue(L, index, linkBelowExtraToken) : undefined;
  if (linkBelowExtraValue !== undefined) return `special-summon-limit:link-below-extra:${linkBelowExtraValue}`;
  const notNamedTypeExtra = snippet.match(new RegExp(`\\breturn\\s+(?:${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)\\s+and\\s+not\\s+${card}\\s*:\\s*Is(Fusion|Ritual|Synchro|Xyz|Pendulum|Link)Monster\\s*\\(\\s*\\)|not\\s+${card}\\s*:\\s*Is(Fusion|Ritual|Synchro|Xyz|Pendulum|Link)Monster\\s*\\(\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\))`));
  const notNamedTypeExtraName = notNamedTypeExtra?.[1] ?? notNamedTypeExtra?.[2];
  const notNamedTypeExtraValue = notNamedTypeExtraName ? namedExtraDeckMonsterTypeValue(notNamedTypeExtraName) : undefined;
  if (notNamedTypeExtraValue === 0x40) return "special-summon-limit:non-fusion-extra";
  if (notNamedTypeExtraValue !== undefined) return `special-summon-limit:not-type-extra:${notNamedTypeExtraValue}`;
  const notTypeAttributeExtra = snippet.match(new RegExp(`\\breturn\\s+(?:not\\s+\\(\\s*${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)|${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)\\s+and\\s+not\\s+\\(\\s*${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s*\\))`));
  const notTypeAttributeExtraTypeToken = notTypeAttributeExtra?.[1] ?? notTypeAttributeExtra?.[4];
  const notTypeAttributeExtraAttributeToken = notTypeAttributeExtra?.[2] ?? notTypeAttributeExtra?.[3];
  const notTypeAttributeExtraType = notTypeAttributeExtraTypeToken ? luaNumberExpressionValue(L, index, notTypeAttributeExtraTypeToken) : undefined;
  const notTypeAttributeExtraAttribute = notTypeAttributeExtraAttributeToken ? luaNumberExpressionValue(L, index, notTypeAttributeExtraAttributeToken) : undefined;
  if (notTypeAttributeExtraType !== undefined && notTypeAttributeExtraAttribute !== undefined) return `special-summon-limit:not-type-attribute-extra:${notTypeAttributeExtraType}:${notTypeAttributeExtraAttribute}`;
  const notTypeAttributeExtraTypeFirstAfterLocation = snippet.match(new RegExp(`\\breturn\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)\\s+and\\s+not\\s+\\(\\s*${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s*\\)`));
  const notTypeAttributeExtraTypeFirstAfterLocationType = notTypeAttributeExtraTypeFirstAfterLocation?.[1] ? luaNumberExpressionValue(L, index, notTypeAttributeExtraTypeFirstAfterLocation[1]) : undefined;
  const notTypeAttributeExtraTypeFirstAfterLocationAttribute = notTypeAttributeExtraTypeFirstAfterLocation?.[2] ? luaNumberExpressionValue(L, index, notTypeAttributeExtraTypeFirstAfterLocation[2]) : undefined;
  if (notTypeAttributeExtraTypeFirstAfterLocationType !== undefined && notTypeAttributeExtraTypeFirstAfterLocationAttribute !== undefined) return `special-summon-limit:not-type-attribute-extra:${notTypeAttributeExtraTypeFirstAfterLocationType}:${notTypeAttributeExtraTypeFirstAfterLocationAttribute}`;
  const notTypeRankExtra = snippet.match(new RegExp(`\\breturn\\s+(?:${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)\\s+and\\s+not\\s+\\(\\s*${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsRank\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*\\)|not\\s+\\(\\s*${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsRank\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\))`));
  const notTypeRankExtraTypeToken = notTypeRankExtra?.[1] ?? notTypeRankExtra?.[3];
  const notTypeRankExtraRankToken = notTypeRankExtra?.[2] ?? notTypeRankExtra?.[4];
  const notTypeRankExtraType = notTypeRankExtraTypeToken ? luaNumberExpressionValue(L, index, notTypeRankExtraTypeToken) : undefined;
  const notTypeRankExtraRank = notTypeRankExtraRankToken ? luaNumberTokenValue(L, index, notTypeRankExtraRankToken) : undefined;
  if (notTypeRankExtraType !== undefined && notTypeRankExtraRank !== undefined) return `special-summon-limit:not-type-rank-extra:${notTypeRankExtraType}:${notTypeRankExtraRank}`;
  const notTypeRankAboveExtra = snippet.match(new RegExp(`\\breturn\\s+(?:${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)\\s+and\\s+not\\s+\\(\\s*${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsRankAbove\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*\\)|not\\s+\\(\\s*${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsRankAbove\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\))`));
  const notTypeRankAboveExtraTypeToken = notTypeRankAboveExtra?.[1] ?? notTypeRankAboveExtra?.[3];
  const notTypeRankAboveExtraRankToken = notTypeRankAboveExtra?.[2] ?? notTypeRankAboveExtra?.[4];
  const notTypeRankAboveExtraType = notTypeRankAboveExtraTypeToken ? luaNumberExpressionValue(L, index, notTypeRankAboveExtraTypeToken) : undefined;
  const notTypeRankAboveExtraRank = notTypeRankAboveExtraRankToken ? luaNumberTokenValue(L, index, notTypeRankAboveExtraRankToken) : undefined;
  if (notTypeRankAboveExtraType !== undefined && notTypeRankAboveExtraRank !== undefined) return `special-summon-limit:not-type-rank-above-extra:${notTypeRankAboveExtraType}:${notTypeRankAboveExtraRank}`;
  const notTypeLevelExtra = snippet.match(new RegExp(`\\breturn\\s+(?:${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)\\s+and\\s+not\\s+\\(\\s*(?:${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLevel\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)|${card}\\s*:\\s*IsLevel\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\))\\s*\\)|not\\s+\\(\\s*(?:${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLevel\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)|${card}\\s*:\\s*IsLevel\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\))\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\))`));
  const notTypeLevelExtraTypeToken = notTypeLevelExtra?.[1] ?? notTypeLevelExtra?.[4] ?? notTypeLevelExtra?.[5] ?? notTypeLevelExtra?.[8];
  const notTypeLevelExtraLevelToken = notTypeLevelExtra?.[2] ?? notTypeLevelExtra?.[3] ?? notTypeLevelExtra?.[6] ?? notTypeLevelExtra?.[7];
  const notTypeLevelExtraType = notTypeLevelExtraTypeToken ? luaNumberExpressionValue(L, index, notTypeLevelExtraTypeToken) : undefined;
  const notTypeLevelExtraLevel = notTypeLevelExtraLevelToken ? luaNumberTokenValue(L, index, notTypeLevelExtraLevelToken) : undefined;
  if (notTypeLevelExtraType !== undefined && notTypeLevelExtraLevel !== undefined) return `special-summon-limit:not-type-level-extra:${notTypeLevelExtraType}:${notTypeLevelExtraLevel}`;
  const notLevelAboveAttributeExtra = snippet.match(new RegExp(`\\breturn\\s+(?:not\\s+\\(\\s*${card}\\s*:\\s*IsLevelAbove\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)|${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)\\s+and\\s+not\\s+\\(\\s*${card}\\s*:\\s*IsLevelAbove\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*\\))`));
  const notLevelAboveAttributeExtraLevelToken = notLevelAboveAttributeExtra?.[1] ?? notLevelAboveAttributeExtra?.[3];
  const notLevelAboveAttributeExtraAttributeToken = notLevelAboveAttributeExtra?.[2] ?? notLevelAboveAttributeExtra?.[4];
  const notLevelAboveAttributeExtraLevel = notLevelAboveAttributeExtraLevelToken ? luaNumberTokenValue(L, index, notLevelAboveAttributeExtraLevelToken) : undefined;
  const notLevelAboveAttributeExtraAttribute = notLevelAboveAttributeExtraAttributeToken ? luaNumberTokenValue(L, index, notLevelAboveAttributeExtraAttributeToken) : undefined;
  if (notLevelAboveAttributeExtraLevel !== undefined && notLevelAboveAttributeExtraAttribute !== undefined) return `special-summon-limit:not-level-above-attribute-extra:${notLevelAboveAttributeExtraLevel}:${notLevelAboveAttributeExtraAttribute}`;
  const notLevelAboveRaceExtra = snippet.match(new RegExp(`\\breturn\\s+(?:not\\s+\\(\\s*${card}\\s*:\\s*IsLevelAbove\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)|${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)\\s+and\\s+not\\s+\\(\\s*${card}\\s*:\\s*IsLevelAbove\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s*\\))`));
  const notLevelAboveRaceExtraLevelToken = notLevelAboveRaceExtra?.[1] ?? notLevelAboveRaceExtra?.[3];
  const notLevelAboveRaceExtraRaceToken = notLevelAboveRaceExtra?.[2] ?? notLevelAboveRaceExtra?.[4];
  const notLevelAboveRaceExtraLevel = notLevelAboveRaceExtraLevelToken ? luaNumberTokenValue(L, index, notLevelAboveRaceExtraLevelToken) : undefined;
  const notLevelAboveRaceExtraRace = notLevelAboveRaceExtraRaceToken ? luaNumberExpressionValue(L, index, notLevelAboveRaceExtraRaceToken) : undefined;
  if (notLevelAboveRaceExtraLevel !== undefined && notLevelAboveRaceExtraRace !== undefined) return `special-summon-limit:not-level-above-race-extra:${notLevelAboveRaceExtraLevel}:${notLevelAboveRaceExtraRace}`;
  const notRaceBaseAttackExtra = snippet.match(new RegExp(`\\breturn\\s+(?:${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)\\s+and\\s+not\\s+\\(\\s*${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*GetBaseAttack\\s*\\(\\s*\\)\\s*<=\\s*(${numericOrIdentifierPattern})\\s*\\)|not\\s+\\(\\s*${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*GetBaseAttack\\s*\\(\\s*\\)\\s*<=\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\))`));
  const notRaceBaseAttackExtraRaceToken = notRaceBaseAttackExtra?.[1] ?? notRaceBaseAttackExtra?.[3];
  const notRaceBaseAttackExtraAttackToken = notRaceBaseAttackExtra?.[2] ?? notRaceBaseAttackExtra?.[4];
  const notRaceBaseAttackExtraRace = notRaceBaseAttackExtraRaceToken ? luaNumberExpressionValue(L, index, notRaceBaseAttackExtraRaceToken) : undefined;
  const notRaceBaseAttackExtraAttack = notRaceBaseAttackExtraAttackToken ? luaNumberTokenValue(L, index, notRaceBaseAttackExtraAttackToken) : undefined;
  if (notRaceBaseAttackExtraRace !== undefined && notRaceBaseAttackExtraAttack !== undefined) return `special-summon-limit:not-race-base-attack-lte-extra:${notRaceBaseAttackExtraRace}:${notRaceBaseAttackExtraAttack}`;
  const notRaceAttackExtra = snippet.match(new RegExp(`\\breturn\\s+(?:${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)\\s+and\\s+not\\s+\\(\\s*${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsAttackBelow\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*\\)|not\\s+\\(\\s*${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsAttackBelow\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\))`));
  const notRaceAttackExtraRaceToken = notRaceAttackExtra?.[1] ?? notRaceAttackExtra?.[3];
  const notRaceAttackExtraAttackToken = notRaceAttackExtra?.[2] ?? notRaceAttackExtra?.[4];
  const notRaceAttackExtraRace = notRaceAttackExtraRaceToken ? luaNumberExpressionValue(L, index, notRaceAttackExtraRaceToken) : undefined;
  const notRaceAttackExtraAttack = notRaceAttackExtraAttackToken ? luaNumberTokenValue(L, index, notRaceAttackExtraAttackToken) : undefined;
  if (notRaceAttackExtraRace !== undefined && notRaceAttackExtraAttack !== undefined) return `special-summon-limit:not-race-attack-lte-extra:${notRaceAttackExtraRace}:${notRaceAttackExtraAttack}`;
  const notSetcodeTypeExtra = snippet.match(new RegExp(`\\breturn\\s+(?:${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)\\s+and\\s+not\\s+\\(\\s*(?:${card}\\s*:\\s*IsSetCard\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)|${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsSetCard\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\))\\s*\\)|not\\s+\\(\\s*(?:${card}\\s*:\\s*IsSetCard\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)|${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsSetCard\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\))\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\))`));
  const notSetcodeTypeExtraSetcodeToken = notSetcodeTypeExtra?.[1] ?? notSetcodeTypeExtra?.[4] ?? notSetcodeTypeExtra?.[5] ?? notSetcodeTypeExtra?.[8];
  const notSetcodeTypeExtraTypeToken = notSetcodeTypeExtra?.[2] ?? notSetcodeTypeExtra?.[3] ?? notSetcodeTypeExtra?.[6] ?? notSetcodeTypeExtra?.[7];
  const notSetcodeTypeExtraSetcode = notSetcodeTypeExtraSetcodeToken ? luaNumberExpressionValue(L, index, notSetcodeTypeExtraSetcodeToken) : undefined;
  const notSetcodeTypeExtraType = notSetcodeTypeExtraTypeToken ? luaNumberExpressionValue(L, index, notSetcodeTypeExtraTypeToken) : undefined;
  if (notSetcodeTypeExtraSetcode !== undefined && notSetcodeTypeExtraType !== undefined) return `special-summon-limit:not-setcode-type-extra:${notSetcodeTypeExtraSetcode}:${notSetcodeTypeExtraType}`;
  const notSetcodeExtra = snippet.match(new RegExp(`\\breturn\\s+(?:${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)\\s+and\\s+not\\s+${card}\\s*:\\s*IsSetCard\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)|not\\s+${card}\\s*:\\s*IsSetCard\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\))`));
  const notSetcodeExtraToken = notSetcodeExtra?.[1] ?? notSetcodeExtra?.[2];
  const notSetcodeExtraValue = notSetcodeExtraToken ? luaNumberExpressionValue(L, index, notSetcodeExtraToken) : undefined;
  if (notSetcodeExtraValue !== undefined) return `special-summon-limit:not-setcode-extra:${notSetcodeExtraValue}`;
  const notNamedTypeAttributeExtra = snippet.match(new RegExp(`\\breturn\\s+not\\s+\\(\\s*${card}\\s*:\\s*Is(Fusion|Ritual|Synchro|Xyz|Pendulum|Link)Monster\\s*\\(\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)`));
  const notNamedTypeAttributeExtraType = notNamedTypeAttributeExtra?.[1] ? namedExtraDeckMonsterTypeValue(notNamedTypeAttributeExtra[1]) : undefined;
  const notNamedTypeAttributeExtraAttribute = notNamedTypeAttributeExtra?.[2] ? luaNumberTokenValue(L, index, notNamedTypeAttributeExtra[2]) : undefined;
  if (notNamedTypeAttributeExtraType !== undefined && notNamedTypeAttributeExtraAttribute !== undefined) return `special-summon-limit:not-type-attribute-extra:${notNamedTypeAttributeExtraType}:${notNamedTypeAttributeExtraAttribute}`;
  const notSynchroAttributeExtra = snippet.match(new RegExp(`\\breturn\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)\\s+and\\s+not\\s+\\(\\s*${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsSynchroMonster\\s*\\(\\s*\\)\\s*\\)`));
  const notSynchroAttributeExtraAttribute = notSynchroAttributeExtra?.[1] ? luaNumberTokenValue(L, index, notSynchroAttributeExtra[1]) : undefined;
  if (notSynchroAttributeExtraAttribute !== undefined) return `special-summon-limit:not-type-attribute-extra:${0x2000}:${notSynchroAttributeExtraAttribute}`;
  const notTypeRaceExtra = snippet.match(new RegExp(`\\breturn\\s+(?:${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)\\s+and\\s+not\\s+\\(\\s*(?:${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)|${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\))\\s*\\)|not\\s+\\(\\s*(?:${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)|${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\))\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\))`));
  const notTypeRaceExtraTypeToken = notTypeRaceExtra?.[1] ?? notTypeRaceExtra?.[4] ?? notTypeRaceExtra?.[5] ?? notTypeRaceExtra?.[8];
  const notTypeRaceExtraRaceToken = notTypeRaceExtra?.[2] ?? notTypeRaceExtra?.[3] ?? notTypeRaceExtra?.[6] ?? notTypeRaceExtra?.[7];
  const notTypeRaceExtraTypeValue = notTypeRaceExtraTypeToken ? luaNumberExpressionValue(L, index, notTypeRaceExtraTypeToken) : undefined;
  const notTypeRaceExtraRaceValue = notTypeRaceExtraRaceToken ? luaNumberExpressionValue(L, index, notTypeRaceExtraRaceToken) : undefined;
  if (notTypeRaceExtraTypeValue !== undefined && notTypeRaceExtraRaceValue !== undefined) return `special-summon-limit:not-type-race-extra:${notTypeRaceExtraTypeValue}:${notTypeRaceExtraRaceValue}`;
  const notTypeAttributeRaceExtra = snippet.match(new RegExp(`\\breturn\\s+not\\s+\\(\\s*${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)`));
  const notTypeAttributeRaceExtraType = notTypeAttributeRaceExtra?.[1] ? luaNumberTokenValue(L, index, notTypeAttributeRaceExtra[1]) : undefined;
  const notTypeAttributeRaceExtraAttribute = notTypeAttributeRaceExtra?.[2] ? luaNumberTokenValue(L, index, notTypeAttributeRaceExtra[2]) : undefined;
  const notTypeAttributeRaceExtraRace = notTypeAttributeRaceExtra?.[3] ? luaNumberTokenValue(L, index, notTypeAttributeRaceExtra[3]) : undefined;
  if (notTypeAttributeRaceExtraType !== undefined && notTypeAttributeRaceExtraAttribute !== undefined && notTypeAttributeRaceExtraRace !== undefined) return `special-summon-limit:not-type-attribute-race-extra:${notTypeAttributeRaceExtraType}:${notTypeAttributeRaceExtraAttribute}:${notTypeAttributeRaceExtraRace}`;
  const notTypeRaceAttributeExtra = snippet.match(new RegExp(`\\breturn\\s+not\\s+\\(\\s*${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)`));
  const notTypeRaceAttributeExtraType = notTypeRaceAttributeExtra?.[1] ? luaNumberTokenValue(L, index, notTypeRaceAttributeExtra[1]) : undefined;
  const notTypeRaceAttributeExtraRace = notTypeRaceAttributeExtra?.[2] ? luaNumberTokenValue(L, index, notTypeRaceAttributeExtra[2]) : undefined;
  const notTypeRaceAttributeExtraAttribute = notTypeRaceAttributeExtra?.[3] ? luaNumberTokenValue(L, index, notTypeRaceAttributeExtra[3]) : undefined;
  if (notTypeRaceAttributeExtraType !== undefined && notTypeRaceAttributeExtraAttribute !== undefined && notTypeRaceAttributeExtraRace !== undefined) return `special-summon-limit:not-type-attribute-race-extra:${notTypeRaceAttributeExtraType}:${notTypeRaceAttributeExtraAttribute}:${notTypeRaceAttributeExtraRace}`;
  const notRaceTypeOrSetcode = snippet.match(new RegExp(`\\breturn\\s+not\\s+\\(\\s*${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s*\\)\\s+and\\s+not\\s+${card}\\s*:\\s*IsSetCard\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)`));
  const notRaceTypeOrSetcodeRace = notRaceTypeOrSetcode?.[1] ? luaNumberExpressionValue(L, index, notRaceTypeOrSetcode[1]) : undefined;
  const notRaceTypeOrSetcodeType = notRaceTypeOrSetcode?.[2] ? luaNumberExpressionValue(L, index, notRaceTypeOrSetcode[2]) : undefined;
  const notRaceTypeOrSetcodeSetcode = notRaceTypeOrSetcode?.[3] ? luaNumberExpressionValue(L, index, notRaceTypeOrSetcode[3]) : undefined;
  if (notRaceTypeOrSetcodeRace !== undefined && notRaceTypeOrSetcodeType !== undefined && notRaceTypeOrSetcodeSetcode !== undefined) return `target:not-race-type-or-setcode:${notRaceTypeOrSetcodeRace}:${notRaceTypeOrSetcodeType}:${notRaceTypeOrSetcodeSetcode}`;
  const notRaceAttribute = snippet.match(new RegExp(`\\breturn\\s+not\\s+\\(\\s*${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s*\\)`));
  const notRaceAttributeRace = notRaceAttribute?.[1] ? luaNumberExpressionValue(L, index, notRaceAttribute[1]) : undefined;
  const notRaceAttributeAttribute = notRaceAttribute?.[2] ? luaNumberExpressionValue(L, index, notRaceAttribute[2]) : undefined;
  if (notRaceAttributeRace !== undefined && notRaceAttributeAttribute !== undefined) return `target:not-race-attribute:${notRaceAttributeRace}:${notRaceAttributeAttribute}`;
  const preSummonTypeParam = luaFunctionParams(snippet)?.[3];
  const pendulumSummonNotAttribute = preSummonTypeParam
    ? snippet.match(new RegExp(`\\breturn\\s+(?:not\\s+${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+\\(?\\s*${escapeRegExp(preSummonTypeParam)}\\s*&\\s*SUMMON_TYPE_PENDULUM\\s*\\)?\\s*==\\s*SUMMON_TYPE_PENDULUM|\\(?\\s*${escapeRegExp(preSummonTypeParam)}\\s*&\\s*SUMMON_TYPE_PENDULUM\\s*\\)?\\s*==\\s*SUMMON_TYPE_PENDULUM\\s+and\\s+not\\s+${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\))`))
    : undefined;
  const pendulumSummonNotAttributeToken = pendulumSummonNotAttribute?.[1] ?? pendulumSummonNotAttribute?.[2];
  const pendulumSummonNotAttributeValue = pendulumSummonNotAttributeToken ? luaNumberExpressionValue(L, index, pendulumSummonNotAttributeToken) : undefined;
  if (pendulumSummonNotAttributeValue !== undefined) return `target:pendulum-summon-not-attribute:${pendulumSummonNotAttributeValue}`;
  const pendulumSummonNotRace = preSummonTypeParam
    ? snippet.match(new RegExp(`\\breturn\\s+(?:not\\s+${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+\\(?\\s*${escapeRegExp(preSummonTypeParam)}\\s*&\\s*SUMMON_TYPE_PENDULUM\\s*\\)?\\s*==\\s*SUMMON_TYPE_PENDULUM|\\(?\\s*${escapeRegExp(preSummonTypeParam)}\\s*&\\s*SUMMON_TYPE_PENDULUM\\s*\\)?\\s*==\\s*SUMMON_TYPE_PENDULUM\\s+and\\s+not\\s+${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\))`))
    : undefined;
  const pendulumSummonNotRaceToken = pendulumSummonNotRace?.[1] ?? pendulumSummonNotRace?.[2];
  const pendulumSummonNotRaceValue = pendulumSummonNotRaceToken ? luaNumberExpressionValue(L, index, pendulumSummonNotRaceToken) : undefined;
  if (pendulumSummonNotRaceValue !== undefined) return `target:pendulum-summon-not-race:${pendulumSummonNotRaceValue}`;
  const notAttributeRaceExtra = snippet.match(new RegExp(`\\breturn\\s+(?:${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)\\s+and\\s+not\\s+\\(\\s*(?:${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)|${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\))\\s*\\)|not\\s+\\(\\s*(?:${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)|${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\))\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\))`));
  const notAttributeRaceExtraAttributeToken = notAttributeRaceExtra?.[1] ?? notAttributeRaceExtra?.[4] ?? notAttributeRaceExtra?.[5] ?? notAttributeRaceExtra?.[8];
  const notAttributeRaceExtraRaceToken = notAttributeRaceExtra?.[2] ?? notAttributeRaceExtra?.[3] ?? notAttributeRaceExtra?.[6] ?? notAttributeRaceExtra?.[7];
  const notAttributeRaceExtraAttribute = notAttributeRaceExtraAttributeToken ? luaNumberExpressionValue(L, index, notAttributeRaceExtraAttributeToken) : undefined;
  const notAttributeRaceExtraRace = notAttributeRaceExtraRaceToken ? luaNumberExpressionValue(L, index, notAttributeRaceExtraRaceToken) : undefined;
  if (notAttributeRaceExtraAttribute !== undefined && notAttributeRaceExtraRace !== undefined) return `special-summon-limit:not-attribute-race-extra:${notAttributeRaceExtraAttribute}:${notAttributeRaceExtraRace}`;
  const type = snippet.match(new RegExp(`\\breturn\\s+${card}\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)(?!\\s+(?:and|or)\\b)`));
  const typeValue = type?.[1] ? luaNumberExpressionValue(L, index, type[1]) : undefined;
  if (typeValue !== undefined) return `target:type:${typeValue}`;
  const levelAbove = snippet.match(new RegExp(`\\breturn\\s+${card}\\s*:\\s*IsLevelAbove\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)(?!\\s+(?:and|or)\\b)`));
  const levelAboveValue = levelAbove?.[1] ? luaNumberTokenValue(L, index, levelAbove[1]) : undefined;
  if (levelAboveValue !== undefined) return `target:level-above:${levelAboveValue}`;
  const attackBelow = snippet.match(new RegExp(`\\breturn\\s+${card}\\s*:\\s*IsAttackBelow\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)(?!\\s+(?:and|or)\\b)`));
  const attackBelowValue = attackBelow?.[1] ? luaNumberTokenValue(L, index, attackBelow[1]) : undefined;
  if (attackBelowValue !== undefined) return `target:attack-below:${attackBelowValue}`;
  const notLevelOrRankAbove = snippet.match(new RegExp(`\\breturn\\s+not\\s+\\(\\s*${card}\\s*:\\s*IsLevelAbove\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+or\\s+${card}\\s*:\\s*IsRankAbove\\s*\\(\\s*\\1\\s*\\)\\s*\\)`));
  const notLevelOrRankAboveValue = notLevelOrRankAbove?.[1] ? luaNumberTokenValue(L, index, notLevelOrRankAbove[1]) : undefined;
  if (notLevelOrRankAboveValue !== undefined) return `target:not-level-or-rank-above:${notLevelOrRankAboveValue}`;
  const notType = snippet.match(new RegExp(`\\breturn\\s+not\\s+${card}\\s*:\\s*Is(?:Original)?Type\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`));
  const notTypeValue = notType?.[1] ? luaNumberTokenValue(L, index, notType[1]) : undefined;
  if (notTypeValue !== undefined) return `target:not-type:${notTypeValue}`;
  const notRaceExtra = snippet.match(new RegExp(`\\breturn\\s+(?:${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)\\s+and\\s+not\\s+\\(?\\s*${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*\\)?|not\\s+\\(?\\s*${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*\\)?\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\))`));
  const notRaceExtraToken = notRaceExtra?.[1] ?? notRaceExtra?.[2];
  const notRaceExtraValue = notRaceExtraToken ? luaNumberTokenValue(L, index, notRaceExtraToken) : undefined;
  if (notRaceExtraValue !== undefined) return `special-summon-limit:not-race-extra:${notRaceExtraValue}`;
  const notAttributeExtra = snippet.match(new RegExp(`\\breturn\\s+(?:${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)\\s+and\\s+not\\s+${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)|not\\s+${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\))`));
  const notAttributeExtraToken = notAttributeExtra?.[1] ?? notAttributeExtra?.[2];
  const notAttributeExtraValue = notAttributeExtraToken ? luaNumberTokenValue(L, index, notAttributeExtraToken) : undefined;
  if (notAttributeExtraValue !== undefined) return `special-summon-limit:not-attribute-extra:${notAttributeExtraValue}`;
  const notAttribute = snippet.match(new RegExp(`\\breturn\\s+not\\s+${card}\\s*:\\s*IsAttribute\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`)) ?? snippet.match(new RegExp(`\\breturn\\s+${card}\\s*:\\s*GetAttribute\\s*\\(\\s*\\)\\s*~=\\s*(${numericOrIdentifierPattern})`));
  const notAttributeValue = notAttribute?.[1] ? luaNumberTokenValue(L, index, notAttribute[1]) : undefined;
  if (notAttributeValue !== undefined) return `target:not-attribute:${notAttributeValue}`;
  const notRace = snippet.match(new RegExp(`\\breturn\\s+not\\s+${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`)) ?? snippet.match(new RegExp(`\\breturn\\s+${card}\\s*:\\s*GetRace\\s*\\(\\s*\\)\\s*~=\\s*(${numericOrIdentifierPattern})`));
  const notRaceValue = notRace?.[1] ? luaNumberTokenValue(L, index, notRace[1]) : undefined;
  if (notRaceValue !== undefined) return `target:not-race:${notRaceValue}`;
  const setcodeOrCodeType = setcodeOrCodeTypeTargetDescriptor(L, index, snippet, card);
  if (setcodeOrCodeType !== undefined) return setcodeOrCodeType;
  const notCode = snippet.match(new RegExp(`\\breturn\\s+not\\s+${card}\\s*:\\s*IsCode\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`)) ?? snippet.match(new RegExp(`\\breturn\\s+${card}\\s*:\\s*GetCode\\s*\\(\\s*\\)\\s*~=\\s*(${numericOrIdentifierPattern})`));
  const notCodeValue = notCode?.[1] ? luaNumberTokenValue(L, index, notCode[1]) : undefined;
  if (notCodeValue !== undefined) return `target:not-code:${notCodeValue}`;
  const effectParam = luaFunctionParams(snippet)?.[0];
  if (effectParam && new RegExp(`\\breturn\\s+${card}\\s*:\\s*IsCode\\s*\\(\\s*${escapeRegExp(effectParam)}\\s*:\\s*GetLabel\\s*\\(\\s*\\)\\s*\\)`).test(snippet)) return "target:same-code-label";
  const summonTypeParam = luaFunctionParams(snippet)?.[3];
  const summonPositionParam = luaFunctionParams(snippet)?.[4];
  const relatedEffectParam = luaFunctionParams(snippet)?.[6];
  if (summonPositionParam && new RegExp(`\\breturn\\s+\\(\\s*${escapeRegExp(summonPositionParam)}\\s*&\\s*(?:POS_FACEDOWN|10)\\s*\\)\\s*>\\s*0`).test(snippet)) return "target:special-summon-position-facedown";
  const pendulumSummonNotSetcode = summonTypeParam
    ? snippet.match(new RegExp(`\\breturn\\s+(?:(?:\\(?\\s*${escapeRegExp(summonTypeParam)}\\s*&\\s*SUMMON_TYPE_PENDULUM\\s*\\)?\\s*==\\s*SUMMON_TYPE_PENDULUM|${escapeRegExp(summonTypeParam)}\\s*&\\s*SUMMON_TYPE_PENDULUM\\s*==\\s*SUMMON_TYPE_PENDULUM)\\s+and\\s+not\\s+${card}\\s*:\\s*IsSetCard\\s*\\(\\s*(?:\\{\\s*)?(${numericOrIdentifierListPattern})(?:\\s*\\})?\\s*\\)|not\\s+${card}\\s*:\\s*IsSetCard\\s*\\(\\s*(?:\\{\\s*)?(${numericOrIdentifierListPattern})(?:\\s*\\})?\\s*\\)\\s+and\\s+\\(?\\s*${escapeRegExp(summonTypeParam)}\\s*&\\s*SUMMON_TYPE_PENDULUM\\s*\\)?\\s*==\\s*SUMMON_TYPE_PENDULUM)`))
    : undefined;
  const pendulumSummonNotSetcodeToken = pendulumSummonNotSetcode?.[1] ?? pendulumSummonNotSetcode?.[2];
  const pendulumSummonNotSetcodeValues = pendulumSummonNotSetcodeToken ? luaNumberListValue(L, index, pendulumSummonNotSetcodeToken) : undefined;
  if (pendulumSummonNotSetcodeValues?.length) return `target:pendulum-summon-not-setcode:${pendulumSummonNotSetcodeValues.join(",")}`;
  const ritualSummonNotRace = summonTypeParam
    ? snippet.match(new RegExp(`\\breturn\\s+\\(?\\s*${escapeRegExp(summonTypeParam)}\\s*&\\s*SUMMON_TYPE_RITUAL\\s*\\)?\\s*==\\s*SUMMON_TYPE_RITUAL\\s+and\\s+not\\s+${card}\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierExpressionPattern})\\s*\\)`))
    : undefined;
  const ritualSummonNotRaceValue = ritualSummonNotRace?.[1] ? luaNumberExpressionValue(L, index, ritualSummonNotRace[1]) : undefined;
  if (ritualSummonNotRaceValue !== undefined) return `target:ritual-summon-not-race:${ritualSummonNotRaceValue}`;
  const extraSummonTypeNot = summonTypeParam
    ? snippet.match(new RegExp(`\\breturn\\s+${card}\\s*:\\s*IsLocation\\s*\\(\\s*(?:LOCATION_EXTRA|64)\\s*\\)\\s+and\\s+\\(?\\s*${escapeRegExp(summonTypeParam)}\\s*&\\s*(${numericOrIdentifierPattern})\\s*\\)?\\s*~=\\s*\\1`))
    : undefined;
  const extraSummonTypeNotValue = extraSummonTypeNot?.[1] ? luaSummonTypeTokenValue(L, index, extraSummonTypeNot[1]) : undefined;
  if (extraSummonTypeNotValue !== undefined) return `target:extra-summon-type-not:${extraSummonTypeNotValue}`;
  const xyzSummonNotRelatedSetcode = relatedEffectParam && summonTypeParam ? snippet.match(new RegExp(`\\breturn\\s+\\(\\s*${escapeRegExp(summonTypeParam)}\\s*&\\s*SUMMON_TYPE_XYZ\\s*\\)\\s*==\\s*SUMMON_TYPE_XYZ\\s+and\\s+not\\s+${escapeRegExp(relatedEffectParam)}\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsSetCard\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`)) : undefined;
  const xyzSummonNotRelatedSetcodeValue = xyzSummonNotRelatedSetcode?.[1] ? luaNumberTokenValue(L, index, xyzSummonNotRelatedSetcode[1]) : undefined;
  if (xyzSummonNotRelatedSetcodeValue !== undefined) return `target:xyz-summon-not-related-setcode:${xyzSummonNotRelatedSetcodeValue}`;
  if (summonTypeParam) {
    const summonTypeNot = snippet.match(new RegExp(`\\breturn\\s+${escapeRegExp(summonTypeParam)}\\s*~=\\s*(SUMMON_TYPE_SPECIAL\\s*\\+\\s*${numericOrIdentifierPattern}|${numericOrIdentifierPattern})`));
    const summonTypeMaskIs = snippet.match(new RegExp(`\\breturn\\s+${escapeRegExp(summonTypeParam)}\\s*&\\s*(${numericOrIdentifierPattern})\\s*==\\s*\\1`)) ?? snippet.match(new RegExp(`\\breturn\\s+\\(\\s*${escapeRegExp(summonTypeParam)}\\s*&\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*==\\s*\\1`));
    const summonTypeMaskIsAny = snippet.match(new RegExp(`\\breturn\\s+\\(\\s*${escapeRegExp(summonTypeParam)}\\s*&\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*==\\s*\\1\\s+or\\s+\\(\\s*${escapeRegExp(summonTypeParam)}\\s*&\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*==\\s*\\2`));
    const summonTypeMaskNot = snippet.match(new RegExp(`\\breturn\\s+\\(\\s*${escapeRegExp(summonTypeParam)}\\s*&\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*~=\\s*\\1`));
    const summonTypeIsAny = summonTypeMaskIsAny?.[1] && summonTypeMaskIsAny[2] ? [luaSummonTypeTokenValue(L, index, summonTypeMaskIsAny[1]), luaSummonTypeTokenValue(L, index, summonTypeMaskIsAny[2])] : undefined;
    if (summonTypeIsAny?.every((value): value is number => value !== undefined)) return `target:special-summon-type-is-any:${summonTypeIsAny.join(",")}`;
    const summonTypeIsValue = summonTypeMaskIs?.[1] ? luaSummonTypeTokenValue(L, index, summonTypeMaskIs[1]) : undefined;
    if (summonTypeIsValue !== undefined) return `target:special-summon-type-is:${summonTypeIsValue}`;
    const summonTypeNotToken = summonTypeNot?.[1] ?? summonTypeMaskNot?.[1];
    const summonTypeNotValue = summonTypeNotToken ? luaSummonTypeTokenValue(L, index, summonTypeNotToken) : undefined;
    if (summonTypeNotValue !== undefined) return `target:special-summon-type-not:${summonTypeNotValue}`;
  }
  const notSetcode = snippet.match(new RegExp(`\\breturn\\s+not\\s+${card}\\s*:\\s*IsSetCard\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`));
  const setcode = notSetcode?.[1] ? luaNumberTokenValue(L, index, notSetcode[1]) : undefined;
  return setcode !== undefined && Number.isSafeInteger(setcode) && setcode > 0 ? `target:not-setcode:${setcode}` : undefined;
}

export function specialSummonTypeNotTargetDescriptor(descriptor: string | undefined): number | undefined {
  if (!descriptor?.startsWith("target:special-summon-type-not:")) return undefined;
  const value = Number(descriptor.slice("target:special-summon-type-not:".length));
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function specialSummonTypeIsTargetDescriptor(descriptor: string | undefined): number | undefined {
  if (!descriptor?.startsWith("target:special-summon-type-is:")) return undefined;
  const value = Number(descriptor.slice("target:special-summon-type-is:".length));
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function specialSummonTypeIsAnyTargetDescriptor(descriptor: string | undefined): number[] | undefined {
  if (!descriptor?.startsWith("target:special-summon-type-is-any:")) return undefined;
  const values = descriptor.slice("target:special-summon-type-is-any:".length).split(",").map(Number);
  return values.length > 0 && values.every((value) => Number.isSafeInteger(value) && value > 0) ? values : undefined;
}

function knownFixedFunctionDescriptor(L: unknown, index: number, hostState: LuaHostState): string | undefined {
  const absoluteIndex = lua.lua_absindex(L, index);
  for (const [ref, descriptor] of hostState.functionDescriptors) {
    lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, ref);
    const matches = Boolean(lua.lua_isfunction(L, -1) && lua.lua_rawequal(L, absoluteIndex, -1));
    lua.lua_pop(L, 1);
    if (matches) return descriptor;
  }
  return undefined;
}

const numericOrIdentifierPattern = String.raw`(?:0x[0-9A-Fa-f]+|\d+|[A-Za-z_]\w*)`;
const numericOrIdentifierListPattern = String.raw`${numericOrIdentifierPattern}(?:\s*,\s*${numericOrIdentifierPattern})*`;
const numericOrIdentifierExpressionPattern = String.raw`${numericOrIdentifierPattern}(?:\s*[|+]\s*${numericOrIdentifierPattern})*`;

function setcodeOrCodeTypeTargetDescriptor(L: unknown, index: number, snippet: string, card: string): string | undefined {
  const cardCall = `${card}\\s*:\\s*`;
  const setcodeCall = `${cardCall}IsSetCard\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`;
  const codeCall = `${cardCall}IsCode\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`;
  const typeCall = `${cardCall}IsType\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`;
  const match =
    snippet.match(new RegExp(`\\breturn\\s+${setcodeCall}\\s+or\\s+\\(?\\s*${codeCall}\\s+and\\s+${typeCall}\\s*\\)?`)) ??
    snippet.match(new RegExp(`\\breturn\\s+${setcodeCall}\\s+or\\s+\\(?\\s*${typeCall}\\s+and\\s+${codeCall}\\s*\\)?`));
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  const setcode = luaNumberTokenValue(L, index, match[1]);
  const code = luaNumberTokenValue(L, index, match[2]);
  const type = luaNumberTokenValue(L, index, match[3]);
  return setcode !== undefined && code !== undefined && type !== undefined ? `target:setcode-or-code-type:${setcode}:${code}:${type}` : undefined;
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

function luaNumberExpressionValue(L: unknown, functionIndex: number, token: string): number | undefined {
  const parts = token.split(/[|+]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;
  let value = 0;
  for (const part of parts) {
    const partValue = luaNumberTokenValue(L, functionIndex, part);
    if (partValue === undefined) return undefined;
    value |= partValue;
  }
  return value;
}

function luaNumberListValue(L: unknown, functionIndex: number, token: string): number[] | undefined {
  const values = token.split(",").map((part) => luaNumberTokenValue(L, functionIndex, part.trim()));
  return values.length > 0 && values.every((value): value is number => value !== undefined) ? values : undefined;
}

function namedExtraDeckMonsterTypeValue(name: string): number | undefined {
  if (name === "Fusion") return 0x40;
  if (name === "Ritual") return 0x80;
  if (name === "Synchro") return 0x2000;
  if (name === "Xyz") return 0x800000;
  if (name === "Pendulum") return 0x1000000;
  if (name === "Link") return 0x4000000;
  return undefined;
}

function luaSummonTypeTokenValue(L: unknown, functionIndex: number, token: string): number | undefined {
  const parts = token.split("+").map((part) => part.trim());
  if (parts.length === 2 && parts[0] === "SUMMON_TYPE_SPECIAL" && parts[1] !== undefined) {
    const detail = luaNumberTokenValue(L, functionIndex, parts[1]);
    return detail === undefined ? undefined : 0x40000000 + detail;
  }
  return luaNumberTokenValue(L, functionIndex, token);
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
