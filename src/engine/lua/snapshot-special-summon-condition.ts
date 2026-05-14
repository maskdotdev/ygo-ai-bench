import { getDuelActivityCount } from "#duel/activity.js";
import { currentCardMatchesCode, currentCardMatchesSetcode } from "#duel/card-code-state.js";
import { moveDuelCard } from "#duel/card-state.js";
import { matchingPlayerEffects, type ContinuousEffectContextFactory } from "#duel/continuous-effects.js";
import { getDuelCardCounter } from "#duel/counters.js";
import { getDuelFlagEffectCount } from "#duel/flags.js";
import { currentDuelPhaseMask } from "#duel/phase-mask.js";
import { currentRace } from "#duel/card-stats.js";
import { effectiveSpecialSummonTypeCode, isSummonTypeMaskMatch } from "#duel/summon-type-codes.js";
import type { DuelEffectContext, DuelEffectDefinition, DuelState, PlayerId, SerializedDuelEffect } from "#duel/types.js";

const luaStatusProcComplete = 0x8;
const luaEffectTypeActions = 0x10 | 0x20 | 0x40 | 0x80 | 0x100 | 0x200 | 0x400;
const cardDarkFusion = "94820406";
const cardSuperPolymerization = "48130397";
const cardFossilFusion = "59419719";
const skillDarkUnity = 300306009;
const effectSupremeCastle = 72043279;

