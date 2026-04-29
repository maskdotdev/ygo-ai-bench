import { findCard } from "#duel/card-state.js";
import type {
  DuelCardInstance,
  DuelEffectContext,
  DuelEffectDefinition,
  DuelLocation,
  DuelState,
  PlayerId,
} from "#duel/types.js";

export type ContinuousEffectContextFactory = (
  effect: DuelEffectDefinition,
  source: DuelCardInstance,
  card?: DuelCardInstance,
) => DuelEffectContext;

export interface ContinuousEffectMatch {
  effect: DuelEffectDefinition;
  source: DuelCardInstance;
  card: DuelCardInstance;
}

export type MaterialUseKind = "fusion" | "synchro" | "xyz" | "link" | "ritual";

export function isSpecialSummonPrevented(state: DuelState, player: PlayerId, createContext: ContinuousEffectContextFactory, card?: DuelCardInstance): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 22) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    if (!continuousEffectTargetsPlayer(effect, source, player)) continue;
    const ctx = createContext(effect, source, card);
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

export function isAttackPrevented(state: DuelState, card: DuelCardInstance, createContext: ContinuousEffectContextFactory): boolean {
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 85) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    if (!continuousEffectAffectsCard(effect, source, card)) continue;
    const ctx = createContext(effect, source, card);
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

export function shouldRedirectToGraveyardMove(state: DuelState, uid: string, createContext: ContinuousEffectContextFactory): boolean {
  return moveDestinationRedirectLocation(state, uid, "graveyard", createContext) === "banished";
}

export function shouldRedirectBanishMove(state: DuelState, uid: string, createContext: ContinuousEffectContextFactory): boolean {
  return moveDestinationRedirectLocation(state, uid, "banished", createContext) === "graveyard";
}

export function moveDestinationRedirectLocation(
  state: DuelState,
  uid: string,
  destination: DuelLocation,
  createContext: ContinuousEffectContextFactory,
): DuelLocation | undefined {
  const card = findCard(state, uid);
  if (!card) return undefined;
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || !isDestinationRedirectCode(effect.code, destination)) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    if (!continuousEffectAffectsCard(effect, source, card)) continue;
    const redirectLocation = locationFromRedirectValue(effect.value) ?? fallbackRedirectLocation(effect.code);
    if (!redirectLocation) continue;
    const ctx = createContext(effect, source, card);
    if (!effect.canActivate || effect.canActivate(ctx)) return redirectLocation;
  }
  return undefined;
}

export function leaveFieldRedirectLocation(
  state: DuelState,
  uid: string,
  destination: DuelLocation,
  createContext: ContinuousEffectContextFactory,
): DuelLocation | undefined {
  const card = findCard(state, uid);
  if (!card || !isFieldLocation(card.location) || isFieldLocation(destination)) return undefined;
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 60) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    if (!continuousEffectAffectsCard(effect, source, card)) continue;
    const redirectLocation = locationFromRedirectValue(effect.value);
    if (!redirectLocation) continue;
    const ctx = createContext(effect, source, card);
    if (!effect.canActivate || effect.canActivate(ctx)) return redirectLocation;
  }
  return undefined;
}

export function findDestroyReplacementEffect(state: DuelState, uid: string, createContext: ContinuousEffectContextFactory): ContinuousEffectMatch | undefined {
  return findReplacementEffect(state, uid, 45, 50, createContext);
}

export function findReleaseReplacementEffect(state: DuelState, uid: string, createContext: ContinuousEffectContextFactory): ContinuousEffectMatch | undefined {
  return findReplacementEffect(state, uid, 51, undefined, createContext);
}

export function findSendReplacementEffect(state: DuelState, uid: string, createContext: ContinuousEffectContextFactory): ContinuousEffectMatch | undefined {
  return findReplacementEffect(state, uid, 52, undefined, createContext);
}

function findReplacementEffect(
  state: DuelState,
  uid: string,
  firstCode: number,
  secondCode: number | undefined,
  createContext: ContinuousEffectContextFactory,
): ContinuousEffectMatch | undefined {
  const card = findCard(state, uid);
  if (!card) return undefined;
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || (effect.code !== firstCode && effect.code !== secondCode)) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    if (!continuousEffectAffectsCard(effect, source, card)) continue;
    const ctx = createContext(effect, source, card);
    if (!effect.canActivate || effect.canActivate(ctx)) return { effect, source, card };
  }
  return undefined;
}

