import { cardTypeFlags } from "#lua/card-stat-api.js";
import type { DuelCardInstance, DuelEffectContext, DuelSession, PlayerId } from "#duel/types.js";
import type { LuaEffectRecord, LuaHostState } from "#lua/host-types.js";

export function effectController(session: DuelSession, effect: LuaEffectRecord): PlayerId {
  const source = sourceCard(session, effect);
  return source?.controller ?? 0;
}

export function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}

export function normalizeLuaPlayer(value: number): PlayerId {
  return normalizePlayer(value);
}

export function canUseLuaEffectCount(hostState: LuaHostState, effect: LuaEffectRecord, player: PlayerId): boolean {
  const limit = luaEffectCountLimit(effect);
  if (limit <= 0) return true;
  return (hostState.usedEffectCounts.get(luaEffectCountKey(effect, player)) ?? 0) < limit;
}

export function markLuaEffectCountUsed(hostState: LuaHostState, effect: LuaEffectRecord, player: PlayerId, count: number): void {
  const limit = luaEffectCountLimit(effect);
  if (limit <= 0) return;
  const key = luaEffectCountKey(effect, player);
  hostState.usedEffectCounts.set(key, (hostState.usedEffectCounts.get(key) ?? 0) + count);
}

export function clearLuaEffectCountUsage(hostState: LuaHostState, effect: LuaEffectRecord): void {
  const prefix = `effect:${effect.id}:`;
  const codePrefix = effect.countLimitCode === undefined ? undefined : `code:${effect.countLimitCode}:`;
  for (const key of [...hostState.usedEffectCounts.keys()]) {
    if (key.startsWith(prefix) || (codePrefix && key.startsWith(codePrefix))) hostState.usedEffectCounts.delete(key);
  }
}

function luaEffectCountLimit(effect: LuaEffectRecord): number {
  return effect.countLimit ?? 0;
}

function luaEffectCountKey(effect: LuaEffectRecord, player: PlayerId): string {
  return effect.countLimitCode === undefined ? `effect:${effect.id}:${player}` : `code:${effect.countLimitCode}:${player}`;
}

export function sourceCard(session: DuelSession, effect: LuaEffectRecord): DuelCardInstance | undefined {
  return effect.sourceUid ? session.state.cards.find((candidate) => candidate.uid === effect.sourceUid) : undefined;
}

export function activeTypeFlags(card: DuelCardInstance | undefined, session: DuelSession): number {
  return cardTypeFlags(card, session.state) & 0x7;
}

export function firstFiniteNumber(...values: Array<number | undefined>): number | undefined {
  return values.find((value): value is number => value !== undefined && Number.isFinite(value));
}

export function relatedEffectIdFromEventHistory(hostState: LuaHostState, ctx?: DuelEffectContext): number | undefined {
  if (!ctx?.eventName) return latestRelatedEffectId(hostState);
  for (let index = hostState.session.state.eventHistory.length - 1; index >= 0; index -= 1) {
    const event = hostState.session.state.eventHistory[index];
    if (!event || event.eventName !== ctx.eventName) continue;
    if (ctx.eventCode !== undefined && event.eventCode !== ctx.eventCode) continue;
    if (ctx.eventCard?.uid !== undefined && event.eventCardUid !== ctx.eventCard.uid) continue;
    return event.relatedEffectId;
  }
  return latestRelatedEffectId(hostState);
}

export function relatedEffectIdFromChainLink(link: DuelSession["state"]["chain"][number] | undefined): number | undefined {
  if (!link) return undefined;
  const relatedEffectId = Number(link.effectId.match(/^lua-(\d+)/)?.[1]);
  return Number.isFinite(relatedEffectId) ? relatedEffectId : undefined;
}

function latestRelatedEffectId(hostState: LuaHostState): number | undefined {
  for (let index = hostState.session.state.eventHistory.length - 1; index >= 0; index -= 1) {
    const relatedEffectId = hostState.session.state.eventHistory[index]?.relatedEffectId;
    if (relatedEffectId !== undefined) return relatedEffectId;
  }
  return undefined;
}