export function restoredSpecialSummonConditionValueCallbacks(effect: SerializedDuelEffect): Pick<DuelEffectDefinition, "valuePredicate"> {
  if (effect.luaValueDescriptor === "special-summon-condition:false") return { valuePredicate: () => false };
  if (effect.luaValueDescriptor === "special-summon-condition:evil-hero-limit") return { valuePredicate: evilHeroLimitApplies };
  if (effect.luaValueDescriptor === "special-summon-condition:fossil-limit") return { valuePredicate: fossilLimitApplies };
  if (effect.luaValueDescriptor === "special-summon-condition:card-effect") return { valuePredicate: (ctx) => relatedEffectIsAction(ctx) };
  if (effect.luaValueDescriptor === "special-summon-condition:not-related-handler-monster") return { valuePredicate: (ctx) => !relatedEffectHandlerIsMonster(ctx) };
  if (effect.luaValueDescriptor?.startsWith("special-summon-condition:card-effect-handler-setcode:")) return { valuePredicate: (ctx) => relatedEffectIsAction(ctx) && relatedEffectHandlerMatchesSetcode(ctx, Number(effect.luaValueDescriptor?.split(":").pop())) };
  if (effect.luaValueDescriptor?.startsWith("special-summon-condition:related-handler-spelltrap-setcode:")) return { valuePredicate: (ctx) => relatedEffectHandlerIsSpellTrap(ctx) && relatedEffectHandlerMatchesSetcode(ctx, Number(effect.luaValueDescriptor?.split(":").pop())) };
  if (effect.luaValueDescriptor?.startsWith("special-summon-condition:related-handler-spell-setcode:")) return { valuePredicate: (ctx) => relatedEffectHandlerIsSpell(ctx) && relatedEffectHandlerMatchesSetcode(ctx, Number(effect.luaValueDescriptor?.split(":").pop())) };
  if (effect.luaValueDescriptor?.startsWith("special-summon-condition:related-handler-setcode:")) return { valuePredicate: (ctx) => relatedEffectHandlerMatchesSetcode(ctx, Number(effect.luaValueDescriptor?.split(":").pop())) };
  if (effect.luaValueDescriptor?.startsWith("special-summon-condition:monster-related-handler-race:")) return { valuePredicate: (ctx) => relatedEffectIsMonsterEffect(ctx) && relatedEffectHandlerMatchesRace(ctx, Number(effect.luaValueDescriptor?.split(":").pop())) };
  const relatedHandlerTypeRace = specialSummonConditionRelatedHandlerTypeRace(effect.luaValueDescriptor);
  if (relatedHandlerTypeRace) return { valuePredicate: (ctx) => relatedEffectHandlerMatchesType(ctx, relatedHandlerTypeRace.type) && relatedEffectHandlerMatchesRace(ctx, relatedHandlerTypeRace.race) };
  const monsterRelatedHandlerSetcodeOrSetcode = specialSummonConditionMonsterRelatedHandlerSetcodeOrSetcode(effect.luaValueDescriptor);
  if (monsterRelatedHandlerSetcodeOrSetcode) return { valuePredicate: (ctx) => (relatedEffectIsMonsterEffect(ctx) && relatedEffectHandlerMatchesSetcode(ctx, monsterRelatedHandlerSetcodeOrSetcode.monsterSetcode)) || relatedEffectHandlerMatchesSetcode(ctx, monsterRelatedHandlerSetcodeOrSetcode.setcode) };
  if (effect.luaValueDescriptor === "special-summon-condition:not-extra") return { valuePredicate: (ctx) => ctx.source.location !== "extraDeck" };
  if (effect.luaValueDescriptor?.startsWith("special-summon-condition:not-locations:")) return { valuePredicate: (ctx) => (sourceLocationMask(ctx.source.location) & Number(effect.luaValueDescriptor?.split(":").pop())) === 0 };
  if (effect.luaValueDescriptor === "special-summon-condition:summon-player-empty-mzone") return { valuePredicate: (ctx) => ctx.duel.cards.every((card) => card.controller !== ctx.player || card.location !== "monsterZone") };
  if (effect.luaValueDescriptor?.startsWith("special-summon-condition:exact-types:")) { const [exactPart = "", maskPart = ""] = effect.luaValueDescriptor.slice("special-summon-condition:exact-types:".length).split(":types:"); const exactTypes = exactPart.split(",").map(Number); const maskTypes = maskPart.split(",").filter(Boolean).map(Number); return { valuePredicate: (ctx) => exactTypes.includes(effectiveSpecialSummonTypeCode(ctx.summonTypeCode)) || maskTypes.some((type) => isSummonTypeMaskMatch(effectiveSpecialSummonTypeCode(ctx.summonTypeCode), type)) }; }
  if (effect.luaValueDescriptor?.startsWith("special-summon-condition:types:")) { const summonTypes = effect.luaValueDescriptor.slice("special-summon-condition:types:".length).split(",").map(Number); return { valuePredicate: (ctx) => summonTypes.some((type) => isSummonTypeMaskMatch(effectiveSpecialSummonTypeCode(ctx.summonTypeCode), type)) }; }
  if (effect.luaValueDescriptor?.startsWith("special-summon-condition:type-no-related:")) return { valuePredicate: (ctx) => ctx.relatedEffectId === undefined && isSummonTypeMaskMatch(effectiveSpecialSummonTypeCode(ctx.summonTypeCode), Number(effect.luaValueDescriptor?.split(":").pop())) };
  if (effect.luaValueDescriptor?.startsWith("special-summon-condition:type:")) return { valuePredicate: (ctx) => isSummonTypeMaskMatch(effectiveSpecialSummonTypeCode(ctx.summonTypeCode), Number(effect.luaValueDescriptor?.split(":").pop())) };
  if (effect.luaValueDescriptor?.startsWith("special-summon-condition:extra-or-type-no-related:")) return { valuePredicate: (ctx) => ctx.source.location !== "extraDeck" || (ctx.relatedEffectId === undefined && isSummonTypeMaskMatch(effectiveSpecialSummonTypeCode(ctx.summonTypeCode), Number(effect.luaValueDescriptor?.split(":").pop()))) };
  if (effect.luaValueDescriptor?.startsWith("special-summon-condition:extra-or-type:")) return { valuePredicate: (ctx) => ctx.source.location !== "extraDeck" || isSummonTypeMaskMatch(effectiveSpecialSummonTypeCode(ctx.summonTypeCode), Number(effect.luaValueDescriptor?.split(":").pop())) };
  if (effect.luaValueDescriptor?.startsWith("special-summon-condition:extra-or-types:")) return { valuePredicate: (ctx) => ctx.source.location !== "extraDeck" || effect.luaValueDescriptor!.slice("special-summon-condition:extra-or-types:".length).split(",").some((type) => isSummonTypeMaskMatch(effectiveSpecialSummonTypeCode(ctx.summonTypeCode), Number(type))) };
  const actionNoActivityPhaseTurnPlayer = specialSummonConditionActionNoActivityPhaseTurnPlayer(effect.luaValueDescriptor);
  if (actionNoActivityPhaseTurnPlayer) return { valuePredicate: (ctx) => specialSummonConditionActionNoActivityPhaseTurnPlayerApplies(ctx, actionNoActivityPhaseTurnPlayer) };
  const typeOrRelatedHandlerCode = specialSummonConditionTypeOrRelatedHandlerCode(effect.luaValueDescriptor);
  if (typeOrRelatedHandlerCode) return { valuePredicate: (ctx) => specialSummonConditionTypeOrRelatedHandlerCodeApplies(ctx, typeOrRelatedHandlerCode) };
  const notTypeOrPlayerFlagAbsent = specialSummonConditionNotTypeOrPlayerFlagAbsent(effect.luaValueDescriptor);
  if (notTypeOrPlayerFlagAbsent) return { valuePredicate: (ctx) => specialSummonConditionNotTypeOrPlayerFlagAbsentApplies(ctx, notTypeOrPlayerFlagAbsent) };
  if (effect.luaValueDescriptor?.startsWith("special-summon-condition:target-player-no-field-faceup-code:")) return { valuePredicate: (ctx) => !playerFieldHasFaceupCode(ctx, Number(effect.luaValueDescriptor?.split(":").pop())) };
  if (effect.luaValueDescriptor?.startsWith("special-summon-condition:target-player-field-faceup-code:")) return { valuePredicate: (ctx) => playerFieldHasFaceupCode(ctx, Number(effect.luaValueDescriptor?.split(":").pop())) };
  const exactTypePlayerAffectedController = specialSummonConditionExactTypePlayerAffectedController(effect.luaValueDescriptor);
  if (exactTypePlayerAffectedController) return { valuePredicate: (ctx) => specialSummonConditionExactTypePlayerAffectedControllerApplies(ctx, exactTypePlayerAffectedController) };
  const notTypeOrPlayerGraveSetcode = specialSummonConditionNotTypeOrPlayerGraveSetcode(effect.luaValueDescriptor);
  if (notTypeOrPlayerGraveSetcode) return { valuePredicate: (ctx) => !isSummonTypeMaskMatch(effectiveSpecialSummonTypeCode(ctx.summonTypeCode), notTypeOrPlayerGraveSetcode.summonType) || playerGraveHasSetcode(ctx, notTypeOrPlayerGraveSetcode.setcode) };
  const notExtraOrPlayerGraveSpellTrapSetcodeCount = specialSummonConditionNotExtraOrPlayerGraveSpellTrapSetcodeCount(effect.luaValueDescriptor);
  if (notExtraOrPlayerGraveSpellTrapSetcodeCount) return { valuePredicate: (ctx) => ctx.source.location !== "extraDeck" || playerGraveSpellTrapSetcodeCount(ctx, notExtraOrPlayerGraveSpellTrapSetcodeCount.setcode) >= notExtraOrPlayerGraveSpellTrapSetcodeCount.count };
  const notTypeOrPhase = specialSummonConditionNotTypeOrPhase(effect.luaValueDescriptor);
  if (notTypeOrPhase) return { valuePredicate: (ctx) => !isSummonTypeMaskMatch(effectiveSpecialSummonTypeCode(ctx.summonTypeCode), notTypeOrPhase.summonType) || (currentDuelPhaseMask(ctx.duel) & notTypeOrPhase.phase) !== 0 };
  const notTypeOrPzoneOriginalRaceCounterSum = specialSummonConditionNotTypeOrPzoneOriginalRaceCounterSum(effect.luaValueDescriptor);
  if (notTypeOrPzoneOriginalRaceCounterSum) return { valuePredicate: (ctx) => !isSummonTypeMaskMatch(effectiveSpecialSummonTypeCode(ctx.summonTypeCode), notTypeOrPzoneOriginalRaceCounterSum.summonType) || playerPzoneOriginalRaceCounterSum(ctx, notTypeOrPzoneOriginalRaceCounterSum.race, notTypeOrPzoneOriginalRaceCounterSum.counter) >= notTypeOrPzoneOriginalRaceCounterSum.min };
  const sourceLocationAndType = specialSummonConditionSourceLocationAndType(effect.luaValueDescriptor);
  if (sourceLocationAndType) return { valuePredicate: (ctx) => (sourceLocationMask(ctx.source.location) & sourceLocationAndType.location) !== 0 && isSummonTypeMaskMatch(effectiveSpecialSummonTypeCode(ctx.summonTypeCode), sourceLocationAndType.summonType) };
  const typeOrSourceLocationAndType = specialSummonConditionTypeOrSourceLocationAndType(effect.luaValueDescriptor);
  if (typeOrSourceLocationAndType) return { valuePredicate: (ctx) => isSummonTypeMaskMatch(effectiveSpecialSummonTypeCode(ctx.summonTypeCode), typeOrSourceLocationAndType.summonType) || ((sourceLocationMask(ctx.source.location) & typeOrSourceLocationAndType.location) !== 0 && isSummonTypeMaskMatch(effectiveSpecialSummonTypeCode(ctx.summonTypeCode), typeOrSourceLocationAndType.sourceLocationSummonType)) };
  const sourceLocationAndPreviousLocation = specialSummonConditionSourceLocationAndPreviousLocation(effect.luaValueDescriptor);
  if (sourceLocationAndPreviousLocation) return { valuePredicate: (ctx) => (sourceLocationMask(ctx.source.location) & sourceLocationAndPreviousLocation.location) !== 0 && (sourceLocationMask(ctx.source.previousLocation) & sourceLocationAndPreviousLocation.previousLocation) !== 0 };
  if (effect.luaValueDescriptor?.startsWith("special-summon-condition:proc-complete-or-type:")) return { valuePredicate: (ctx) => ((ctx.source.customStatusMask ?? 0) & luaStatusProcComplete) !== 0 || isSummonTypeMaskMatch(effectiveSpecialSummonTypeCode(ctx.summonTypeCode), Number(effect.luaValueDescriptor?.split(":").pop())) };
  return {};
}

