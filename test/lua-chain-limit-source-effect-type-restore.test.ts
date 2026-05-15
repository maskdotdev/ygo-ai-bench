import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua source/effect-type chain-limit restore", () => {
  it("restores named active-type activation block predicates from snapshots", () => {
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
            c100 = {}
            c100.initial_effect = function(c)
              local e = Effect.CreateEffect(c)
              e:SetType(EFFECT_TYPE_IGNITION)
              e:SetRange(LOCATION_HAND)
              e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
                if chk==0 then return true end
                Duel.SetChainLimitTillChainEnd(c100.elimit)
              end)
              e:SetOperation(function(e,tp) Debug.Message("active/effect-type limit source resolved") end)
              c:RegisterEffect(e)
            end
            function c100.elimit(re,rp,tp)
              return not (re:IsActiveType(TYPE_SPELL+TYPE_TRAP) and re:IsHasType(EFFECT_TYPE_ACTIVATE))
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "blocked spell activation resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        if (name === "c300.lua") return quickScript(300, "blocked trap activation resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        if (name === "c400.lua") return quickScript(400, "allowed spell quick effect resolved", "EFFECT_TYPE_QUICK_O");
        if (name === "c500.lua") return quickScript(500, "allowed monster activation-type response resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([
      { id: 100, type: 1 },
      { id: 200, type: 2 },
      { id: 300, type: 4 },
      { id: 400, type: 2 },
      { id: 500, type: 1 },
    ], []);
    const session = createDuel({ seed: 318, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200", "300", "400", "500"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.loadCardScript(400, source).ok).toBe(true);
    expect(host.loadCardScript(500, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(5);

    const sourceAction = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(sourceAction).toBeDefined();
    const opened = applyResponse(session, sourceAction!);
    expect(opened.ok, opened.error).toBe(true);

    const registryKey = "lua-chain-limit:100:0:chain:known:closure:not-active-type-effect-type:6:16";
    expect(serializeDuel(session).state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-2")).toBe(false);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-3")).toBe(false);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-4")).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-5")).toBe(true);

    const opponentWindowRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(opponentWindowRestored, registryKey);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-2")).toBe(false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-3")).toBe(false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-4")).toBe(true);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-5")).toBe(true);

    const restoredAction = getLuaRestoreLegalActions(opponentWindowRestored, 1).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-4");
    expect(restoredAction).toBeDefined();
    const restoredResponse = applyLuaRestoreResponse(opponentWindowRestored, restoredAction!);
    expect(restoredResponse.ok, restoredResponse.error).toBe(true);
  });

  it("restores hex literal active-type activation block predicates from snapshots", () => {
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
            c100 = {}
            c100.initial_effect = function(c)
              local e = Effect.CreateEffect(c)
              e:SetType(EFFECT_TYPE_IGNITION)
              e:SetRange(LOCATION_HAND)
              e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
                if chk==0 then return true end
                Duel.SetChainLimitTillChainEnd(c100.hexelimit)
              end)
              e:SetOperation(function(e,tp) Debug.Message("hex active/effect-type limit source resolved") end)
              c:RegisterEffect(e)
            end
            function c100.hexelimit(re,rp,tp)
              return not (re:IsActiveType(0x6) and re:IsHasType(0x10))
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "blocked hex spell activation resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        if (name === "c300.lua") return quickScript(300, "blocked hex trap activation resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        if (name === "c400.lua") return quickScript(400, "allowed hex spell quick effect resolved", "EFFECT_TYPE_QUICK_O");
        if (name === "c500.lua") return quickScript(500, "allowed hex monster activation-type response resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([
      { id: 100, type: 1 },
      { id: 200, type: 2 },
      { id: 300, type: 4 },
      { id: 400, type: 2 },
      { id: 500, type: 1 },
    ], []);
    const session = createDuel({ seed: 322, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200", "300", "400", "500"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.loadCardScript(400, source).ok).toBe(true);
    expect(host.loadCardScript(500, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(5);

    const sourceAction = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(sourceAction).toBeDefined();
    const opened = applyResponse(session, sourceAction!);
    expect(opened.ok, opened.error).toBe(true);

    const registryKey = "lua-chain-limit:100:0:chain:known:closure:not-active-type-effect-type:6:16";
    expect(serializeDuel(session).state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-2")).toBe(false);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-3")).toBe(false);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-4")).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-5")).toBe(true);

    const opponentWindowRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(opponentWindowRestored, registryKey);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-2")).toBe(false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-3")).toBe(false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-4")).toBe(true);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-5")).toBe(true);

    const restoredAction = getLuaRestoreLegalActions(opponentWindowRestored, 1).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-4");
    expect(restoredAction).toBeDefined();
    const restoredResponse = applyLuaRestoreResponse(opponentWindowRestored, restoredAction!);
    expect(restoredResponse.ok, restoredResponse.error).toBe(true);
  });

  it("restores reversed hex literal active/effect-type activation block predicates from snapshots", () => {
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
            c100 = {}
            c100.initial_effect = function(c)
              local e = Effect.CreateEffect(c)
              e:SetType(EFFECT_TYPE_IGNITION)
              e:SetRange(LOCATION_HAND)
              e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
                if chk==0 then return true end
                Duel.SetChainLimitTillChainEnd(c100.reversehexlimit)
              end)
              e:SetOperation(function(e,tp) Debug.Message("reversed hex active/effect-type limit source resolved") end)
              c:RegisterEffect(e)
            end
            function c100.reversehexlimit(re,rp,tp)
              return not (re:IsHasType(0x10) and re:IsActiveType(0x6))
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "blocked reversed hex spell activation resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        if (name === "c300.lua") return quickScript(300, "blocked reversed hex trap activation resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        if (name === "c400.lua") return quickScript(400, "allowed reversed hex spell quick effect resolved", "EFFECT_TYPE_QUICK_O");
        if (name === "c500.lua") return quickScript(500, "allowed reversed hex monster activation-type response resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([
      { id: 100, type: 1 },
      { id: 200, type: 2 },
      { id: 300, type: 4 },
      { id: 400, type: 2 },
      { id: 500, type: 1 },
    ], []);
    const session = createDuel({ seed: 323, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200", "300", "400", "500"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.loadCardScript(400, source).ok).toBe(true);
    expect(host.loadCardScript(500, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(5);

    const sourceAction = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(sourceAction).toBeDefined();
    const opened = applyResponse(session, sourceAction!);
    expect(opened.ok, opened.error).toBe(true);

    const registryKey = "lua-chain-limit:100:0:chain:known:closure:not-active-type-effect-type:6:16";
    expect(serializeDuel(session).state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-2")).toBe(false);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-3")).toBe(false);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-4")).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-5")).toBe(true);

    const opponentWindowRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(opponentWindowRestored, registryKey);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-2")).toBe(false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-3")).toBe(false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-4")).toBe(true);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-5")).toBe(true);

    const restoredAction = getLuaRestoreLegalActions(opponentWindowRestored, 1).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-4");
    expect(restoredAction).toBeDefined();
    const restoredResponse = applyLuaRestoreResponse(opponentWindowRestored, restoredAction!);
    expect(restoredResponse.ok, restoredResponse.error).toBe(true);
  });

  it("restores named trap activation block predicates from snapshots", () => {
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
            c100 = {}
            c100.initial_effect = function(c)
              local e = Effect.CreateEffect(c)
              e:SetType(EFFECT_TYPE_IGNITION)
              e:SetRange(LOCATION_HAND)
              e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
                if chk==0 then return true end
                Duel.SetChainLimitTillChainEnd(c100.chlimit)
              end)
              e:SetOperation(function(e,tp) Debug.Message("source/effect-type limit source resolved") end)
              c:RegisterEffect(e)
            end
            function c100.chlimit(re,rp,tp)
              return not re:GetHandler():IsTrap() or not re:IsHasType(EFFECT_TYPE_ACTIVATE)
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "blocked trap activation resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        if (name === "c300.lua") return quickScript(300, "allowed trap quick effect resolved", "EFFECT_TYPE_QUICK_O");
        if (name === "c400.lua") return quickScript(400, "allowed spell activation resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([
      { id: 100, type: 1 },
      { id: 200, type: 4 },
      { id: 300, type: 4 },
      { id: 400, type: 2 },
    ], []);
    const session = createDuel({ seed: 319, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200", "300", "400"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.loadCardScript(400, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const sourceAction = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(sourceAction).toBeDefined();
    const opened = applyResponse(session, sourceAction!);
    expect(opened.ok, opened.error).toBe(true);

    const registryKey = "lua-chain-limit:100:0:chain:known:closure:not-source-type-effect-type:4:16";
    expect(serializeDuel(session).state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-2")).toBe(false);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-3")).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-4")).toBe(true);

    const opponentWindowRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(opponentWindowRestored, registryKey);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-2")).toBe(false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-3")).toBe(true);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-4")).toBe(true);

    const restoredAction = getLuaRestoreLegalActions(opponentWindowRestored, 1).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3");
    expect(restoredAction).toBeDefined();
    const restoredResponse = applyLuaRestoreResponse(opponentWindowRestored, restoredAction!);
    expect(restoredResponse.ok, restoredResponse.error).toBe(true);
  });

  it("restores hex literal source/effect-type activation block predicates from snapshots", () => {
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
            c100 = {}
            c100.initial_effect = function(c)
              local e = Effect.CreateEffect(c)
              e:SetType(EFFECT_TYPE_IGNITION)
              e:SetRange(LOCATION_HAND)
              e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
                if chk==0 then return true end
                Duel.SetChainLimitTillChainEnd(c100.hexlimit)
              end)
              e:SetOperation(function(e,tp) Debug.Message("hex source/effect-type limit source resolved") end)
              c:RegisterEffect(e)
            end
            function c100.hexlimit(re,rp,tp)
              return not re:GetHandler():IsType(0x4) or not re:IsHasType(0x10)
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "blocked hex trap activation resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        if (name === "c300.lua") return quickScript(300, "allowed hex trap quick effect resolved", "EFFECT_TYPE_QUICK_O");
        if (name === "c400.lua") return quickScript(400, "allowed hex spell activation resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([
      { id: 100, type: 1 },
      { id: 200, type: 4 },
      { id: 300, type: 4 },
      { id: 400, type: 2 },
    ], []);
    const session = createDuel({ seed: 321, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200", "300", "400"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.loadCardScript(400, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const sourceAction = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(sourceAction).toBeDefined();
    const opened = applyResponse(session, sourceAction!);
    expect(opened.ok, opened.error).toBe(true);

    const registryKey = "lua-chain-limit:100:0:chain:known:closure:not-source-type-effect-type:4:16";
    expect(serializeDuel(session).state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-2")).toBe(false);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-3")).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-4")).toBe(true);

    const opponentWindowRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(opponentWindowRestored, registryKey);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-2")).toBe(false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-3")).toBe(true);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-4")).toBe(true);

    const restoredAction = getLuaRestoreLegalActions(opponentWindowRestored, 1).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3");
    expect(restoredAction).toBeDefined();
    const restoredResponse = applyLuaRestoreResponse(opponentWindowRestored, restoredAction!);
    expect(restoredResponse.ok, restoredResponse.error).toBe(true);
  });

  it("restores named trap activation block predicates with source setcode exclusions", () => {
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
            c100 = {}
            c100.initial_effect = function(c)
              local e = Effect.CreateEffect(c)
              e:SetType(EFFECT_TYPE_IGNITION)
              e:SetRange(LOCATION_HAND)
              e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
                if chk==0 then return true end
                Duel.SetChainLimitTillChainEnd(c100.chlimit)
              end)
              e:SetOperation(function(e,tp) Debug.Message("setcode source/effect-type limit source resolved") end)
              c:RegisterEffect(e)
            end
            function c100.chlimit(re,rp,tp)
              return not re:GetHandler():IsTrap() or not re:IsHasType(EFFECT_TYPE_ACTIVATE) or not re:GetHandler():IsSetCard(SET_TRAP_HOLE)
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "blocked trap set activation resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        if (name === "c300.lua") return quickScript(300, "allowed trap set quick effect resolved", "EFFECT_TYPE_QUICK_O");
        if (name === "c400.lua") return quickScript(400, "allowed off-set trap activation resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        if (name === "c500.lua") return quickScript(500, "allowed spell set activation resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([
      { id: 100, type: 1 },
      { id: 200, type: 4, setcode: 0x4c },
      { id: 300, type: 4, setcode: 0x4c },
      { id: 400, type: 4, setcode: 0x123 },
      { id: 500, type: 2, setcode: 0x4c },
    ], []);
    const session = createDuel({ seed: 320, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200", "300", "400", "500"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.loadCardScript(400, source).ok).toBe(true);
    expect(host.loadCardScript(500, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(5);

    const sourceAction = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(sourceAction).toBeDefined();
    const opened = applyResponse(session, sourceAction!);
    expect(opened.ok, opened.error).toBe(true);

    const registryKey = "lua-chain-limit:100:0:chain:known:closure:not-source-type-effect-type-setcode:4:16:76";
    expect(serializeDuel(session).state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-2")).toBe(false);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-3")).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-4")).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-5")).toBe(true);

    const opponentWindowRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(opponentWindowRestored, registryKey);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-2")).toBe(false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-3")).toBe(true);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-4")).toBe(true);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-5")).toBe(true);
  });

  it("restores hex literal trap activation block predicates with source setcode exclusions", () => {
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
            c100 = {}
            c100.initial_effect = function(c)
              local e = Effect.CreateEffect(c)
              e:SetType(EFFECT_TYPE_IGNITION)
              e:SetRange(LOCATION_HAND)
              e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
                if chk==0 then return true end
                Duel.SetChainLimitTillChainEnd(c100.hexsetlimit)
              end)
              e:SetOperation(function(e,tp) Debug.Message("hex setcode source/effect-type limit source resolved") end)
              c:RegisterEffect(e)
            end
            function c100.hexsetlimit(re,rp,tp)
              return not re:GetHandler():IsType(0x4) or not re:IsHasType(0x10) or not re:GetHandler():IsSetCard(0x4c)
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "blocked hex trap set activation resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        if (name === "c300.lua") return quickScript(300, "allowed hex trap set quick effect resolved", "EFFECT_TYPE_QUICK_O");
        if (name === "c400.lua") return quickScript(400, "allowed hex off-set trap activation resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        if (name === "c500.lua") return quickScript(500, "allowed hex spell set activation resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([
      { id: 100, type: 1 },
      { id: 200, type: 4, setcode: 0x4c },
      { id: 300, type: 4, setcode: 0x4c },
      { id: 400, type: 4, setcode: 0x123 },
      { id: 500, type: 2, setcode: 0x4c },
    ], []);
    const session = createDuel({ seed: 324, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200", "300", "400", "500"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.loadCardScript(400, source).ok).toBe(true);
    expect(host.loadCardScript(500, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(5);

    const sourceAction = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(sourceAction).toBeDefined();
    const opened = applyResponse(session, sourceAction!);
    expect(opened.ok, opened.error).toBe(true);

    const registryKey = "lua-chain-limit:100:0:chain:known:closure:not-source-type-effect-type-setcode:4:16:76";
    expect(serializeDuel(session).state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-2")).toBe(false);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-3")).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-4")).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-5")).toBe(true);

    const opponentWindowRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(opponentWindowRestored, registryKey);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-2")).toBe(false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-3")).toBe(true);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-4")).toBe(true);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-5")).toBe(true);

    const restoredAction = getLuaRestoreLegalActions(opponentWindowRestored, 1).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3");
    expect(restoredAction).toBeDefined();
    const restoredResponse = applyLuaRestoreResponse(opponentWindowRestored, restoredAction!);
    expect(restoredResponse.ok, restoredResponse.error).toBe(true);
  });
});

function quickScript(code: number, message: string, effectType: string): string {
  return `
    c${code} = {}
    c${code}.initial_effect = function(c)
      local e = Effect.CreateEffect(c)
      e:SetType(${effectType})
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("${message}") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectRestoredChainLimit(restored: ReturnType<typeof restoreDuelWithLuaScripts>, registryKey: string): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
  expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
  expectRestoredLegalActions(restored, 0);
  expectRestoredLegalActions(restored, 1);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function hasLuaEffect(actions: ReturnType<typeof getLegalActions>, player: 0 | 1, effectId: string): boolean {
  return actions.some((action) => action.type === "activateEffect" && action.player === player && action.effectId === effectId);
}

function hasGroupedLuaEffect(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1, effectId: string): boolean {
  return getLuaRestoreLegalActionGroups(restored, player).some((group) =>
    group.actions.some((action) => action.type === "activateEffect" && action.player === player && action.effectId === effectId),
  );
}
