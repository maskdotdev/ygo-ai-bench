import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import { expectLuaRestoreResponseLegalActions } from "./lua-restore-response-helpers.js";

describe("Lua active-type response-player chain-limit restore", () => {
  it("restores inline response-player-or-not-monster-effect predicates from snapshots", () => {
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
                Duel.SetChainLimit(function(e,ep,tp) return ep==tp or not e:IsMonsterEffect() end)
              end)
              e:SetOperation(function(e,tp) Debug.Message("response-player active-type limit source resolved") end)
              c:RegisterEffect(e)
            end
          `;
        }
        if (name === "c200.lua") {
          return `
            c200 = {}
            c200.initial_effect = function(c)
              local e = Effect.CreateEffect(c)
              e:SetType(EFFECT_TYPE_QUICK_O)
              e:SetRange(LOCATION_HAND)
              e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
              e:SetOperation(function(e,tp) Debug.Message("same-player monster response resolved") end)
              c:RegisterEffect(e)
            end
          `;
        }
        if (name === "c300.lua") {
          return `
            c300 = {}
            c300.initial_effect = function(c)
              local e = Effect.CreateEffect(c)
              e:SetType(EFFECT_TYPE_QUICK_O)
              e:SetRange(LOCATION_HAND)
              e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
              e:SetOperation(function(e,tp) Debug.Message("blocked opponent monster response resolved") end)
              c:RegisterEffect(e)
            end
          `;
        }
        if (name === "c400.lua") {
          return `
            c400 = {}
            c400.initial_effect = function(c)
              local e = Effect.CreateEffect(c)
              e:SetType(EFFECT_TYPE_QUICK_O)
              e:SetRange(LOCATION_HAND)
              e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
              e:SetOperation(function(e,tp) Debug.Message("allowed opponent spell response resolved") end)
              c:RegisterEffect(e)
            end
          `;
        }
        return undefined;
      },
    };

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }, { id: 400, type: 2 }], []);
    const session = createDuel({ seed: 269, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: ["300", "400"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.loadCardScript(400, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);
    const sourceAction = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(sourceAction).toBeDefined();
    const sourceResult = applyResponse(session, sourceAction!);
    expect(sourceResult.ok, sourceResult.error).toBe(true);

    const registryKey = "lua-chain-limit:100:0:link:known:closure:not-active-type-response-player:1";
    expect(serializeDuel(session).state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3")).toBe(false);
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-4")).toBe(true);

    const opponentWindowRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(opponentWindowRestored, registryKey);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-3")).toBe(false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-4")).toBe(true);

    const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(opponentPass).toBeDefined();
    const passResult = applyResponse(session, opponentPass!);
    expect(passResult.ok, passResult.error).toBe(true);
    expect(getLegalActions(session, 0).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2")).toBe(true);

    const handoffRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(handoffRestored, registryKey);
    expect(hasGroupedLuaEffect(handoffRestored, 0, "lua-2")).toBe(true);
    const restoredAction = getLuaRestoreLegalActions(handoffRestored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
    expect(restoredAction).toBeDefined();
    const restoredResponse = applyLuaRestoreResponse(handoffRestored, restoredAction!);
    expectLuaRestoreResponseLegalActions(handoffRestored, restoredResponse);
  });

  it("restores named response-player-or-not-monster-effect predicates from snapshots", () => {
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
              e:SetOperation(function(e,tp) Debug.Message("named response-player active-type limit source resolved") end)
              c:RegisterEffect(e)
            end
            function c100.chainlm(e,rp,tp)
              return rp==tp or not e:IsMonsterEffect()
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "same-player named monster response resolved", "TYPE_MONSTER");
        if (name === "c300.lua") return quickScript(300, "blocked named opponent monster response resolved", "TYPE_MONSTER");
        if (name === "c400.lua") return quickScript(400, "allowed named opponent spell response resolved", "TYPE_SPELL");
        return undefined;
      },
    };

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }, { id: 400, type: 2 }], []);
    const session = createDuel({ seed: 337, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: ["300", "400"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.loadCardScript(400, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);
    const sourceAction = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(sourceAction).toBeDefined();
    const sourceResult = applyResponse(session, sourceAction!);
    expect(sourceResult.ok, sourceResult.error).toBe(true);

    const registryKey = "lua-chain-limit:100:0:link:known:closure:not-active-type-response-player:1";
    expect(serializeDuel(session).state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3")).toBe(false);
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-4")).toBe(true);

    const opponentWindowRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(opponentWindowRestored, registryKey);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-3")).toBe(false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-4")).toBe(true);

    const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(opponentPass).toBeDefined();
    const passResult = applyResponse(session, opponentPass!);
    expect(passResult.ok, passResult.error).toBe(true);
    expect(getLegalActions(session, 0).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2")).toBe(true);

    const handoffRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(handoffRestored, registryKey);
    expect(hasGroupedLuaEffect(handoffRestored, 0, "lua-2")).toBe(true);
    const restoredAction = getLuaRestoreLegalActions(handoffRestored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
    expect(restoredAction).toBeDefined();
    const restoredResponse = applyLuaRestoreResponse(handoffRestored, restoredAction!);
    expectLuaRestoreResponseLegalActions(handoffRestored, restoredResponse);
  });

  it("restores named chain-player-or-not-monster-effect predicates from snapshots", () => {
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
              e:SetOperation(function(e,tp) Debug.Message("named chain-player active-type limit source resolved") end)
              c:RegisterEffect(e)
            end
            function c100.chainlm(e,rp,tp)
              return tp==rp or not e:IsMonsterEffect()
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "same-player chain-player monster response resolved", "TYPE_MONSTER");
        if (name === "c300.lua") return quickScript(300, "blocked chain-player opponent monster response resolved", "TYPE_MONSTER");
        if (name === "c400.lua") return quickScript(400, "allowed chain-player opponent spell response resolved", "TYPE_SPELL");
        return undefined;
      },
    };

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }, { id: 400, type: 2 }], []);
    const session = createDuel({ seed: 338, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: ["300", "400"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.loadCardScript(400, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);
    const sourceAction = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(sourceAction).toBeDefined();
    const sourceResult = applyResponse(session, sourceAction!);
    expect(sourceResult.ok, sourceResult.error).toBe(true);

    const registryKey = "lua-chain-limit:100:0:link:known:closure:not-active-type-response-player:1";
    expect(serializeDuel(session).state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3")).toBe(false);
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-4")).toBe(true);

    const opponentWindowRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(opponentWindowRestored, registryKey);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-3")).toBe(false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-4")).toBe(true);

    const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(opponentPass).toBeDefined();
    const passResult = applyResponse(session, opponentPass!);
    expect(passResult.ok, passResult.error).toBe(true);
    expect(getLegalActions(session, 0).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2")).toBe(true);

    const handoffRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(handoffRestored, registryKey);
    expect(hasGroupedLuaEffect(handoffRestored, 0, "lua-2")).toBe(true);
    const restoredAction = getLuaRestoreLegalActions(handoffRestored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
    expect(restoredAction).toBeDefined();
    const restoredResponse = applyLuaRestoreResponse(handoffRestored, restoredAction!);
    expectLuaRestoreResponseLegalActions(handoffRestored, restoredResponse);
  });

  it("restores inline response-player-or-not-IsActiveType predicates from snapshots", () => {
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
                Duel.SetChainLimit(function(e,ep,tp) return ep==tp or not e:IsActiveType(TYPE_TRAP) end)
              end)
              e:SetOperation(function(e,tp) Debug.Message("response-player direct active-type limit source resolved") end)
              c:RegisterEffect(e)
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "same-player trap response resolved", "TYPE_TRAP");
        if (name === "c300.lua") return quickScript(300, "blocked opponent trap response resolved", "TYPE_TRAP");
        if (name === "c400.lua") return quickScript(400, "allowed opponent spell response resolved", "TYPE_SPELL");
        return undefined;
      },
    };

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 4 }, { id: 300, type: 4 }, { id: 400, type: 2 }], []);
    const session = createDuel({ seed: 270, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: ["300", "400"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.loadCardScript(400, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);
    const sourceAction = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(sourceAction).toBeDefined();
    const sourceResult = applyResponse(session, sourceAction!);
    expect(sourceResult.ok, sourceResult.error).toBe(true);

    const registryKey = "lua-chain-limit:100:0:link:known:closure:not-active-type-response-player:4";
    expect(serializeDuel(session).state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3")).toBe(false);
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-4")).toBe(true);

    const opponentWindowRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(opponentWindowRestored, registryKey);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-3")).toBe(false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-4")).toBe(true);

    const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(opponentPass).toBeDefined();
    const passResult = applyResponse(session, opponentPass!);
    expect(passResult.ok, passResult.error).toBe(true);
    expect(getLegalActions(session, 0).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2")).toBe(true);

    const handoffRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(handoffRestored, registryKey);
    expect(hasGroupedLuaEffect(handoffRestored, 0, "lua-2")).toBe(true);
    const restoredAction = getLuaRestoreLegalActions(handoffRestored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
    expect(restoredAction).toBeDefined();
    const restoredResponse = applyLuaRestoreResponse(handoffRestored, restoredAction!);
    expectLuaRestoreResponseLegalActions(handoffRestored, restoredResponse);
  });

  it("restores hex literal response-player-or-not-IsActiveType predicates from snapshots", () => {
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
                Duel.SetChainLimit(function(e,ep,tp) return ep==tp or not e:IsActiveType(0x4) end)
              end)
              e:SetOperation(function(e,tp) Debug.Message("response-player hex active-type limit source resolved") end)
              c:RegisterEffect(e)
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "same-player hex trap response resolved", "TYPE_TRAP");
        if (name === "c300.lua") return quickScript(300, "blocked opponent hex trap response resolved", "TYPE_TRAP");
        if (name === "c400.lua") return quickScript(400, "allowed opponent hex spell response resolved", "TYPE_SPELL");
        return undefined;
      },
    };

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 4 }, { id: 300, type: 4 }, { id: 400, type: 2 }], []);
    const session = createDuel({ seed: 272, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: ["300", "400"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.loadCardScript(400, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);
    const sourceAction = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(sourceAction).toBeDefined();
    const sourceResult = applyResponse(session, sourceAction!);
    expect(sourceResult.ok, sourceResult.error).toBe(true);

    const registryKey = "lua-chain-limit:100:0:link:known:closure:not-active-type-response-player:4";
    expect(serializeDuel(session).state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3")).toBe(false);
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-4")).toBe(true);

    const opponentWindowRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(opponentWindowRestored, registryKey);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-3")).toBe(false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-4")).toBe(true);

    const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(opponentPass).toBeDefined();
    const passResult = applyResponse(session, opponentPass!);
    expect(passResult.ok, passResult.error).toBe(true);
    expect(getLegalActions(session, 0).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2")).toBe(true);

    const handoffRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(handoffRestored, registryKey);
    expect(hasGroupedLuaEffect(handoffRestored, 0, "lua-2")).toBe(true);
    const restoredAction = getLuaRestoreLegalActions(handoffRestored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
    expect(restoredAction).toBeDefined();
    const restoredResponse = applyLuaRestoreResponse(handoffRestored, restoredAction!);
    expectLuaRestoreResponseLegalActions(handoffRestored, restoredResponse);
  });

  it("restores inline response-player-or-not-IsActiveType predicates with combined masks", () => {
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
                Duel.SetChainLimit(function(e,ep,tp) return ep==tp or not e:IsActiveType(TYPE_SPELL|TYPE_TRAP) end)
              end)
              e:SetOperation(function(e,tp) Debug.Message("response-player combined active-type limit source resolved") end)
              c:RegisterEffect(e)
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "same-player spell response resolved", "TYPE_SPELL");
        if (name === "c300.lua") return quickScript(300, "allowed opponent monster response resolved", "TYPE_MONSTER");
        if (name === "c400.lua") return quickScript(400, "blocked opponent spell response resolved", "TYPE_SPELL");
        if (name === "c500.lua") return quickScript(500, "blocked opponent trap response resolved", "TYPE_TRAP");
        return undefined;
      },
    };

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 2 }, { id: 300, type: 1 }, { id: 400, type: 2 }, { id: 500, type: 4 }], []);
    const session = createDuel({ seed: 271, startingHandSize: 3, cardReader: createCardReader(cards) });
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
    const sourceResult = applyResponse(session, sourceAction!);
    expect(sourceResult.ok, sourceResult.error).toBe(true);

    const registryKey = "lua-chain-limit:100:0:link:known:closure:not-active-type-response-player:6";
    expect(serializeDuel(session).state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3")).toBe(true);
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-4")).toBe(false);
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-5")).toBe(false);

    const opponentWindowRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(opponentWindowRestored, registryKey);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-3")).toBe(true);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-4")).toBe(false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-5")).toBe(false);

    const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(opponentPass).toBeDefined();
    const passResult = applyResponse(session, opponentPass!);
    expect(passResult.ok, passResult.error).toBe(true);

    const handoffRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(handoffRestored, registryKey);
    expect(hasGroupedLuaEffect(handoffRestored, 0, "lua-2")).toBe(true);
    const restoredAction = getLuaRestoreLegalActions(handoffRestored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
    expect(restoredAction).toBeDefined();
    const restoredResponse = applyLuaRestoreResponse(handoffRestored, restoredAction!);
    expectLuaRestoreResponseLegalActions(handoffRestored, restoredResponse);
  });
});

function quickScript(code: number, message: string, effectType: "TYPE_MONSTER" | "TYPE_SPELL" | "TYPE_TRAP"): string {
  return `
    c${code} = {}
    c${code}.initial_effect = function(c)
      local e = Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 and e:IsActiveType(${effectType}) end)
      e:SetOperation(function(e,tp) Debug.Message("${message}") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectRestoredChainLimit(restored: ReturnType<typeof restoreDuelWithLuaScripts>, registryKey: string): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
  expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
  expectRestoredLegalActions(restored, 0);
  expectRestoredLegalActions(restored, 1);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function hasGroupedLuaEffect(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1, effectId: string): boolean {
  return getLuaRestoreLegalActionGroups(restored, player).some((group) =>
    group.actions.some((action) => action.type === "activateEffect" && action.player === player && action.effectId === effectId),
  );
}
