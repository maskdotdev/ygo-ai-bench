import { describe, expect, it } from "vitest";
import { createBrowserDuelCardDataCache } from "../src/playtest-app/duel-pvp-card-reader.js";
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
});