function relatedEffectIsAction(ctx: DuelEffectContext): boolean { return ((relatedEffectFromContext(ctx)?.luaTypeFlags ?? 0) & luaEffectTypeActions) !== 0; }

function relatedEffectIsMonsterEffect(ctx: DuelEffectContext): boolean {
  const handler = relatedEffectHandler(ctx);
  return Boolean(handler && ((handler.data.typeFlags ?? 0) & 0x1) !== 0);
}

function specialSummonConditionActionNoActivityPhaseTurnPlayer(descriptor: string | undefined): { activity: number; phase: number } | undefined {
  const prefix = "special-summon-condition:action-no-activity-phase-turn-player:";
  if (!descriptor?.startsWith(prefix)) return undefined;
  const parts = descriptor.slice(prefix.length).split(":").map(Number), activity = parts[0], phase = parts[1];
  return activity !== undefined && phase !== undefined && Number.isSafeInteger(activity) && Number.isSafeInteger(phase) ? { activity, phase } : undefined;
}

function specialSummonConditionActionNoActivityPhaseTurnPlayerApplies(ctx: DuelEffectContext, descriptor: { activity: number; phase: number }): boolean {
  return relatedEffectIsAction(ctx)
    && getDuelActivityCount(ctx.duel, ctx.source.controller, descriptor.activity) === 0
    && (currentDuelPhaseMask(ctx.duel) & descriptor.phase) !== 0
    && ctx.duel.turnPlayer === ctx.source.controller;
}

