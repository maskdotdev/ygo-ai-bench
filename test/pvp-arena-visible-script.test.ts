import { describe, expect, it } from "vitest";
import {
  bootstrapPvpDuel,
  bootstrapPvpDuelWithBrowserAssets,
  bootstrapPvpDuelWithBrowserData,
  bootstrapPvpDuelWithCardData,
  bootstrapPvpDuelWithLuaScripts,
  createBrowserPvpAssetCaches,
  applyPvpAction,
  pvpVisibleBattleFixtureScript,
  pvpVisibleBattleFixtureYdk,
  runPvpArenaVisibleScript,
  runPvpArenaVisibleScriptStep,
  summarizeBrowserPvpBoot,
} from "../src/playtest-app/pvp-arena.js";
import { createBrowserDuelCardDataCache } from "../src/playtest-app/duel-pvp-card-reader.js";
import { createBrowserLuaScriptCache } from "../src/playtest-app/duel-pvp-script-cache.js";
import { applyResponse, getLegalActions } from "../src/engine/duel/core.js";

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

    expect(requestedBatches).toEqual([["7084129", "90000003"]]);
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

  it("uses Lua script listed_names metadata so Magician's Rod can search after summon", async () => {
    const ydk = `#created by test
#main
7084129
47222536
46986414
#extra
!side`;
    const cardCache = createBrowserDuelCardDataCache(async () => [
      { code: "47222536", name: "Dark Magical Circle", kind: "spell", typeFlags: 0x20002 },
      { code: "46986414", name: "Dark Magician", kind: "monster", typeFlags: 0x11 },
    ]);
    const scriptCache = createBrowserLuaScriptCache(async (names) => Object.fromEntries(names.map((name) => [name, ({
      "c47222536.lua": `
        local s,id=GetID()
        s.listed_names={CARD_DARK_MAGICIAN}
      `,
      "c7084129.lua": `
        local s,id=GetID()
        function s.initial_effect(c)
          local e1=Effect.CreateEffect(c)
          e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)
          e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_O)
          e1:SetCode(EVENT_SUMMON_SUCCESS)
          e1:SetCountLimit(1,id)
          e1:SetTarget(s.thtg)
          e1:SetOperation(s.thop)
          c:RegisterEffect(e1)
        end
        s.listed_names={CARD_DARK_MAGICIAN}
        function s.thfilter(c)
          return c:ListsCode(CARD_DARK_MAGICIAN) and c:IsSpellTrap() and c:IsAbleToHand()
        end
        function s.thtg(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return Duel.IsExistingMatchingCard(s.thfilter,tp,LOCATION_DECK,0,1,nil) end
          Duel.SetOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)
        end
        function s.thop(e,tp,eg,ep,ev,re,r,rp)
          local g=Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)
          if #g>0 then Duel.SendtoHand(g,nil,REASON_EFFECT) end
        end
      `,
    } as Record<string, string | undefined>)[name]])));

    const result = await bootstrapPvpDuelWithBrowserData(ydk, ydk, "rod-search", 1, {
      cardDataCache: cardCache,
      luaScriptCache: scriptCache,
    });
    const summon = getLegalActions(result.session, 0).find((action) => action.type === "normalSummon" && action.uid.includes("7084129"));
    expect(summon).toBeDefined();
    expect(applyResponse(result.session, summon).ok).toBe(true);
    const trigger = getLegalActions(result.session, 0).find((action) => action.type === "activateTrigger" && action.uid.includes("7084129"));
    expect(trigger).toBeDefined();

    expect(applyResponse(result.session, trigger).ok).toBe(true);

    expect(result.session.state.cards.find((card) => card.code === "47222536" && card.controller === 0)).toMatchObject({
      location: "hand",
    });
  });

  it("surfaces Red-Eyes Fusion as an activatable spell when its Fusion target lists Red-Eyes material", async () => {
    const redEyesFusion = "6172122";
    const redEyesBlackDragon = "74677422";
    const darkMagician = "46986414";
    const dragoon = "37818794";
    const ydk = `#created by test
#main
${redEyesFusion}
${redEyesBlackDragon}
${darkMagician}
#extra
${dragoon}
!side`;
    const cardCache = createBrowserDuelCardDataCache(async () => [
      { code: redEyesFusion, name: "Red-Eyes Fusion", kind: "spell", typeFlags: 0x2, setcodes: [0x3b, 0x46] },
      { code: redEyesBlackDragon, name: "Red-Eyes Black Dragon", kind: "monster", typeFlags: 0x11, setcodes: [0x3b], race: 0x2000 },
      { code: darkMagician, name: "Dark Magician", kind: "monster", typeFlags: 0x11, setcodes: [0x10a2], race: 0x800 },
      { code: dragoon, name: "Red-Eyes Dark Dragoon", kind: "extra", typeFlags: 0x61, setcodes: [0x3b, 0x6e], race: 0x2000 },
    ]);
    const scriptCache = createBrowserLuaScriptCache(async (names) => Object.fromEntries(names.map((name) => [name, ({
      "c6172122.lua": `
        local s,id=GetID()
        function s.initial_effect(c)
          local e1=Fusion.CreateSummonEff({handler=c,fusfilter=aux.FilterBoolFunction(Card.ListsArchetypeAsMaterial,SET_RED_EYES)})
          e1:SetCost(s.cost)
          c:RegisterEffect(e1)
        end
        function s.cost(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return Duel.GetActivityCount(tp,ACTIVITY_SUMMON)==0 and Duel.GetActivityCount(tp,ACTIVITY_SPSUMMON)==0 end
          local e1=Effect.CreateEffect(e:GetHandler())
          e1:SetType(EFFECT_TYPE_FIELD)
          e1:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)
          e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET+EFFECT_FLAG_OATH)
          e1:SetTargetRange(1,0)
          e1:SetReset(RESET_PHASE|PHASE_END)
          e1:SetLabelObject(e)
          e1:SetTarget(s.splimit)
          Duel.RegisterEffect(e1,tp)
        end
        function s.splimit(e,c,sump,sumtype,sumpos,targetp,se)
          return se~=e:GetLabelObject()
        end
      `,
      "c37818794.lua": `
        local s,id=GetID()
        function s.initial_effect(c)
          c:EnableReviveLimit()
          Fusion.AddProcMix(c,true,true,CARD_DARK_MAGICIAN,{CARD_REDEYES_B_DRAGON,s.ffilter})
        end
        s.material={CARD_DARK_MAGICIAN,CARD_REDEYES_B_DRAGON}
        s.material_setcode={SET_RED_EYES,SET_DARK_MAGICIAN}
        function s.ffilter(c,fc,sumtype,tp)
          return c:IsRace(RACE_DRAGON,fc,sumtype,tp) and c:IsType(TYPE_EFFECT,fc,sumtype,tp)
        end
      `,
    } as Record<string, string | undefined>)[name]])));

    const result = await bootstrapPvpDuelWithBrowserData(ydk, ydk, "red-eyes-fusion-activation", 3, {
      cardDataCache: cardCache,
      luaScriptCache: scriptCache,
    });
    const spell = result.session.state.cards.find((card) => card.code === redEyesFusion && card.controller === 0);
    const fusion = result.session.state.cards.find((card) => card.code === dragoon && card.controller === 0);
    const redEyes = result.session.state.cards.find((card) => card.code === redEyesBlackDragon && card.controller === 0);
    const magician = result.session.state.cards.find((card) => card.code === darkMagician && card.controller === 0);

    expect(fusion?.data).toMatchObject({
      fusionMaterials: [darkMagician, redEyesBlackDragon],
      materialSetcodes: [0x3b, 0x10a2],
    });
    const actions = getLegalActions(result.session, 0);
    expect(actions).toContainEqual(expect.objectContaining({ type: "activateEffect", uid: spell?.uid }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: "fusionSummon",
      uid: fusion?.uid,
      materialUids: [magician?.uid, redEyes?.uid],
    }));

    const activate = actions.find((action) => action.type === "activateEffect" && action.uid === spell?.uid);
    expect(activate).toBeDefined();
    expect(applyResponse(result.session, activate!).ok).toBe(true);
    expect(result.session.state.cards.find((card) => card.uid === fusion?.uid)).toMatchObject({
      location: "monsterZone",
      summonType: "fusion",
      summonMaterialUids: [magician?.uid, redEyes?.uid],
    });
    expect(result.session.state.cards.find((card) => card.uid === magician?.uid)).toMatchObject({ location: "graveyard" });
    expect(result.session.state.cards.find((card) => card.uid === redEyes?.uid)).toMatchObject({ location: "graveyard" });
  });

  it("places Field Spells in the Field Zone without consuming normal Spell/Trap slots", async () => {
    const fieldSpell = "90000050";
    const backrow = "90000051";
    const ydk = `#created by test
#main
${fieldSpell}
${backrow}
${backrow}
${backrow}
${backrow}
${backrow}
#extra
!side`;
    const cardCache = createBrowserDuelCardDataCache(async () => [
      { code: fieldSpell, name: "PvP Field Spell", kind: "spell", typeFlags: 0x80002 },
      { code: backrow, name: "PvP Normal Trap", kind: "trap", typeFlags: 0x4 },
    ]);
    const scriptCache = createBrowserLuaScriptCache(async (names) => Object.fromEntries(names.map((name) => [name, name === `c${fieldSpell}.lua` ? `
      local s,id=GetID()
      function s.initial_effect(c)
        local e1=Effect.CreateEffect(c)
        e1:SetType(EFFECT_TYPE_ACTIVATE)
        e1:SetCode(EVENT_FREE_CHAIN)
        c:RegisterEffect(e1)
      end
    ` : undefined])));

    const result = await bootstrapPvpDuelWithBrowserData(ydk, ydk, "field-zone-slot", 6, {
      cardDataCache: cardCache,
      luaScriptCache: scriptCache,
    });
    const field = result.session.state.cards.find((card) => card.code === fieldSpell && card.controller === 0);
    const activate = getLegalActions(result.session, 0).find((action) => action.type === "activateEffect" && action.uid === field?.uid);
    expect(activate).toBeDefined();
    expect(applyResponse(result.session, activate!).ok).toBe(true);

    expect(result.session.state.cards.find((card) => card.uid === field?.uid)).toMatchObject({
      location: "fieldZone",
      sequence: 5,
      faceUp: true,
    });
    expect(result.session.state.cards.filter((card) => card.controller === 0 && card.location === "spellTrapZone")).toHaveLength(0);
    expect(getLegalActions(result.session, 0).filter((action) => action.type === "setSpellTrap" && result.session.state.cards.find((card) => card.uid === action.uid)?.code === backrow)).toHaveLength(5);
  });

  it("surfaces Dark Magical Circle's Lua activation prompt and resolves the search", async () => {
    const ydk = `#created by test
#main
47222536
47222536
47222536
47222536
47222536
47222536
47222536
47222536
47222536
47222536
46986414
46986414
46986414
7084129
7084129
7084129
#extra
!side`;
    const cardCache = createBrowserDuelCardDataCache(async () => [
      { code: "47222536", name: "Dark Magical Circle", kind: "spell", typeFlags: 0x20002 },
      { code: "46986414", name: "Dark Magician", kind: "monster", typeFlags: 0x11, attack: 2500, defense: 2100 },
      { code: "7084129", name: "Magician's Rod", kind: "monster", typeFlags: 0x21, attack: 1600, defense: 100 },
    ]);
    const scriptCache = createBrowserLuaScriptCache(async (names) => Object.fromEntries(names.map((name) => [name, ({
      "c47222536.lua": `
        local s,id=GetID()
        function s.initial_effect(c)
          local e1=Effect.CreateEffect(c)
          e1:SetCategory(CATEGORY_TOHAND+CATEGORY_SEARCH)
          e1:SetType(EFFECT_TYPE_ACTIVATE)
          e1:SetCode(EVENT_FREE_CHAIN)
          e1:SetCountLimit(1,id)
          e1:SetTarget(s.target)
          e1:SetOperation(s.activate)
          c:RegisterEffect(e1)
        end
        s.listed_names={CARD_DARK_MAGICIAN}
        function s.target(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return Duel.GetFieldGroupCount(tp,LOCATION_DECK,0)>2 end
          Duel.SetPossibleOperationInfo(0,CATEGORY_TOHAND,nil,1,tp,LOCATION_DECK)
        end
        function s.filter(c)
          return ((c:ListsCode(CARD_DARK_MAGICIAN) and c:IsSpellTrap()) or c:IsCode(CARD_DARK_MAGICIAN)) and c:IsAbleToHand()
        end
        function s.activate(e,tp,eg,ep,ev,re,r,rp)
          if Duel.GetFieldGroupCount(tp,LOCATION_DECK,0)<3 then return end
          local g=Duel.GetDecktopGroup(tp,3)
          Duel.ConfirmCards(tp,g)
          if g:IsExists(s.filter,1,nil) and Duel.SelectYesNo(tp,aux.Stringid(id,0)) then
            Duel.Hint(HINT_SELECTMSG,tp,HINTMSG_ATOHAND)
            local sg=g:FilterSelect(tp,s.filter,1,1,nil)
            Duel.SendtoHand(sg,nil,REASON_EFFECT)
          end
        end
      `,
      "c7084129.lua": "local s,id=GetID() s.listed_names={CARD_DARK_MAGICIAN}",
    } as Record<string, string | undefined>)[name]])));

    const result = await bootstrapPvpDuelWithBrowserData(ydk, ydk, "circle-search", 1, {
      cardDataCache: cardCache,
      luaScriptCache: scriptCache,
    });
    const circle = getLegalActions(result.session, 0).find((action) => action.type === "activateEffect" && action.uid.includes("47222536"));
    expect(circle).toBeDefined();
    const deckCountBefore = result.session.state.cards.filter((card) => card.controller === 0 && card.location === "deck").length;

    const activated = applyPvpAction(result.session, circle!);

    expect(activated.ok).toBe(true);
    expect(activated.state.prompt).toEqual(expect.objectContaining({ type: "selectYesNo", player: 0 }));
    const yes = getLegalActions(result.session, 0).find((action) => action.type === "selectYesNo" && action.yes);
    expect(yes).toBeDefined();

    expect(applyResponse(result.session, yes).ok).toBe(true);
    expect(result.session.state.cards.filter((card) => card.controller === 0 && card.location === "deck")).toHaveLength(deckCountBefore - 1);
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

    expect(cardBatches).toEqual([["7084129", "90000003"]]);
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

    expect(cardBatches).toEqual([["7084129", "90000021"]]);
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
      if (url === "/card-data/cdb-rows.json?codes=7084129,90000003") {
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
        "/card-data/cdb-rows.json?codes=7084129,90000003",
        "/card-scripts/c7084129.lua",
        "/card-scripts/c90000003.lua",
      ]);
      expect(result.cardDataManifest).toMatchObject({ kind: "browser-cdb-rows", datasRows: 1, textsRows: 1, sha256: cardManifestHash });
      expect(result.luaScriptManifest).toMatchObject({ kind: "browser-lua-scripts", copiedCount: 1, sourceCounts: { "upstream-official": 1 }, files: [{ name: "c90000003.lua", source: "upstream-official", bytes: 91, sha256: scriptManifestHash }] });
      expect(result.cardPreload).toEqual({ loaded: ["7084129", "90000003"], missing: [] });
      expect(result.scriptPreload).toEqual({ loaded: ["c90000003.lua"], missing: ["c7084129.lua"] });
      expect(result.luaHost.messages).toContain("endpoint script 2400");
      expect(summarizeBrowserPvpBoot(result)).toEqual({
        detail: "Browser data loaded (2 cards, 1 scripts; missing 0/1; registration failures 0; manifests 1/1).",
        message: "Browser data loaded (2 cards, 1 scripts; missing 0/1; registration failures 0; manifests 1/1). Missing scripts: c7084129.lua.",
        missingCards: [],
        missingScripts: ["c7084129.lua"],
        registrationFailures: [],
        tone: "warning",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("reports browser asset boot as successful when exported card data and scripts are complete", async () => {
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
              datas: [{ id: 90000003, type: 1, atk: 2500 }],
              texts: [{ id: 90000003, name: "Complete Endpoint Duelist" }],
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
                Debug.Message("complete endpoint script " .. c:GetAttack())
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

      const result = await bootstrapPvpDuelWithBrowserAssets(lazyLoadedYdk, lazyLoadedYdk, "pvp-complete-exported-endpoints", 1, caches);

      expect(requestedUrls).toEqual([
        "/card-data/manifest.json",
        "/card-scripts/manifest.json",
        "/card-data/cdb-rows.json?codes=90000003",
        "/card-scripts/c90000003.lua",
      ]);
      expect(result.cardPreload).toEqual({ loaded: ["90000003"], missing: [] });
      expect(result.scriptPreload).toEqual({ loaded: ["c90000003.lua"], missing: [] });
      expect(result.scriptRegistrations.filter((registration) => registration.ok && !registration.skipped)).toHaveLength(2);
      expect(result.luaHost.messages).toEqual([
        "complete endpoint script 2500",
        "complete endpoint script 2500",
      ]);
      expect(summarizeBrowserPvpBoot(result)).toEqual({
        detail: "Browser data loaded (1 cards, 1 scripts; missing 0/0; registration failures 0; manifests 1/1).",
        message: "Browser data loaded (1 cards, 1 scripts; missing 0/0; registration failures 0; manifests 1/1).",
        missingCards: [],
        missingScripts: [],
        registrationFailures: [],
        tone: "success",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("warns when browser asset scripts load but fail initial-effect registration", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "/card-data/cdb-rows.json?codes=90000003") {
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              datas: [{ id: 90000003, type: 1, atk: 2400 }],
              texts: [{ id: 90000003, name: "Broken Script Duelist" }],
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
                error("registration boom")
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

      const result = await bootstrapPvpDuelWithBrowserAssets(lazyLoadedYdk, lazyLoadedYdk, "pvp-registration-failure", 1, caches);

      expect(result.scriptPreload).toEqual({ loaded: ["c90000003.lua"], missing: [] });
      expect(result.scriptRegistrations).toContainEqual(expect.objectContaining({
        code: "90000003",
        ok: false,
        error: expect.stringContaining("registration boom"),
      }));
      expect(summarizeBrowserPvpBoot(result)).toMatchObject({
        detail: "Browser data loaded (1 cards, 1 scripts; missing 0/0; registration failures 2; manifests 1/1).",
        message: expect.stringContaining("Registration failures: 90000003"),
        missingCards: [],
        missingScripts: [],
        registrationFailures: [
          { code: "90000003", error: expect.stringContaining("registration boom") },
          { code: "90000003", error: expect.stringContaining("registration boom") },
        ],
        tone: "warning",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps long browser boot diagnostics bounded but inspectable", () => {
    const boot = {
      cardPreload: { loaded: ["1"], missing: ["90000001", "90000002", "90000003", "90000004", "90000005", "90000006"] },
      scriptPreload: { loaded: ["c1.lua"], missing: ["c90000001.lua", "c90000002.lua", "c90000003.lua", "c90000004.lua", "c90000005.lua", "c90000006.lua"] },
      scriptRegistrations: [
        { code: "90000001", uid: "card-a", ok: false, error: "first\ntrace" },
        { code: "90000002", uid: "card-b", ok: false, error: "second\ntrace" },
        { code: "90000003", uid: "card-c", ok: false, error: "third\ntrace" },
        { code: "90000004", uid: "card-d", ok: false, error: "fourth\ntrace" },
        { code: "90000005", uid: "card-e", ok: true, skipped: true },
      ],
      cardDataManifest: { schemaVersion: 1, kind: "browser-cdb-rows", payload: "cdb-rows.json", selectedCodes: [], datasRows: 99, textsRows: 99, sha256: cardManifestHash },
      luaScriptManifest: { schemaVersion: 1, kind: "browser-lua-scripts", selectedCodes: [], copiedCount: 88, missingCount: 0, sourceCounts: {}, fallbackKindCounts: {}, copied: [], missing: [], files: [] },
    } as unknown as Parameters<typeof summarizeBrowserPvpBoot>[0];

    expect(summarizeBrowserPvpBoot(boot)).toEqual({
      detail: "Browser data loaded (1 cards, 1 scripts; missing 6/6; registration failures 4; manifests 99/88).",
      message: [
        "Browser data loaded (1 cards, 1 scripts; missing 6/6; registration failures 4; manifests 99/88).",
        "Missing cards: 90000001, 90000002, 90000003, 90000004, 90000005, ....",
        "Missing scripts: c90000001.lua, c90000002.lua, c90000003.lua, c90000004.lua, c90000005.lua, ....",
        "Registration failures: 90000001 (first), 90000002 (second), 90000003 (third), ....",
      ].join(" "),
      missingCards: ["90000001", "90000002", "90000003", "90000004", "90000005", "90000006"],
      missingScripts: ["c90000001.lua", "c90000002.lua", "c90000003.lua", "c90000004.lua", "c90000005.lua", "c90000006.lua"],
      registrationFailures: [
        { code: "90000001", uid: "card-a", error: "first\ntrace" },
        { code: "90000002", uid: "card-b", error: "second\ntrace" },
        { code: "90000003", uid: "card-c", error: "third\ntrace" },
        { code: "90000004", uid: "card-d", error: "fourth\ntrace" },
      ],
      tone: "warning",
    });
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
