import { fallbackCardReader } from "#duel/card-reader.js";
import { applyResponse, getGroupedDuelLegalActions, getLegalActions, queryPublicState } from "#duel/core.js";
import { prunePendingTriggersWithoutEffects, restoreDuel } from "#duel/snapshot.js";
import { createLuaScriptHost, type LuaScriptHost, type LuaScriptLoadResult, type LuaScriptSource } from "#lua/host.js";
import type { DuelLegalActionGroup } from "#duel/legal-action-groups.js";
import type { ApplyDuelResponseResult, DuelAction, DuelCardReader, DuelResponse, DuelSession, PlayerId, SerializedDuel } from "#duel/types.js";

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
  const session = restoreDuel(snapshot, cardReader, {}, {}, { pruneUnrestoredPendingTriggers: false });
  const host = createLuaScriptHost(session);
  const registryKeys = luaRegistryKeys(snapshot);
  const loadedScripts = [...luaRegistryCardCodes(registryKeys)].map((code) => host.loadCardScript(code, source));
  const registeredEffects = loadedScripts.every((result) => result.ok) ? host.registerInitialEffects() : 0;
  const restoredRegistryKeys = filterRestoredLuaEffects(session, registryKeys);
  prunePendingTriggersWithoutEffects(session.state);
  const missingRegistryKeys = [...registryKeys].filter((key) => !restoredRegistryKeys.includes(key));
  const chainLimitRegistryKeys = luaChainLimitRegistryKeys(snapshot);
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

function filterRestoredLuaEffects(session: DuelSession, registryKeys: Set<string>): string[] {
  if (registryKeys.size === 0) return [];
  session.state.effects = session.state.effects.filter((effect) => effect.registryKey === undefined || registryKeys.has(effect.registryKey));
  return session.state.effects.map((effect) => effect.registryKey).filter((key): key is string => Boolean(key?.startsWith("lua:")));
}

function luaRegistryKeys(snapshot: SerializedDuel): Set<string> {
  return new Set(snapshot.state.effects.map((effect) => effect.registryKey).filter((key): key is string => Boolean(key?.startsWith("lua:"))));
}

function luaChainLimitRegistryKeys(snapshot: SerializedDuel): string[] {
  return snapshot.state.chainLimits.map((limit) => limit.registryKey).filter((key): key is string => Boolean(key?.startsWith("lua-chain-limit:")));
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

function luaRegistryCardCodes(registryKeys: Set<string>): Set<string> {
  const codes = new Set<string>();
  for (const key of registryKeys) {
    const [, code] = key.split(":");
    if (code) codes.add(code);
  }
  return codes;
}
