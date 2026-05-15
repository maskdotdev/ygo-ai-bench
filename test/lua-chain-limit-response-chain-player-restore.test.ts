import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import type { DuelAction } from "#duel/types.js";

describe("Lua response-matches-chain-player chain-limit restore", () => {
  it("restores descriptor-backed chain limits without requiring the original script body", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }], []);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 419, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: [] } });
    startDuel(session);

    const snapshot = serializeDuel(session);
    snapshot.state.chainLimits = [{ registryKey: "lua-chain-limit:100:0:chain:known:closure:response-matches-chain-player", untilChainEnd: true }];

    const restored = restoreDuelWithLuaScripts(snapshot, { readScript: () => undefined }, reader);

    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expectRestoredLegalActions(restored, 1);
    expect(restored.loadedScripts).toEqual([]);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey: "lua-chain-limit:100:0:chain:known:closure:response-matches-chain-player", untilChainEnd: true });
  });

  it("restores inline tp==rp chain-limit predicates from snapshots", () => {
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
                Duel.SetChainLimitTillChainEnd(function(_e,_rp,_tp) return _tp==_rp end)
              end)
              e:SetOperation(function(e,tp) Debug.Message("same-player limit source resolved") end)
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
              e:SetOperation(function(e,tp) Debug.Message("same-player response resolved") end)
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
              e:SetOperation(function(e,tp) Debug.Message("turn-player response resolved") end)
              c:RegisterEffect(e)
            end
          `;
        }
        return undefined;
      },
    };

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }], []);
    const session = createDuel({ seed: 15, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "300"] }, 1: { main: ["200"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    const sourceAction = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(sourceAction).toBeDefined();
    const sourceResult = applyResponse(session, sourceAction!);
    expect(sourceResult.ok, sourceResult.error).toBe(true);

    const snapshot = serializeDuel(session);
    expect(snapshot.state.chainLimits[0]?.registryKey).toBe("lua-chain-limit:100:0:chain:known:closure:response-matches-chain-player");
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2")).toBe(false);

    const restored = restoreDuelWithLuaScripts(snapshot, source, createCardReader(cards));

    expect(restored.restoreComplete).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expectRestoredLegalActions(restored, 1);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey: "lua-chain-limit:100:0:chain:known:closure:response-matches-chain-player", untilChainEnd: true });
    expect(restored.session.state.chainPasses).toEqual([]);
    expect(actionsWithoutWindowToken(getLuaRestoreLegalActions(restored, 0))).toEqual(actionsWithoutWindowToken(getLegalActions(session, 0)));
    expect(actionsWithoutWindowToken(getLuaRestoreLegalActions(restored, 1))).toEqual(actionsWithoutWindowToken(getLegalActions(session, 1)));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(getLuaRestoreLegalActions(restored, 0).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2")).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2")).toBe(false);
    expect(hasGroupedLuaEffect(restored, 0, "lua-2")).toBe(true);
    expect(hasGroupedLuaEffect(restored, 1, "lua-2")).toBe(false);
  });

  it("restores named tp==rp chain-limit predicates from snapshots", () => {
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
            c100 = {}
            function c100.chlimit(e,ep,tp)
              return tp==ep
            end
            c100.initial_effect = function(c)
              local e = Effect.CreateEffect(c)
              e:SetType(EFFECT_TYPE_IGNITION)
              e:SetRange(LOCATION_HAND)
              e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
                if chk==0 then return true end
                Duel.SetChainLimit(c100.chlimit)
              end)
              e:SetOperation(function(e,tp) Debug.Message("named same-player limit source resolved") end)
              c:RegisterEffect(e)
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "same-player named response resolved");
        if (name === "c300.lua") return quickScript(300, "opponent named response resolved");
        return undefined;
      },
    };

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }], []);
    const session = createDuel({ seed: 286, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: ["300"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    const sourceAction = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(sourceAction).toBeDefined();
    const sourceResult = applyResponse(session, sourceAction!);
    expect(sourceResult.ok, sourceResult.error).toBe(true);

    const registryKey = "lua-chain-limit:100:0:link:known:closure:response-matches-chain-player";
    const snapshot = serializeDuel(session);
    expect(snapshot.state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3")).toBe(false);
    expect(getLegalActions(session, 0).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2")).toBe(true);

    const restored = restoreDuelWithLuaScripts(snapshot, source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expectRestoredLegalActions(restored, 1);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(hasGroupedLuaEffect(restored, 0, "lua-2")).toBe(true);
    expect(hasGroupedLuaEffect(restored, 1, "lua-3")).toBe(false);
  });

  it("restores EVENT_CHAINING returned inline rp==tp chain-limit predicates from snapshots", () => {
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
            c100 = {}
            c100.initial_effect = function(c)
              local e = Effect.CreateEffect(c)
              e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
              e:SetCode(EVENT_CHAINING)
              e:SetRange(LOCATION_HAND)
              e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
                return Duel.SetChainLimit(function(e,rp,tp) return rp==tp end)
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
              e:SetOperation(function(e,tp) Debug.Message("returned inline starter resolved") end)
              c:RegisterEffect(e)
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "same-player returned inline response resolved");
        if (name === "c300.lua") return quickScript(300, "opponent returned inline response resolved");
        return undefined;
      },
    };

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }, { id: 400, type: 1 }], []);
    const session = createDuel({ seed: 341, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "400", "200"] }, 1: { main: ["300"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(400, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);
    const sourceAction = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("400"));
    expect(sourceAction).toBeDefined();
    const sourceResult = applyResponse(session, sourceAction!);
    expect(sourceResult.ok, sourceResult.error).toBe(true);

    const registryKey = "lua-chain-limit:100:0:link:known:closure:response-matches-chain-player";
    const snapshot = serializeDuel(session);
    expect(snapshot.state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(getLegalActions(session, 0).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3")).toBe(true);
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-4")).toBe(false);

    const restored = restoreDuelWithLuaScripts(snapshot, source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(hasGroupedLuaEffect(restored, 0, "lua-3")).toBe(true);
    expect(hasGroupedLuaEffect(restored, 1, "lua-4")).toBe(false);
  });

  it("restores temporary EVENT_CHAINING one-chain limits without leaking the watcher", () => {
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
              ce:SetCode(EVENT_CHAINING)
              ce:SetOperation(c130.chaining)
              Duel.RegisterEffect(ce,tp)
              Debug.Message("one-chain watcher armed")
            end
            function c130.chaining(e,tp,eg,ep,ev,re,r,rp)
              Duel.SetChainLimit(function(e,rp,tp) return rp==tp end)
              Debug.Message("one-chain watcher cleared")
              e:Reset()
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
              e:SetOperation(function(e,tp) Debug.Message("temporary watcher starter resolved") end)
              c:RegisterEffect(e)
            end
          `;
        }
        if (name === "c210.lua") return quickScript(210, "temporary watcher same-player response resolved");
        if (name === "c300.lua") return quickScript(300, "temporary watcher opponent response resolved");
        return undefined;
      },
    };

    const cards = normalizeCdbRows([{ id: 130, type: 1 }, { id: 200, type: 1 }, { id: 210, type: 1 }, { id: 300, type: 1 }], []);
    const session = createDuel({ seed: 436, startingHandSize: 3, cardReader: createCardReader(cards) });
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
    expect(host.messages).toContain("one-chain watcher armed");
    expect(serializeDuel(session).state.effects.some((effect) => effect.registryKey?.endsWith("-1027"))).toBe(true);

    const nextChain = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
    expect(nextChain).toBeDefined();
    expect(applyResponse(session, nextChain!).ok).toBe(true);
    expect(host.messages).toContain("one-chain watcher cleared");

    const registryKey = "lua-chain-limit:130:0:link:known:closure:response-matches-chain-player";
    const snapshot = serializeDuel(session);
    expect(snapshot.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(snapshot.state.effects.some((effect) => effect.registryKey?.endsWith("-1027"))).toBe(false);
    expect(getLegalActions(session, 0).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3")).toBe(true);
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-4")).toBe(false);

    const restored = restoreDuelWithLuaScripts(snapshot, source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(hasGroupedLuaEffect(restored, 0, "lua-3")).toBe(true);
    expect(hasGroupedLuaEffect(restored, 1, "lua-4")).toBe(false);
  });

  it("restores named tp==rp until-chain-end predicates from snapshots", () => {
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
            c100 = {}
            function c100.chlimit(re,rp,tp)
              return rp==tp
            end
            c100.initial_effect = function(c)
              local e = Effect.CreateEffect(c)
              e:SetType(EFFECT_TYPE_IGNITION)
              e:SetRange(LOCATION_HAND)
              e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
                if chk==0 then return true end
                Duel.SetChainLimitTillChainEnd(c100.chlimit)
              end)
              e:SetOperation(function(e,tp) Debug.Message("named same-player until-chain-end limit source resolved") end)
              c:RegisterEffect(e)
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "same-player named until-chain-end response resolved");
        if (name === "c300.lua") return quickScript(300, "opponent named until-chain-end response resolved");
        return undefined;
      },
    };

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }], []);
    const session = createDuel({ seed: 340, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: ["300"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    const sourceAction = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(sourceAction).toBeDefined();
    const sourceResult = applyResponse(session, sourceAction!);
    expect(sourceResult.ok, sourceResult.error).toBe(true);

    const registryKey = "lua-chain-limit:100:0:chain:known:closure:response-matches-chain-player";
    const snapshot = serializeDuel(session);
    expect(snapshot.state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3")).toBe(false);
    expect(getLegalActions(session, 0).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2")).toBe(true);

    const restored = restoreDuelWithLuaScripts(snapshot, source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(hasGroupedLuaEffect(restored, 0, "lua-2")).toBe(true);
    expect(hasGroupedLuaEffect(restored, 1, "lua-3")).toBe(false);
  });
});

function quickScript(code: number, message: string): string {
  return `
    c${code} = {}
    c${code}.initial_effect = function(c)
      local e = Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
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
