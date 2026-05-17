import { describe, expect, it } from "vitest";
import { createDuel, loadDecks } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { createBrowserLuaScriptCache, createBrowserLuaScriptFetchLoader, createBrowserLuaScriptManifestLoader } from "../src/playtest-app/duel-pvp-script-cache.js";

describe("browser PvP Lua script cache", () => {
  const manifestHash = "b".repeat(64);

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

  it("fetches requested Lua scripts from browser script URLs", async () => {
    const requestedUrls: string[] = [];
    const loader = createBrowserLuaScriptFetchLoader({
      baseUrl: "/card-scripts",
      fetchText: async (url) => {
        requestedUrls.push(url);
        if (url.endsWith("c90000013.lua")) {
          return { ok: true, status: 200, async text() { return "c90000013={}"; } };
        }
        return { ok: false, status: 404, async text() { return ""; } };
      },
    });
    const cache = createBrowserLuaScriptCache(loader);

    const preload = await cache.preloadCardScripts(["90000013", "90000014", "90000013"]);

    expect(requestedUrls).toEqual(["/card-scripts/c90000013.lua", "/card-scripts/c90000014.lua"]);
    expect(preload).toEqual({ loaded: ["c90000013.lua"], missing: ["c90000014.lua"] });
    expect(cache.readScript("c90000013.lua")).toBe("c90000013={}");
  });

  it("loads browser Lua script sidecar manifests from the script base URL", async () => {
    const requestedUrls: string[] = [];
    const loadManifest = createBrowserLuaScriptManifestLoader({
      baseUrl: "/card-scripts",
      fetchJson: async (url) => {
        requestedUrls.push(url);
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              schemaVersion: 1,
              kind: "browser-lua-scripts",
              selectedCodes: ["90000015"],
              copiedCount: 1,
              missingCount: 0,
              sourceCounts: { "upstream-official": 1 },
              fallbackKindCounts: {},
              copied: ["c90000015.lua"],
              missing: [],
              files: [{ name: "c90000015.lua", source: "upstream-official", bytes: 16, sha256: manifestHash }],
            };
          },
        };
      },
    });

    await expect(loadManifest()).resolves.toEqual({
      schemaVersion: 1,
      kind: "browser-lua-scripts",
      selectedCodes: ["90000015"],
      copiedCount: 1,
      missingCount: 0,
      sourceCounts: { "upstream-official": 1 },
      fallbackKindCounts: {},
      copied: ["c90000015.lua"],
      missing: [],
      files: [{ name: "c90000015.lua", source: "upstream-official", bytes: 16, sha256: manifestHash }],
    });
    expect(requestedUrls).toEqual(["/card-scripts/manifest.json"]);
  });

  it("rejects inconsistent browser Lua script sidecar manifest counts", async () => {
    const loadManifest = createBrowserLuaScriptManifestLoader({
      baseUrl: "/card-scripts",
      fetchJson: async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            schemaVersion: 1,
            kind: "browser-lua-scripts",
            selectedCodes: [],
            copiedCount: 2,
            missingCount: 0,
            sourceCounts: { "upstream-official": 1 },
            fallbackKindCounts: {},
            copied: ["c90000016.lua"],
            missing: [],
            files: [{ name: "c90000016.lua", source: "upstream-official", bytes: 16, sha256: manifestHash }],
          };
        },
      }),
    });

    await expect(loadManifest()).rejects.toThrow("Lua script manifest must describe browser-lua-scripts payload metadata");
  });

  it("rejects browser Lua script sidecar manifests with stale source tallies", async () => {
    const loadManifest = createBrowserLuaScriptManifestLoader({
      baseUrl: "/card-scripts",
      fetchJson: async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            schemaVersion: 1,
            kind: "browser-lua-scripts",
            selectedCodes: ["90000017", "90000018", "90000019"],
            copiedCount: 3,
            missingCount: 0,
            sourceCounts: { "upstream-official": 1, "local-override": 2 },
            fallbackKindCounts: {},
            copied: ["c90000017.lua", "c90000018.lua", "c90000019.lua"],
            missing: [],
            files: [
              { name: "c90000017.lua", source: "upstream-official", bytes: 16, sha256: manifestHash },
              { name: "c90000018.lua", source: "local-override", bytes: 16, sha256: manifestHash },
              { name: "c90000019.lua", source: "upstream-official", bytes: 16, sha256: manifestHash },
            ],
          };
        },
      }),
    });

    await expect(loadManifest()).rejects.toThrow("Lua script manifest must describe browser-lua-scripts payload metadata");
  });
});
