import { continuousEffectAppliesToCard } from "#duel/continuous-effects.js";
import type { DuelCardInstance, DuelEffectContext, DuelEffectDefinition, DuelState } from "#duel/types.js";

export function cardTypeFlags(card: DuelCardInstance | undefined, state?: DuelState): number {
  if (!card) return 0;
  if (card.assumedProperties?.[2] !== undefined) return card.assumedProperties[2];
  return currentMaskValue(card, state, printedCardTypeFlags(card), 117, 115, 116);
}

export function printedCardTypeFlags(card: DuelCardInstance | undefined): number {
  if (!card) return 0;
  if (card.data.typeFlags !== undefined) return card.data.typeFlags;
  const printedKind = card.kind === "extra" ? card.data.kind : card.kind;
  if (printedKind === "spell") return 0x2;
  if (printedKind === "trap") return 0x4;
  return 0x1;
}

export function cardMainTypeFlags(card: DuelCardInstance | undefined, state?: DuelState): number {
  return cardTypeFlags(card, state) & 0x7;
}

export function cardRank(card: DuelCardInstance | undefined): number {
  return card && (printedCardTypeFlags(card) & 0x800000) !== 0 ? card.data.level ?? 0 : 0;
}

export function cardLink(card: DuelCardInstance | undefined): number {
  return card && (printedCardTypeFlags(card) & 0x4000000) !== 0 ? card.data.level ?? 0 : 0;
}

export function currentAttack(card: DuelCardInstance | undefined, state?: DuelState): number {
  if (card?.assumedProperties?.[7] !== undefined) return card.assumedProperties[7];
  const updatedAttack = currentBaseAttack(card, state) + (card?.attackModifier ?? 0) + statUpdateEffectValue(card, state, 100);
  return setStatEffectValue(card, state, 102) ?? setStatEffectValue(card, state, 101) ?? updatedAttack;
}

export function currentAttackWithoutEffect(card: DuelCardInstance | undefined, state: DuelState | undefined, excludedEffectId: string): number {
  if (card?.assumedProperties?.[7] !== undefined) return card.assumedProperties[7];
  const baseAttack = setStatEffectValue(card, state, 103, excludedEffectId) ?? card?.data.attack ?? 0;
  const updatedAttack = baseAttack + (card?.attackModifier ?? 0) + statUpdateEffectValue(card, state, 100, excludedEffectId);
  return setStatEffectValue(card, state, 102, excludedEffectId) ?? setStatEffectValue(card, state, 101, excludedEffectId) ?? updatedAttack;
}

export function currentDefense(card: DuelCardInstance | undefined, state?: DuelState): number {
  if (card?.assumedProperties?.[8] !== undefined) return card.assumedProperties[8];
  const updatedDefense = currentBaseDefense(card, state) + (card?.defenseModifier ?? 0) + statUpdateEffectValue(card, state, 104);
  return setStatEffectValue(card, state, 106) ?? setStatEffectValue(card, state, 105) ?? updatedDefense;
}

export function currentBaseAttack(card: DuelCardInstance | undefined, state?: DuelState): number {
  if (!card) return 0;
  return setStatEffectValue(card, state, 103) ?? card.data.attack ?? 0;
}

export function currentBaseDefense(card: DuelCardInstance | undefined, state?: DuelState): number {
  if (!card) return 0;
  return setStatEffectValue(card, state, 107) ?? card.data.defense ?? 0;
}

export function currentLevel(card: DuelCardInstance | undefined, state?: DuelState): number {
  if (card?.assumedProperties?.[3] !== undefined) return card.assumedProperties[3];
  const updatedLevel = (card?.data.level ?? 0) + (card?.levelModifier ?? 0) + statUpdateEffectValue(card, state, 130);
  return setStatEffectValue(card, state, 314) ?? setStatEffectValue(card, state, 131) ?? updatedLevel;
}

export function currentRank(card: DuelCardInstance | undefined, state?: DuelState): number {
  if (card?.assumedProperties?.[4] !== undefined) return card.assumedProperties[4];
  const updatedRank = cardRank(card) + (card?.rankModifier ?? 0) + statUpdateEffectValue(card, state, 132);
  return setStatEffectValue(card, state, 315) ?? setStatEffectValue(card, state, 133) ?? updatedRank;
}

export function currentLink(card: DuelCardInstance | undefined, state?: DuelState): number {
  if (card?.assumedProperties?.[9] !== undefined) return card.assumedProperties[9];
  const updatedLink = cardLink(card) + (card?.linkModifier ?? 0) + statUpdateEffectValue(card, state, 420);
  return setStatEffectValue(card, state, 422) ?? setStatEffectValue(card, state, 421) ?? updatedLink;
}

export function currentLinkMarkers(card: DuelCardInstance | undefined, state?: DuelState): number {
  if (!card) return 0;
  if (card.assumedProperties?.[10] !== undefined) return card.assumedProperties[10];
  return currentMaskValue(card, state, card.data.linkMarkers ?? 0, 425, 423, 424);
}

