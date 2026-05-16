import { scriptFilenameForCard } from "#engine/data-loaders.js";
import type { LuaScriptSource } from "#lua/host.js";

export type BrowserLuaScriptLoader = (names: readonly string[]) => Promise<Readonly<Record<string, string | undefined>>>;

export interface BrowserLuaScriptPreloadResult {
  loaded: string[];
  missing: string[];
}

export interface BrowserLuaScriptCache extends LuaScriptSource {
  preloadCardScripts(codes: readonly string[]): Promise<BrowserLuaScriptPreloadResult>;
  loadedScriptNames(): string[];
  missingScriptNames(names: readonly string[]): string[];
}

function normalizedNames(names: readonly string[]): string[] {
  return [...new Set(names.map(String).filter(Boolean))].sort();
}

export function createBrowserLuaScriptCache(loader: BrowserLuaScriptLoader): BrowserLuaScriptCache {
  const scripts = new Map<string, string>();
  return {
    async preloadCardScripts(codes) {
      const names = normalizedNames(codes.map(scriptFilenameForCard));
      const missingBeforeLoad = names.filter((name) => !scripts.has(name));
      if (missingBeforeLoad.length) {
        const loaded = await loader(missingBeforeLoad);
        for (const name of missingBeforeLoad) {
          const code = loaded[name];
          if (code !== undefined) scripts.set(name, code);
        }
      }
      return {
        loaded: names.filter((name) => scripts.has(name)),
        missing: names.filter((name) => !scripts.has(name)),
      };
    },
    readScript(name) {
      return scripts.get(name);
    },
    loadedScriptNames() {
      return normalizedNames([...scripts.keys()]);
    },
    missingScriptNames(names) {
      return normalizedNames(names).filter((name) => !scripts.has(name));
    },
  };
}
