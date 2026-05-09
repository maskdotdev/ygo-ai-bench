import { fallbackCardReader } from "#duel/card-reader.js";
import { createActionWindowToken } from "#duel/action-window-token.js";
import { applyResponse, getGroupedDuelLegalActions, getLegalActions, queryPublicState } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { prunePendingTriggersWithoutEffects, restoreDuel } from "#duel/snapshot.js";
import { createLuaScriptHost, type LuaScriptHost, type LuaScriptLoadResult, type LuaScriptSource } from "#lua/host.js";
import type { DuelLegalActionGroup } from "#duel/legal-action-groups.js";
import type { ApplyDuelResponseResult, ChainLimit, DuelAction, DuelCardReader, DuelEffectDefinition, DuelResponse, DuelSession, PlayerId, SerializedDuel, SerializedDuelEffect } from "#duel/types.js";

export interface LuaSnapshotRestoreResult {
  session: DuelSession;
  host: LuaScriptHost;
  restoreComplete: boolean;
  loadedScripts: LuaScriptLoadResult[];
  registeredEffects: number;
  restoredRegistryKeys: string[];
  missingRegistryKeys: string[];
  chainLimitRegistryKeys: string[];
  missingChainLimitRegistryKeys: string[];
  incompleteReasons: string[];
}

export function restoreDuelWithLuaScripts(
  snapshot: SerializedDuel,
  source: LuaScriptSource,
  cardReader: DuelCardReader = fallbackCardReader,
): LuaSnapshotRestoreResult {
  const chainLimitRegistryKeys = luaChainLimitRegistryKeys(snapshot);
  const session = restoreDuel(snapshot, cardReader, {}, luaDenyChainLimitRegistry(chainLimitRegistryKeys), { pruneUnrestoredPendingTriggers: false });
  session.state.actionWindowToken = createActionWindowToken();
  const host = createLuaScriptHost(session);
  const registryKeys = luaRegistryKeys(snapshot);
  const scriptRegistryKeys = luaScriptRegistryKeys(registryKeys, snapshot.state.effects);
  const loadedScripts = [...luaRegistryCardCodes(scriptRegistryKeys, chainLimitRegistryKeys)].map((code) => host.loadCardScript(code, source));
  const registeredEffects = loadedScripts.every((result) => result.ok) ? host.registerInitialEffects() : 0;
  restoreKnownLuaChainLimits(session, host, chainLimitRegistryKeys);
  const restoredRegistryKeys = filterRestoredLuaEffects(session, registryKeys, snapshot.state.effects);
  restoredRegistryKeys.push(...restoreKnownLuaEffects(session, registryKeys, snapshot.state.effects, restoredRegistryKeys));
  prunePendingTriggersWithoutEffects(session.state);
  const missingRegistryKeys = [...registryKeys].filter((key) => !restoredRegistryKeys.includes(key));
  const restoredChainLimitRegistryKeys = luaChainLimitRegistryKeys({ ...snapshot, state: session.state });
  const missingChainLimitRegistryKeys = chainLimitRegistryKeys.filter((key) => !restoredChainLimitRegistryKeys.includes(key));
  const incompleteReasons = luaRestoreIncompleteReasons(loadedScripts, missingRegistryKeys, missingChainLimitRegistryKeys);
  const restoreComplete = incompleteReasons.length === 0;
  return { session, host, restoreComplete, loadedScripts, registeredEffects, restoredRegistryKeys, missingRegistryKeys, chainLimitRegistryKeys, missingChainLimitRegistryKeys, incompleteReasons };
}

export function getLuaRestoreLegalActions(restored: LuaSnapshotRestoreResult, player: PlayerId): DuelAction[] {
  if (!restored.restoreComplete) return [];
  return getLegalActions(restored.session, player);
}

export function getLuaRestoreLegalActionGroups(restored: LuaSnapshotRestoreResult, player: PlayerId): DuelLegalActionGroup[] {
  if (!restored.restoreComplete) return [];
  return getGroupedDuelLegalActions(restored.session, player);
}

