import { describe, expect, it } from "vitest";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua special summon procedure restore", () => {
  it("rolls back restored Lua procedure costs when replacement costs leave no monster zone", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Rollback Procedure Source", kind: "monster" },
      { code: "200", name: "Rollback Release Material", kind: "monster" },
      { code: "300", name: "Rollback Replacement", kind: "monster" },
      { code: "401", name: "Rollback Zone Blocker 1", kind: "monster" },
      { code: "402", name: "Rollback Zone Blocker 2", kind: "monster" },
      { code: "403", name: "Rollback Zone Blocker 3", kind: "monster" },
      { code: "404", name: "Rollback Zone Blocker 4", kind: "monster" },
    ];
    const session = createDuel({ seed: 82, startingHandSize: 7, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300", "401", "402", "403", "404"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const material = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const replacement = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    const blockers = ["401", "402", "403", "404"].map((code) => session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === code));
    expect(source).toBeTruthy();
    expect(material).toBeTruthy();
    expect(replacement).toBeTruthy();
    expect(blockers.every(Boolean)).toBe(true);
    moveDuelCard(session.state, material!.uid, "monsterZone", 0).sequence = 0;
    blockers.forEach((blocker, index) => { moveDuelCard(session.state, blocker!.uid, "monsterZone", 0).sequence = index + 1; });

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
          if chk==0 then return Duel.CheckReleaseGroup(tp, aux.FilterBoolFunction(Card.IsCode, 200), 1, e:GetHandler()) end
          local g=Duel.SelectReleaseGroup(tp, aux.FilterBoolFunction(Card.IsCode, 200), 1, 1, e:GetHandler())
          local released=Duel.Release(g, REASON_COST)
          Debug.Message("restored rollback release cost " .. released .. "/" .. g:GetCount())
          return released==g:GetCount()
        end)
        c:RegisterEffect(e)
      end
      `;
        }
        if (name === "c300.lua") {
          return `
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
      `;
        }
        return undefined;
      },
    };
    const host = createLuaScriptHost(session);
    const sourceLoad = host.loadCardScript(100, sourceScript);
    const replacementLoad = host.loadCardScript(300, sourceScript);
    expect(sourceLoad.ok, sourceLoad.error).toBe(true);
    expect(replacementLoad.ok, replacementLoad.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), sourceScript, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.loadedScripts.map((script) => script.name).sort()).toEqual(["c100.lua", "c300.lua"]);
    expect(restored.loadedScripts.every((script) => script.ok)).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual([]);
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid === source!.uid);
    if (!action || action.type !== "specialSummonProcedure") {
      throw new Error("Expected restored special summon procedure action");
    }
    expect(action).toMatchObject({ windowKind: "open" });
    expect(action.windowToken).toBeDefined();
    expect(hasGroupedProcedure(restored, source!.uid)).toBe(true);

    const staleAction = { ...action, windowId: action.windowId! - 1 };
    const staleResult = applyLuaRestoreResponse(restored, staleAction);
    expect(staleResult.ok).toBe(false);
    expect(staleResult.error).toContain("Response is not currently legal");
    expect(staleResult.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    assertFailedRestoreSurface(restored, staleResult);
    expect(restored.session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === replacement!.uid)).toMatchObject({ location: "hand" });
    expect(restored.host.messages).toEqual([]);
    const forgedProcedure = applyLuaRestoreResponse(restored, {
      ...action,
      effectId: `${action.effectId}-forged`,
    });
    expect(forgedProcedure.ok).toBe(false);
    expect(forgedProcedure.error).toContain("Response is not currently legal");
    assertFailedRestoreSurface(restored, forgedProcedure);
    expect(restored.session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === replacement!.uid)).toMatchObject({ location: "hand" });
    expect(restored.host.messages).toEqual([]);

    const result = applyLuaRestoreResponse(restored, action);
    expect(result.ok).toBe(false);
    assertFailedRestoreSurface(restored, result);
    expect(restored.host.messages).toContain("restored rollback release cost 0/1");
    expect(restored.session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === replacement!.uid)).toMatchObject({ location: "hand" });
  });

  it("rolls back restored Lua procedures when operation moves the source out of range", () => {
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
        e:SetOperation(function(e,c)
          local moved=Duel.SendtoGrave(c, REASON_COST)
          Debug.Message("restored source moved before summon " .. moved .. "/" .. c:GetLocation())
        end)
        c:RegisterEffect(e)
      end
      `;
        }
        return undefined;
      },
    };
    const host = createLuaScriptHost(session);
    const setup = host.loadCardScript(100, sourceScript);
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), sourceScript, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.loadedScripts).toEqual([{ ok: true, name: "c100.lua" }]);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual([]);
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    expect(hasGroupedProcedure(restored, source!.uid)).toBe(true);

    const staleAction = applyLuaRestoreResponse(restored, { ...action!, windowId: action!.windowId! - 1 });
    expect(staleAction.ok).toBe(false);
    expect(staleAction.error).toContain("Response is not currently legal");
    expect(staleAction.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    assertFailedRestoreSurface(restored, staleAction);
    expect(restored.host.messages).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({ location: "hand" });

    const result = applyLuaRestoreResponse(restored, action!);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("summon procedure is no longer in range");
    assertFailedRestoreSurface(restored, result);
    expect(restored.host.messages).toContain("restored source moved before summon 1/16");
    expect(restored.session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.log.some((entry) => entry.action === "sendToGraveyard" && entry.card === "Self Moving Procedure Source")).toBe(false);
  });

  it("rolls back restored Lua procedures when operation fills the last monster zone", () => {
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
          return Duel.GetLocationCount(c:GetControler(), LOCATION_MZONE)>0
        end)
        e:SetOperation(function(e,c)
          local g=Duel.SelectMatchingCard(c:GetControler(), aux.FilterBoolFunction(Card.IsCode, 200), c:GetControler(), LOCATION_HAND, 0, 1, 1, c)
          local moved=Duel.SpecialSummon(g, 0, c:GetControler(), c:GetControler(), false, false, POS_FACEUP_ATTACK)
          Debug.Message("restored procedure filled zone " .. moved .. "/" .. Duel.GetLocationCount(c:GetControler(), LOCATION_MZONE))
        end)
        c:RegisterEffect(e)
      end
      `;
        }
        return undefined;
      },
    };
    const host = createLuaScriptHost(session);
    const setup = host.loadCardScript(100, sourceScript);
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), sourceScript, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.loadedScripts).toEqual([{ ok: true, name: "c100.lua" }]);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual([]);
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    expect(hasGroupedProcedure(restored, source!.uid)).toBe(true);

    const staleAction = applyLuaRestoreResponse(restored, { ...action!, windowId: action!.windowId! - 1 });
    expect(staleAction.ok).toBe(false);
    expect(staleAction.error).toContain("Response is not currently legal");
    expect(staleAction.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    assertFailedRestoreSurface(restored, staleAction);
    expect(restored.host.messages).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.uid === filler!.uid)).toMatchObject({ location: "hand" });

    const result = applyLuaRestoreResponse(restored, action!);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("cannot be Special Summoned");
    assertFailedRestoreSurface(restored, result);
    expect(restored.host.messages).toContain("restored procedure filled zone 1/0");
    expect(restored.session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.uid === filler!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.filter((card) => card.controller === 0 && card.location === "monsterZone")).toHaveLength(4);
    expect(restored.session.state.log.some((entry) => entry.action === "specialSummon" && entry.card === "Zone Lost Filler")).toBe(false);
  });

  it("rolls back restored Lua procedures when checked material moves are partial", () => {
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
        e:SetOperation(function(e,c)
          local first=Duel.SelectMatchingCard(c:GetControler(), aux.FilterBoolFunction(Card.IsCode, 200), c:GetControler(), LOCATION_HAND, 0, 1, 1, c):GetFirst()
          local blocked=Duel.SelectMatchingCard(c:GetControler(), aux.FilterBoolFunction(Card.IsCode, 300), c:GetControler(), LOCATION_HAND, 0, 1, 1, c):GetFirst()
          local g=Group.FromCards(first, blocked)
          local moved=Duel.SendtoGrave(g, REASON_MATERIAL + REASON_SPSUMMON)
          Debug.Message("restored partial material moves " .. moved .. "/" .. g:GetCount())
          if moved~=g:GetCount() then error("restored procedure material move count mismatch") end
        end)
        c:RegisterEffect(e)
      end
      `;
        }
        if (name === "c300.lua") {
          return `
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_CANNOT_TO_GRAVE)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_HAND)
        e:SetTargetRange(1,0)
        e:SetCondition(function(e,tp)
          return Duel.IsExistingMatchingCard(aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_GRAVE, 0, 1, nil)
        end)
        c:RegisterEffect(e)
      end
      `;
        }
        return undefined;
      },
    };
    const host = createLuaScriptHost(session);
    const setup = host.loadCardScript(100, sourceScript);
    const blockerSetup = host.loadCardScript(300, sourceScript);
    expect(setup.ok, setup.error).toBe(true);
    expect(blockerSetup.ok, blockerSetup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), sourceScript, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.loadedScripts.map((script) => script.name).sort()).toEqual(["c100.lua", "c300.lua"]);
    expect(restored.loadedScripts.every((script) => script.ok)).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual([]);
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "specialSummonProcedure" && candidate.uid === source!.uid);
    expect(action).toBeDefined();
    expect(hasGroupedProcedure(restored, source!.uid)).toBe(true);

    const staleAction = applyLuaRestoreResponse(restored, { ...action!, windowId: action!.windowId! - 1 });
    expect(staleAction.ok).toBe(false);
    expect(staleAction.error).toContain("Response is not currently legal");
    expect(staleAction.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    assertFailedRestoreSurface(restored, staleAction);
    expect(restored.host.messages).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.uid === firstMaterial!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.uid === blockedMaterial!.uid)).toMatchObject({ location: "hand" });

    const result = applyLuaRestoreResponse(restored, action!);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("restored procedure material move count mismatch");
    assertFailedRestoreSurface(restored, result);
    expect(restored.host.messages).toContain("restored partial material moves 1/2");
    expect(restored.session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.uid === firstMaterial!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.uid === blockedMaterial!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.log.some((entry) => entry.action === "sendToGraveyard" && entry.card === "First Partial Material")).toBe(false);
  });
});

function assertFailedRestoreSurface(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: ReturnType<typeof applyLuaRestoreResponse>): void {
  const windowId = restored.session.state.actionWindowId;
  expect(response.state.actionWindowId).toBe(windowId);
  expect(response.state.windowKind).toBe("open");
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  for (const action of response.legalActions) expect(action).toMatchObject({ windowId, windowKind: "open" });
  for (const group of response.legalActionGroups) expect(group).toMatchObject({ windowId, windowKind: "open" });
}

function hasGroupedProcedure(restored: ReturnType<typeof restoreDuelWithLuaScripts>, uid: string): boolean {
  return getLuaRestoreLegalActionGroups(restored, 0).some((group) =>
    group.actions.some((action) => action.type === "specialSummonProcedure" && action.uid === uid),
  );
}
