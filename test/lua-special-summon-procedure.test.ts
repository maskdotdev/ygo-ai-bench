import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const preReleaseScript = (code: string): string => fs.readFileSync(`.upstream/ignis/script/pre-release/c${code}.lua`, "utf8");

describe("Lua special summon procedures", () => {
  it("registers Lua Malefic summon procedures", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Malefic Source", kind: "monster", setcodes: [0x23] },
      { code: "300", name: "Named Material", kind: "monster" },
    ];
    const session = createDuel({ seed: 86, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: [] },
    });
    startDuel(session);
    const source = session.state.cards.find((card) => card.code === "100");
    const material = session.state.cards.find((card) => card.code === "300");
    expect(source).toBeTruthy();
    expect(material).toBeTruthy();
    moveDuelCard(session.state, source!.uid, "hand", 0);
    moveDuelCard(session.state, material!.uid, "deck", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local unique=aux.MaleficUniqueFilter(c)
      local e=aux.AddMaleficSummonProcedure(c,300,LOCATION_DECK)
      Debug.Message("malefic unique " .. tostring(unique(c)) .. "/" .. tostring(c:GetMetatable().has_malefic_unique[c]))
      Debug.Message("malefic metadata " .. e:GetType() .. "/" .. e:GetCode() .. "/" .. e:GetProperty() .. "/" .. e:GetRange())
      Debug.Message("malefic condition " .. tostring(e:GetCondition()(e,c)))
      Debug.Message("malefic target " .. tostring(e:GetTarget()(e,0,Group.CreateGroup(),0,0,nil,0,0,0,c)))
      local sg=e:GetLabelObject()
      Debug.Message("malefic selected " .. sg:GetCount() .. "/" .. sg:GetFirst():GetCode())
      e:GetOperation()(e,0,Group.CreateGroup(),0,0,nil,0,0,c)
      Debug.Message("malefic removed " .. Duel.GetMatchingGroupCount(aux.FilterBoolFunction(Card.IsCode,300),0,LOCATION_REMOVED,0,nil))
      `,
      "malefic-procedure.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("malefic unique true/true");
    expect(host.messages).toContain("malefic metadata 2/34/262144/2");
    expect(host.messages).toContain("malefic condition true");
    expect(host.messages).toContain("malefic target true");
    expect(host.messages).toContain("malefic selected 1/300");
    expect(host.messages).toContain("malefic removed 1");
  });

  it("registers Lua special summon procedure effects as legal summon actions", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Procedure Source", kind: "monster" },
      { code: "200", name: "Blocked Procedure Source", kind: "monster" },
      { code: "300", name: "Procedure Cost", kind: "monster" },
    ];
    const session = createDuel({ seed: 32, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const sourceScript = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_SPSUMMON_PROC)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c)
          return Duel.IsExistingMatchingCard(aux.FilterBoolFunction(Card.IsCode, 300), c:GetControler(), LOCATION_HAND, 0, 1, c)
        end)
        e:SetValue(function(e,c)
          Debug.Message("procedure value " .. c:GetCode())
          return c:IsCode(100)
        end)
        e:SetOperation(function(e,c)
          local g=Duel.SelectMatchingCard(c:GetControler(), aux.FilterBoolFunction(Card.IsCode, 300), c:GetControler(), LOCATION_HAND, 0, 1, 1, c)
          Debug.Message("procedure operation cost " .. g:GetCount())
          Duel.SendtoGrave(g, REASON_COST)
        end)
        c:RegisterEffect(e)
      end
      `;
        }
        if (name === "c200.lua") {
          return `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_SPSUMMON_PROC)
        e:SetRange(LOCATION_HAND)
        e:SetValue(function(e,c)
          Debug.Message("blocked procedure value " .. c:GetCode())
          return false
        end)
        c:RegisterEffect(e)
      end
      `;
        }
        return undefined;
      },
    };
    const host = createLuaScriptHost(session);
    const sourceLoad = host.loadCardScript(100, sourceScript);
    const blockedLoad = host.loadCardScript(200, sourceScript);

    expect(sourceLoad.ok, sourceLoad.error).toBe(true);
    expect(blockedLoad.ok, blockedLoad.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid.includes("100"));
    const blocked = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid.includes("200"));
    expect(action).toBeDefined();
    expect(blocked).toBeUndefined();

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), sourceScript, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.loadedScripts.map((script) => script.name).sort()).toEqual(["c100.lua", "c200.lua"]);
    expect(restored.loadedScripts.every((script) => script.ok)).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const restoredAction = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid.includes("100"));
    expect(restoredAction).toBeDefined();
    const restoredPublic = queryPublicState(restored.session);
    expect(restoredAction).toMatchObject({ windowId: restoredPublic.actionWindowId, windowKind: "open" });
    applyLuaRestoreAndAssert(restored, restoredAction!);
    expect(restored.host.messages).toContain("procedure value 100");
    expect(restored.host.messages).toContain("blocked procedure value 200");
    expect(restored.host.messages).toContain("procedure operation cost 1");
    expect(restored.session.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "monsterZone", summonType: "special", faceUp: true });
    expect(restored.session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.code === "300")).toMatchObject({ location: "graveyard" });
    expect(getLuaRestoreLegalActions(restored, 0).some((candidate) => candidate.type === "specialSummonProcedure")).toBe(false);
    const staleRestoredResult = applyLuaRestoreResponse(restored, restoredAction!);
    expect(staleRestoredResult.ok).toBe(false);
    expect(staleRestoredResult.error).toContain("Response is not currently legal");
    expect(staleRestoredResult.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleRestoredResult.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleRestoredResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(staleRestoredResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleRestoredResult.legalActions);
    assertPublicRestoreMetadata(restored, staleRestoredResult);

    applyAndAssert(session, action!);

    expect(host.messages).toContain("procedure value 100");
    expect(host.messages).toContain("blocked procedure value 200");
    expect(host.messages).toContain("procedure operation cost 1");
    expect(session.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "monsterZone", summonType: "special", faceUp: true });
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "hand" });
    expect(session.state.cards.find((card) => card.code === "300")).toMatchObject({ location: "graveyard" });
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "specialSummonProcedure")).toBe(false);
  });

  it("supports Ultimate Magical Swordsman procedure returning a Ritual monster to deck", () => {
    const cards: DuelCardData[] = [
      { code: "98684220", name: "Black Chaos the Ultimate Magical Swordsman", kind: "monster", attack: 3000 },
      { code: "70405001", name: "Ritual Warrior Cost", kind: "monster", typeFlags: 0x81, race: 0x1 },
    ];
    const session = createDuel({ seed: 161, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["98684220", "70405001"] },
      1: { main: [] },
    });
    startDuel(session);
    const cost = session.state.cards.find((card) => card.code === "70405001");
    expect(cost).toBeTruthy();
    moveDuelCard(session.state, cost!.uid, "graveyard", 0);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(preReleaseScript("101305001"), "c98684220.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const source = session.state.cards.find((card) => card.code === "98684220");
    expect(source).toBeTruthy();
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    applyAndAssert(session, action!);

    expect(session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({ location: "monsterZone", summonType: "special", faceUp: true });
    expect(session.state.cards.find((card) => card.uid === cost!.uid)).toMatchObject({ location: "deck", reason: 0x80 });
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid === source!.uid)).toBe(false);
  });

  it("loads Ultimate Magical Swordsman field effects for placing Mind Shuffle and banishing two cards", () => {
    const cards: DuelCardData[] = [
      { code: "98684220", name: "Black Chaos the Ultimate Magical Swordsman", kind: "monster", typeFlags: 33554465, attack: 3000, defense: 2500, level: 8, race: 2, attribute: 32 },
      { code: "24749710", name: "Mind Shuffle", kind: "trap", typeFlags: 0x20004, listedNames: ["101305044"] },
      { code: "100", name: "Opponent Card A", kind: "monster" },
      { code: "200", name: "Opponent Card B", kind: "spell", typeFlags: 0x2 },
    ];
    const session = createDuel({ seed: 162, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["98684220", "24749710"] },
      1: { main: ["100", "200"] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.code === "98684220");
    const mindShuffle = session.state.cards.find((card) => card.code === "24749710");
    const opponentA = session.state.cards.find((card) => card.code === "100");
    const opponentB = session.state.cards.find((card) => card.code === "200");
    expect(source).toBeTruthy();
    expect(mindShuffle).toBeTruthy();
    expect(opponentA).toBeTruthy();
    expect(opponentB).toBeTruthy();
    moveDuelCard(session.state, source!.uid, "hand", 0);
    moveDuelCard(session.state, mindShuffle!.uid, "deck", 0);
    moveDuelCard(session.state, opponentA!.uid, "monsterZone", 1);
    moveDuelCard(session.state, opponentB!.uid, "spellTrapZone", 1);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(preReleaseScript("101305001"), "c98684220.lua");
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const placeAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(placeAction).toBeDefined();
    applyAndAssert(session, placeAction!);
    expect(session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.cards.find((card) => card.uid === mindShuffle!.uid)).toMatchObject({ location: "spellTrapZone", controller: 0, faceUp: true });

    moveDuelCard(session.state, source!.uid, "monsterZone", 0);
    const banishAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(banishAction).toBeDefined();
    applyAndAssert(session, banishAction!);
    expect(session.state.cards.find((card) => card.uid === opponentA!.uid)).toMatchObject({ location: "banished" });
    expect(session.state.cards.find((card) => card.uid === opponentB!.uid)).toMatchObject({ location: "banished" });
  });

  it("supports Lua special summon procedures from face-up pendulum extra deck cards", () => {
    const cards: DuelCardData[] = [
      { code: "301", name: "Extra Procedure Pendulum", kind: "monster", typeFlags: 0x1000001 },
      { code: "920", name: "Blocked Extra Procedure", kind: "extra", typeFlags: 0x800001, level: 4 },
    ];
    const session = createDuel({ seed: 33, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["301"], extra: ["920"] },
      1: { main: [] },
    });
    startDuel(session);

    const pendulum = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "301");
    const extra = session.state.cards.find((card) => card.controller === 0 && card.location === "extraDeck" && card.code === "920");
    expect(pendulum).toBeTruthy();
    expect(extra).toBeTruthy();
    moveDuelCard(session.state, pendulum!.uid, "extraDeck", 0);

    const sourceScript = {
      readScript(name: string) {
        if (name === "c301.lua") {
          return `
      c301={}
      function c301.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_SPSUMMON_PROC)
        e:SetRange(LOCATION_EXTRA)
        e:SetValue(function(e,c)
          Debug.Message("extra procedure value " .. tostring(c:IsFaceup()) .. "/" .. c:GetLocation())
          return c:IsFaceup()
        end)
        e:SetOperation(function(e,c)
          Debug.Message("extra procedure operation " .. c:GetCode())
        end)
        c:RegisterEffect(e)
      end
      `;
        }
        if (name === "c920.lua") {
          return `
      c920={}
      function c920.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_SPSUMMON_PROC)
        e:SetRange(LOCATION_EXTRA)
        e:SetValue(function(e,c)
          Debug.Message("blocked extra procedure value " .. tostring(c:IsFaceup()) .. "/" .. c:GetLocation())
          return true
        end)
        c:RegisterEffect(e)
      end
      `;
        }
        return undefined;
      },
    };
    const host = createLuaScriptHost(session);
    const pendulumLoad = host.loadCardScript(301, sourceScript);
    const blockedLoad = host.loadCardScript(920, sourceScript);

    expect(pendulumLoad.ok, pendulumLoad.error).toBe(true);
    expect(blockedLoad.ok, blockedLoad.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid === pendulum!.uid);
    const blocked = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid === extra!.uid);
    expect(action).toBeDefined();
    expect(blocked).toBeUndefined();

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), sourceScript, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.loadedScripts.map((script) => script.name).sort()).toEqual(["c301.lua", "c920.lua"]);
    expect(restored.loadedScripts.every((script) => script.ok)).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const restoredAction = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid === pendulum!.uid);
    const restoredBlocked = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid === extra!.uid);
    expect(restoredAction).toBeDefined();
    expect(restoredBlocked).toBeUndefined();
    applyLuaRestoreAndAssert(restored, restoredAction!);
    expect(restored.host.messages).toContain("extra procedure value true/64");
    expect(restored.host.messages).toContain("extra procedure operation 301");
    expect(restored.session.state.cards.find((card) => card.uid === pendulum!.uid)).toMatchObject({ location: "monsterZone", summonType: "special", faceUp: true });
    expect(restored.session.state.cards.find((card) => card.uid === extra!.uid)).toMatchObject({ location: "extraDeck", faceUp: false });

    applyAndAssert(session, action!);

    expect(host.messages).toContain("extra procedure value true/64");
    expect(host.messages).toContain("extra procedure operation 301");
    expect(session.state.cards.find((card) => card.uid === pendulum!.uid)).toMatchObject({ location: "monsterZone", summonType: "special", faceUp: true });
    expect(session.state.cards.find((card) => card.uid === extra!.uid)).toMatchObject({ location: "extraDeck", faceUp: false });
  });

  it("lets Lua special summon procedures consume field materials", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Material Procedure Source", kind: "monster", ritualMaterials: ["300"] },
      { code: "200", name: "Blocked Material Procedure", kind: "monster", ritualMaterials: ["999"] },
      { code: "300", name: "Procedure Field Material", kind: "monster" },
    ];
    const session = createDuel({ seed: 34, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const material = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(material).toBeTruthy();
    moveDuelCard(session.state, material!.uid, "monsterZone", 0);

    const sourceScript = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_SPSUMMON_PROC)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c)
          return Duel.IsExistingMatchingCard(function(tc) return tc:IsCanBeRitualMaterial(c) end, c:GetControler(), LOCATION_MZONE, 0, 1, nil)
        end)
        e:SetOperation(function(e,c)
          local g=Duel.SelectMatchingCard(c:GetControler(), function(tc) return tc:IsCanBeRitualMaterial(c) end, c:GetControler(), LOCATION_MZONE, 0, 1, 1, nil)
          Debug.Message("material procedure selected " .. g:GetCount() .. "/" .. g:GetFirst():GetCode())
          Duel.SendtoGrave(g, REASON_MATERIAL + REASON_SPSUMMON)
        end)
        c:RegisterEffect(e)
      end
      `;
        }
        if (name === "c200.lua") {
          return `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_SPSUMMON_PROC)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c)
          return Duel.IsExistingMatchingCard(function(tc) return tc:IsCanBeRitualMaterial(c) end, c:GetControler(), LOCATION_MZONE, 0, 1, nil)
        end)
        c:RegisterEffect(e)
      end
      `;
        }
        return undefined;
      },
    };
    const host = createLuaScriptHost(session);
    const sourceLoad = host.loadCardScript(100, sourceScript);
    const blockedLoad = host.loadCardScript(200, sourceScript);

    expect(sourceLoad.ok, sourceLoad.error).toBe(true);
    expect(blockedLoad.ok, blockedLoad.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid.includes("100"));
    const blocked = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid.includes("200"));
    expect(action).toBeDefined();
    expect(blocked).toBeUndefined();

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), sourceScript, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.loadedScripts.map((script) => script.name).sort()).toEqual(["c100.lua", "c200.lua"]);
    expect(restored.loadedScripts.every((script) => script.ok)).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const restoredAction = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid.includes("100"));
    expect(restoredAction).toBeDefined();
    applyLuaRestoreAndAssert(restored, restoredAction!);
    expect(restored.host.messages).toContain("material procedure selected 1/300");
    expect(restored.session.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "monsterZone", summonType: "special", faceUp: true });
    expect(restored.session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.code === "300")).toMatchObject({ location: "graveyard" });
    expect(getLuaRestoreLegalActions(restored, 0).some((candidate) => candidate.type === "specialSummonProcedure")).toBe(false);

    applyAndAssert(session, action!);

    expect(host.messages).toContain("material procedure selected 1/300");
    expect(session.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "monsterZone", summonType: "special", faceUp: true });
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "hand" });
    expect(session.state.cards.find((card) => card.code === "300")).toMatchObject({ location: "graveyard" });
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "specialSummonProcedure")).toBe(false);
  });

  it("lets Lua special summon procedures free the last monster zone with materials", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Full Zone Procedure Source", kind: "monster" },
      { code: "200", name: "Full Zone Blocked Procedure", kind: "monster" },
      { code: "300", name: "Full Zone Material", kind: "monster" },
      { code: "400", name: "Zone Filler A", kind: "monster" },
      { code: "500", name: "Zone Filler B", kind: "monster" },
      { code: "600", name: "Zone Filler C", kind: "monster" },
      { code: "700", name: "Zone Filler D", kind: "monster" },
    ];
    const session = createDuel({ seed: 35, startingHandSize: 7, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500", "600", "700"] },
      1: { main: [] },
    });
    startDuel(session);

    for (const code of ["300", "400", "500", "600", "700"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      expect(card).toBeTruthy();
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
    }
    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const blockedSource = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(source).toBeTruthy();
    expect(blockedSource).toBeTruthy();

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_SPSUMMON_PROC)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c)
          local g=Duel.GetMatchingGroup(aux.FilterBoolFunction(Card.IsCode, 300), c:GetControler(), LOCATION_MZONE, 0, nil)
          return g:GetCount()>0 and Duel.GetLocationCountFromEx(c:GetControler(), c:GetControler(), nil, g)>0
        end)
        e:SetOperation(function(e,c)
          local g=Duel.SelectMatchingCard(c:GetControler(), aux.FilterBoolFunction(Card.IsCode, 300), c:GetControler(), LOCATION_MZONE, 0, 1, 1, nil)
          Debug.Message("full zone material selected " .. g:GetCount() .. "/" .. Duel.GetLocationCountFromEx(c:GetControler(), c:GetControler(), nil, g))
          Duel.SendtoGrave(g, REASON_MATERIAL + REASON_SPSUMMON)
        end)
        c:RegisterEffect(e)
      end
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_SPSUMMON_PROC)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c)
          return Duel.GetLocationCount(c:GetControler(), LOCATION_MZONE)>0
        end)
        c:RegisterEffect(e)
      end
      `,
      "full-zone-material-special-summon-procedure.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const actions = getDuelLegalActions(session, 0);
    const action = actions.find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid === source!.uid);
    const blocked = actions.find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid === blockedSource!.uid);
    expect(action).toBeDefined();
    expect(blocked).toBeUndefined();
    applyAndAssert(session, action!);

    expect(host.messages).toContain("full zone material selected 1/1");
    expect(session.state.cards.find((card) => card.code === "100")).toMatchObject({ location: "monsterZone", summonType: "special", faceUp: true });
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "hand" });
    expect(session.state.cards.find((card) => card.code === "300")).toMatchObject({ location: "graveyard" });
    expect(session.state.cards.filter((card) => card.controller === 0 && card.location === "monsterZone")).toHaveLength(5);
  });

  it("lets Lua special summon procedure costs release material before summoning", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Release Procedure Source", kind: "monster" },
      { code: "200", name: "Blocked Release Procedure", kind: "monster" },
      { code: "300", name: "Release Procedure Material", kind: "monster" },
      { code: "400", name: "Release Filler A", kind: "monster" },
      { code: "500", name: "Release Filler B", kind: "monster" },
      { code: "600", name: "Release Filler C", kind: "monster" },
      { code: "700", name: "Release Filler D", kind: "monster" },
    ];
    const session = createDuel({ seed: 36, startingHandSize: 7, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500", "600", "700"] },
      1: { main: [] },
    });
    startDuel(session);

    for (const code of ["300", "400", "500", "600", "700"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      expect(card).toBeTruthy();
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
    }
    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const blockedSource = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const material = session.state.cards.find((card) => card.controller === 0 && card.location === "monsterZone" && card.code === "300");
    expect(source).toBeTruthy();
    expect(blockedSource).toBeTruthy();
    expect(material).toBeTruthy();

    const sourceScript = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_SPSUMMON_PROC)
        e:SetRange(LOCATION_HAND)
        e:SetCost(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return Duel.CheckReleaseGroup(tp, aux.FilterBoolFunction(Card.IsCode, 300), 1, e:GetHandler()) end
          local g=Duel.SelectReleaseGroup(tp, aux.FilterBoolFunction(Card.IsCode, 300), 1, 1, e:GetHandler())
          Debug.Message("procedure release cost " .. g:GetCount() .. "/" .. Duel.GetLocationCountFromEx(tp, tp, nil, g))
          Duel.Release(g, REASON_COST)
        end)
        c:RegisterEffect(e)
      end
      `;
        }
        if (name === "c200.lua") {
          return `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_SPSUMMON_PROC)
        e:SetRange(LOCATION_HAND)
        e:SetCost(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return Duel.CheckReleaseGroup(tp, aux.FilterBoolFunction(Card.IsCode, 999), 1, e:GetHandler()) end
        end)
        c:RegisterEffect(e)
      end
      `;
        }
        return undefined;
      },
    };
    const host = createLuaScriptHost(session);
    const sourceLoad = host.loadCardScript(100, sourceScript);
    const blockedLoad = host.loadCardScript(200, sourceScript);

    expect(sourceLoad.ok, sourceLoad.error).toBe(true);
    expect(blockedLoad.ok, blockedLoad.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const actions = getDuelLegalActions(session, 0);
    const action = actions.find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid === source!.uid);
    const blocked = actions.find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid === blockedSource!.uid);
    expect(action).toBeDefined();
    expect(blocked).toBeUndefined();
    expect(host.messages).not.toContain("procedure release cost 1/1");
    expect(session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({ location: "monsterZone" });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), sourceScript, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.loadedScripts.map((script) => script.name).sort()).toEqual(["c100.lua", "c200.lua"]);
    expect(restored.loadedScripts.every((script) => script.ok)).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const restoredAction = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid === source!.uid);
    expect(restoredAction).toBeDefined();
    expect(restored.host.messages).not.toContain("procedure release cost 1/1");
    applyLuaRestoreAndAssert(restored, restoredAction!);
    expect(restored.host.messages).toContain("procedure release cost 1/1");
    expect(restored.session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({ location: "monsterZone", summonType: "special", faceUp: true });
    expect(restored.session.state.cards.find((card) => card.uid === blockedSource!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.filter((card) => card.controller === 0 && card.location === "monsterZone")).toHaveLength(5);

    applyAndAssert(session, action!);

    expect(host.messages).toContain("procedure release cost 1/1");
    expect(session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({ location: "monsterZone", summonType: "special", faceUp: true });
    expect(session.state.cards.find((card) => card.uid === blockedSource!.uid)).toMatchObject({ location: "hand" });
    expect(session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.cards.filter((card) => card.controller === 0 && card.location === "monsterZone")).toHaveLength(5);
  });

  it("rolls back Lua special summon procedure costs when release count falls short", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Rollback Procedure Source", kind: "monster" },
      { code: "200", name: "Rollback Release Material", kind: "monster" },
      { code: "300", name: "Rollback Replacement", kind: "monster" },
    ];
    const session = createDuel({ seed: 82, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const material = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const replacement = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(source).toBeTruthy();
    expect(material).toBeTruthy();
    expect(replacement).toBeTruthy();
    moveDuelCard(session.state, material!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_SPSUMMON_PROC)
        e:SetRange(LOCATION_HAND)
        e:SetCost(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return Duel.CheckReleaseGroup(tp, aux.FilterBoolFunction(Card.IsCode, 200), 1, e:GetHandler()) end
          local g=Duel.SelectReleaseGroup(tp, aux.FilterBoolFunction(Card.IsCode, 200), 1, 1, e:GetHandler())
          local released=Duel.Release(g, REASON_COST)
          Debug.Message("rollback release cost " .. released .. "/" .. g:GetCount())
          return released==g:GetCount()
        end)
        c:RegisterEffect(e)
      end
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EFFECT_RELEASE_REPLACE)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_HAND)
        e:SetTargetRange(1,0)
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return true end
          Duel.SetTargetCard(Group.FromCards(e:GetHandler()))
          return true
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Duel.Release(Duel.GetTargetCards(), REASON_EFFECT+REASON_REPLACE)
        end)
        c:RegisterEffect(e)
      end
      `,
      "rollback-release-cost-procedure.lua",
    );

    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    const result = applyResponse(session, action!);

    expect(result.ok).toBe(false);
    expect(host.messages).toContain("rollback release cost 0/1");
    expect(session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({ location: "hand" });
    expect(session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({ location: "monsterZone" });
    expect(session.state.cards.find((card) => card.uid === replacement!.uid)).toMatchObject({ location: "hand" });
  });

  it("rolls back Lua special summon procedures when operation moves the source out of range", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Self Moving Procedure Source", kind: "monster" },
    ];
    const session = createDuel({ seed: 83, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(source).toBeTruthy();

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_SPSUMMON_PROC)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          local moved=Duel.SendtoGrave(c, REASON_COST)
          Debug.Message("source moved before summon " .. moved .. "/" .. c:GetLocation())
        end)
        c:RegisterEffect(e)
      end
      `,
      "source-moved-special-summon-procedure.lua",
    );

    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    const result = applyResponse(session, action!);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("summon procedure is no longer in range");
    expect(host.messages).toContain("source moved before summon 1/16");
    expect(session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({ location: "hand" });
    expect(session.state.log.some((entry) => entry.action === "sendToGraveyard" && entry.card === "Self Moving Procedure Source")).toBe(false);
  });

  it("rolls back Lua special summon procedures when operation fills the last monster zone", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Zone Lost Procedure Source", kind: "monster" },
      { code: "200", name: "Zone Lost Filler", kind: "monster" },
      { code: "300", name: "Existing Zone Filler A", kind: "monster" },
      { code: "400", name: "Existing Zone Filler B", kind: "monster" },
      { code: "500", name: "Existing Zone Filler C", kind: "monster" },
      { code: "600", name: "Existing Zone Filler D", kind: "monster" },
    ];
    const session = createDuel({ seed: 84, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "400", "500", "600"] },
      1: { main: [] },
    });
    startDuel(session);

    for (const code of ["300", "400", "500", "600"]) {
      const card = session.state.cards.find((candidate) => candidate.controller === 0 && candidate.location === "hand" && candidate.code === code);
      expect(card).toBeTruthy();
      moveDuelCard(session.state, card!.uid, "monsterZone", 0);
    }
    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const filler = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(source).toBeTruthy();
    expect(filler).toBeTruthy();

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_SPSUMMON_PROC)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c)
          return Duel.GetLocationCount(c:GetControler(), LOCATION_MZONE)>0
        end)
        e:SetOperation(function(e,c)
          local g=Duel.SelectMatchingCard(c:GetControler(), aux.FilterBoolFunction(Card.IsCode, 200), c:GetControler(), LOCATION_HAND, 0, 1, 1, c)
          local moved=Duel.SpecialSummon(g, 0, c:GetControler(), c:GetControler(), false, false, POS_FACEUP_ATTACK)
          Debug.Message("procedure filled zone " .. moved .. "/" .. Duel.GetLocationCount(c:GetControler(), LOCATION_MZONE))
        end)
        c:RegisterEffect(e)
      end
      `,
      "zone-filled-special-summon-procedure.lua",
    );

    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    const result = applyResponse(session, action!);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("cannot be Special Summoned");
    expect(host.messages).toContain("procedure filled zone 1/0");
    expect(session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({ location: "hand" });
    expect(session.state.cards.find((card) => card.uid === filler!.uid)).toMatchObject({ location: "hand" });
    expect(session.state.cards.filter((card) => card.controller === 0 && card.location === "monsterZone")).toHaveLength(4);
    expect(session.state.log.some((entry) => entry.action === "specialSummon" && entry.card === "Zone Lost Filler")).toBe(false);
  });

  it("rolls back Lua special summon procedures when checked material moves are partial", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Partial Move Procedure Source", kind: "monster" },
      { code: "200", name: "First Partial Material", kind: "monster" },
      { code: "300", name: "Blocked Partial Material", kind: "monster" },
    ];
    const session = createDuel({ seed: 85, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const firstMaterial = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const blockedMaterial = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(source).toBeTruthy();
    expect(firstMaterial).toBeTruthy();
    expect(blockedMaterial).toBeTruthy();

    registerEffect(session, {
      id: "block-second-material-after-first-moves",
      sourceUid: blockedMaterial!.uid,
      controller: 0,
      event: "continuous",
      code: 68,
      range: ["hand"],
      canActivate(ctx) {
        return ctx.duel.cards.find((card) => card.uid === firstMaterial!.uid)?.location === "graveyard";
      },
      operation() {},
    });

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_SPSUMMON_PROC)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          local first=Duel.SelectMatchingCard(c:GetControler(), aux.FilterBoolFunction(Card.IsCode, 200), c:GetControler(), LOCATION_HAND, 0, 1, 1, c):GetFirst()
          local blocked=Duel.SelectMatchingCard(c:GetControler(), aux.FilterBoolFunction(Card.IsCode, 300), c:GetControler(), LOCATION_HAND, 0, 1, 1, c):GetFirst()
          local g=Group.FromCards(first, blocked)
          local moved=Duel.SendtoGrave(g, REASON_MATERIAL + REASON_SPSUMMON)
          Debug.Message("partial material moves " .. moved .. "/" .. g:GetCount())
          if moved~=g:GetCount() then error("procedure material move count mismatch") end
        end)
        c:RegisterEffect(e)
      end
      `,
      "partial-material-move-special-summon-procedure.lua",
    );

    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    const result = applyResponse(session, action!);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("procedure material move count mismatch");
    expect(host.messages).toContain("partial material moves 1/2");
    expect(session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({ location: "hand" });
    expect(session.state.cards.find((card) => card.uid === firstMaterial!.uid)).toMatchObject({ location: "hand" });
    expect(session.state.cards.find((card) => card.uid === blockedMaterial!.uid)).toMatchObject({ location: "hand" });
    expect(session.state.log.some((entry) => entry.action === "sendToGraveyard" && entry.card === "First Partial Material")).toBe(false);
  });

  it("ignores Lua operation return false for summon procedure compatibility", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Return False Procedure Source", kind: "monster" },
      { code: "200", name: "Return False First Material", kind: "monster" },
      { code: "300", name: "Return False Blocked Material", kind: "monster" },
    ];
    const session = createDuel({ seed: 86, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const firstMaterial = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const blockedMaterial = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(source).toBeTruthy();
    expect(firstMaterial).toBeTruthy();
    expect(blockedMaterial).toBeTruthy();

    registerEffect(session, {
      id: "block-second-return-false-material",
      sourceUid: blockedMaterial!.uid,
      controller: 0,
      event: "continuous",
      code: 68,
      range: ["hand"],
      canActivate(ctx) {
        return ctx.duel.cards.find((card) => card.uid === firstMaterial!.uid)?.location === "graveyard";
      },
      operation() {},
    });

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_SPSUMMON_PROC)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          local first=Duel.SelectMatchingCard(c:GetControler(), aux.FilterBoolFunction(Card.IsCode, 200), c:GetControler(), LOCATION_HAND, 0, 1, 1, c):GetFirst()
          local blocked=Duel.SelectMatchingCard(c:GetControler(), aux.FilterBoolFunction(Card.IsCode, 300), c:GetControler(), LOCATION_HAND, 0, 1, 1, c):GetFirst()
          local g=Group.FromCards(first, blocked)
          local moved=Duel.SendtoGrave(g, REASON_MATERIAL + REASON_SPSUMMON)
          Debug.Message("return false material moves " .. moved .. "/" .. g:GetCount())
          if moved~=g:GetCount() then return false end
        end)
        c:RegisterEffect(e)
      end
      `,
      "return-false-material-move-special-summon-procedure.lua",
    );

    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    const result = applyAndAssert(session, action!);

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("return false material moves 1/2");
    expect(session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({ location: "monsterZone", summonType: "special", faceUp: true });
    expect(session.state.cards.find((card) => card.uid === firstMaterial!.uid)).toMatchObject({ location: "graveyard" });
    expect(session.state.cards.find((card) => card.uid === blockedMaterial!.uid)).toMatchObject({ location: "hand" });
  });
});

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  assertPublicRestoreMetadata(restored, response);
  return response;
}

function assertPublicRestoreMetadata(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: ReturnType<typeof applyLuaRestoreResponse>): void {
  const publicState = queryPublicState(restored.session);
  expect(response.state.pendingTriggerBuckets).toEqual(publicState.pendingTriggerBuckets);
  if ("triggerOrderPrompt" in publicState) expect(response.state.triggerOrderPrompt).toEqual(publicState.triggerOrderPrompt);
  else expect(response.state).not.toHaveProperty("triggerOrderPrompt");
}
