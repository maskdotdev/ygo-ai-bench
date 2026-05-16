import { cardRegistry } from "#cards/definitions.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { CardDefinition } from "#engine/types.js";
import { fallbackCardReader } from "#duel/card-reader.js";
import type { DuelCardData, DuelCardKind } from "#duel/types.js";

let cachedReader: ((code: string) => DuelCardData) | undefined;
let cachedBuiltinCards: Map<string, DuelCardData> | undefined;

export type BrowserDuelCardDataLoader = (codes: readonly string[]) => Promise<readonly DuelCardData[]>;

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

/** Maps bundled card definitions + fallback for unknown passcodes (minimal stub). */
export function getBrowserDuelCardReader(): (code: string) => DuelCardData {
  if (cachedReader) return cachedReader;
  const lookup = createCardReader(builtinCards().values());
  cachedReader = (code: string) => lookup(code) ?? fallbackCardReader(code);
  return cachedReader;
}
