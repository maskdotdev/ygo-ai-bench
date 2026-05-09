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
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });

    const nextChain = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
    expect(nextChain).toBeDefined();
    expect(applyResponse(restored.session, nextChain!).ok).toBe(true);
    expect(hasGroupedLuaEffect(restored, 0, "lua-3")).toBe(true);
    expect(hasGroupedLuaEffect(restored, 1, "lua-4")).toBe(false);
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

function actionsWithoutWindowToken(actions: DuelAction[]): Array<Omit<DuelAction, "windowToken">> {
  return actions.map((action) => {
    const { windowToken: _windowToken, ...rest } = action;
    return rest;
  });
}