export function applyLuaRestoreResponse(restored: LuaSnapshotRestoreResult, response: DuelResponse): ApplyDuelResponseResult {
  if (!restored.restoreComplete) {
    return {
      ok: false,
      error: luaRestoreIncompleteError(restored),
      state: queryPublicState(restored.session),
      legalActions: [],
      legalActionGroups: [],
    };
  }
  return applyResponse(restored.session, response);
}

function filterRestoredLuaEffects(session: DuelSession, registryKeys: Set<string>, snapshotEffects: SerializedDuelEffect[]): string[] {
  if (registryKeys.size === 0) return [];
  const snapshotEffectsByKey = new Map(snapshotEffects.map((effect) => [effect.registryKey, effect]).filter((entry): entry is [string, SerializedDuelEffect] => Boolean(entry[0])));
  session.state.effects = session.state.effects
    .filter((effect) => effect.registryKey === undefined || registryKeys.has(effect.registryKey))
    .map((effect) => mergeRestoredLuaEffectMetadata(effect, snapshotEffectsByKey.get(effect.registryKey ?? "")));
  return session.state.effects.map((effect) => effect.registryKey).filter((key): key is string => Boolean(key?.startsWith("lua:")));
}

function mergeRestoredLuaEffectMetadata(effect: DuelEffectDefinition, snapshotEffect: SerializedDuelEffect | undefined): DuelEffectDefinition {
  if (snapshotEffect?.reset === undefined) return effect;
  return { ...effect, reset: { ...snapshotEffect.reset } };
}

function restoreKnownLuaEffects(
  session: DuelSession,
  registryKeys: Set<string>,
  snapshotEffects: SerializedDuelEffect[],
  restoredRegistryKeys: string[],
): string[] {
  const restored = new Set(restoredRegistryKeys);
  const added: string[] = [];
  for (const effect of snapshotEffects) {
    if (!effect.registryKey || !registryKeys.has(effect.registryKey) || restored.has(effect.registryKey)) continue;
    if (!isKnownRestorableLuaEffect(effect)) continue;
    session.state.effects.push({
      ...effect,
      range: [...effect.range],
      ...(effect.reset ? { reset: { ...effect.reset } } : {}),
      ...(effect.targetRange ? { targetRange: [...effect.targetRange] } : {}),
      ...(effect.hintTiming ? { hintTiming: [...effect.hintTiming] } : {}),
      ...restoredLuaValueCallbacks(effect),
      operation: () => {},
    });
    added.push(effect.registryKey);
  }
  return added;
}

function isKnownRestorableLuaEffect(effect: SerializedDuelEffect): boolean {
  return (
    effect.event === "continuous" &&
    (effect.code === 22 ||
      effect.code === 25 ||
      effect.luaValueDescriptor === "change-damage:effect-double" ||
      ((effect.code === 100 || effect.code === 103 || effect.code === 104 || effect.code === 107 || effect.code === 130 || effect.code === 132) && effect.value !== undefined))
  );
}

function restoredLuaValueCallbacks(effect: SerializedDuelEffect): Pick<DuelEffectDefinition, "battleDamageValue" | "lifePointValue"> {
  if (effect.luaValueDescriptor !== "change-damage:effect-double") return {};
  const applyValue = (ctx: Parameters<NonNullable<DuelEffectDefinition["lifePointValue"]>>[0], _player: PlayerId, amount: number): number =>
    ((ctx.eventReason ?? 0) & duelReason.effect) !== 0 ? amount * 2 : amount;
  return { battleDamageValue: applyValue, lifePointValue: applyValue };
}

function luaScriptRegistryKeys(registryKeys: Set<string>, snapshotEffects: SerializedDuelEffect[]): Set<string> {
  const knownRestorableKeys = new Set(
    snapshotEffects
      .filter(isKnownRestorableLuaEffect)
      .map((effect) => effect.registryKey)
      .filter((key): key is string => Boolean(key)),
  );
  return new Set([...registryKeys].filter((key) => !knownRestorableKeys.has(key)));
}

function luaRegistryKeys(snapshot: SerializedDuel): Set<string> {
  return new Set(snapshot.state.effects.map((effect) => effect.registryKey).filter((key): key is string => Boolean(key?.startsWith("lua:"))));
}

