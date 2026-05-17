import { scriptFilenameForCard } from "#engine/data-loaders.js";
import type { LuaScriptSource } from "#lua/host.js";

export type BrowserLuaScriptLoader = (names: readonly string[]) => Promise<Readonly<Record<string, string | undefined>>>;

export interface BrowserLuaScriptFetchResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type BrowserLuaScriptFetch = (url: string) => Promise<BrowserLuaScriptFetchResponse>;

export interface BrowserLuaScriptFetchLoaderOptions {
  baseUrl: string;
  fetchText?: BrowserLuaScriptFetch;
}

export interface BrowserLuaScriptJsonResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type BrowserLuaScriptJsonFetch = (url: string) => Promise<BrowserLuaScriptJsonResponse>;

export interface BrowserLuaScriptManifestLoaderOptions {
  baseUrl: string;
  manifestUrl?: string;
  fetchJson?: BrowserLuaScriptJsonFetch;
}

export interface BrowserLuaScriptManifest {
  schemaVersion: 1;
  kind: "browser-lua-scripts";
  selectedCodes: string[];
  copiedCount: number;
  missingCount: number;
  sourceCounts: Record<string, number>;
  fallbackKindCounts: Record<string, number>;
  copied: string[];
  missing: string[];
  files: BrowserLuaScriptManifestFile[];
}

export interface BrowserLuaScriptManifestFile {
  name: string;
  source: BrowserLuaScriptSourceKind;
  fallbackKind?: "alias" | "provisional" | "other";
  bytes: number;
  sha256: string;
}

type BrowserLuaScriptSourceKind = "local-override" | "upstream-official" | "upstream-root" | "upstream-pre-release" | "local-fallback";

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

export function createBrowserLuaScriptFetchLoader(options: BrowserLuaScriptFetchLoaderOptions): BrowserLuaScriptLoader {
  const fetchText = options.fetchText ?? ((url) => fetch(url));
  return async (names) => {
    const loaded: Record<string, string | undefined> = {};
    await Promise.all(normalizedNames(names).map(async (name) => {
      const response = await fetchText(scriptUrl(options.baseUrl, name));
      if (response.status === 404) {
        loaded[name] = undefined;
        return;
      }
      if (!response.ok) throw new Error(`Lua script fetch failed for ${name} with HTTP ${response.status}`);
      loaded[name] = await response.text();
    }));
    return loaded;
  };
}

export function createBrowserLuaScriptManifestLoader(options: BrowserLuaScriptManifestLoaderOptions): () => Promise<BrowserLuaScriptManifest> {
  const fetchJson = options.fetchJson ?? ((url) => fetch(url));
  return async () => {
    const response = await fetchJson(options.manifestUrl ?? scriptUrl(options.baseUrl, "manifest.json"));
    if (!response.ok) throw new Error(`Lua script manifest fetch failed with HTTP ${response.status}`);
    return parseBrowserLuaScriptManifest(await response.json());
  };
}

function scriptUrl(baseUrl: string, name: string): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}${encodeURIComponent(name)}`;
}

function parseBrowserLuaScriptManifest(value: unknown): BrowserLuaScriptManifest {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.kind !== "browser-lua-scripts" ||
    !Array.isArray(value.selectedCodes) ||
    !value.selectedCodes.every((code) => typeof code === "string") ||
    typeof value.copiedCount !== "number" ||
    !Number.isInteger(value.copiedCount) ||
    typeof value.missingCount !== "number" ||
    !Number.isInteger(value.missingCount) ||
    !Array.isArray(value.copied) ||
    !value.copied.every((name) => typeof name === "string") ||
    !Array.isArray(value.missing) ||
    !value.missing.every((name) => typeof name === "string") ||
    !isRecord(value.sourceCounts) ||
    !Object.values(value.sourceCounts).every((count) => Number.isInteger(count)) ||
    !isRecord(value.fallbackKindCounts) ||
    !Object.values(value.fallbackKindCounts).every((count) => Number.isInteger(count)) ||
    !Array.isArray(value.files) ||
    !value.files.every(isBrowserLuaScriptManifestFile) ||
    value.copiedCount !== value.copied.length ||
    value.missingCount !== value.missing.length ||
    value.files.length !== value.copied.length ||
    sumCounts(value.sourceCounts) !== value.copied.length ||
    ((value.sourceCounts["local-fallback"] as number | undefined) ?? 0) !== sumCounts(value.fallbackKindCounts)
  ) {
    throw new Error("Lua script manifest must describe browser-lua-scripts payload metadata");
  }
  return {
    schemaVersion: 1,
    kind: "browser-lua-scripts",
    selectedCodes: [...value.selectedCodes],
    copiedCount: value.copiedCount,
    missingCount: value.missingCount,
    sourceCounts: { ...value.sourceCounts } as Record<string, number>,
    fallbackKindCounts: { ...value.fallbackKindCounts } as Record<string, number>,
    copied: [...value.copied],
    missing: [...value.missing],
    files: value.files.map((file) => ({ ...file })),
  };
}

function isBrowserLuaScriptManifestFile(value: unknown): value is BrowserLuaScriptManifestFile {
  return isRecord(value) &&
    typeof value.name === "string" &&
    isBrowserLuaScriptSourceKind(value.source) &&
    (value.fallbackKind === undefined || isBrowserLuaScriptFallbackKind(value.fallbackKind)) &&
    typeof value.bytes === "number" &&
    Number.isInteger(value.bytes) &&
    typeof value.sha256 === "string" &&
    isSha256(value.sha256);
}

function isBrowserLuaScriptSourceKind(value: unknown): value is BrowserLuaScriptSourceKind {
  return value === "local-override" ||
    value === "upstream-official" ||
    value === "upstream-root" ||
    value === "upstream-pre-release" ||
    value === "local-fallback";
}

function isBrowserLuaScriptFallbackKind(value: unknown): value is "alias" | "provisional" | "other" {
  return value === "alias" || value === "provisional" || value === "other";
}

function sumCounts(counts: Record<string, unknown>): number {
  return Object.values(counts).reduce<number>((sum, count) => sum + (typeof count === "number" ? count : 0), 0);
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
