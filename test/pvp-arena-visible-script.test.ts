import { describe, expect, it } from "vitest";
import {
  bootstrapPvpDuel,
  bootstrapPvpDuelWithBrowserAssets,
  bootstrapPvpDuelWithBrowserData,
  bootstrapPvpDuelWithCardData,
  bootstrapPvpDuelWithLuaScripts,
  createBrowserPvpAssetCaches,
  pvpVisibleBattleFixtureScript,
  pvpVisibleBattleFixtureYdk,
  runPvpArenaVisibleScript,
  runPvpArenaVisibleScriptStep,
} from "../src/playtest-app/pvp-arena.js";
import { createBrowserDuelCardDataCache } from "../src/playtest-app/duel-pvp-card-reader.js";
import { createBrowserLuaScriptCache } from "../src/playtest-app/duel-pvp-script-cache.js";

const lazyLoadedYdk = `#created by test
#main
90000003
#extra
!side`;

describe("PvP arena visible scripts", () => {
  const cardManifestHash = "c".repeat(64);
  const scriptManifestHash = "d".repeat(64);

  it("drives the browser arena fixture through visible actions", () => {
    const session = bootstrapPvpDuel(pvpVisibleBattleFixtureYdk, pvpVisibleBattleFixtureYdk, "pvp-arena-visible-script", 1);

    const result = runPvpArenaVisibleScript(session, pvpVisibleBattleFixtureScript);

    expect(result.ok).toBe(true);
    expect(result.failedStep).toBeUndefined();
    expect(result.state.attacksDeclared).toHaveLength(1);
    expect(result.state.log).toContainEqual(expect.objectContaining({ action: "attack", card: "Magician's Rod", detail: "Direct attack" }));
  });

  it("autoplays the browser arena fixture one visible action at a time", () => {
    const session = bootstrapPvpDuel(pvpVisibleBattleFixtureYdk, pvpVisibleBattleFixtureYdk, "pvp-arena-visible-script-autoplay", 1);
    let step = 0;

    for (const expected of pvpVisibleBattleFixtureScript) {
      const result = runPvpArenaVisibleScriptStep(session, pvpVisibleBattleFixtureScript, step);
      expect(result.ok).toBe(true);
      expect(result.failedStep).toBeUndefined();
      expect(result.appliedAction).toEqual(expect.objectContaining({ type: expected.type }));
      step = result.nextStep;
    }

    const done = runPvpArenaVisibleScriptStep(session, pvpVisibleBattleFixtureScript, step);
    expect(done.ok).toBe(true);
    expect(done.done).toBe(true);
    expect(done.nextStep).toBe(pvpVisibleBattleFixtureScript.length);
    expect(done.state.attacksDeclared).toHaveLength(1);
    expect(done.state.log).toContainEqual(expect.objectContaining({ action: "attack", card: "Magician's Rod", detail: "Direct attack" }));
  });

  it("can bootstrap from preloaded browser card data", async () => {
    const cache = createBrowserDuelCardDataCache(async () => [
      { code: "90000003", name: "Lazy Loaded Duelist", kind: "monster", attack: 2100 },
    ]);

    await cache.preload(["90000003"]);
    const session = bootstrapPvpDuel(lazyLoadedYdk, lazyLoadedYdk, "pvp-arena-lazy-card-data", 1, { cardReader: cache.reader });

    expect(session.state.cards).toContainEqual(expect.objectContaining({
      code: "90000003",
      name: "Lazy Loaded Duelist",
      data: expect.objectContaining({ attack: 2100 }),
    }));
  });

  it("preloads both PvP decks before bootstrapping with browser card data", async () => {
    const requestedBatches: string[][] = [];
    const cache = createBrowserDuelCardDataCache(async (codes) => {
      requestedBatches.push([...codes]);
      return [
        { code: "90000003", name: "Lazy Loaded Duelist", kind: "monster", attack: 2100 },
      ];
    });

    const result = await bootstrapPvpDuelWithCardData(lazyLoadedYdk, pvpVisibleBattleFixtureYdk, "pvp-arena-card-data-preload", 1, {
      cardDataCache: cache,
    });

    expect(requestedBatches).toEqual([["90000003"]]);
    expect(result.preload).toEqual({ loaded: ["7084129", "90000003"], missing: [] });
    expect(result.session.state.cards).toContainEqual(expect.objectContaining({
      code: "90000003",
      name: "Lazy Loaded Duelist",
      data: expect.objectContaining({ attack: 2100 }),
    }));
    expect(result.session.state.cards).toContainEqual(expect.objectContaining({
      code: "7084129",
      name: "Magician's Rod",
    }));
  });

  it("preloads PvP deck scripts and registers initial Lua effects", async () => {
    const requestedBatches: string[][] = [];
    const scriptCache = createBrowserLuaScriptCache(async (names) => {
      requestedBatches.push([...names]);
      return {
        "c90000003.lua": `
          c90000003={}
          function c90000003.initial_effect(c)
            Debug.Message("pvp script loaded " .. c:GetCode())
          end
        `,
      };
    });

    const result = await bootstrapPvpDuelWithLuaScripts(lazyLoadedYdk, pvpVisibleBattleFixtureYdk, "pvp-arena-lua-preload", 1, {
      luaScriptCache: scriptCache,
    });

    expect(requestedBatches).toEqual([["c7084129.lua", "c90000003.lua"]]);
    expect(result.scriptPreload).toEqual({ loaded: ["c90000003.lua"], missing: ["c7084129.lua"] });
    expect(result.scriptLoads).toContainEqual(expect.objectContaining({ ok: true, name: "c90000003.lua" }));
    expect(result.scriptLoads).toContainEqual(expect.objectContaining({ ok: false, name: "c7084129.lua" }));
    expect(result.scriptRegistrations).toContainEqual(expect.objectContaining({ code: "90000003", ok: true }));
    expect(result.luaHost.messages).toContain("pvp script loaded 90000003");
  });

  it("preloads PvP card data and Lua scripts before browser bootstrap", async () => {
    const cardBatches: string[][] = [];
    const scriptBatches: string[][] = [];
    const cardDataCache = createBrowserDuelCardDataCache(async (codes) => {
      cardBatches.push([...codes]);
      return [
        { code: "90000003", name: "Browser Scripted Duelist", kind: "monster", attack: 2300 },
      ];
    });
    const luaScriptCache = createBrowserLuaScriptCache(async (names) => {
      scriptBatches.push([...names]);
      return {
        "c90000003.lua": `
          c90000003={}
          function c90000003.initial_effect(c)
            Debug.Message("browser bootstrap " .. c:GetAttack())
          end
        `,
      };
    });

    const result = await bootstrapPvpDuelWithBrowserData(lazyLoadedYdk, pvpVisibleBattleFixtureYdk, "pvp-browser-data-bootstrap", 1, {
      cardDataCache,
      luaScriptCache,
    });

    expect(cardBatches).toEqual([["90000003"]]);
    expect(scriptBatches).toEqual([["c7084129.lua", "c90000003.lua"]]);
    expect(result.cardPreload).toEqual({ loaded: ["7084129", "90000003"], missing: [] });
    expect(result.scriptPreload).toEqual({ loaded: ["c90000003.lua"], missing: ["c7084129.lua"] });
    expect(result.session.state.cards).toContainEqual(expect.objectContaining({
      code: "90000003",
      name: "Browser Scripted Duelist",
      data: expect.objectContaining({ attack: 2300 }),
    }));
    expect(result.scriptRegistrations).toContainEqual(expect.objectContaining({ code: "90000003", ok: true }));
    expect(result.luaHost.messages).toContain("browser bootstrap 2300");
  });

  it("preloads browser Lua scripts for CDB aliases before registering deck cards", async () => {
    const aliasedYdk = `#created by test
#main
90000021
#extra
!side`;
    const cardBatches: string[][] = [];
    const scriptBatches: string[][] = [];
    const cardDataCache = createBrowserDuelCardDataCache(async (codes) => {
      cardBatches.push([...codes]);
      return [
        { code: "90000021", alias: "90000020", name: "Browser Alias Duelist", kind: "monster", attack: 1900 },
      ];
    });
    const luaScriptCache = createBrowserLuaScriptCache(async (names) => {
      scriptBatches.push([...names]);
      return {
        "c90000020.lua": `
          c90000020={}
          function c90000020.initial_effect(c)
            Debug.Message("browser alias script " .. c:GetCode())
          end
        `,
      };
    });

    const result = await bootstrapPvpDuelWithBrowserData(aliasedYdk, pvpVisibleBattleFixtureYdk, "pvp-browser-alias-script", 1, {
      cardDataCache,
      luaScriptCache,
    });

    expect(cardBatches).toEqual([["90000021"]]);
    expect(scriptBatches).toEqual([["c7084129.lua", "c90000020.lua", "c90000021.lua"]]);
    expect(result.cardPreload).toEqual({ loaded: ["7084129", "90000021"], missing: [] });
    expect(result.scriptPreload).toEqual({ loaded: ["c90000020.lua"], missing: ["c7084129.lua", "c90000021.lua"] });
    expect(result.scriptLoads).toContainEqual({ ok: true, name: "c90000021.lua" });
    expect(result.scriptRegistrations).toContainEqual(expect.objectContaining({ code: "90000021", ok: true }));
    expect(result.luaHost.messages).toContain("browser alias script 90000021");
  });

  it("bootstraps browser assets against exported endpoint paths with manifests", async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url === "/card-data/cdb-rows.json?codes=90000003") {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              datas: [{ id: 90000003, type: 1, atk: 2400 }],
              texts: [{ id: 90000003, name: "Endpoint Duelist" }],
            };
          },
          async text() { return ""; },
        } as Response;
      }
      if (url === "/card-data/manifest.json") {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              schemaVersion: 1,
              kind: "browser-cdb-rows",
              payload: "cdb-rows.json",
              selectedCodes: ["90000003"],
              datasRows: 1,
              textsRows: 1,
              sha256: cardManifestHash,
            };
          },
          async text() { return ""; },
        } as Response;
      }
      if (url === "/card-scripts/c90000003.lua") {
        return {
          ok: true,
          status: 200,
          async text() {
            return `
              c90000003={}
              function c90000003.initial_effect(c)
                Debug.Message("endpoint script " .. c:GetAttack())
              end
            `;
          },
          async json() { return {}; },
        } as Response;
      }
      if (url === "/card-scripts/manifest.json") {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              schemaVersion: 1,
              kind: "browser-lua-scripts",
              selectedCodes: ["90000003"],
              copiedCount: 1,
              missingCount: 0,
              sourceCounts: { "upstream-official": 1 },
              fallbackKindCounts: {},
              copied: ["c90000003.lua"],
              missing: [],
              files: [{ name: "c90000003.lua", source: "upstream-official", bytes: 91, sha256: scriptManifestHash }],
            };
          },
          async text() { return ""; },
        } as Response;
      }
      return { ok: false, status: 404, async text() { return ""; }, async json() { return {}; } } as Response;
    }) as typeof fetch;
    try {
      const caches = createBrowserPvpAssetCaches({
        cardRowsEndpoint: "/card-data/cdb-rows.json",
        scriptBaseUrl: "/card-scripts",
      });

      const result = await bootstrapPvpDuelWithBrowserAssets(lazyLoadedYdk, pvpVisibleBattleFixtureYdk, "pvp-exported-endpoints", 1, caches);

      expect(requestedUrls).toEqual([
        "/card-data/manifest.json",
        "/card-scripts/manifest.json",
        "/card-data/cdb-rows.json?codes=90000003",
        "/card-scripts/c7084129.lua",
        "/card-scripts/c90000003.lua",
      ]);
      expect(result.cardDataManifest).toMatchObject({ kind: "browser-cdb-rows", datasRows: 1, textsRows: 1, sha256: cardManifestHash });
      expect(result.luaScriptManifest).toMatchObject({ kind: "browser-lua-scripts", copiedCount: 1, sourceCounts: { "upstream-official": 1 }, files: [{ name: "c90000003.lua", source: "upstream-official", bytes: 91, sha256: scriptManifestHash }] });
      expect(result.cardPreload).toEqual({ loaded: ["7084129", "90000003"], missing: [] });
      expect(result.scriptPreload).toEqual({ loaded: ["c90000003.lua"], missing: ["c7084129.lua"] });
      expect(result.luaHost.messages).toContain("endpoint script 2400");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects browser asset bootstrap before payload fetches when manifests are unavailable", async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url === "/card-data/manifest.json") {
        return { ok: false, status: 503, async json() { return {}; }, async text() { return ""; } } as Response;
      }
      if (url === "/card-scripts/manifest.json") {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              schemaVersion: 1,
              kind: "browser-lua-scripts",
              selectedCodes: [],
              copiedCount: 0,
              missingCount: 0,
              sourceCounts: {},
              fallbackKindCounts: {},
              copied: [],
              missing: [],
              files: [],
            };
          },
          async text() { return ""; },
        } as Response;
      }
      return { ok: true, status: 200, async text() { return ""; }, async json() { return { datas: [], texts: [] }; } } as Response;
    }) as typeof fetch;
    try {
      const caches = createBrowserPvpAssetCaches({
        cardRowsEndpoint: "/card-data/cdb-rows.json",
        scriptBaseUrl: "/card-scripts",
      });

      await expect(bootstrapPvpDuelWithBrowserAssets(lazyLoadedYdk, pvpVisibleBattleFixtureYdk, "pvp-missing-manifest", 1, caches))
        .rejects.toThrow("CDB rows manifest fetch failed with HTTP 503");
      expect(requestedUrls).toEqual([
        "/card-data/manifest.json",
        "/card-scripts/manifest.json",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
