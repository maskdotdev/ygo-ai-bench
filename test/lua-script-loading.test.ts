import { describe, expect, it } from "vitest";
import { createDuel } from "#duel/core.js";
import { createLuaScriptHost, type LuaScriptSource } from "#lua/host.js";

describe("Lua script loading", () => {
  it("lets Lua scripts load other configured scripts once unless forced", () => {
    const session = createDuel({ seed: 91, startingHandSize: 0 });
    const scripts = new Map<string, string>([
      [
        "helper.lua",
        `
        loaded_count=(loaded_count or 0)+1
        Debug.Message("loaded helper " .. loaded_count)
        `,
      ],
    ]);
    const source: LuaScriptSource = {
      readScript(name) {
        return scripts.get(name);
      },
    };
    const host = createLuaScriptHost(session, source);
    const result = host.loadScript(
      `
      Debug.Message("load first " .. tostring(Duel.LoadScript("helper.lua")))
      Debug.Message("load duplicate " .. tostring(Duel.LoadScript("helper.lua")))
      Debug.Message("load forced " .. tostring(Duel.LoadScript("helper.lua", true)))
      Debug.Message("load missing " .. tostring(Duel.LoadScript("missing.lua")))
      `,
      "main.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["loaded helper 1", "load first true", "load duplicate true", "loaded helper 2", "load forced true", "load missing false"]);
    expect(host.getGlobalNumber("loaded_count")).toBe(2);
  });

  it("lets Lua scripts load card scripts by code or filename", () => {
    const session = createDuel({ seed: 92, startingHandSize: 0 });
    const scripts = new Map<string, string>([
      ["c100.lua", "c100={loaded=true}; Debug.Message('loaded c100')"],
      ["c200.lua", "c200={loaded=true}; Debug.Message('loaded c200')"],
    ]);
    const source: LuaScriptSource = {
      readScript(name) {
        return scripts.get(name);
      },
    };
    const host = createLuaScriptHost(session, source);
    const result = host.loadScript(
      `
      local first=Duel.LoadCardScript(100)
      Duel.LoadCardScript("c100.lua")
      local second=Duel.LoadCardScript("200")
      Duel.LoadCardScript("missing.lua")
      Debug.Message("card scripts " .. tostring(c100.loaded) .. "/" .. tostring(c200.loaded) .. "/" .. tostring(first.loaded) .. "/" .. tostring(second.loaded))
      `,
      "main-card-loader.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["loaded c100", "loaded c200", "card scripts true/true/true/true"]);
  });

  it("lets Lua card scripts alias their current script table to another card script", () => {
    const session = createDuel({ seed: 93, startingHandSize: 0 });
    const scripts = new Map<string, string>([
      ["c100.lua", "c100={aliased=true}; Debug.Message('loaded alias source')"],
      ["c999.lua", "Duel.LoadCardScriptAlias(100); Debug.Message('loaded alias wrapper')"],
    ]);
    const source: LuaScriptSource = {
      readScript(name) {
        return scripts.get(name);
      },
    };
    const host = createLuaScriptHost(session, source);
    const result = host.loadScript(
      `
      Duel.LoadCardScript(999)
      Debug.Message("alias tables " .. tostring(c999.aliased) .. "/" .. tostring(c100.aliased) .. "/" .. tostring(c999==c100))
      `,
      "main-card-alias-loader.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["loaded alias source", "loaded alias wrapper", "alias tables true/true/true"]);
  });
});
