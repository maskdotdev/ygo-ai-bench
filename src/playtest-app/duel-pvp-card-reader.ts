import { cardRegistry } from "#cards/definitions.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { CardDefinition } from "#engine/types.js";
import { fallbackCardReader } from "#duel/card-reader.js";
import type { DuelCardData, DuelCardKind } from "#duel/types.js";

let cachedReader: ((code: string) => DuelCardData) | undefined;

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

/** Maps bundled card definitions + fallback for unknown passcodes (minimal stub). */
export function getBrowserDuelCardReader(): (code: string) => DuelCardData {
  if (cachedReader) return cachedReader;
  const builtins = [...cardRegistry.values()].map(definitionToDuelData);
  const lookup = createCardReader(builtins);
  cachedReader = (code: string) => lookup(code) ?? fallbackCardReader(code);
  return cachedReader;
}