function evilHeroLimitApplies(ctx: DuelEffectContext): boolean {
  const handler = relatedEffectHandler(ctx);
  if (handler && currentCardMatchesCode(handler, ctx.duel, cardDarkFusion)) return true;
  if (handler && currentCardMatchesCode(handler, ctx.duel, cardSuperPolymerization) && playerAffectedByEffect(ctx.duel, ctx.source.controller, skillDarkUnity)) return true;
  return playerAffectedByEffect(ctx.duel, ctx.source.controller, effectSupremeCastle) && isSummonTypeMaskMatch(effectiveSpecialSummonTypeCode(ctx.summonTypeCode), 0x43000000);
}

function fossilLimitApplies(ctx: DuelEffectContext): boolean {
  if (ctx.source.location !== "extraDeck") return true;
  const handler = relatedEffectHandler(ctx);
  return Boolean(handler && currentCardMatchesCode(handler, ctx.duel, cardFossilFusion));
}

function relatedEffectHandlerMatchesSetcode(ctx: DuelEffectContext, setcode: number): boolean {
  const handler = relatedEffectHandler(ctx);
  return Boolean(handler && currentCardMatchesSetcode(handler, ctx.duel, setcode));
}

function relatedEffectHandlerMatchesRace(ctx: DuelEffectContext, race: number): boolean {
  const handler = relatedEffectHandler(ctx);
  return Boolean(handler && (currentRace(handler, ctx.duel) & race) !== 0);
}

