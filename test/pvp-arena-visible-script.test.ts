import { describe, expect, it } from "vitest";
import {
  bootstrapPvpDuel,
  bootstrapPvpDuelWithBrowserData,
  bootstrapPvpDuelWithCardData,
  bootstrapPvpDuelWithLuaScripts,
  pvpVisibleBattleFixtureScript,
  pvpVisibleBattleFixtureYdk,
  runPvpArenaVisibleScript,
} from "../src/playtest-app/pvp-arena.js";
import { createBrowserDuelCardDataCache } from "../src/playtest-app/duel-pvp-card-reader.js";
import { createBrowserLuaScriptCache } from "../src/playtest-app/duel-pvp-script-cache.js";

const lazyLoadedYdk = `#created by test
#main
90000003
#extra
!side`;

describe("PvP arena visible scripts", () => {
  it("drives the browser arena fixture through visible actions", () => {
    const session = bootstrapPvpDuel(pvpVisibleBattleFixtureYdk, pvpVisibleBattleFixtureYdk, "pvp-arena-visible-script", 1);

    const result = runPvpArenaVisibleScript(session, pvpVisibleBattleFixtureScript);

    expect(result.ok).toBe(true);
    expect(result.failedStep).toBeUndefined();
    expect(result.state.attacksDeclared).toHaveLength(1);
    expect(result.state.log).toContainEqual(expect.objectContaining({ action: "attack", card: "Magician's Rod", detail: "Direct attack" }));
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
});