export function currentLeftScale(card: DuelCardInstance | undefined, state?: DuelState): number {
  const updatedScale = (card?.data.leftScale ?? 0) + (card?.scaleModifier ?? 0) + statUpdateEffectValue(card, state, 134);
  return setStatEffectValue(card, state, 135) ?? updatedScale;
}

export function currentRightScale(card: DuelCardInstance | undefined, state?: DuelState): number {
  const updatedScale = (card?.data.rightScale ?? 0) + (card?.scaleModifier ?? 0) + statUpdateEffectValue(card, state, 136);
  return setStatEffectValue(card, state, 137) ?? updatedScale;
}

export function currentRace(card: DuelCardInstance | undefined, state?: DuelState): number {
  if (!card) return 0;
  if (card.assumedProperties?.[6] !== undefined) return card.assumedProperties[6];
  return currentMaskValue(card, state, card.data.race ?? 0, 122, 120, 121);
}

export function currentAttribute(card: DuelCardInstance | undefined, state?: DuelState): number {
  if (!card) return 0;
  if (card.assumedProperties?.[5] !== undefined) return card.assumedProperties[5];
  return currentMaskValue(card, state, card.data.attribute ?? 0, 127, 125, 126);
}

function currentMaskValue(card: DuelCardInstance, state: DuelState | undefined, baseValue: number, changeCode: number, addCode: number, removeCode: number): number {
  let value = setStatEffectValue(card, state, changeCode) ?? baseValue;
  for (const match of matchingStatEffects(card, state, addCode)) value |= finiteMaskValue(statEffectValue(card, state, match.effect, match.ctx));
  for (const match of matchingStatEffects(card, state, removeCode)) value &= ~finiteMaskValue(statEffectValue(card, state, match.effect, match.ctx));
  return value;
}

export function currentFiniteEffectValues(card: DuelCardInstance | undefined, state: DuelState | undefined, code: number): number[] {
  if (!card) return [];
  return matchingStatEffects(card, state, code)
    .map(({ effect, ctx }) => statEffectValue(card, state, effect, ctx))
    .filter((value): value is number => value !== undefined && Number.isFinite(value))
    .map((value) => Math.trunc(value));
}

export function currentCardHasEffect(card: DuelCardInstance | undefined, state: DuelState | undefined, code: number): boolean {
  return matchingStatEffects(card, state, code).length > 0;
}

function finiteMaskValue(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function statUpdateEffectValue(card: DuelCardInstance | undefined, state: DuelState | undefined, code: number, excludedEffectId?: string): number {
  if (!card) return 0;
  return matchingStatEffects(card, state, code, excludedEffectId)
    .reduce((total, { effect, ctx }) => total + (statEffectValue(card, state, effect, ctx) ?? 0), 0);
}

function setStatEffectValue(card: DuelCardInstance | undefined, state: DuelState | undefined, code: number, excludedEffectId?: string): number | undefined {
  const match = matchingStatEffects(card, state, code, excludedEffectId)
    .filter(({ effect }) => effect.value !== undefined || effect.statValue !== undefined)
    .at(-1);
  return card && match ? statEffectValue(card, state, match.effect, match.ctx) : undefined;
}

function matchingStatEffects(card: DuelCardInstance | undefined, state: DuelState | undefined, code: number, excludedEffectId?: string): Array<{ effect: DuelEffectDefinition; ctx: DuelEffectContext }> {
  if (!card || !state) return [];
  const matches: Array<{ effect: DuelEffectDefinition; ctx: DuelEffectContext }> = [];
  for (const effect of state.effects) {
    if (effect.id === excludedEffectId) continue;
    if (effect.event !== "continuous" || effect.code !== code) continue;
    const source = state.cards.find((candidate) => candidate.uid === effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    const ctx = statEffectContext(state, effect, source);
    if (!continuousEffectAppliesToCard(effect, source, card, ctx)) continue;
    if (effect.canActivate && !effect.canActivate(ctx)) continue;
    matches.push({ effect, ctx });
  }
  return matches;
}

function statEffectValue(card: DuelCardInstance, state: DuelState | undefined, effect: DuelEffectDefinition, ctx?: DuelEffectContext): number | undefined {
  if (!state) return effect.value;
  const source = state.cards.find((candidate) => candidate.uid === effect.sourceUid) ?? card;
  const resolvedContext = ctx ?? statEffectContext(state, effect, source);
  return effect.statValue?.(resolvedContext, card) ?? effect.value;
}

function statEffectContext(state: DuelState, effect: DuelEffectDefinition, source: DuelCardInstance): DuelEffectContext {
  return {
    duel: state,
    source,
    player: effect.controller,
    targetUids: [],
    log: () => {},
    moveCard: () => {
      throw new Error("Stat value callbacks cannot move cards");
    },
    negateChainLink: () => false,
    setTargets: () => {},
    getTargets: () => [],
    setTargetPlayer: () => {},
    setTargetParam: () => {},
  };
}