function relatedEffectHandlerMatchesType(ctx: DuelEffectContext, type: number): boolean {
  const handler = relatedEffectHandler(ctx);
  return Boolean(handler && ((handler.data.typeFlags ?? 0) & type) !== 0);
}

function relatedEffectHandlerIsMonster(ctx: DuelEffectContext): boolean {
  const handler = relatedEffectHandler(ctx);
  return Boolean(handler && ((handler.data.typeFlags ?? 0) & 0x1) !== 0);
}

function relatedEffectHandlerIsSpellTrap(ctx: DuelEffectContext): boolean {
  const handler = relatedEffectHandler(ctx);
  return Boolean(handler && (handler.data.kind === "spell" || handler.data.kind === "trap" || ((handler.data.typeFlags ?? 0) & 0x6) !== 0));
}

function relatedEffectHandlerIsSpell(ctx: DuelEffectContext): boolean {
  const handler = relatedEffectHandler(ctx);
  return Boolean(handler && (handler.data.kind === "spell" || ((handler.data.typeFlags ?? 0) & 0x2) !== 0));
}

function playerGraveHasSetcode(ctx: DuelEffectContext, setcode: number): boolean {
  return ctx.duel.cards.some((card) => card.controller === ctx.player && card.location === "graveyard" && currentCardMatchesSetcode(card, ctx.duel, setcode));
}

function playerGraveSpellTrapSetcodeCount(ctx: DuelEffectContext, setcode: number): number {
  return ctx.duel.cards.filter((card) => card.controller === ctx.player && card.location === "graveyard" && cardIsSpellTrap(card) && currentCardMatchesSetcode(card, ctx.duel, setcode)).length;
}

function playerFieldHasFaceupCode(ctx: DuelEffectContext, code: number): boolean {
  return ctx.duel.cards.some((card) => card.controller === ctx.player && card.faceUp && (card.location === "monsterZone" || card.location === "spellTrapZone") && currentCardMatchesCode(card, ctx.duel, String(code)));
}

function playerPzoneOriginalRaceCounterSum(ctx: DuelEffectContext, race: number, counter: number): number {
  return ctx.duel.cards
    .filter((card) => card.controller === ctx.player && card.location === "spellTrapZone" && (card.sequence === 0 || card.sequence === 1) && card.faceUp && ((card.data.race ?? 0) & race) !== 0)
    .reduce((sum, card) => sum + getDuelCardCounter(card, counter), 0);
}

function cardIsSpellTrap(card: DuelEffectContext["source"]): boolean {
  return card.data.kind === "spell" || card.data.kind === "trap" || ((card.data.typeFlags ?? 0) & 0x6) !== 0;
}

function specialSummonConditionRelatedHandlerTypeRace(descriptor: string | undefined): { type: number; race: number } | undefined {
  const prefix = "special-summon-condition:related-handler-type-race:";
  if (!descriptor?.startsWith(prefix)) return undefined;
  const parts = descriptor.slice(prefix.length).split(":").map(Number), type = parts[0], race = parts[1];
  return type !== undefined && race !== undefined && Number.isSafeInteger(type) && Number.isSafeInteger(race) ? { type, race } : undefined;
}

function specialSummonConditionMonsterRelatedHandlerSetcodeOrSetcode(descriptor: string | undefined): { monsterSetcode: number; setcode: number } | undefined {
  const prefix = "special-summon-condition:monster-related-handler-setcode-or-setcode:";
  if (!descriptor?.startsWith(prefix)) return undefined;
  const parts = descriptor.slice(prefix.length).split(":").map(Number), monsterSetcode = parts[0], setcode = parts[1];
  return monsterSetcode !== undefined && setcode !== undefined && Number.isSafeInteger(monsterSetcode) && Number.isSafeInteger(setcode) ? { monsterSetcode, setcode } : undefined;
}

function relatedEffectHandler(ctx: DuelEffectContext): DuelEffectContext["source"] | undefined {
  const relatedEffect = relatedEffectFromContext(ctx);
  return ctx.duel.cards.find((card) => card.uid === relatedEffect?.sourceUid);
}

function playerAffectedByEffect(state: DuelState, player: PlayerId, code: number): boolean {
  return matchingPlayerEffects(state, player, code, createPlayerCheckContext(state)).length > 0;
}

