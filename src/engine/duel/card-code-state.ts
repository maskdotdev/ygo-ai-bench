import { currentFiniteEffectValues } from "#duel/card-stats.js";
import type { DuelCardInstance, DuelState } from "#duel/types.js";

const effectAddCode = 113;
const effectChangeCode = 114;
const effectRemoveCode = 118;
const effectAddSetcode = 334;
const effectRemoveSetcode = 349;
const effectChangeSetcode = 350;
const effectAddLinkCode = 354;
const effectAddLinkSetcode = 355;

export function currentCardCodes(card: DuelCardInstance, state: DuelState | undefined): string[] {
  let codes = printedCardCodes(card);
  for (const code of currentFiniteEffectValues(card, state, effectChangeCode)) codes = [String(code)];
  for (const code of currentFiniteEffectValues(card, state, effectAddCode)) codes.push(String(code));
  for (const code of currentFiniteEffectValues(card, state, effectRemoveCode)) codes = codes.filter((current) => current !== String(code));
  return unique(codes);
}

export function currentCardMatchesCode(card: DuelCardInstance, state: DuelState | undefined, requested: string): boolean {
  return currentCardCodes(card, state).includes(requested);
}

export function currentCardSetcodes(card: DuelCardInstance, state: DuelState | undefined): number[] {
  let setcodes = [...printedCardSetcodes(card)];
  for (const setcode of currentFiniteEffectValues(card, state, effectChangeSetcode)) setcodes = [setcode];
  for (const setcode of currentFiniteEffectValues(card, state, effectAddSetcode)) setcodes.push(setcode);
  for (const setcode of currentFiniteEffectValues(card, state, effectRemoveSetcode)) {
    setcodes = setcodes.filter((current) => !isSetcodeMatch(setcode, current));
  }
  return unique(setcodes);
}

export function currentCardMatchesSetcode(card: DuelCardInstance, state: DuelState | undefined, requested: number): boolean {
  return currentCardSetcodes(card, state).some((setcode) => isSetcodeMatch(requested, setcode));
}

export function currentLinkMaterialCodes(card: DuelCardInstance, state: DuelState | undefined): string[] {
  return unique([...currentCardCodes(card, state), ...currentFiniteEffectValues(card, state, effectAddLinkCode).map(String)]);
}

export function currentLinkMaterialSetcodes(card: DuelCardInstance, state: DuelState | undefined): number[] {
  return unique([...currentCardSetcodes(card, state), ...currentFiniteEffectValues(card, state, effectAddLinkSetcode)]);
}

export function currentLinkMaterialMatchesSetcode(card: DuelCardInstance, state: DuelState | undefined, requested: number): boolean {
  return currentLinkMaterialSetcodes(card, state).some((setcode) => isSetcodeMatch(requested, setcode));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function printedCardCodes(card: DuelCardInstance): string[] {
  const assumedCode = card.assumedProperties?.[1];
  if (assumedCode !== undefined) return [String(assumedCode)];
  return card.data.alias ? [card.code, card.data.alias] : [card.code];
}

function printedCardSetcodes(card: DuelCardInstance): number[] {
  return card.data.setcodes ?? [];
}

function isSetcodeMatch(requested: number, setcode: number): boolean {
  return (setcode & 0xfff) === (requested & 0xfff) && (setcode & requested) === requested;
}
