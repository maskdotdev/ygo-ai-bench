import { describe, expect, it } from "vitest";
import { createBrowserCdbCardDataLoader, createBrowserDuelCardDataCache } from "../src/playtest-app/duel-pvp-card-reader.js";
import type { DuelCardData } from "#duel/types.js";

describe("browser PvP card data cache", () => {
  it("preloads only missing requested passcodes and keeps reader access synchronous", async () => {
    const loadedCards: DuelCardData[] = [
      { code: "90000001", name: "Loaded Monster", kind: "monster", attack: 1800 },
    ];
    const requestedBatches: string[][] = [];
    const cache = createBrowserDuelCardDataCache(async (codes) => {
      requestedBatches.push([...codes]);
      return loadedCards;
    });

    const first = await cache.preload(["7084129", "90000001", "90000001", "90000002"]);

    expect(requestedBatches).toEqual([["90000001", "90000002"]]);
    expect(first).toEqual({ loaded: ["7084129", "90000001"], missing: ["90000002"] });
    expect(cache.reader("7084129")).toMatchObject({ code: "7084129", name: "Magician's Rod" });
    expect(cache.reader("90000001")).toMatchObject({ code: "90000001", name: "Loaded Monster", attack: 1800 });
    expect(cache.reader("90000002")).toMatchObject({ code: "90000002", name: "Card 90000002" });

    const second = await cache.preload(["90000001", "90000002"]);

    expect(requestedBatches).toEqual([["90000001", "90000002"], ["90000002"]]);
    expect(second).toEqual({ loaded: ["90000001"], missing: ["90000002"] });
    expect(cache.missingCodes(["7084129", "90000001", "90000002"])).toEqual(["90000002"]);
  });

  it("normalizes JSON-safe CDB rows for requested passcodes", async () => {
    const requestedBatches: string[][] = [];
    const loader = createBrowserCdbCardDataLoader(async (codes) => {
      requestedBatches.push([...codes]);
      return {
        datas: [
          { id: 90000004, type: 1, atk: 1700, def: 1200, level: 4, race: 1, attribute: 16 },
          { id: 90000005, type: 2 },
        ],
        texts: [
          { id: 90000004, name: "CDB Loaded Monster" },
          { id: 90000005, name: "Unrequested Spell" },
        ],
      };
    });
    const cache = createBrowserDuelCardDataCache(loader);

    const preload = await cache.preload(["90000004"]);

    expect(requestedBatches).toEqual([["90000004"]]);
    expect(preload).toEqual({ loaded: ["90000004"], missing: [] });
    expect(cache.reader("90000004")).toMatchObject({
      code: "90000004",
      name: "CDB Loaded Monster",
      kind: "monster",
      attack: 1700,
      defense: 1200,
      level: 4,
      race: 1,
      attribute: 16,
    });
    expect(cache.missingCodes(["90000005"])).toEqual(["90000005"]);
  });
});