function createPlayerCheckContext(state: DuelState): ContinuousEffectContextFactory {
  return (effect, source) => ({
    duel: state,
    source,
    player: effect.controller,
    checkOnly: true,
    targetUids: [],
    log() {},
    moveCard(uid, to, controller) { return moveDuelCard(state, uid, to, controller); },
    negateChainLink() { return false; },
    setTargets() {},
    getTargets() { return []; },
    setTargetPlayer() {},
    setTargetParam() {},
  });
}

function sourceLocationMask(location: DuelEffectContext["source"]["location"] | undefined): number {
  if (location === "deck") return 0x01;
  if (location === "hand") return 0x02;
  if (location === "monsterZone") return 0x04;
  if (location === "spellTrapZone") return 0x08;
  if (location === "graveyard") return 0x10;
  if (location === "banished") return 0x20;
  if (location === "extraDeck") return 0x40;
  return 0;
}

function specialSummonConditionTypeOrRelatedHandlerCode(descriptor: string | undefined): { summonType: number; code: number } | undefined { const prefix = "special-summon-condition:type-or-related-handler-code:"; if (!descriptor?.startsWith(prefix)) return undefined; const parts = descriptor.slice(prefix.length).split(":").map(Number), summonType = parts[0], code = parts[1]; return summonType !== undefined && code !== undefined && Number.isSafeInteger(summonType) && Number.isSafeInteger(code) ? { summonType, code } : undefined; }

function specialSummonConditionTypeOrRelatedHandlerCodeApplies(ctx: DuelEffectContext, descriptor: { summonType: number; code: number }): boolean {
  if (isSummonTypeMaskMatch(effectiveSpecialSummonTypeCode(ctx.summonTypeCode), descriptor.summonType)) return true;
  const relatedEffect = relatedEffectFromContext(ctx);
  const handler = ctx.duel.cards.find((card) => card.uid === relatedEffect?.sourceUid);
  return Boolean(handler && currentCardMatchesCode(handler, ctx.duel, String(descriptor.code)));
}

function specialSummonConditionNotTypeOrPlayerFlagAbsent(descriptor: string | undefined): { summonType: number; flagCode: number } | undefined {
  const prefix = "special-summon-condition:not-type-or-player-flag-absent:";
  if (!descriptor?.startsWith(prefix)) return undefined;
  const parts = descriptor.slice(prefix.length).split(":").map(Number), summonType = parts[0], flagCode = parts[1];
  return summonType !== undefined && flagCode !== undefined && Number.isSafeInteger(summonType) && Number.isSafeInteger(flagCode) ? { summonType, flagCode } : undefined;
}

function specialSummonConditionNotTypeOrPlayerFlagAbsentApplies(ctx: DuelEffectContext, descriptor: { summonType: number; flagCode: number }): boolean {
  if (!isSummonTypeMaskMatch(effectiveSpecialSummonTypeCode(ctx.summonTypeCode), descriptor.summonType)) return true;
  return getDuelFlagEffectCount(ctx.duel, { ownerType: "player", ownerId: ctx.player }, descriptor.flagCode) === 0;
}

function specialSummonConditionExactTypePlayerAffectedController(descriptor: string | undefined): { summonType: number; effectCode: number } | undefined {
  const prefix = "special-summon-condition:exact-type-player-affected-controller:";
  if (!descriptor?.startsWith(prefix)) return undefined;
  const parts = descriptor.slice(prefix.length).split(":").map(Number), summonType = parts[0], effectCode = parts[1];
  return summonType !== undefined && effectCode !== undefined && Number.isSafeInteger(summonType) && Number.isSafeInteger(effectCode) ? { summonType, effectCode } : undefined;
}

function specialSummonConditionExactTypePlayerAffectedControllerApplies(ctx: DuelEffectContext, descriptor: { summonType: number; effectCode: number }): boolean {
  return effectiveSpecialSummonTypeCode(ctx.summonTypeCode) === descriptor.summonType
    && ctx.source.controller === ctx.player
    && playerAffectedByEffect(ctx.duel, ctx.player, descriptor.effectCode);
}

