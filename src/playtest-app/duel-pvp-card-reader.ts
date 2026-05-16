import { cardRegistry } from "#cards/definitions.js";
import { createCardReader, normalizeCdbRows, type RawCdbDataRow, type RawCdbTextRow } from "#engine/data-loaders.js";
import type { CardDefinition } from "#engine/types.js";
import { fallbackCardReader } from "#duel/card-reader.js";
import type { DuelCardData, DuelCardKind } from "#duel/types.js";

let cachedReader: ((code: string) => DuelCardData) | undefined;
let cachedBuiltinCards: Map<string, DuelCardData> | undefined;

export type BrowserDuelCardDataLoader = (codes: readonly string[]) => Promise<readonly DuelCardData[]>;

export interface BrowserCdbCardRows {
  datas: RawCdbDataRow[];
  texts: RawCdbTextRow[];
}

export type BrowserCdbCardRowsLoader = (codes: readonly string[]) => Promise<BrowserCdbCardRows>;

export interface BrowserCdbJsonResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type BrowserCdbJsonFetch = (url: string) => Promise<BrowserCdbJsonResponse>;

export interface BrowserCdbJsonRowsLoaderOptions {
  endpoint: string;
  fetchJson?: BrowserCdbJsonFetch;
}

export interface BrowserCdbJsonManifestLoaderOptions {
  endpoint: string;
  manifestEndpoint?: string;
  fetchJson?: BrowserCdbJsonFetch;
}

export interface BrowserCdbRowsManifest {
  schemaVersion: 1;
  kind: "browser-cdb-rows";
  payload: string;
  selectedCodes: string[];
  datasRows: number;
  textsRows: number;
  sha256: string;
}

export interface BrowserDuelCardDataPreloadResult {
  loaded: string[];
  missing: string[];
}

export interface BrowserDuelCardDataCache {
  preload(codes: readonly string[]): Promise<BrowserDuelCardDataPreloadResult>;
  reader(code: string): DuelCardData;
  loadedCodes(): string[];
  missingCodes(codes: readonly string[]): string[];
}

function definitionToDuelData(def: CardDefinition): DuelCardData {
  const kind: DuelCardKind =
    def.type === "spell" ? "spell" : def.type === "trap" ? "trap" : def.type === "extra" ? "extra" : "monster";
  return {
    code: def.id,
    name: def.name,
    kind,
    ...(def.level !== undefined ? { level: def.level } : {}),
  };
}

function builtinCards(): Map<string, DuelCardData> {
  if (cachedBuiltinCards) return cachedBuiltinCards;
  cachedBuiltinCards = new Map([...cardRegistry.values()].map((definition) => {
    const card = definitionToDuelData(definition);
    return [card.code, card];
  }));
  return cachedBuiltinCards;
}

function normalizedCodes(codes: readonly string[]): string[] {
  return [...new Set(codes.map(String).filter(Boolean))].sort();
}

export function createBrowserDuelCardDataCache(loader?: BrowserDuelCardDataLoader): BrowserDuelCardDataCache {
  const dynamicCards = new Map<string, DuelCardData>();
  const builtins = builtinCards();
  const reader = (code: string): DuelCardData => dynamicCards.get(String(code)) ?? builtins.get(String(code)) ?? fallbackCardReader(String(code));
  return {
    async preload(codes) {
      const requested = normalizedCodes(codes);
      const needLoad = requested.filter((code) => !builtins.has(code) && !dynamicCards.has(code));
      if (needLoad.length && loader) {
        const loaded = await loader(needLoad);
        const requestedSet = new Set(needLoad);
        for (const card of loaded) {
          const code = String(card.code);
          if (requestedSet.has(code)) dynamicCards.set(code, { ...card, code });
        }
      }
      return {
        loaded: requested.filter((code) => builtins.has(code) || dynamicCards.has(code)),
        missing: requested.filter((code) => !builtins.has(code) && !dynamicCards.has(code)),
      };
    },
    reader,
    loadedCodes() {
      return normalizedCodes([...builtins.keys(), ...dynamicCards.keys()]);
    },
    missingCodes(codes) {
      return normalizedCodes(codes).filter((code) => !builtins.has(code) && !dynamicCards.has(code));
    },
  };
}

