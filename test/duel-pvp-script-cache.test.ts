import { describe, expect, it } from "vitest";
import { createDuel, loadDecks } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { createBrowserLuaScriptCache } from "../src/playtest-app/duel-pvp-script-cache.js";

describe("browser PvP Lua script cache", () => {
  it("preloads only missing card scripts and exposes a synchronous Lua source", async () => {
    const requestedBatches: string[][] = [];
    const cache = createBrowserLuaScriptCache(async (names) => {
      requestedBatches.push([...names]);
      return {
        "c90000011.lua": `
          c90000011={}
          function c90000011.initial_effect(c)
            Debug.Message("loaded script " .. c:GetCode())
          end
        `,
      };
    });

    const first = await cache.preloadCardScripts(["90000011", "90000011", "90000012"]);

    expect(requestedBatches).toEqual([["c90000011.lua", "c90000012.lua"]]);
    expect(first).toEqual({ loaded: ["c90000011.lua"], missing: ["c90000012.lua"] });
    expect(cache.readScript("c90000011.lua")).toContain("loaded script");
    expect(cache.readScript("c90000012.lua")).toBeUndefined();

    const second = await cache.preloadCardScripts(["90000011", "90000012"]);

    expect(requestedBatches).toEqual([["c90000011.lua", "c90000012.lua"], ["c90000012.lua"]]);
    expect(second).toEqual({ loaded: ["c90000011.lua"], missing: ["c90000012.lua"] });
    expect(cache.missingScriptNames(["c90000011.lua", "c90000012.lua"])).toEqual(["c90000012.lua"]);
  });

  it("feeds preloaded script text into the Lua host", async () => {
    const cache = createBrowserLuaScriptCache(async () => ({
      "c90000011.lua": `
        c90000011={}
        function c90000011.initial_effect(c)
          Debug.Message("browser script " .. c:GetCode())
        end
      `,
    }));
    await cache.preloadCardScripts(["90000011"]);
    const session = createDuel({
      seed: 411,
      startingHandSize: 0,
      cardReader: createCardReader([{ code: "90000011", name: "Browser Scripted Monster", kind: "monster" }]),
    });
    loadDecks(session, { 0: { main: ["90000011"] }, 1: { main: [] } });

    const host = createLuaScriptHost(session, cache);
    const loaded = host.loadCardScript("90000011", cache);
    const registered = host.registerInitialEffectsDetailed();

    expect(loaded).toEqual({ ok: true, name: "c90000011.lua" });
    expect(registered).toContainEqual(expect.objectContaining({ code: "90000011", ok: true }));
    expect(host.messages).toContain("browser script 90000011");
  });
});
