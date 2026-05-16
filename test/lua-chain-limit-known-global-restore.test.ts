import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua known-global chain-limit restore", () => {
  it("restores temporary EVENT_CHAINING aux.TRUE one-chain limits without leaking the watcher", () => {
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
              Debug.Message("known-global watcher armed")
            end
            function c130.chaining(e,tp,eg,ep,ev,re,r,rp)
              Duel.SetChainLimit(aux.TRUE)
              Debug.Message("known-global watcher cleared")
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
              e:SetOperation(function(e,tp) Debug.Message("known-global starter resolved") end)
              c:RegisterEffect(e)
            end
          `;
        }
        if (name === "c210.lua") return quickScript(210, "known-global same-player response resolved");
        if (name === "c300.lua") return quickScript(300, "known-global opponent response resolved");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([{ id: 130, type: 1 }, { id: 200, type: 1 }, { id: 210, type: 1 }, { id: 300, type: 1 }], []);
    const session = createDuel({ seed: 437, startingHandSize: 3, cardReader: createCardReader(cards) });
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
    expect(host.messages).toContain("known-global watcher armed");
    expect(serializeDuel(session).state.effects.some((effect) => effect.registryKey?.endsWith("-1027"))).toBe(true);

    const nextChain = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
    expect(nextChain).toBeDefined();
    expect(applyResponse(session, nextChain!).ok).toBe(true);
    expect(host.messages).toContain("known-global watcher cleared");

    const registryKey = "lua-chain-limit:130:0:link:known:aux.TRUE";
    const snapshot = serializeDuel(session);
    expect(snapshot.state.chain).toHaveLength(1);
    expect(snapshot.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(snapshot.state.effects.some((effect) => effect.registryKey?.endsWith("-1027"))).toBe(false);
    expect(hasGroupedDuelEffect(session, 1, "lua-4")).toBe(true);

    const restored = restoreDuelWithLuaScripts(snapshot, source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(hasGroupedLuaEffect(restored, 1, "lua-4")).toBe(true);

    const opponentResponse = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-4");
    expect(opponentResponse).toBeDefined();
    expect(applyResponse(restored.session, opponentResponse!).ok).toBe(true);
    expect(restored.session.state.chainLimits).toEqual([]);
    expect(hasGroupedLuaEffect(restored, 0, "lua-3")).toBe(true);
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

function hasGroupedDuelEffect(session: Parameters<typeof getGroupedDuelLegalActions>[0], player: 0 | 1, effectId: string): boolean {
  return getGroupedDuelLegalActions(session, player).some((group) =>
    group.actions.some((action) => action.type === "activateEffect" && action.player === player && action.effectId === effectId),
  );
}
