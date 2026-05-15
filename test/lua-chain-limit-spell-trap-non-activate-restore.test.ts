import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua Spell/Trap non-activation chain-limit restore", () => {
  it("restores response-player-or-spell-trap-non-activation predicates from snapshots", () => {
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
                Duel.SetChainLimit(function(e,rp,tp) return tp==rp or (e:IsSpellTrapEffect() and not e:IsHasType(EFFECT_TYPE_ACTIVATE)) end)
              end)
              e:SetOperation(function(e,tp) Debug.Message("spell-trap non-activation limit source resolved") end)
              c:RegisterEffect(e)
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "same-player monster response resolved", "EFFECT_TYPE_QUICK_O");
        if (name === "c300.lua") return quickScript(300, "blocked opponent monster response resolved", "EFFECT_TYPE_QUICK_O");
        if (name === "c400.lua") return quickScript(400, "allowed opponent spell effect response resolved", "EFFECT_TYPE_QUICK_O");
        if (name === "c500.lua") return quickScript(500, "blocked opponent spell activation response resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([
      { id: 100, type: 1 },
      { id: 200, type: 1 },
      { id: 300, type: 1 },
      { id: 400, type: 2 },
      { id: 500, type: 2 },
    ], []);
    const session = createDuel({ seed: 317, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: ["300", "400", "500"] } });
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

    const registryKey = "lua-chain-limit:100:0:link:known:closure:source-type-non-activate-response-player:6";
    expect(serializeDuel(session).state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-3")).toBe(false);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-4")).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-5")).toBe(false);

    const opponentWindowRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(opponentWindowRestored, registryKey);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-3")).toBe(false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-4")).toBe(true);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-5")).toBe(false);

    const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(opponentPass).toBeDefined();
    const passed = applyResponse(session, opponentPass!);
    expect(passed.ok, passed.error).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 0), 0, "lua-2")).toBe(true);

    const handoffRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(handoffRestored, registryKey);
    expect(hasGroupedLuaEffect(handoffRestored, 0, "lua-2")).toBe(true);
    const restoredAction = getLuaRestoreLegalActions(handoffRestored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
    expect(restoredAction).toBeDefined();
    const restoredResponse = applyLuaRestoreResponse(handoffRestored, restoredAction!);
    expect(restoredResponse.ok, restoredResponse.error).toBe(true);
  });

  it("restores named response-player-or-spell-trap-non-activation predicates from snapshots", () => {
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
                Duel.SetChainLimit(c100.chainlm)
              end)
              e:SetOperation(function(e,tp) Debug.Message("named spell-trap non-activation limit source resolved") end)
              c:RegisterEffect(e)
            end
            function c100.chainlm(e,rp,tp)
              return tp==rp or (e:IsSpellTrapEffect() and not e:IsHasType(EFFECT_TYPE_ACTIVATE))
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "same-player named monster response resolved", "EFFECT_TYPE_QUICK_O");
        if (name === "c300.lua") return quickScript(300, "blocked named opponent monster response resolved", "EFFECT_TYPE_QUICK_O");
        if (name === "c400.lua") return quickScript(400, "allowed named opponent trap effect response resolved", "EFFECT_TYPE_QUICK_O");
        if (name === "c500.lua") return quickScript(500, "blocked named opponent trap activation response resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([
      { id: 100, type: 1 },
      { id: 200, type: 1 },
      { id: 300, type: 1 },
      { id: 400, type: 4 },
      { id: 500, type: 4 },
    ], []);
    const session = createDuel({ seed: 319, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: ["300", "400", "500"] } });
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

    const registryKey = "lua-chain-limit:100:0:link:known:closure:source-type-non-activate-response-player:6";
    expect(serializeDuel(session).state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-3")).toBe(false);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-4")).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-5")).toBe(false);

    const opponentWindowRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(opponentWindowRestored, registryKey);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-3")).toBe(false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-4")).toBe(true);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-5")).toBe(false);

    const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(opponentPass).toBeDefined();
    const passed = applyResponse(session, opponentPass!);
    expect(passed.ok, passed.error).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 0), 0, "lua-2")).toBe(true);

    const handoffRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(handoffRestored, registryKey);
    expect(hasGroupedLuaEffect(handoffRestored, 0, "lua-2")).toBe(true);
    const restoredAction = getLuaRestoreLegalActions(handoffRestored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
    expect(restoredAction).toBeDefined();
    const restoredResponse = applyLuaRestoreResponse(handoffRestored, restoredAction!);
    expect(restoredResponse.ok, restoredResponse.error).toBe(true);
  });

  it("restores hex literal response-player-or-spell-trap-non-activation predicates from snapshots", () => {
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
                Duel.SetChainLimit(c100.hexchainlm)
              end)
              e:SetOperation(function(e,tp) Debug.Message("hex spell-trap non-activation limit source resolved") end)
              c:RegisterEffect(e)
            end
            function c100.hexchainlm(e,rp,tp)
              return tp==rp or (e:IsSpellTrapEffect() and not e:IsHasType(0x10))
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "same-player hex monster response resolved", "EFFECT_TYPE_QUICK_O");
        if (name === "c300.lua") return quickScript(300, "blocked hex opponent monster response resolved", "EFFECT_TYPE_QUICK_O");
        if (name === "c400.lua") return quickScript(400, "allowed hex opponent trap effect response resolved", "EFFECT_TYPE_QUICK_O");
        if (name === "c500.lua") return quickScript(500, "blocked hex opponent trap activation response resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([
      { id: 100, type: 1 },
      { id: 200, type: 1 },
      { id: 300, type: 1 },
      { id: 400, type: 4 },
      { id: 500, type: 4 },
    ], []);
    const session = createDuel({ seed: 320, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: ["300", "400", "500"] } });
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

    const registryKey = "lua-chain-limit:100:0:link:known:closure:source-type-non-activate-response-player:6";
    expect(serializeDuel(session).state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-3")).toBe(false);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-4")).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-5")).toBe(false);

    const opponentWindowRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(opponentWindowRestored, registryKey);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-3")).toBe(false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-4")).toBe(true);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-5")).toBe(false);

    const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(opponentPass).toBeDefined();
    const passed = applyResponse(session, opponentPass!);
    expect(passed.ok, passed.error).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 0), 0, "lua-2")).toBe(true);

    const handoffRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(handoffRestored, registryKey);
    expect(hasGroupedLuaEffect(handoffRestored, 0, "lua-2")).toBe(true);
    const restoredAction = getLuaRestoreLegalActions(handoffRestored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
    expect(restoredAction).toBeDefined();
    const restoredResponse = applyLuaRestoreResponse(handoffRestored, restoredAction!);
    expect(restoredResponse.ok, restoredResponse.error).toBe(true);
  });

  it("restores named response-player-or-spell-trap-non-activation until-chain-end predicates from snapshots", () => {
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
                Duel.SetChainLimitTillChainEnd(c100.chainlm)
              end)
              e:SetOperation(function(e,tp) Debug.Message("named spell-trap non-activation until-chain-end limit source resolved") end)
              c:RegisterEffect(e)
            end
            function c100.chainlm(e,rp,tp)
              return tp==rp or (e:IsSpellTrapEffect() and not e:IsHasType(EFFECT_TYPE_ACTIVATE))
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "same-player named chain spell response resolved", "EFFECT_TYPE_QUICK_O");
        if (name === "c300.lua") return quickScript(300, "blocked named chain opponent monster response resolved", "EFFECT_TYPE_QUICK_O");
        if (name === "c400.lua") return quickScript(400, "allowed named chain opponent trap effect response resolved", "EFFECT_TYPE_QUICK_O");
        if (name === "c500.lua") return quickScript(500, "blocked named chain opponent trap activation response resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([
      { id: 100, type: 1 },
      { id: 200, type: 2 },
      { id: 300, type: 1 },
      { id: 400, type: 4 },
      { id: 500, type: 4 },
    ], []);
    const session = createDuel({ seed: 341, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: ["300", "400", "500"] } });
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

    const registryKey = "lua-chain-limit:100:0:chain:known:closure:source-type-non-activate-response-player:6";
    expect(serializeDuel(session).state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-3")).toBe(false);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-4")).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-5")).toBe(false);

    const opponentWindowRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(opponentWindowRestored, registryKey, true);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-3")).toBe(false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-4")).toBe(true);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-5")).toBe(false);

    const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(opponentPass).toBeDefined();
    const passed = applyResponse(session, opponentPass!);
    expect(passed.ok, passed.error).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 0), 0, "lua-2")).toBe(true);

    const handoffRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(handoffRestored, registryKey, true);
    expect(hasGroupedLuaEffect(handoffRestored, 0, "lua-2")).toBe(true);
    const restoredAction = getLuaRestoreLegalActions(handoffRestored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
    expect(restoredAction).toBeDefined();
    const restoredResponse = applyLuaRestoreResponse(handoffRestored, restoredAction!);
    expect(restoredResponse.ok, restoredResponse.error).toBe(true);
  });

  it("restores named response-player-or-trap-non-activation predicates from snapshots", () => {
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
                Duel.SetChainLimit(c100.chainlm)
              end)
              e:SetOperation(function(e,tp) Debug.Message("named trap non-activation limit source resolved") end)
              c:RegisterEffect(e)
            end
            function c100.chainlm(e,rp,tp)return tp==rp or (e:IsTrapEffect() and not e:IsHasType(EFFECT_TYPE_ACTIVATE))end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "same-player trap-only monster response resolved", "EFFECT_TYPE_QUICK_O");
        if (name === "c300.lua") return quickScript(300, "blocked trap-only opponent monster response resolved", "EFFECT_TYPE_QUICK_O");
        if (name === "c400.lua") return quickScript(400, "allowed trap-only opponent trap effect response resolved", "EFFECT_TYPE_QUICK_O");
        if (name === "c500.lua") return quickScript(500, "blocked trap-only opponent trap activation response resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        if (name === "c600.lua") return quickScript(600, "blocked trap-only opponent spell effect response resolved", "EFFECT_TYPE_QUICK_O");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([
      { id: 100, type: 1 },
      { id: 200, type: 1 },
      { id: 300, type: 1 },
      { id: 400, type: 4 },
      { id: 500, type: 4 },
      { id: 600, type: 2 },
    ], []);
    const session = createDuel({ seed: 331, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: ["300", "400", "500", "600"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.loadCardScript(400, source).ok).toBe(true);
    expect(host.loadCardScript(500, source).ok).toBe(true);
    expect(host.loadCardScript(600, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(6);

    const sourceAction = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(sourceAction).toBeDefined();
    const opened = applyResponse(session, sourceAction!);
    expect(opened.ok, opened.error).toBe(true);

    const registryKey = "lua-chain-limit:100:0:link:known:closure:source-type-non-activate-response-player:4";
    expect(serializeDuel(session).state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-3")).toBe(false);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-4")).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-5")).toBe(false);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-6")).toBe(false);

    const opponentWindowRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(opponentWindowRestored, registryKey);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-3")).toBe(false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-4")).toBe(true);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-5")).toBe(false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-6")).toBe(false);

    const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(opponentPass).toBeDefined();
    const passed = applyResponse(session, opponentPass!);
    expect(passed.ok, passed.error).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 0), 0, "lua-2")).toBe(true);

    const handoffRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(handoffRestored, registryKey);
    expect(hasGroupedLuaEffect(handoffRestored, 0, "lua-2")).toBe(true);
    const restoredAction = getLuaRestoreLegalActions(handoffRestored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
    expect(restoredAction).toBeDefined();
    const restoredResponse = applyLuaRestoreResponse(handoffRestored, restoredAction!);
    expect(restoredResponse.ok, restoredResponse.error).toBe(true);
  });

  it("restores named response-player-or-trap-non-activation until-chain-end predicates from snapshots", () => {
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
                Duel.SetChainLimitTillChainEnd(c100.chainlm)
              end)
              e:SetOperation(function(e,tp) Debug.Message("named trap non-activation until-chain-end limit source resolved") end)
              c:RegisterEffect(e)
            end
            function c100.chainlm(e,rp,tp)
              return tp==rp or (e:IsTrapEffect() and not e:IsHasType(EFFECT_TYPE_ACTIVATE))
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "same-player trap-only chain spell response resolved", "EFFECT_TYPE_QUICK_O");
        if (name === "c300.lua") return quickScript(300, "blocked trap-only chain opponent monster response resolved", "EFFECT_TYPE_QUICK_O");
        if (name === "c400.lua") return quickScript(400, "allowed trap-only chain opponent trap effect response resolved", "EFFECT_TYPE_QUICK_O");
        if (name === "c500.lua") return quickScript(500, "blocked trap-only chain opponent trap activation response resolved", "EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE");
        if (name === "c600.lua") return quickScript(600, "blocked trap-only chain opponent spell effect response resolved", "EFFECT_TYPE_QUICK_O");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([
      { id: 100, type: 1 },
      { id: 200, type: 2 },
      { id: 300, type: 1 },
      { id: 400, type: 4 },
      { id: 500, type: 4 },
      { id: 600, type: 2 },
    ], []);
    const session = createDuel({ seed: 343, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: ["300", "400", "500", "600"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.loadCardScript(400, source).ok).toBe(true);
    expect(host.loadCardScript(500, source).ok).toBe(true);
    expect(host.loadCardScript(600, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(6);

    const sourceAction = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(sourceAction).toBeDefined();
    const opened = applyResponse(session, sourceAction!);
    expect(opened.ok, opened.error).toBe(true);

    const registryKey = "lua-chain-limit:100:0:chain:known:closure:source-type-non-activate-response-player:4";
    expect(serializeDuel(session).state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-3")).toBe(false);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-4")).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-5")).toBe(false);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-6")).toBe(false);

    const opponentWindowRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(opponentWindowRestored, registryKey, true);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-3")).toBe(false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-4")).toBe(true);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-5")).toBe(false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-6")).toBe(false);

    const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(opponentPass).toBeDefined();
    const passed = applyResponse(session, opponentPass!);
    expect(passed.ok, passed.error).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 0), 0, "lua-2")).toBe(true);

    const handoffRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(handoffRestored, registryKey, true);
    expect(hasGroupedLuaEffect(handoffRestored, 0, "lua-2")).toBe(true);
    const restoredAction = getLuaRestoreLegalActions(handoffRestored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
    expect(restoredAction).toBeDefined();
    const restoredResponse = applyLuaRestoreResponse(handoffRestored, restoredAction!);
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

function expectRestoredChainLimit(restored: ReturnType<typeof restoreDuelWithLuaScripts>, registryKey: string, untilChainEnd = false): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
  expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd });
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
