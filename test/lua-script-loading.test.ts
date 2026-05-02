import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost, type LuaScriptSource } from "#lua/host.js";

describe("Lua script loading", () => {
  it("runs startup effects during the Lua deck probe CLI", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "probe-startup-"));
    const deckPath = path.join(root, "startup.ydk");
    const scriptRoot = path.join(root, "script");
    fs.mkdirSync(scriptRoot, { recursive: true });
    fs.writeFileSync(deckPath, "#main\n100\n#extra\n!side\n");
    fs.writeFileSync(
      path.join(scriptRoot, "c100.lua"),
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EVENT_STARTUP)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp) Debug.Message("startup probe " .. tostring(Duel.CheckEvent(EVENT_STARTUP))) end)
        c:RegisterEffect(e)
      end
      `,
    );

    const output = execFileSync("node", ["--experimental-transform-types", "tools/probe-lua-deck.ts", deckPath, "--upstream", root], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(output).toContain("Registered initial_effect calls: 1");
    expect(output).toContain("Startup effects executed: 1");
    expect(output).toContain("First failing API/helper: none detected");
  });

  it("lets Lua scripts extend unofficial race and attribute masks", () => {
    const session = createDuel({ seed: 155, startingHandSize: 0 });
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      RACE_ALL=0x3
      ATTRIBUTE_ALL=0x5
      Duel.EnableUnofficialRace(0x40)
      Duel.EnableUnofficialAttribute(0x80)
      Debug.Message("unofficial masks " .. RACE_ALL .. "/" .. ATTRIBUTE_ALL)
      `,
      "unofficial-masks.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["unofficial masks 67/133"]);
    expect(host.getGlobalNumber("RACE_ALL")).toBe(0x43);
    expect(host.getGlobalNumber("ATTRIBUTE_ALL")).toBe(0x85);
  });

  it("installs standard Project Ignis race constants", () => {
    const session = createDuel({ seed: 156, startingHandSize: 0 });
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("races " .. RACE_FIEND .. "/" .. RACE_ZOMBIE .. "/" .. RACE_DINOSAUR .. "/" .. RACE_CYBERSE .. "/" .. RACE_ILLUSION)
      `,
      "standard-races.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["races 8/16/65536/16777216/33554432"]);
  });

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

  it("supports Project Ignis GetID card script bindings", () => {
    const session = createDuel({
      seed: 95,
      startingHandSize: 1,
      cardReader: createCardReader([{ code: "100", name: "GetID Probe", kind: "monster" }]),
    });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local s,id=GetID()
      function s.initial_effect(c)
        Debug.Message("getid " .. id .. "/" .. tostring(s==c100))
      end
      `,
      "c100.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(host.messages).toContain("getid 100/true");
  });

  it("formats Lua table errors with their fields and traceback", () => {
    const session = createDuel({
      seed: 96,
      startingHandSize: 1,
      cardReader: createCardReader([{ code: "100", name: "Error Probe", kind: "monster" }]),
    });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local s,id=GetID()
      function s.initial_effect(c)
        error({api="Missing.Helper", detail={card=id}})
      end
      `,
      "c100.lua",
    );

    expect(result.ok, result.error).toBe(true);
    const registration = host.registerInitialEffectsDetailed()[0]!;

    expect(registration.ok).toBe(false);
    expect(registration.error).toContain("api=Missing.Helper");
    expect(registration.error).toContain("card=100");
    expect(registration.error).toContain("stack traceback");
  });

  it("exposes newer Project Ignis timing constants and card procedure methods", () => {
    const session = createDuel({
      seed: 97,
      startingHandSize: 1,
      cardReader: createCardReader([{ code: "100", name: "Procedure Probe", kind: "monster" }]),
    });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local s,id=GetID()
      function s.initial_effect(c)
        Debug.Message("timing " .. TIMINGS_CHECK_MONSTER_E .. "/" .. TIMING_SUMMON)
        c:SetSPSummonOnce(id)
      end
      `,
      "c100.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(host.messages).toContain("timing 480/64");
  });

  it("supports Project Ignis reveal cost helpers", () => {
    const session = createDuel({
      seed: 99,
      startingHandSize: 1,
      cardReader: createCardReader([
        { code: "100", name: "Reveal Source", kind: "monster" },
        { code: "200", name: "Reveal Extra", kind: "extra" },
      ]),
    });
    loadDecks(session, {
      0: { main: ["100"], extra: ["200"] },
      1: { main: [] },
    });
    startDuel(session);
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local s,id=GetID()
      function s.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetCost(Cost.Reveal(function(tc) return tc:IsCode(200) end,nil,1,1,function(e,tp,g)
          Debug.Message("revealed " .. g:GetCount() .. "/" .. g:GetFirst():GetCode())
        end,LOCATION_EXTRA))
        c:RegisterEffect(e)
      end
      `,
      "c100.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const action = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);
    expect(host.messages).toContain("revealed 1/200");
  });

  it("does not expose range-less monster setup effects from the deck as activations", () => {
    const session = createDuel({
      seed: 98,
      startingHandSize: 0,
      cardReader: createCardReader([{ code: "100", name: "Setup Probe", kind: "monster" }]),
    });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local s,id=GetID()
      function s.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        c:RegisterEffect(e)
        local e2=Effect.CreateEffect(c)
        e2:SetType(EFFECT_TYPE_IGNITION)
        c:RegisterEffect(e2)
      end
      `,
      "c100.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(getLegalActions(session, 0).some((action) => action.type === "activateEffect")).toBe(false);
  });

  it("lets Lua scripts read card script metatables", () => {
    const session = createDuel({
      seed: 94,
      startingHandSize: 1,
      cardReader: createCardReader([{ code: "100", name: "Metatable Probe", kind: "monster" }]),
    });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={material={200}}
      local c=Duel.SelectMatchingCard(0, aux.TRUE, 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local card_mt=c:GetMetatable()
      local current_mt=c:GetMetatable(true)
      local duel_mt=Duel.GetMetatable(100)
      local missing_mt=Duel.GetMetatable(200)
      missing_mt.created=true
      Debug.Message("metatable material " .. card_mt.material[1] .. "/" .. current_mt.material[1] .. "/" .. duel_mt.material[1])
      Debug.Message("metatable identity " .. tostring(card_mt==c100) .. "/" .. tostring(duel_mt==c100) .. "/" .. tostring(c200.created))
      `,
      "script-metatable.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("metatable material 200/200/200");
    expect(host.messages).toContain("metatable identity true/true/true");
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