export function findIndestructibleEffect(state: DuelState, uid: string, reason: number, createContext: ContinuousEffectContextFactory): ContinuousEffectMatch | undefined {
  const card = findCard(state, uid);
  if (!card) return undefined;
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || !isIndestructibleCodeForReason(effect.code, reason)) continue;
    if (effect.code === 47 && (effect.value ?? 1) <= 0) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    if (!continuousEffectAffectsCard(effect, source, card)) continue;
    const ctx = createContext(effect, source, card);
    if (!effect.canActivate || effect.canActivate(ctx)) return { effect, source, card };
  }
  return undefined;
}

export function isMoveToLocationPrevented(state: DuelState, uid: string, to: DuelLocation, reason: number, createContext: ContinuousEffectContextFactory): boolean {
  const card = findCard(state, uid);
  if (!card) return false;
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || !isCannotMoveCodeForLocation(effect.code, to, reason)) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    if (!continuousEffectAffectsCard(effect, source, card)) continue;
    const ctx = createContext(effect, source, card);
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

export function isMaterialUsePrevented(state: DuelState, uid: string, kind: MaterialUseKind, createContext: ContinuousEffectContextFactory): boolean {
  const card = findCard(state, uid);
  if (!card) return false;
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || !isCannotMaterialCodeForKind(effect.code, kind)) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    if (!continuousEffectAffectsCard(effect, source, card)) continue;
    const ctx = createContext(effect, source, card);
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

export function isReleasePrevented(state: DuelState, uid: string, reason: number, createContext: ContinuousEffectContextFactory): boolean {
  const card = findCard(state, uid);
  if (!card) return false;
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || !isUnreleasableCodeForReason(effect.code, reason)) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    if (!continuousEffectAffectsCard(effect, source, card)) continue;
    const ctx = createContext(effect, source, card);
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

function locationFromRedirectValue(value: number | undefined): DuelLocation | undefined {
  if (value === 0x02) return "hand";
  if (value === 0x10) return "graveyard";
  if (value === 0x20) return "banished";
  if (value === 0x40) return "extraDeck";
  if (value === 0x01) return "deck";
  return undefined;
}

function fallbackRedirectLocation(code: number | undefined): DuelLocation | undefined {
  if (code === 63) return "banished";
  if (code === 64) return "graveyard";
  return undefined;
}

function isDestinationRedirectCode(code: number | undefined, destination: DuelLocation): boolean {
  if (code === 61) return destination === "hand";
  if (code === 62) return destination === "deck";
  if (code === 63) return destination === "graveyard";
  if (code === 64) return destination === "banished";
  return false;
}

function isFieldLocation(location: DuelLocation): boolean {
  return location === "monsterZone" || location === "spellTrapZone";
}

function continuousEffectAffectsCard(effect: DuelEffectDefinition, source: DuelCardInstance, card: DuelCardInstance): boolean {
  if (source.uid === card.uid) return true;
  return ((effect.property ?? 0) & 0x800) !== 0 && continuousEffectTargetsPlayer(effect, source, card.controller);
}

function continuousEffectTargetsPlayer(effect: DuelEffectDefinition, source: DuelCardInstance, player: PlayerId): boolean {
  if ((effect.property ?? 0) === 0 || ((effect.property ?? 0) & 0x800) === 0) return source.controller === player;
  const [selfTarget = 0, opponentTarget = 0] = effect.targetRange ?? [1, 0];
  if (source.controller === player) return selfTarget !== 0;
  return opponentTarget !== 0;
}

function isIndestructibleCodeForReason(code: number | undefined, reason: number): boolean {
  if (code === 40) return true;
  if (code === 41) return (reason & 0x40) !== 0;
  if (code === 42) return (reason & 0x20) !== 0;
  if (code === 47) return true;
  return false;
}

function isCannotMoveCodeForLocation(code: number | undefined, location: DuelLocation, reason: number): boolean {
  if (code === 59) return location === "graveyard" && (reason & 0x80) !== 0;
  if (code === 65) return location === "hand";
  if (code === 66) return location === "deck";
  if (code === 67) return location === "banished";
  if (code === 68) return location === "graveyard";
  return false;
}

function isCannotMaterialCodeForKind(code: number | undefined, kind: MaterialUseKind): boolean {
  if (code === 248) return true;
  if (code === 235) return kind === "fusion";
  if (code === 236) return kind === "synchro";
  if (code === 238) return kind === "xyz";
  if (code === 239) return kind === "link";
  return false;
}

function isUnreleasableCodeForReason(code: number | undefined, reason: number): boolean {
  if (code === 46) return true;
  if (code === 43) return (reason & 0x10) !== 0;
  if (code === 44) return (reason & 0x10) === 0;
  if (code === 48) return (reason & 0x40) !== 0;
  return false;
}
