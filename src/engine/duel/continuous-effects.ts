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
  const card = findCard(state, uid);
  if (!card) return false;
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 63) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    if (!continuousEffectAffectsCard(effect, source, card)) continue;
    const ctx = createContext(effect, source, card);
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
}

export function shouldRedirectBanishMove(state: DuelState, uid: string, createContext: ContinuousEffectContextFactory): boolean {
  const card = findCard(state, uid);
  if (!card) return false;
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 64) continue;
    const source = findCard(state, effect.sourceUid);
    if (!source || !effect.range.includes(source.location)) continue;
    if (!continuousEffectAffectsCard(effect, source, card)) continue;
    const ctx = createContext(effect, source, card);
    if (!effect.canActivate || effect.canActivate(ctx)) return true;
  }
  return false;
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

function locationFromRedirectValue(value: number | undefined): DuelLocation | undefined {
  if (value === 0x02) return "hand";
  if (value === 0x10) return "graveyard";
  if (value === 0x20) return "banished";
  if (value === 0x40) return "extraDeck";
  if (value === 0x01) return "deck";
  return undefined;
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