function luaChainLimitRegistryKeys(snapshot: SerializedDuel): string[] {
  return snapshot.state.chainLimits.map((limit) => limit.registryKey).filter((key): key is string => Boolean(key?.startsWith("lua-chain-limit:")));
}

function luaDenyChainLimitRegistry(keys: string[]): Record<string, (limit: ChainLimit) => ChainLimit> {
  return Object.fromEntries(keys.map((key) => [key, knownLuaChainLimitRestoreFactory(key) ?? ((limit: ChainLimit): ChainLimit => {
    const { registryKey: _registryKey, ...metadata } = limit;
    return { ...metadata, allows: () => false };
  })]));
}

function knownLuaChainLimitRestoreFactory(key: string): ((limit: ChainLimit) => ChainLimit) | undefined {
  const parts = key.split(":");
  const knownPredicate = parts[4] === "known" ? parts.slice(5).join(":") : undefined;
  if (knownPredicate === "aux.FALSE") return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate === "aux.TRUE") return (limit) => ({ ...limit, allows: () => true });
  if (knownPredicate?.startsWith("closure:card-handler:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:card-not-handler:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:cards-not-handler:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:target-cards-not-handler:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:type-mask-response-player:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:not-source-type-unless-chain-player:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:not-source-type-effect-type-setcode:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:not-source-type-effect-type:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:not-active-type-effect-type:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:handler-code:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:handler-codes:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:handler-code-response-player:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:handler-codes-response-player:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:not-effect-type:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:not-effect-type-response-player:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate === "closure:not-monster-without-level") return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate === "closure:not-active-monster-link") return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:not-active-type-response-player:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:active-type-response-player:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:source-type-non-activate-response-player:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate === "closure:spell-trap-non-activate-response-player") return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:not-active-type:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.match(/^closure:response-player:[01]$/)) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate === "closure:response-matches-chain-player") return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.match(/^closure:chain-player:[01]$/)) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.startsWith("closure:source:")) return (limit) => ({ ...limit, allows: () => false });
  if (knownPredicate?.match(/^c\d+\.[A-Za-z_]\w*$/)) return (limit) => ({ ...limit, allows: () => false });
  return undefined;
}

function restoreKnownLuaChainLimits(session: DuelSession, host: LuaScriptHost, keys: string[]): void {
  if (keys.length === 0) return;
  const keySet = new Set(keys);
  session.state.chainLimits = session.state.chainLimits.map((limit) => {
    if (!limit.registryKey || !keySet.has(limit.registryKey)) return limit;
    const restored = host.restoreChainLimit(limit.registryKey, limit);
    if (restored) return restored;
    const { registryKey: _registryKey, ...metadata } = limit;
    return { ...metadata, allows: () => false };
  });
}

function luaRestoreIncompleteReasons(loadedScripts: LuaScriptLoadResult[], missingRegistryKeys: string[], missingChainLimitRegistryKeys: string[]): string[] {
  return [
    ...loadedScripts.filter((result) => !result.ok).map((result) => `script ${result.name}: ${result.error}`),
    ...(missingRegistryKeys.length === 0 ? [] : [`missing Lua effect registry keys: ${missingRegistryKeys.join(", ")}`]),
    ...(missingChainLimitRegistryKeys.length === 0 ? [] : [`missing Lua chain-limit registry keys: ${missingChainLimitRegistryKeys.join(", ")}`]),
  ];
}

function luaRestoreIncompleteError(restored: LuaSnapshotRestoreResult): string {
  return restored.incompleteReasons.length === 0 ? "Lua snapshot restore is incomplete" : `Lua snapshot restore is incomplete: ${restored.incompleteReasons.join("; ")}`;
}

function luaRegistryCardCodes(registryKeys: Set<string>, chainLimitRegistryKeys: string[] = []): Set<string> {
  const codes = new Set<string>();
  for (const key of [...registryKeys, ...chainLimitRegistryKeys]) {
    const [, code] = key.split(":");
    if (code && /^\d+$/.test(code)) codes.add(code);
  }
  return codes;
}
