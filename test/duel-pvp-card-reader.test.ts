import { describe, expect, it } from "vitest";
import { createBrowserCdbCardDataLoader, createBrowserCdbJsonManifestLoader, createBrowserCdbJsonRowsLoader, createBrowserDuelCardDataCache } from "../src/playtest-app/duel-pvp-card-reader.js";
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

  it("fetches JSON-safe CDB rows from a browser endpoint", async () => {
    const requestedUrls: string[] = [];
    const loadRows = createBrowserCdbJsonRowsLoader({
      endpoint: "/card-data/cdb-rows.json?format=browser",
      fetchJson: async (url) => {
        requestedUrls.push(url);
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              datas: [{ id: 90000006, type: 2 }],
              texts: [{ id: 90000006, name: "Fetched Spell" }],
            };
          },
        };
      },
    });
    const cache = createBrowserDuelCardDataCache(createBrowserCdbCardDataLoader(loadRows));

    const preload = await cache.preload(["90000006", "90000007", "90000006"]);

    expect(requestedUrls).toEqual(["/card-data/cdb-rows.json?format=browser&codes=90000006,90000007"]);
    expect(preload).toEqual({ loaded: ["90000006"], missing: ["90000007"] });
    expect(cache.reader("90000006")).toMatchObject({ code: "90000006", name: "Fetched Spell", kind: "spell" });
  });

  it("reports invalid CDB row endpoint responses", async () => {
    const loadRows = createBrowserCdbJsonRowsLoader({
      endpoint: "/card-data/cdb-rows.json",
      fetchJson: async () => ({
        ok: true,
        status: 200,
        async json() {
          return { datas: [] };
        },
      }),
    });

    await expect(loadRows(["90000008"])).rejects.toThrow("CDB rows payload must contain datas and texts arrays");
  });

  it("loads browser CDB sidecar manifests from the endpoint directory", async () => {
    const requestedUrls: string[] = [];
    const loadManifest = createBrowserCdbJsonManifestLoader({
      endpoint: "/card-data/cdb-rows.json?format=browser",
      fetchJson: async (url) => {
        requestedUrls.push(url);
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              schemaVersion: 1,
              kind: "browser-cdb-rows",
              payload: "cdb-rows.json",
              selectedCodes: ["90000009"],
              datasRows: 1,
              textsRows: 1,
              sha256: "abc123",
            };
          },
        };
      },
    });

    await expect(loadManifest()).resolves.toEqual({
      schemaVersion: 1,
      kind: "browser-cdb-rows",
      payload: "cdb-rows.json",
      selectedCodes: ["90000009"],
      datasRows: 1,
      textsRows: 1,
      sha256: "abc123",
    });
    expect(requestedUrls).toEqual(["/card-data/manifest.json"]);
  });
});
