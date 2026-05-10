import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, startDuel } from "#duel/core.js";
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

  it("installs newer Project Ignis race and event constants used by real scripts", () => {
    const session = createDuel({ seed: 158, startingHandSize: 0 });
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("rush races " .. RACE_CYBORG .. "/" .. RACE_HIGHDRAGON .. "/" .. RACE_GALAXY .. "/" .. RACES_BEAST_BWARRIOR_WINGB)
      Debug.Message("event constants " .. EVENT_LEAVE_GRAVE .. "/" .. EVENT_DAMAGE_CALCULATING .. "/" .. EVENT_BATTLE_END .. "/" .. EVENT_CONFIRM .. "/" .. EVENT_TOHAND_CONFIRM)
      Debug.Message("counter constants " .. COUNTER_NEED_ENABLE .. "/" .. EFFECT_COUNTER_PERMIT .. "/" .. EFFECT_COUNTER_LIMIT .. "/" .. EFFECT_RCOUNTER_REPLACE .. "/" .. SUMMON_TYPE_MAXIMUM)
      `,
      "newer-race-event-constants.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual([
      "rush races 67108864/268435456/-2147483648/49664",
      "event constants 1031/1135/1137/1211/1212",
      "counter constants 8192/65536/131072/196608/1308622848",
    ]);
  });

  it("installs common Project Ignis aggregate constants", () => {
    const session = createDuel({ seed: 157, startingHandSize: 0 });
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("positions " .. POS_ATTACK .. "/" .. POS_DEFENSE .. "/" .. POS_FACEDOWN .. "/" .. ZONE_CENTER_MMZ .. "/" .. NO_FLIP_EFFECT)
      Debug.Message("types " .. TYPE_TOKEN .. "/" .. TYPE_QUICKPLAY .. "/" .. TYPE_COUNTER .. "/" .. TYPE_FLIP .. "/" .. TYPE_TOON .. "/" .. TYPE_EXTRA)
      Debug.Message("aggregate " .. ATTRIBUTE_ALL .. "/" .. TYPES_TOKEN .. "/" .. PLAYER_EITHER .. "/" .. PLAYER_SELFDES .. "/" .. REASON_RDAMAGE .. "/" .. REASON_RRECOVER)
      `,
      "standard-aggregate-constants.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual([
      "positions 3/12/10/4/65536",
      "types 16384/65536/1048576/2097152/4194304/75505728",
      "aggregate 127/16401/4/5/32768/65536",
    ]);
  });

  it("installs newer Project Ignis effect flag and marker constants", () => {
    const session = createDuel({ seed: 160, startingHandSize: 0 });
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("flag2 constants " .. EFFECT_FLAG2_CONTINUOUS_EQUIP .. "/" .. EFFECT_FLAG2_CHECK_SIMULTANEOUS .. "/" .. EFFECT_FLAG2_FORCE_ACTIVATE_LOCATION .. "/" .. EFFECT_FLAG2_MAJESTIC_MUST_COPY)
      Debug.Message("reset chain bitwise " .. tostring((RESET_EVENT|RESETS_STANDARD|RESET_CHAIN)&RESET_CHAIN ~= 0))
      Debug.Message("link marker constants " .. EFFECT_CHANGE_LINKMARKER .. "/" .. EFFECT_FORCE_NORMAL_SUMMON_POSITION .. "/" .. EFFECT_FORCE_SPSUMMON_POSITION .. "/" .. EFFECT_DARKNESS_HIDE .. "/" .. EFFECT_NORMAL_SUMMON_FACEUP_DEFENSE)
      `,
      "newer-effect-constants.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual([
      "flag2 constants 1/4/1073741824/-2147483648",
      "reset chain bitwise true",
      "link marker constants 425/426/427/428/429",
    ]);
  });

  it("installs Project Ignis hint, select, declaration, and opcode constants", () => {
    const session = createDuel({ seed: 161, startingHandSize: 0 });
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("hint constants " .. HINT_EVENT .. "/" .. HINT_EFFECT .. "/" .. HINT_RACE .. "/" .. HINT_ATTRIB .. "/" .. HINT_CODE .. "/" .. HINT_SKILL_REMOVE)
      Debug.Message("card hint constants " .. CHINT_TURN .. "/" .. CHINT_ATTRIBUTE .. "/" .. CHINT_DESC_REMOVE .. "/" .. PHINT_DESC_ADD .. "/" .. PHINT_DESC_REMOVE)
      Debug.Message("select constants " .. SELECT_HEADS .. "/" .. SELECT_TAILS .. "/" .. DECLTYPE_MONSTER .. "/" .. DECLTYPE_SPELL .. "/" .. DECLTYPE_TRAP .. "/" .. EFFECT_COUNT_CODE_CHAIN)
      Debug.Message("opcode available " .. tostring(OPCODE_ADD ~= nil) .. "/" .. tostring(OPCODE_ISCODE ~= nil) .. "/" .. tostring(OPCODE_GETATTRIBUTE ~= nil))
      `,
      "hint-opcode-constants.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual([
      "hint constants 1/5/6/7/8/203",
      "card hint constants 1/4/7/6/7",
      "select constants 60/61/70/71/72/8",
      "opcode available true/true/true",
    ]);
  });

  it("installs Project Ignis procedure, duel-mode, and material constants", () => {
    const session = createDuel({ seed: 162, startingHandSize: 0 });
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("procedure constants " .. EFFECT_TUNER_MATERIAL_LIMIT .. "/" .. FUSPROC_CONTACTFUS .. "/" .. FUSPROC_CANCELABLE .. "/" .. RITPROC_EQUAL .. "/" .. RITPROC_GREATER)
      Debug.Message("restriction constants " .. EFFECT_FUSION_MAT_RESTRICTION .. "/" .. EFFECT_SYNCHRO_MAT_RESTRICTION .. "/" .. EFFECT_XYZ_MAT_RESTRICTION .. "/" .. EFFECT_SYNCHRO_MAT_FROM_HAND .. "/" .. EFFECT_XYZ_MAT_FROM_GRAVE)
      Debug.Message("duel mode constants " .. DUEL_MODE_SPEED .. "/" .. DUEL_MODE_MR1 .. "/" .. DUEL_MODE_MR5 .. "/" .. DUEL_OBSOLETE_RULING .. "/" .. ACTIVITY_BATTLE_PHASE .. "/" .. ANNOUNCE_CARD .. "/" .. ANNOUNCE_CARD_FILTER)
      Debug.Message("material constants available " .. tostring(MATERIAL_FUSION ~= nil) .. "/" .. tostring(MATERIAL_SYNCHRO ~= nil) .. "/" .. tostring(MATERIAL_XYZ ~= nil) .. "/" .. tostring(MATERIAL_LINK ~= nil))
      `,
      "procedure-mode-material-constants.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual([
      "procedure constants 353/512/4096/1/2",
      "restriction constants 73941556/73949684/82330100/97682931/511002793",
      "duel mode constants 6422528/853760/190464/853760/6/7/8",
      "material constants available true/true/true/true",
    ]);
  });

  it("installs Project Ignis hardcoded effect marker constants", () => {
    const session = createDuel({ seed: 163, startingHandSize: 0 });
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      Debug.Message("hardcoded effects " .. EFFECT_CAN_BE_TUNER .. "/" .. EFFECT_CLEAR_WALL .. "/" .. EFFECT_CYBERDARK_WORLD .. "/" .. EFFECT_WITCHCRAFTER_REPLACE)
      Debug.Message("effect markers " .. EFFECT_MARKER_DETACH_XMAT .. "/" .. EFFECT_MARKER_CARDIAN .. "/" .. EFFECT_MARKER_DRAGON_RULER)
      Debug.Message("register marker aliases " .. REGISTER_FLAG_DETACH_XMAT .. "/" .. REGISTER_FLAG_CARDIAN .. "/" .. REGISTER_FLAG_DRAGON_RULER)
      `,
      "hardcoded-effect-marker-constants.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual([
      "hardcoded effects 30765615/6089145/64753988/83289866",
      "effect markers 511002571/511001692/4965193",
      "register marker aliases 511002571/511001692/4965193",
    ]);
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
    const response = applyResponse(session, action!);
    expect(response.ok).toBe(true);
    expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
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
