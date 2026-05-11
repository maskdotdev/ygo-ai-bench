import fengari from "fengari";
import { luaFunctionParams, luaFunctionSourceSnippet } from "#lua/effect-descriptor-source.js";
import type { LuaHostState } from "#lua/host-types.js";

const { lua, to_jsstring, to_luastring } = fengari;
const numericOrIdentifierPattern = String.raw`(?:0x[0-9A-Fa-f]+|\d+|[A-Za-z_]\w*)`;
const summonTypeConditionValues: Record<string, number> = { Ritual: 0x45000000, Fusion: 0x43000000, Synchro: 0x46000000, Xyz: 0x49000000, Pendulum: 0x4a000000, Link: 0x4c000000 };

export function knownLuaEffectConditionDescriptor(L: unknown, index: number, hostState: LuaHostState): string | undefined {
  const snippet = luaFunctionSourceSnippet(L, index, hostState);
  if (!snippet) return undefined;
  if (/\breturn\s+Duel\s*\.\s*GetCurrentPhase\s*\(\s*\)\s*~=\s*PHASE_DRAW\b/.test(snippet)) return "condition:not-draw-phase";
  const equippedTargetSetcode = snippet.match(new RegExp(`\\breturn\\s+\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*GetEquipTarget\\s*\\(\\s*\\)\\s*:\\s*IsSetCard\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`));
  const equippedTargetSetcodeValue = equippedTargetSetcode?.[1] ? luaNumberTokenValue(L, index, equippedTargetSetcode[1]) : undefined;
  if (equippedTargetSetcodeValue !== undefined) return `condition:equipped-target-setcode:${equippedTargetSetcodeValue}`;
  const equippedTargetType = snippet.match(new RegExp(`\\breturn\\s+\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*GetEquipTarget\\s*\\(\\s*\\)\\s*:\\s*IsType\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`));
  const equippedTargetTypeValue = equippedTargetType?.[1] ? luaNumberTokenValue(L, index, equippedTargetType[1]) : undefined;
  if (equippedTargetTypeValue !== undefined) return `condition:equipped-target-type:${equippedTargetTypeValue}`;
  const equippedTargetRace = snippet.match(new RegExp(`\\blocal\\s+(\\w+)\\s*=\\s*\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*GetEquipTarget\\s*\\(\\s*\\)\\s+return\\s+\\1\\s+and\\s+\\1\\s*:\\s*IsRace\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)`));
  const equippedTargetRaceValue = equippedTargetRace?.[2] ? luaNumberTokenValue(L, index, equippedTargetRace[2]) : undefined;
  if (equippedTargetRaceValue !== undefined) return `condition:equipped-target-race:${equippedTargetRaceValue}`;
  if (/\breturn\s+\w+\s*:\s*GetHandler\s*\(\s*\)\s*:\s*GetEquipTarget\s*\(\s*\)/.test(snippet)) return "condition:source-equipped";
  if (/\breturn\s+\w+\s*:\s*GetHandler\s*\(\s*\)\s*:\s*IsFaceup\s*\(\s*\)\s*(?:end\b|$)/.test(snippet)) return "condition:source-faceup";
  if (/\breturn\s+\w+\s*:\s*GetHandler\s*\(\s*\)\s*:\s*IsAttackPos\s*\(\s*\)\s*(?:end\b|$)/.test(snippet)) return "condition:source-attack-position";
  if (/\breturn\s+\w+\s*:\s*GetHandler\s*\(\s*\)\s*:\s*IsDefensePos\s*\(\s*\)\s*(?:end\b|$)/.test(snippet)) return "condition:source-defense-position";
  const sourceLocationNot = snippet.match(new RegExp(`\\breturn\\s+not\\s+\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsLocation\\s*\\(\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\)\\s*(?:end\\b|$)`));
  const sourceLocationNotValue = sourceLocationNot?.[1] ? luaNumberExpressionValue(L, index, sourceLocationNot[1]) : undefined;
  if (sourceLocationNotValue !== undefined) return `condition:source-location-not:${sourceLocationNotValue}`;
  const sourceLocation = snippet.match(new RegExp(`\\breturn\\s+\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsLocation\\s*\\(\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\)\\s*(?:end\\b|$)`));
  const sourceLocationValue = sourceLocation?.[1] ? luaNumberExpressionValue(L, index, sourceLocation[1]) : undefined;
  if (sourceLocationValue !== undefined) return `condition:source-location:${sourceLocationValue}`;
  const sourceSummonType = snippet.match(/\breturn\s+\w+\s*:\s*GetHandler\s*\(\s*\)\s*:\s*Is(Ritual|Fusion|Synchro|Xyz|Pendulum|Link)Summoned\s*\(\s*\)\s*(?:end\b|$)/);
  if (sourceSummonType?.[1]) return `condition:source-summon-type:${summonTypeConditionValues[sourceSummonType[1]]}`;
  const sourceTurnCurrentReasonNot = snippet.match(new RegExp(`\\b(?:local\\s+(\\w+)\\s*=\\s*\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s+)?return\\s+(?:(?:\\1|\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\))\\s*:\\s*GetTurnID\\s*\\(\\s*\\)\\s*==\\s*Duel\\s*\\.\\s*GetTurnCount\\s*\\(\\s*\\)\\s+and\\s+not\\s+(?:\\1|\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\))\\s*:\\s*IsReason\\s*\\(\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\))`));
  const sourceTurnCurrentReasonNotValue = sourceTurnCurrentReasonNot?.[2] ? luaNumberExpressionValue(L, index, sourceTurnCurrentReasonNot[2]) : undefined;
  if (sourceTurnCurrentReasonNotValue !== undefined) return `condition:source-turn-current-reason-not:${sourceTurnCurrentReasonNotValue}`;
  if (/\breturn\s+\w+\s*:\s*GetHandler\s*\(\s*\)\s*:\s*GetTurnID\s*\(\s*\)\s*==\s*Duel\s*\.\s*GetTurnCount\s*\(\s*\)\s*(?:end\b|$)/.test(snippet)) return "condition:source-turn-current";
  if (/\breturn\s+(?:\w+\s*:\s*GetHandler\s*\(\s*\)\s*:\s*GetTurnID\s*\(\s*\)\s*~=\s*Duel\s*\.\s*GetTurnCount\s*\(\s*\)|Duel\s*\.\s*GetTurnCount\s*\(\s*\)\s*~=\s*\w+\s*:\s*GetHandler\s*\(\s*\)\s*:\s*GetTurnID\s*\(\s*\))\s*(?:end\b|$)/.test(snippet)) return "condition:source-turn-not-current";
  if (/\breturn\s+Duel\s*\.\s*GetTurnCount\s*\(\s*\)\s*==\s*\w+\s*:\s*GetHandler\s*\(\s*\)\s*:\s*GetTurnID\s*\(\s*\)\s*\+\s*1\s*(?:end\b|$)/.test(snippet)) return "condition:source-turn-next";
  if (/\breturn\s+(?:Duel\s*\.\s*IsTurnPlayer\s*\(\s*tp\s*\)\s+and\s+Duel\s*\.\s*IsMainPhase\s*\(\s*\)|Duel\s*\.\s*IsMainPhase\s*\(\s*\)\s+and\s+Duel\s*\.\s*IsTurnPlayer\s*\(\s*tp\s*\))\s*(?:end\b|$)/.test(snippet)) return "condition:turn-player:self-main-phase";
  if (/\breturn\s+(?:Duel\s*\.\s*IsTurnPlayer\s*\(\s*1\s*-\s*tp\s*\)\s+and\s+Duel\s*\.\s*IsMainPhase\s*\(\s*\)|Duel\s*\.\s*IsMainPhase\s*\(\s*\)\s+and\s+Duel\s*\.\s*IsTurnPlayer\s*\(\s*1\s*-\s*tp\s*\))\s*(?:end\b|$)/.test(snippet)) return "condition:turn-player:opponent-main-phase";
  if (/\breturn\s+(?:Duel\s*\.\s*IsTurnPlayer\s*\(\s*tp\s*\)\s+and\s+Duel\s*\.\s*IsBattlePhase\s*\(\s*\)|Duel\s*\.\s*IsBattlePhase\s*\(\s*\)\s+and\s+Duel\s*\.\s*IsTurnPlayer\s*\(\s*tp\s*\))\s*(?:end\b|$)/.test(snippet)) return "condition:turn-player:self-battle-phase";
  if (/\breturn\s+(?:Duel\s*\.\s*IsTurnPlayer\s*\(\s*1\s*-\s*tp\s*\)\s+and\s+Duel\s*\.\s*IsBattlePhase\s*\(\s*\)|Duel\s*\.\s*IsBattlePhase\s*\(\s*\)\s+and\s+Duel\s*\.\s*IsTurnPlayer\s*\(\s*1\s*-\s*tp\s*\))\s*(?:end\b|$)/.test(snippet)) return "condition:turn-player:opponent-battle-phase";
  const turnPlayerPhase = snippet.match(new RegExp(`\\breturn\\s+(?:(Duel\\s*\\.\\s*IsTurnPlayer\\s*\\(\\s*(tp|1\\s*-\\s*tp)\\s*\\)\\s+and\\s+Duel\\s*\\.\\s*IsPhase\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\))|(Duel\\s*\\.\\s*IsPhase\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s+and\\s+Duel\\s*\\.\\s*IsTurnPlayer\\s*\\(\\s*(tp|1\\s*-\\s*tp)\\s*\\)))\\s*(?:end\\b|$)`));
  const turnPlayerPhaseValue = turnPlayerPhase?.[3] ? luaNumberTokenValue(L, index, turnPlayerPhase[3]) : turnPlayerPhase?.[5] ? luaNumberTokenValue(L, index, turnPlayerPhase[5]) : undefined;
  if (turnPlayerPhase && turnPlayerPhaseValue !== undefined) return `condition:turn-player-phase:${(turnPlayerPhase[2] ?? turnPlayerPhase[6])?.startsWith("1") ? "opponent" : "self"}:${turnPlayerPhaseValue}`;
  const exactPhase = snippet.match(new RegExp(`\\breturn\\s+Duel\\s*\\.\\s*IsPhase\\s*\\(\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*(?:end\\b|$)`));
  const exactPhaseValue = exactPhase?.[1] ? luaNumberTokenValue(L, index, exactPhase[1]) : undefined;
  if (exactPhaseValue !== undefined) return `condition:phase:${exactPhaseValue}`;
  if (/\breturn\s+Duel\s*\.\s*IsBattlePhase\s*\(\s*\)\s*(?:end\b|$)/.test(snippet)) return "condition:battle-phase";
  if (/\breturn\s+(?:Duel\s*\.\s*IsMainPhase\s*\(\s*\)\s+or\s+Duel\s*\.\s*IsBattlePhase\s*\(\s*\)|Duel\s*\.\s*IsBattlePhase\s*\(\s*\)\s+or\s+Duel\s*\.\s*IsMainPhase\s*\(\s*\))\s*(?:end\b|$)/.test(snippet)) return "condition:main-or-battle-phase";
  if (/\breturn\s+Duel\s*\.\s*IsMainPhase\s*\(\s*\)\s*(?:end\b|$)/.test(snippet)) return "condition:main-phase";
  if (/\breturn\s+Duel\s*\.\s*IsMainPhase2\s*\(\s*\)\s*(?:end\b|$)/.test(snippet)) return "condition:phase:256";
  if (/\breturn\s+Duel\s*\.\s*IsStandbyPhase\s*\(\s*\)\s*(?:end\b|$)/.test(snippet)) return "condition:phase:2";
  if (/\breturn\s+\w+\s*:\s*GetHandler\s*\(\s*\)\s*:\s*GetBattleTarget\s*\(\s*\)\s*(?:~=\s*nil\s*)?(?:end\b|$)/.test(snippet)) return "condition:source-battle-target";
  const sourceStatusNot = snippet.match(new RegExp(`\\breturn\\s+not\\s+\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsStatus\\s*\\(\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\)\\s*(?:end\\b|$)`));
  const sourceStatusNotValue = sourceStatusNot?.[1] ? luaNumberExpressionValue(L, index, sourceStatusNot[1]) : undefined;
  if (sourceStatusNotValue !== undefined) return `condition:source-status-not:${sourceStatusNotValue}`;
  const sourceStatusSummonType = snippet.match(new RegExp(`\\blocal\\s+(\\w+)\\s*=\\s*\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s+return\\s+\\1\\s*:\\s*IsStatus\\s*\\(\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\)\\s+and\\s+\\1\\s*:\\s*Is(Ritual|Fusion|Synchro|Xyz|Pendulum|Link)Summoned\\s*\\(\\s*\\)\\s*(?:end\\b|$)`));
  const sourceStatusSummonTypeValue = sourceStatusSummonType?.[2] ? luaNumberExpressionValue(L, index, sourceStatusSummonType[2]) : undefined;
  if (sourceStatusSummonTypeValue !== undefined && sourceStatusSummonType?.[3]) return `condition:source-status-summon-type:${sourceStatusSummonTypeValue}:${summonTypeConditionValues[sourceStatusSummonType[3]]}`;
  const sourceStatusRelateBattle = snippet.match(new RegExp(`\\blocal\\s+(\\w+)\\s*=\\s*\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s+return\\s+\\1\\s*:\\s*IsStatus\\s*\\(\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\)\\s+and\\s+\\1\\s*:\\s*IsRelateToBattle\\s*\\(\\s*\\)\\s*(?:end\\b|$)`));
  const sourceStatusRelateBattleValue = sourceStatusRelateBattle?.[2] ? luaNumberExpressionValue(L, index, sourceStatusRelateBattle[2]) : undefined;
  if (sourceStatusRelateBattleValue !== undefined) return `condition:source-status-relate-battle:${sourceStatusRelateBattleValue}`;
  const sourceStatusBattleTargetControl = snippet.match(new RegExp(`\\blocal\\s+(\\w+)\\s*=\\s*\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s+local\\s+(\\w+)\\s*=\\s*\\1\\s*:\\s*GetBattleTarget\\s*\\(\\s*\\)\\s+return\\s+\\1\\s*:\\s*IsStatus\\s*\\(\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\)\\s+and\\s+\\2\\s+and\\s+\\2\\s*:\\s*IsAbleToChangeControler\\s*\\(\\s*\\)\\s*(?:end\\b|$)`));
  const sourceStatusBattleTargetControlValue = sourceStatusBattleTargetControl?.[3] ? luaNumberExpressionValue(L, index, sourceStatusBattleTargetControl[3]) : undefined;
  if (sourceStatusBattleTargetControlValue !== undefined) return `condition:source-status-battle-target-control:${sourceStatusBattleTargetControlValue}`;
  const sourceStatus = snippet.match(new RegExp(`\\breturn\\s+\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsStatus\\s*\\(\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\)`));
  const sourceStatusValue = sourceStatus?.[1] ? luaNumberExpressionValue(L, index, sourceStatus[1]) : undefined;
  if (sourceStatusValue !== undefined) return `condition:source-status:${sourceStatusValue}`;
  if (/\breturn\s+Duel\s*\.\s*IsTurnPlayer\s*\(\s*tp\s*\)\s*(?:end\b|$)/.test(snippet)) return "condition:turn-player:self";
  if (/\breturn\s+Duel\s*\.\s*IsTurnPlayer\s*\(\s*1\s*-\s*tp\s*\)\s*(?:end\b|$)/.test(snippet)) return "condition:turn-player:opponent";
  const sourceSummonLocation = snippet.match(new RegExp(`\\breturn\\s+\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsSummonLocation\\s*\\(\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\)`));
  const sourceSummonLocationValue = sourceSummonLocation?.[1] ? luaNumberExpressionValue(L, index, sourceSummonLocation[1]) : undefined;
  if (sourceSummonLocationValue !== undefined) return `condition:source-summon-location:${sourceSummonLocationValue}`;
  const sourcePreviousLocationReason = snippet.match(new RegExp(`\\breturn\\s+\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsPreviousLocation\\s*\\(\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\)\\s+and\\s+\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsReason\\s*\\(\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\)`));
  const sourceReasonPreviousLocation = snippet.match(new RegExp(`\\breturn\\s+\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsReason\\s*\\(\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\)\\s+and\\s+\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsPreviousLocation\\s*\\(\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\)`));
  const sourcePreviousLocationReasonLocationValue = sourcePreviousLocationReason?.[1] ? luaNumberExpressionValue(L, index, sourcePreviousLocationReason[1]) : sourceReasonPreviousLocation?.[2] ? luaNumberExpressionValue(L, index, sourceReasonPreviousLocation[2]) : undefined;
  const sourcePreviousLocationReasonReasonValue = sourcePreviousLocationReason?.[2] ? luaNumberExpressionValue(L, index, sourcePreviousLocationReason[2]) : sourceReasonPreviousLocation?.[1] ? luaNumberExpressionValue(L, index, sourceReasonPreviousLocation[1]) : undefined;
  if (sourcePreviousLocationReasonLocationValue !== undefined && sourcePreviousLocationReasonReasonValue !== undefined) return `condition:source-previous-location-reason:${sourcePreviousLocationReasonLocationValue}:${sourcePreviousLocationReasonReasonValue}`;
  const sourceReasonNotPreviousLocation = snippet.match(new RegExp(`\\breturn\\s+not\\s+\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsReason\\s*\\(\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\)\\s+and\\s+\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsPreviousLocation\\s*\\(\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\)`));
  const sourceReasonNotPreviousLocationReasonValue = sourceReasonNotPreviousLocation?.[1] ? luaNumberExpressionValue(L, index, sourceReasonNotPreviousLocation[1]) : undefined;
  const sourceReasonNotPreviousLocationLocationValue = sourceReasonNotPreviousLocation?.[2] ? luaNumberExpressionValue(L, index, sourceReasonNotPreviousLocation[2]) : undefined;
  if (sourceReasonNotPreviousLocationLocationValue !== undefined && sourceReasonNotPreviousLocationReasonValue !== undefined) return `condition:source-previous-location-reason-not:${sourceReasonNotPreviousLocationLocationValue}:${sourceReasonNotPreviousLocationReasonValue}`;
  const sourcePreviousLocation = snippet.match(new RegExp(`\\breturn\\s+\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsPreviousLocation\\s*\\(\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\)`));
  const sourcePreviousLocationValue = sourcePreviousLocation?.[1] ? luaNumberExpressionValue(L, index, sourcePreviousLocation[1]) : undefined;
  if (sourcePreviousLocationValue !== undefined) return `condition:source-previous-location:${sourcePreviousLocationValue}`;
  const sourcePreviousLocationEquals = snippet.match(new RegExp(`\\breturn\\s+\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*GetPreviousLocation\\s*\\(\\s*\\)\\s*==\\s*(${numericOrIdentifierPattern})`));
  const sourcePreviousLocationEqualsValue = sourcePreviousLocationEquals?.[1] ? luaNumberTokenValue(L, index, sourcePreviousLocationEquals[1]) : undefined;
  if (sourcePreviousLocationEqualsValue !== undefined) return `condition:source-previous-location:${sourcePreviousLocationEqualsValue}`;
  const sourcePreviousLocationMask = snippet.match(new RegExp(`\\b\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*GetPreviousLocation\\s*\\(\\s*\\)\\s*&\\s*(${numericOrIdentifierPattern})\\s*(?:\\)\\s*~=\\s*0|>\\s*0)`));
  const sourcePreviousLocationMaskValue = sourcePreviousLocationMask?.[1] ? luaNumberTokenValue(L, index, sourcePreviousLocationMask[1]) : undefined;
  if (sourcePreviousLocationMaskValue !== undefined) return `condition:source-previous-location:${sourcePreviousLocationMaskValue}`;
  const sourceReasonPreviousPosition = snippet.match(new RegExp(`\\breturn\\s+\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsReason\\s*\\(\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\)\\s+and\\s+\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsPreviousPosition\\s*\\(\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\)`));
  const sourceReasonPreviousPositionReasonValue = sourceReasonPreviousPosition?.[1] ? luaNumberExpressionValue(L, index, sourceReasonPreviousPosition[1]) : undefined;
  const sourceReasonPreviousPositionPositionValue = sourceReasonPreviousPosition?.[2] ? luaNumberExpressionValue(L, index, sourceReasonPreviousPosition[2]) : undefined;
  if (sourceReasonPreviousPositionPositionValue !== undefined && sourceReasonPreviousPositionReasonValue !== undefined) return `condition:source-previous-position-reason:${sourceReasonPreviousPositionPositionValue}:${sourceReasonPreviousPositionReasonValue}`;
  const sourcePreviousPosition = snippet.match(new RegExp(`\\breturn\\s+\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsPreviousPosition\\s*\\(\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\)`));
  const sourcePreviousPositionValue = sourcePreviousPosition?.[1] ? luaNumberExpressionValue(L, index, sourcePreviousPosition[1]) : undefined;
  if (sourcePreviousPositionValue !== undefined) return `condition:source-previous-position:${sourcePreviousPositionValue}`;
  const sourcePreviousPositionMask = snippet.match(new RegExp(`\\b\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*GetPreviousPosition\\s*\\(\\s*\\)\\s*&\\s*(${numericOrIdentifierPattern})\\s*\\)\\s*~=\\s*0`));
  const sourcePreviousPositionMaskValue = sourcePreviousPositionMask?.[1] ? luaNumberTokenValue(L, index, sourcePreviousPositionMask[1]) : undefined;
  if (sourcePreviousPositionMaskValue !== undefined) return `condition:source-previous-position:${sourcePreviousPositionMaskValue}`;
  if (/\b\w+\s*:\s*GetHandler\s*\(\s*\)\s*:\s*(?:IsPreviousControler\s*\(\s*tp\s*\)|GetPreviousControler\s*\(\s*\)\s*==\s*tp)/.test(snippet)) return "condition:source-previous-controller";
  const sourceLocationReason = snippet.match(new RegExp(`\\breturn\\s+\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsLocation\\s*\\(\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\)\\s+and\\s+\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsReason\\s*\\(\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\)`));
  const sourceLocationReasonLocationValue = sourceLocationReason?.[1] ? luaNumberExpressionValue(L, index, sourceLocationReason[1]) : undefined;
  const sourceLocationReasonReasonValue = sourceLocationReason?.[2] ? luaNumberExpressionValue(L, index, sourceLocationReason[2]) : undefined;
  if (sourceLocationReasonLocationValue !== undefined && sourceLocationReasonReasonValue !== undefined) return `condition:source-location-reason:${sourceLocationReasonLocationValue}:${sourceLocationReasonReasonValue}`;
  const sourceLocationReasonMask = snippet.match(new RegExp(`\\breturn\\s+\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsLocation\\s*\\(\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\)\\s+and\\s+\\(?\\s*\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*GetReason\\s*\\(\\s*\\)\\s*&\\s*\\(?\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\)?\\s*\\)?\\s*(?:~=\\s*0|>\\s*0)`));
  const sourceLocationReasonMaskLocationValue = sourceLocationReasonMask?.[1] ? luaNumberExpressionValue(L, index, sourceLocationReasonMask[1]) : undefined;
  const sourceLocationReasonMaskReasonValue = sourceLocationReasonMask?.[2] ? luaNumberExpressionValue(L, index, sourceLocationReasonMask[2]) : undefined;
  if (sourceLocationReasonMaskLocationValue !== undefined && sourceLocationReasonMaskReasonValue !== undefined) return `condition:source-location-reason:${sourceLocationReasonMaskLocationValue}:${sourceLocationReasonMaskReasonValue}`;
  const sourceReasonNot = snippet.match(new RegExp(`\\breturn\\s+not\\s+\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsReason\\s*\\(\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\)`));
  const sourceReasonNotValue = sourceReasonNot?.[1] ? luaNumberExpressionValue(L, index, sourceReasonNot[1]) : undefined;
  if (sourceReasonNotValue !== undefined) return `condition:source-reason-not:${sourceReasonNotValue}`;
  const sourceReason = snippet.match(new RegExp(`\\breturn\\s+\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*IsReason\\s*\\(\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\)`));
  const sourceReasonValue = sourceReason?.[1] ? luaNumberExpressionValue(L, index, sourceReason[1]) : undefined;
  if (sourceReasonValue !== undefined) return `condition:source-reason:${sourceReasonValue}`;
  const sourceReasonAll = snippet.match(new RegExp(`\\b\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*GetReason\\s*\\(\\s*\\)\\s*&\\s*\\(?\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\)?\\s*(?:\\)\\s*)?==\\s*\\(?\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\)?`));
  const sourceReasonAllValue = sourceReasonAll?.[1] && sourceReasonAll[2] ? luaNumberExpressionValue(L, index, sourceReasonAll[1]) : undefined;
  const sourceReasonAllCompareValue = sourceReasonAll?.[2] ? luaNumberExpressionValue(L, index, sourceReasonAll[2]) : undefined;
  if (sourceReasonAllValue !== undefined && sourceReasonAllValue === sourceReasonAllCompareValue) return `condition:source-reason-all:${sourceReasonAllValue}`;
  const sourceReasonMask = snippet.match(new RegExp(`\\b\\w+\\s*:\\s*GetHandler\\s*\\(\\s*\\)\\s*:\\s*GetReason\\s*\\(\\s*\\)\\s*&\\s*\\(?\\s*(${numericOrIdentifierPattern}(?:\\s*[|+]\\s*${numericOrIdentifierPattern})*)\\s*\\)?\\s*(?:\\)\\s*)?(?:~=\\s*0|>\\s*0)`));
  const sourceReasonMaskValue = sourceReasonMask?.[1] ? luaNumberExpressionValue(L, index, sourceReasonMask[1]) : undefined;
  if (sourceReasonMaskValue !== undefined) return `condition:source-reason:${sourceReasonMaskValue}`;
  if (/\b\w+\s*:\s*GetHandler\s*\(\s*\)\s*:\s*(?:GetReasonPlayer\s*\(\s*\)\s*~=\s*tp|GetReasonPlayer\s*\(\s*\)\s*==\s*1\s*-\s*tp|IsReasonPlayer\s*\(\s*1\s*-\s*tp\s*\))/.test(snippet)) return "condition:source-reason-player:opponent";
  if (/\b\w+\s*:\s*GetHandler\s*\(\s*\)\s*:\s*(?:GetReasonPlayer\s*\(\s*\)\s*==\s*tp|IsReasonPlayer\s*\(\s*tp\s*\))/.test(snippet)) return "condition:source-reason-player:self";
  const sourceOverlayCount = snippet.match(/\breturn\s+\w+\s*:\s*GetHandler\s*\(\s*\)\s*:\s*GetOverlayCount\s*\(\s*\)\s*(==|~=|>|>=)\s*0\s*(?:end\b|$)/);
  if (sourceOverlayCount?.[1]) return sourceOverlayCount[1] === "==" ? "condition:source-overlay-count-zero" : "condition:source-overlay-count-positive";
  const params = luaFunctionParams(snippet);
  if (params && params.length > 0) return undefined;
  const identifier = String.raw`[A-Za-z_]\w*`;
  const sourceController = new RegExp(String.raw`\breturn\s+${identifier}\s*:\s*IsControler\s*\(\s*${identifier}\s*\)\s*(?:end\b|$)`);
  return sourceController.test(snippet) ? "condition:source-controller" : undefined;
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