export function createBrowserCdbCardDataLoader(loadRows: BrowserCdbCardRowsLoader): BrowserDuelCardDataLoader {
  return async (codes) => {
    const requested = new Set(normalizedCodes(codes));
    const rows = await loadRows([...requested]);
    return normalizeCdbRows(
      rows.datas.filter((row) => requested.has(String(row.id))),
      rows.texts.filter((row) => requested.has(String(row.id))),
    );
  };
}

export function createBrowserCdbJsonRowsLoader(options: BrowserCdbJsonRowsLoaderOptions): BrowserCdbCardRowsLoader {
  const fetchJson = options.fetchJson ?? ((url) => fetch(url));
  return async (codes) => {
    const requested = normalizedCodes(codes);
    if (!requested.length) return { datas: [], texts: [] };
    const response = await fetchJson(cdbRowsUrl(options.endpoint, requested));
    if (!response.ok) throw new Error(`CDB rows fetch failed with HTTP ${response.status}`);
    return parseBrowserCdbCardRows(await response.json());
  };
}

export function createBrowserCdbJsonManifestLoader(options: BrowserCdbJsonManifestLoaderOptions): () => Promise<BrowserCdbRowsManifest> {
  const fetchJson = options.fetchJson ?? ((url) => fetch(url));
  return async () => {
    const response = await fetchJson(options.manifestEndpoint ?? cdbManifestUrl(options.endpoint));
    if (!response.ok) throw new Error(`CDB rows manifest fetch failed with HTTP ${response.status}`);
    return parseBrowserCdbRowsManifest(await response.json());
  };
}

function cdbRowsUrl(endpoint: string, codes: readonly string[]): string {
  const separator = endpoint.includes("?") ? "&" : "?";
  return `${endpoint}${separator}codes=${codes.map(encodeURIComponent).join(",")}`;
}

function cdbManifestUrl(endpoint: string): string {
  const endpointPath = endpoint.split("?")[0] ?? endpoint;
  const slashIndex = endpointPath.lastIndexOf("/");
  const base = slashIndex >= 0 ? endpointPath.slice(0, slashIndex + 1) : "";
  return `${base}manifest.json`;
}

function parseBrowserCdbCardRows(value: unknown): BrowserCdbCardRows {
  if (!isRecord(value) || !Array.isArray(value.datas) || !Array.isArray(value.texts)) {
    throw new Error("CDB rows payload must contain datas and texts arrays");
  }
  return {
    datas: value.datas as RawCdbDataRow[],
    texts: value.texts as RawCdbTextRow[],
  };
}

function parseBrowserCdbRowsManifest(value: unknown): BrowserCdbRowsManifest {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.kind !== "browser-cdb-rows" ||
    typeof value.payload !== "string" ||
    !Array.isArray(value.selectedCodes) ||
    !value.selectedCodes.every((code) => typeof code === "string") ||
    typeof value.datasRows !== "number" ||
    !Number.isInteger(value.datasRows) ||
    typeof value.textsRows !== "number" ||
    !Number.isInteger(value.textsRows) ||
    typeof value.sha256 !== "string" ||
    !isSha256(value.sha256)
  ) {
    throw new Error("CDB rows manifest must describe browser-cdb-rows payload metadata");
  }
  return {
    schemaVersion: 1,
    kind: "browser-cdb-rows",
    payload: value.payload,
    selectedCodes: [...value.selectedCodes],
    datasRows: value.datasRows,
    textsRows: value.textsRows,
    sha256: value.sha256,
  };
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Maps bundled card definitions + fallback for unknown passcodes (minimal stub). */
export function getBrowserDuelCardReader(): (code: string) => DuelCardData {
  if (cachedReader) return cachedReader;
  const lookup = createCardReader(builtinCards().values());
  cachedReader = (code: string) => lookup(code) ?? fallbackCardReader(code);
  return cachedReader;
}
