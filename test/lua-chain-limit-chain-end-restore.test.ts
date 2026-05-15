import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelAction } from "#duel/types.js";

describe("Lua chain-end chain-limit restore", () => {
  it("restores EVENT_CHAIN_END inline until-chain-end predicates for the next chain", () => {
    const source = {
      readScript(name: string) {
        if (name === "c110.lua") {
          return `
            c110 = {}
            c110.initial_effect = function(c)
              local e = Effect.CreateEffect(c)
              e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
              e:SetCode(EVENT_CHAIN_END)
              e:SetRange(LOCATION_HAND)
              e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
                return Duel.SetChainLimitTillChainEnd(function(e,rp,tp) return rp==tp end)
              end)
              c:RegisterEffect(e)
            end
          `;
        }
        if (name === "c400.lua") {
          return `
            c400 = {}
            c400.initial_effect = function(c)
              local e = Effect.CreateEffect(c)
              e:SetType(EFFECT_TYPE_IGNITION)
              e:SetRange(LOCATION_HAND)
              e:SetOperation(function(e,tp) Debug.Message("chain-end starter resolved") end)
              c:RegisterEffect(e)
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "same-player post-chain-end response resolved");
        if (name === "c210.lua") return quickScript(210, "same-player post-chain-end follow-up resolved");
        if (name === "c300.lua") return quickScript(300, "opponent post-chain-end response resolved");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([{ id: 110, type: 1 }, { id: 200, type: 1 }, { id: 210, type: 1 }, { id: 300, type: 1 }, { id: 400, type: 1 }], []);
    const session = createDuel({ seed: 427, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["110", "400", "200", "210"] }, 1: { main: ["300"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(110, source).ok).toBe(true);
    expect(host.loadCardScript(400, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(210, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(5);

    const starter = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("400"));
    expect(starter).toBeDefined();
    expect(applyResponse(session, starter!).ok).toBe(true);
    const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(opponentPass).toBeDefined();
    expect(applyResponse(session, opponentPass!).ok).toBe(true);
    const turnPass = getLegalActions(session, 0).find((candidate) => candidate.type === "passChain");
    expect(turnPass).toBeDefined();
    expect(applyResponse(session, turnPass!).ok).toBe(true);

    const registryKey = "lua-chain-limit:110:0:chain:known:closure:response-matches-chain-player";
    const snapshot = serializeDuel(session);
    expect(queryPublicState(session)).toMatchObject({ waitingFor: 0, windowKind: "open" });
    expect(snapshot.state.chain).toEqual([]);
    expect(snapshot.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });

    const restored = restoreDuelWithLuaScripts(snapshot, source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expectRestoredLegalActions(restored, 1);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    expect(queryPublicState(restored.session)).toMatchObject({ waitingFor: 0, windowKind: "open" });
    expect(actionsWithoutWindowToken(getLuaRestoreLegalActions(restored, 0))).toEqual(actionsWithoutWindowToken(getLegalActions(session, 0)));
    expect(actionsWithoutWindowToken(getLuaRestoreLegalActions(restored, 1))).toEqual(actionsWithoutWindowToken(getLegalActions(session, 1)));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));

    const nextChain = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3");
    expect(nextChain).toBeDefined();
    expect(applyResponse(restored.session, nextChain!).ok).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 0).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-4")).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-5")).toBe(false);
    expect(hasGroupedLuaEffect(restored, 0, "lua-4")).toBe(true);
    expect(hasGroupedLuaEffect(restored, 1, "lua-5")).toBe(false);
  });

  it("restores EVENT_CHAIN_END aux.FALSE predicates as no-response next-chain guards", () => {
    const source = {
      readScript(name: string) {
        if (name === "c120.lua") {
          return `
            c120 = {}
            c120.initial_effect = function(c)
              local e = Effect.CreateEffect(c)
              e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
              e:SetCode(EVENT_CHAIN_END)
              e:SetRange(LOCATION_HAND)
              e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
                return Duel.SetChainLimitTillChainEnd(aux.FALSE)
              end)
              c:RegisterEffect(e)
            end
          `;
        }
        if (name === "c400.lua") {
          return `
            c400 = {}
            c400.initial_effect = function(c)
              local e = Effect.CreateEffect(c)
              e:SetType(EFFECT_TYPE_IGNITION)
              e:SetRange(LOCATION_HAND)
              e:SetOperation(function(e,tp) Debug.Message("aux false starter resolved") end)
              c:RegisterEffect(e)
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "aux false next chain resolved");
        if (name === "c300.lua") return quickScript(300, "aux false blocked response resolved");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([{ id: 120, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }, { id: 400, type: 1 }], []);
    const session = createDuel({ seed: 428, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["120", "400", "200"] }, 1: { main: ["300"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(120, source).ok).toBe(true);
    expect(host.loadCardScript(400, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const starter = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
    expect(starter).toBeDefined();
    expect(applyResponse(session, starter!).ok).toBe(true);
    const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(opponentPass).toBeDefined();
    expect(applyResponse(session, opponentPass!).ok).toBe(true);
    const turnPass = getLegalActions(session, 0).find((candidate) => candidate.type === "passChain");
    expect(turnPass).toBeDefined();
    expect(applyResponse(session, turnPass!).ok).toBe(true);

    const registryKey = "lua-chain-limit:120:0:chain:known:aux.FALSE";
    const snapshot = serializeDuel(session);
    expect(queryPublicState(session)).toMatchObject({ waitingFor: 0, windowKind: "open" });
    expect(snapshot.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });

    const restored = restoreDuelWithLuaScripts(snapshot, source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expectRestoredLegalActions(restored, 1);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    expect(actionsWithoutWindowToken(getLuaRestoreLegalActions(restored, 0))).toEqual(actionsWithoutWindowToken(getLegalActions(session, 0)));

    const nextChain = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3");
    expect(nextChain).toBeDefined();
    const resolved = applyResponse(restored.session, nextChain!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [] });
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    expect(restored.host.messages).toContain("aux false next chain resolved");
    expect(restored.host.messages).not.toContain("aux false blocked response resolved");
  });

  it("restores current-chain-zero EVENT_CHAIN_END aux.FALSE limits", () => {
    const source = {
      readScript(name: string) {
        if (name === "c170.lua") {
          return `
            c170 = {}
            c170.initial_effect = function(c)
              local e = Effect.CreateEffect(c)
              e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
              e:SetCode(EVENT_CHAIN_END)
              e:SetRange(LOCATION_HAND)
              e:SetOperation(c170.chainend)
              c:RegisterEffect(e)
            end
            function c170.chainend(e,tp,eg,ep,ev,re,r,rp)
              if Duel.GetCurrentChain()==0 then
                Duel.SetChainLimitTillChainEnd(aux.FALSE)
              end
            end
          `;
        }
        if (name === "c400.lua") {
          return `
            c400 = {}
            c400.initial_effect = function(c)
              local e = Effect.CreateEffect(c)
              e:SetType(EFFECT_TYPE_IGNITION)
              e:SetRange(LOCATION_HAND)
              e:SetOperation(function(e,tp) Debug.Message("current-chain-zero starter resolved") end)
              c:RegisterEffect(e)
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "current-chain-zero next chain resolved");
        if (name === "c300.lua") return quickScript(300, "current-chain-zero blocked response resolved");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([{ id: 170, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }, { id: 400, type: 1 }], []);
    const session = createDuel({ seed: 433, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["170", "400", "200"] }, 1: { main: ["300"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(170, source).ok).toBe(true);
    expect(host.loadCardScript(400, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const starter = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("400"));
    expect(starter).toBeDefined();
    expect(applyResponse(session, starter!).ok).toBe(true);
    const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(opponentPass).toBeDefined();
    expect(applyResponse(session, opponentPass!).ok).toBe(true);
    const turnPass = getLegalActions(session, 0).find((candidate) => candidate.type === "passChain");
    expect(turnPass).toBeDefined();
    expect(applyResponse(session, turnPass!).ok).toBe(true);

    const registryKey = "lua-chain-limit:170:0:chain:known:aux.FALSE";
    const snapshot = serializeDuel(session);
    expect(snapshot.state.chain).toEqual([]);
    expect(snapshot.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });

    const restored = restoreDuelWithLuaScripts(snapshot, source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expectRestoredLegalActions(restored, 1);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });

    const nextChain = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3");
    expect(nextChain).toBeDefined();
    const resolved = applyResponse(restored.session, nextChain!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [] });
    expect(restored.host.messages).toContain("current-chain-zero next chain resolved");
    expect(restored.host.messages).not.toContain("current-chain-zero blocked response resolved");
  });

  it("restores temporary EVENT_CHAIN_END watcher limits without leaking the watcher", () => {
    const source = {
      readScript(name: string) {
        if (name === "c130.lua") {
          return `
            c130 = {}
            c130.initial_effect = function(c)
              local e = Effect.CreateEffect(c)
              e:SetType(EFFECT_TYPE_IGNITION)
              e:SetRange(LOCATION_HAND)
              e:SetOperation(c130.op)
              c:RegisterEffect(e)
            end
            function c130.op(e,tp)
              local ce = Effect.CreateEffect(e:GetHandler())
              ce:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
              ce:SetCode(EVENT_CHAIN_END)
              ce:SetOperation(c130.chainend)
              Duel.RegisterEffect(ce,tp)
            end
            function c130.chainend(e,tp,eg,ep,ev,re,r,rp)
              Duel.SetChainLimitTillChainEnd(function(e,rp,tp) return rp==tp end)
              e:Reset()
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "temporary watcher same-player response resolved");
        if (name === "c210.lua") return quickScript(210, "temporary watcher same-player follow-up resolved");
        if (name === "c300.lua") return quickScript(300, "temporary watcher opponent response resolved");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([{ id: 130, type: 1 }, { id: 200, type: 1 }, { id: 210, type: 1 }, { id: 300, type: 1 }], []);
    const session = createDuel({ seed: 429, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["130", "200", "210"] }, 1: { main: ["300"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(130, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(210, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const starter = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(starter).toBeDefined();
    expect(applyResponse(session, starter!).ok).toBe(true);
    const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(opponentPass).toBeDefined();
    expect(applyResponse(session, opponentPass!).ok).toBe(true);
    const turnPass = getLegalActions(session, 0).find((candidate) => candidate.type === "passChain");
    expect(turnPass).toBeDefined();
    expect(applyResponse(session, turnPass!).ok).toBe(true);

    const registryKey = "lua-chain-limit:130:0:chain:known:closure:response-matches-chain-player";
    const snapshot = serializeDuel(session);
    expect(snapshot.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    expect(snapshot.state.effects.some((effect) => effect.registryKey?.endsWith("-1026"))).toBe(false);

    const restored = restoreDuelWithLuaScripts(snapshot, source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expectRestoredLegalActions(restored, 1);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });

    const nextChain = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
    expect(nextChain).toBeDefined();
    expect(applyResponse(restored.session, nextChain!).ok).toBe(true);
    expect(hasGroupedLuaEffect(restored, 0, "lua-3")).toBe(true);
    expect(hasGroupedLuaEffect(restored, 1, "lua-4")).toBe(false);
  });

  it("restores flag-gated EVENT_CHAIN_END limits after clearing the flag", () => {
    const source = {
      readScript(name: string) {
        if (name === "c140.lua") {
          return `
            c140 = {}
            c140.initial_effect = function(c)
              local e1 = Effect.CreateEffect(c)
              e1:SetType(EFFECT_TYPE_IGNITION)
              e1:SetRange(LOCATION_HAND)
              e1:SetOperation(c140.op)
              c:RegisterEffect(e1)
              local e2 = Effect.CreateEffect(c)
              e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
              e2:SetCode(EVENT_CHAIN_END)
              e2:SetRange(LOCATION_HAND)
              e2:SetOperation(c140.chainend)
              c:RegisterEffect(e2)
            end
            function c140.op(e,tp)
              e:GetHandler():RegisterFlagEffect(140,RESET_EVENT,0,1)
            end
            function c140.chainend(e,tp,eg,ep,ev,re,r,rp)
              local c=e:GetHandler()
              if c:HasFlagEffect(140) then
                Duel.SetChainLimitTillChainEnd(function(e,rp,tp) return rp==tp end)
              end
              c:ResetFlagEffect(140)
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "flag-gated same-player response resolved");
        if (name === "c210.lua") return quickScript(210, "flag-gated same-player follow-up resolved");
        if (name === "c300.lua") return quickScript(300, "flag-gated opponent response resolved");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([{ id: 140, type: 1 }, { id: 200, type: 1 }, { id: 210, type: 1 }, { id: 300, type: 1 }], []);
    const session = createDuel({ seed: 430, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["140", "200", "210"] }, 1: { main: ["300"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(140, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(210, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const starter = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(starter).toBeDefined();
    expect(applyResponse(session, starter!).ok).toBe(true);
    const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(opponentPass).toBeDefined();
    expect(applyResponse(session, opponentPass!).ok).toBe(true);
    const turnPass = getLegalActions(session, 0).find((candidate) => candidate.type === "passChain");
    expect(turnPass).toBeDefined();
    expect(applyResponse(session, turnPass!).ok).toBe(true);

    const registryKey = "lua-chain-limit:140:0:chain:known:closure:response-matches-chain-player";
    const snapshot = serializeDuel(session);
    expect(snapshot.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    expect(snapshot.state.flagEffects.some((flag) => flag.code === 140)).toBe(false);

    const restored = restoreDuelWithLuaScripts(snapshot, source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expectRestoredLegalActions(restored, 1);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });

    const nextChain = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3");
    expect(nextChain).toBeDefined();
    expect(applyResponse(restored.session, nextChain!).ok).toBe(true);
    expect(hasGroupedLuaEffect(restored, 0, "lua-4")).toBe(true);
    expect(hasGroupedLuaEffect(restored, 1, "lua-5")).toBe(false);
  });

  it("restores chain-depth flag-gated EVENT_CHAIN_END limits after clearing the flag", () => {
    const source = {
      readScript(name: string) {
        if (name === "c160.lua") {
          return `
            c160 = {}
            c160.initial_effect = function(c)
              local e1 = Effect.CreateEffect(c)
              e1:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
              e1:SetCode(EVENT_CHAINING)
              e1:SetRange(LOCATION_HAND)
              e1:SetOperation(c160.mark)
              c:RegisterEffect(e1)
              local e2 = Effect.CreateEffect(c)
              e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
              e2:SetCode(EVENT_CHAIN_END)
              e2:SetRange(LOCATION_HAND)
              e2:SetOperation(c160.chainend)
              c:RegisterEffect(e2)
            end
            function c160.mark(e,tp,eg,ep,ev,re,r,rp)
              if Duel.GetCurrentChain()==1 then
                e:GetHandler():RegisterFlagEffect(160,RESET_EVENT,0,1)
              end
            end
            function c160.chainend(e,tp,eg,ep,ev,re,r,rp)
              local c=e:GetHandler()
              if c:HasFlagEffect(160) then
                Duel.SetChainLimitTillChainEnd(function(e,rp,tp) return rp==tp end)
              end
              c:ResetFlagEffect(160)
            end
          `;
        }
        if (name === "c400.lua") {
          return `
            c400 = {}
            c400.initial_effect = function(c)
              local e = Effect.CreateEffect(c)
              e:SetType(EFFECT_TYPE_IGNITION)
              e:SetRange(LOCATION_HAND)
              e:SetOperation(function(e,tp) Debug.Message("chain-depth flag starter resolved") end)
              c:RegisterEffect(e)
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "chain-depth flag same-player response resolved");
        if (name === "c210.lua") return quickScript(210, "chain-depth flag same-player follow-up resolved");
        if (name === "c300.lua") return quickScript(300, "chain-depth flag opponent response resolved");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([{ id: 160, type: 1 }, { id: 200, type: 1 }, { id: 210, type: 1 }, { id: 300, type: 1 }, { id: 400, type: 1 }], []);
    const session = createDuel({ seed: 432, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["160", "400", "200", "210"] }, 1: { main: ["300"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(160, source).ok).toBe(true);
    expect(host.loadCardScript(400, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(210, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(5);

    const starter = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("400"));
    expect(starter).toBeDefined();
    expect(applyResponse(session, starter!).ok).toBe(true);
    const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(opponentPass).toBeDefined();
    expect(applyResponse(session, opponentPass!).ok).toBe(true);
    const turnPass = getLegalActions(session, 0).find((candidate) => candidate.type === "passChain");
    expect(turnPass).toBeDefined();
    expect(applyResponse(session, turnPass!).ok).toBe(true);

    const registryKey = "lua-chain-limit:160:0:chain:known:closure:response-matches-chain-player";
    const snapshot = serializeDuel(session);
    expect(snapshot.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    expect(snapshot.state.flagEffects.some((flag) => flag.code === 160)).toBe(false);

    const restored = restoreDuelWithLuaScripts(snapshot, source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expectRestoredLegalActions(restored, 1);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });

    const nextChain = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-4");
    expect(nextChain).toBeDefined();
    expect(applyResponse(restored.session, nextChain!).ok).toBe(true);
    expect(hasGroupedLuaEffect(restored, 0, "lua-5")).toBe(true);
    expect(hasGroupedLuaEffect(restored, 1, "lua-6")).toBe(false);
  });

  it("restores resolving-chain-depth flag-gated EVENT_CHAIN_END limits", () => {
    const source = {
      readScript(name: string) {
        if (name === "c180.lua") {
          return `
            c180 = {}
            c180.initial_effect = function(c)
              local e1 = Effect.CreateEffect(c)
              e1:SetType(EFFECT_TYPE_IGNITION)
              e1:SetRange(LOCATION_HAND)
              e1:SetOperation(c180.op)
              c:RegisterEffect(e1)
              local e2 = Effect.CreateEffect(c)
              e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
              e2:SetCode(EVENT_CHAIN_END)
              e2:SetRange(LOCATION_HAND)
              e2:SetOperation(c180.chainend)
              c:RegisterEffect(e2)
            end
            function c180.op(e,tp)
              Debug.Message("resolving depth " .. Duel.GetCurrentChain() .. "/" .. Duel.GetChainCount())
              if Duel.GetCurrentChain()==0 then
                Duel.SetChainLimitTillChainEnd(aux.FALSE)
              elseif Duel.GetCurrentChain()==1 and Duel.GetChainCount()==1 then
                e:GetHandler():RegisterFlagEffect(180,RESET_EVENT,0,1)
              end
            end
            function c180.chainend(e,tp,eg,ep,ev,re,r,rp)
              local c=e:GetHandler()
              if c:HasFlagEffect(180) then
                Duel.SetChainLimitTillChainEnd(function(e,rp,tp) return rp==tp end)
              end
              c:ResetFlagEffect(180)
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "resolving-depth same-player response resolved");
        if (name === "c210.lua") return quickScript(210, "resolving-depth same-player follow-up resolved");
        if (name === "c300.lua") return quickScript(300, "resolving-depth opponent response resolved");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([{ id: 180, type: 1 }, { id: 200, type: 1 }, { id: 210, type: 1 }, { id: 300, type: 1 }], []);
    const session = createDuel({ seed: 434, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["180", "200", "210"] }, 1: { main: ["300"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(180, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(210, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const starter = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(starter).toBeDefined();
    expect(applyResponse(session, starter!).ok).toBe(true);
    const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(opponentPass).toBeDefined();
    expect(applyResponse(session, opponentPass!).ok).toBe(true);
    const turnPass = getLegalActions(session, 0).find((candidate) => candidate.type === "passChain");
    expect(turnPass).toBeDefined();
    expect(applyResponse(session, turnPass!).ok).toBe(true);
    expect(host.messages).toContain("resolving depth 1/1");

    const registryKey = "lua-chain-limit:180:0:chain:known:closure:response-matches-chain-player";
    const snapshot = serializeDuel(session);
    expect(snapshot.state.chain).toEqual([]);
    expect(snapshot.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    expect(snapshot.state.flagEffects.some((flag) => flag.code === 180)).toBe(false);

    const restored = restoreDuelWithLuaScripts(snapshot, source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expectRestoredLegalActions(restored, 1);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });

    const nextChain = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3");
    expect(nextChain).toBeDefined();
    expect(applyResponse(restored.session, nextChain!).ok).toBe(true);
    expect(hasGroupedLuaEffect(restored, 0, "lua-4")).toBe(true);
    expect(hasGroupedLuaEffect(restored, 1, "lua-5")).toBe(false);
  });

  it("restores resolving-chain-depth chain-end limits after reset watcher cleanup", () => {
    const source = {
      readScript(name: string) {
        if (name === "c190.lua") {
          return `
            c190 = {}
            c190.initial_effect = function(c)
              local e1 = Effect.CreateEffect(c)
              e1:SetType(EFFECT_TYPE_IGNITION)
              e1:SetRange(LOCATION_HAND)
              e1:SetOperation(c190.op)
              c:RegisterEffect(e1)
              local e2 = Effect.CreateEffect(c)
              e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
              e2:SetCode(EVENT_CHAIN_END)
              e2:SetRange(LOCATION_HAND)
              e2:SetOperation(c190.chainend)
              c:RegisterEffect(e2)
            end
            function c190.op(e,tp)
              if Duel.GetCurrentChain()==1 then
                e:GetHandler():RegisterFlagEffect(190,RESET_EVENT,0,1)
                local ce = Effect.CreateEffect(e:GetHandler())
                ce:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
                ce:SetCode(EVENT_CHAINING)
                ce:SetOperation(c190.resetop)
                Duel.RegisterEffect(ce,tp)
              end
            end
            function c190.resetop(e,tp,eg,ep,ev,re,r,rp)
              e:GetHandler():ResetFlagEffect(190)
              Debug.Message("chain-depth reset watcher cleared")
              e:Reset()
            end
            function c190.chainend(e,tp,eg,ep,ev,re,r,rp)
              local c=e:GetHandler()
              if c:HasFlagEffect(190) then
                Duel.SetChainLimitTillChainEnd(function(e,rp,tp) return rp==tp end)
              end
              c:ResetFlagEffect(190)
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "reset-watcher same-player response resolved");
        if (name === "c210.lua") return quickScript(210, "reset-watcher same-player follow-up resolved");
        if (name === "c300.lua") return quickScript(300, "reset-watcher opponent response resolved");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([{ id: 190, type: 1 }, { id: 200, type: 1 }, { id: 210, type: 1 }, { id: 300, type: 1 }], []);
    const session = createDuel({ seed: 435, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["190", "200", "210"] }, 1: { main: ["300"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(190, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(210, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const starter = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(starter).toBeDefined();
    expect(applyResponse(session, starter!).ok).toBe(true);
    const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(opponentPass).toBeDefined();
    expect(applyResponse(session, opponentPass!).ok).toBe(true);
    const turnPass = getLegalActions(session, 0).find((candidate) => candidate.type === "passChain");
    expect(turnPass).toBeDefined();
    expect(applyResponse(session, turnPass!).ok).toBe(true);

    const registryKey = "lua-chain-limit:190:0:chain:known:closure:response-matches-chain-player";
    expect(serializeDuel(session).state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    const nextChain = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3");
    expect(nextChain).toBeDefined();
    expect(applyResponse(session, nextChain!).ok).toBe(true);
    expect(host.messages).toContain("chain-depth reset watcher cleared");

    const snapshot = serializeDuel(session);
    expect(snapshot.state.effects.some((effect) => effect.registryKey?.endsWith("-1027"))).toBe(false);
    expect(snapshot.state.flagEffects.some((flag) => flag.code === 190)).toBe(false);
    expect(snapshot.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });

    const restored = restoreDuelWithLuaScripts(snapshot, source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expectRestoredLegalActions(restored, 1);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    expect(hasGroupedLuaEffect(restored, 0, "lua-4")).toBe(true);
    expect(hasGroupedLuaEffect(restored, 1, "lua-5")).toBe(false);
  });

  it("restores flag-gated EVENT_CHAIN_END aux.FALSE limits after clearing the flag", () => {
    const source = {
      readScript(name: string) {
        if (name === "c150.lua") {
          return `
            c150 = {}
            c150.initial_effect = function(c)
              local e1 = Effect.CreateEffect(c)
              e1:SetType(EFFECT_TYPE_IGNITION)
              e1:SetRange(LOCATION_HAND)
              e1:SetOperation(c150.op)
              c:RegisterEffect(e1)
              local e2 = Effect.CreateEffect(c)
              e2:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
              e2:SetCode(EVENT_CHAIN_END)
              e2:SetRange(LOCATION_HAND)
              e2:SetOperation(c150.chainend)
              c:RegisterEffect(e2)
            end
            function c150.op(e,tp)
              e:GetHandler():RegisterFlagEffect(150,RESET_EVENT,0,1)
            end
            function c150.chainend(e,tp,eg,ep,ev,re,r,rp)
              local c=e:GetHandler()
              if c:HasFlagEffect(150) then
                Duel.SetChainLimitTillChainEnd(aux.FALSE)
              end
              c:ResetFlagEffect(150)
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "flag-gated aux false next chain resolved");
        if (name === "c300.lua") return quickScript(300, "flag-gated aux false blocked response resolved");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([{ id: 150, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }], []);
    const session = createDuel({ seed: 431, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["150", "200"] }, 1: { main: ["300"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(150, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const starter = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(starter).toBeDefined();
    expect(applyResponse(session, starter!).ok).toBe(true);
    const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(opponentPass).toBeDefined();
    expect(applyResponse(session, opponentPass!).ok).toBe(true);
    const turnPass = getLegalActions(session, 0).find((candidate) => candidate.type === "passChain");
    expect(turnPass).toBeDefined();
    expect(applyResponse(session, turnPass!).ok).toBe(true);

    const registryKey = "lua-chain-limit:150:0:chain:known:aux.FALSE";
    const snapshot = serializeDuel(session);
    expect(snapshot.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    expect(snapshot.state.flagEffects.some((flag) => flag.code === 150)).toBe(false);

    const restored = restoreDuelWithLuaScripts(snapshot, source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expectRestoredLegalActions(restored, 1);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });

    const nextChain = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3");
    expect(nextChain).toBeDefined();
    const resolved = applyResponse(restored.session, nextChain!);
    expect(resolved.ok, resolved.error).toBe(true);
    expect(resolved.state).toMatchObject({ waitingFor: 0, windowKind: "open", chain: [] });
    expect(restored.host.messages).toContain("flag-gated aux false next chain resolved");
    expect(restored.host.messages).not.toContain("flag-gated aux false blocked response resolved");
  });
});

function quickScript(code: number, message: string): string {
  return `
    c${code} = {}
    c${code}.initial_effect = function(c)
      local e = Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp) Debug.Message("${message}") end)
      c:RegisterEffect(e)
    end
  `;
}

function hasGroupedLuaEffect(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1, effectId: string): boolean {
  return getLuaRestoreLegalActionGroups(restored, player).some((group) =>
    group.actions.some((action) => action.type === "activateEffect" && action.player === player && action.effectId === effectId),
  );
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function actionsWithoutWindowToken(actions: DuelAction[]): Array<Omit<DuelAction, "windowToken">> {
  return actions.map((action) => {
    const { windowToken: _windowToken, ...rest } = action;
    return rest;
  });
}