function specialSummonConditionNotTypeOrPlayerGraveSetcode(descriptor: string | undefined): { summonType: number; setcode: number } | undefined {
  const prefix = "special-summon-condition:not-type-or-player-grave-setcode:";
  if (!descriptor?.startsWith(prefix)) return undefined;
  const parts = descriptor.slice(prefix.length).split(":").map(Number), summonType = parts[0], setcode = parts[1];
  return summonType !== undefined && setcode !== undefined && Number.isSafeInteger(summonType) && Number.isSafeInteger(setcode) ? { summonType, setcode } : undefined;
}

function specialSummonConditionNotExtraOrPlayerGraveSpellTrapSetcodeCount(descriptor: string | undefined): { setcode: number; count: number } | undefined {
  const prefix = "special-summon-condition:not-extra-or-player-grave-spelltrap-setcode-count:";
  if (!descriptor?.startsWith(prefix)) return undefined;
  const parts = descriptor.slice(prefix.length).split(":").map(Number), setcode = parts[0], count = parts[1];
  return setcode !== undefined && count !== undefined && Number.isSafeInteger(setcode) && Number.isSafeInteger(count) ? { setcode, count } : undefined;
}

function specialSummonConditionNotTypeOrPhase(descriptor: string | undefined): { summonType: number; phase: number } | undefined {
  const prefix = "special-summon-condition:not-type-or-phase:";
  if (!descriptor?.startsWith(prefix)) return undefined;
  const parts = descriptor.slice(prefix.length).split(":").map(Number), summonType = parts[0], phase = parts[1];
  return summonType !== undefined && phase !== undefined && Number.isSafeInteger(summonType) && Number.isSafeInteger(phase) ? { summonType, phase } : undefined;
}

function specialSummonConditionNotTypeOrPzoneOriginalRaceCounterSum(descriptor: string | undefined): { summonType: number; race: number; counter: number; min: number } | undefined {
  const prefix = "special-summon-condition:not-type-or-player-pzone-original-race-counter-sum:";
  if (!descriptor?.startsWith(prefix)) return undefined;
  const parts = descriptor.slice(prefix.length).split(":").map(Number), summonType = parts[0], race = parts[1], counter = parts[2], min = parts[3];
  return summonType !== undefined && race !== undefined && counter !== undefined && min !== undefined && Number.isSafeInteger(summonType) && Number.isSafeInteger(race) && Number.isSafeInteger(counter) && Number.isSafeInteger(min) ? { summonType, race, counter, min } : undefined;
}

function specialSummonConditionSourceLocationAndType(descriptor: string | undefined): { location: number; summonType: number } | undefined {
  const prefix = "special-summon-condition:source-location-and-type:";
  if (!descriptor?.startsWith(prefix)) return undefined;
  const parts = descriptor.slice(prefix.length).split(":").map(Number), location = parts[0], summonType = parts[1];
  return location !== undefined && summonType !== undefined && Number.isSafeInteger(location) && Number.isSafeInteger(summonType) ? { location, summonType } : undefined;
}

function specialSummonConditionTypeOrSourceLocationAndType(descriptor: string | undefined): { summonType: number; location: number; sourceLocationSummonType: number } | undefined {
  const prefix = "special-summon-condition:type-or-source-location-and-type:";
  if (!descriptor?.startsWith(prefix)) return undefined;
  const parts = descriptor.slice(prefix.length).split(":").map(Number), summonType = parts[0], location = parts[1], sourceLocationSummonType = parts[2];
  return summonType !== undefined && location !== undefined && sourceLocationSummonType !== undefined && Number.isSafeInteger(summonType) && Number.isSafeInteger(location) && Number.isSafeInteger(sourceLocationSummonType) ? { summonType, location, sourceLocationSummonType } : undefined;
}

function specialSummonConditionSourceLocationAndPreviousLocation(descriptor: string | undefined): { location: number; previousLocation: number } | undefined {
  const prefix = "special-summon-condition:source-location-and-previous-location:";
  if (!descriptor?.startsWith(prefix)) return undefined;
  const parts = descriptor.slice(prefix.length).split(":").map(Number), location = parts[0], previousLocation = parts[1];
  return location !== undefined && previousLocation !== undefined && Number.isSafeInteger(location) && Number.isSafeInteger(previousLocation) ? { location, previousLocation } : undefined;
}

function relatedEffectFromContext(ctx: DuelEffectContext): DuelEffectDefinition | undefined {
  if (ctx.relatedEffectId === undefined) return undefined;
  return ctx.duel.effects.find((effect) => effect.id === `lua-${ctx.relatedEffectId}`);
}
