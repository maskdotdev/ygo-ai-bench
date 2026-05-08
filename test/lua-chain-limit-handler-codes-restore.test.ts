import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua multi-code handler chain-limit restore", () => {
  it("restores captured IsCode(id, alternate) chain-limit predicates from snapshots", () => {
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
            local s,id=GetID()
            local alternate=101
            function s.initial_effect(c)
              local e1=Effect.CreateEffect(c)
              e1:SetType(EFFECT_TYPE_IGNITION)
              e1:SetRange(LOCATION_HAND)
              e1:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
                if chk==0 then return true end
                Duel.SetChainLimit(function(e) return e:GetHandler():IsCode(id,alternate) end)
              end)
              e1:SetOperation(function(e,tp) Debug.Message("captured multi-code limit source resolved") end)
              c:RegisterEffect(e1)

              local e2=Effect.CreateEffect(c)
              e2:SetType(EFFECT_TYPE_QUICK_O)
              e2:SetRange(LOCATION_HAND)
              e2:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
              e2:SetOperation(function(e,tp) Debug.Message("matching primary code response resolved") end)
              c:RegisterEffect(e2)
            end
          `;
        }
        if (name === "c101.lua") return quickScript(101, "matching alternate code response resolved");
        if (name === "c200.lua") return quickScript(200, "blocked nonmatching code response resolved");
        return undefined;
      },
    };

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 101, type: 1 }, { id: 200, type: 1 }, { id: 900, type: 1 }], []);
    const session = createDuel({ seed: 19, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "101", "200"] }, 1: { main: ["900", "900", "900"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(101, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    const sourceAction = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(sourceAction).toBeDefined();
    const sourceResult = applyResponse(session, sourceAction!);
    expect(sourceResult.ok, sourceResult.error).toBe(true);

    const registryKey = "lua-chain-limit:100:0:link:known:closure:handler-codes:100,101";
    const snapshot = serializeDuel(session);
    expect(snapshot.state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(hasLuaEffect(getLegalActions(session, 0), "lua-2")).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 0), "lua-3")).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 0), "lua-4")).toBe(false);

    const restored = restoreDuelWithLuaScripts(snapshot, source, createCardReader(cards));

    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(hasLuaEffect(getLuaRestoreLegalActions(restored, 0), "lua-2")).toBe(true);
    expect(hasLuaEffect(getLuaRestoreLegalActions(restored, 0), "lua-3")).toBe(true);
    expect(hasLuaEffect(getLuaRestoreLegalActions(restored, 0), "lua-4")).toBe(false);
  });
});

function quickScript(code: number, message: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("${message}") end)
      c:RegisterEffect(e)
    end
  `;
}

function hasLuaEffect(actions: ReturnType<typeof getLegalActions>, effectId: string): boolean {
  return actions.some((action) => action.type === "activateEffect" && action.player === 0 && action.effectId === effectId);
}
