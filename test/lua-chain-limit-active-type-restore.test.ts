import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua active-type chain-limit restore", () => {
  it("restores inline not IsMonsterEffect predicates from snapshots", () => {
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
                Duel.SetChainLimit(function(e) return not e:IsMonsterEffect() end)
              end)
              e:SetOperation(function(e,tp) Debug.Message("active-type limit source resolved") end)
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
              e:SetOperation(function(e,tp) Debug.Message("blocked monster response resolved") end)
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
              e:SetOperation(function(e,tp) Debug.Message("allowed spell quick response resolved") end)
              c:RegisterEffect(e)
            end
          `;
        }
        return undefined;
      },
    };

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 2 }], []);
    const session = createDuel({ seed: 17, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200", "300"] } });
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
    expect(snapshot.state.chainLimits[0]?.registryKey).toBe("lua-chain-limit:100:0:link:known:closure:not-active-type:1");
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2")).toBe(false);
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3")).toBe(true);

    const restored = restoreDuelWithLuaScripts(snapshot, source, createCardReader(cards));

    expect(restored.restoreComplete).toBe(true);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey: "lua-chain-limit:100:0:link:known:closure:not-active-type:1", untilChainEnd: false });
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(getLuaRestoreLegalActions(restored, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2")).toBe(false);
    expect(getLuaRestoreLegalActions(restored, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3")).toBe(true);
    expect(hasGroupedLuaEffect(restored, 1, "lua-2")).toBe(false);
    expect(hasGroupedLuaEffect(restored, 1, "lua-3")).toBe(true);
  });
});

function hasGroupedLuaEffect(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1, effectId: string): boolean {
  return getLuaRestoreLegalActionGroups(restored, player).some((group) =>
    group.actions.some((action) => action.type === "activateEffect" && action.player === player && action.effectId === effectId),
  );
}
