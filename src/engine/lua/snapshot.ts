import { fallbackCardReader } from "#duel/card-reader.js";
import { restoreDuel } from "#duel/snapshot.js";
import { createLuaScriptHost, type LuaScriptHost, type LuaScriptLoadResult, type LuaScriptSource } from "#lua/host.js";
import type { DuelCardReader, DuelSession, SerializedDuel } from "#duel/types.js";

export interface LuaSnapshotRestoreResult {
  session: DuelSession;
  host: LuaScriptHost;
  loadedScripts: LuaScriptLoadResult[];
  registeredEffects: number;
  restoredRegistryKeys: string[];
  missingRegistryKeys: string[];
}

export function restoreDuelWithLuaScripts(
  snapshot: SerializedDuel,
  source: LuaScriptSource,
  cardReader: DuelCardReader = fallbackCardReader,
): LuaSnapshotRestoreResult {
  const session = restoreDuel(snapshot, cardReader);
  const host = createLuaScriptHost(session);
  const registryKeys = luaRegistryKeys(snapshot);
  const loadedScripts = [...luaRegistryCardCodes(registryKeys)].map((code) => host.loadCardScript(code, source));
  const registeredEffects = loadedScripts.every((result) => result.ok) ? host.registerInitialEffects() : 0;
  const restoredRegistryKeys = filterRestoredLuaEffects(session, registryKeys);
  const missingRegistryKeys = [...registryKeys].filter((key) => !restoredRegistryKeys.includes(key));
  return { session, host, loadedScripts, registeredEffects, restoredRegistryKeys, missingRegistryKeys };
}

function filterRestoredLuaEffects(session: DuelSession, registryKeys: Set<string>): string[] {
  if (registryKeys.size === 0) return [];
  session.state.effects = session.state.effects.filter((effect) => effect.registryKey === undefined || registryKeys.has(effect.registryKey));
  return session.state.effects.map((effect) => effect.registryKey).filter((key): key is string => Boolean(key?.startsWith("lua:")));
}

function luaRegistryKeys(snapshot: SerializedDuel): Set<string> {
  return new Set(snapshot.state.effects.map((effect) => effect.registryKey).filter((key): key is string => Boolean(key?.startsWith("lua:"))));
}

function luaRegistryCardCodes(registryKeys: Set<string>): Set<string> {
  const codes = new Set<string>();
  for (const key of registryKeys) {
    const [, code] = key.split(":");
    if (code) codes.add(code);
  }
  return codes;
}
