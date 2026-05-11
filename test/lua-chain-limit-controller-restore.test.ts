import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua controller-aware chain-limit restore", () => {
  it("restores named opponent-controlled Trap chain-limit predicates from snapshots", () => {
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
            local s,id=GetID()
            function s.initial_effect(c)
              local e=Effect.CreateEffect(c)
              e:SetType(EFFECT_TYPE_IGNITION)
              e:SetRange(LOCATION_HAND)
              e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
                if chk==0 then return true end
                Duel.SetChainLimit(s.actlimit)
              end)
              e:SetOperation(function(e,tp) Debug.Message("controller-aware source resolved") end)
              c:RegisterEffect(e)
            end
            function s.actlimit(e,tp,p)
              return not e:GetHandler():IsType(TYPE_TRAP) or not e:GetHandler():IsControler(1-tp)
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "same-player Trap activation resolved");
        if (name === "c300.lua") return quickScript(300, "opponent Trap activation resolved");
        if (name === "c400.lua") return quickScript(400, "opponent monster response resolved");
        return undefined;
      },
    };

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 4 }, { id: 300, type: 4 }, { id: 400, type: 1 }], []);
    const session = createDuel({ seed: 35, startingHandSize: 2, cardReader: createCardReader(cards) });
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

    const registryKey = "lua-chain-limit:100:0:link:known:closure:not-opponent-controlled-trap";
    const snapshot = serializeDuel(session);
    expect(snapshot.state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-3")).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-4")).toBe(true);

    const liveTrap = session.state.effects.find((effect) => effect.id === "lua-3");
    const liveLimit = session.state.chainLimits[0];
    const liveTrapSource = session.state.cards.find((card) => card.uid === liveTrap?.sourceUid);
    expect(liveTrap).toBeDefined();
    expect(liveLimit).toBeDefined();
    expect(liveTrapSource).toBeDefined();
    liveTrapSource!.controller = 0;
    expect(liveLimit!.allows(liveTrap!, 1, 0)).toBe(false);
    liveTrapSource!.controller = 1;

    const restored = restoreDuelWithLuaScripts(snapshot, source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(hasLuaEffect(getLuaRestoreLegalActions(restored, 1), 1, "lua-3")).toBe(true);
    expect(hasLuaEffect(getLuaRestoreLegalActions(restored, 1), 1, "lua-4")).toBe(true);

    const restoredTrap = restored.session.state.effects.find((effect) => effect.id === "lua-3");
    const restoredTrapSource = restored.session.state.cards.find((card) => card.uid === restoredTrap?.sourceUid);
    expect(restoredTrap).toBeDefined();
    expect(restoredTrapSource).toBeDefined();
    restoredTrapSource!.controller = 0;
    expect(restored.session.state.chainLimits[0]!.allows(restoredTrap!, 1, 0)).toBe(false);
  });
});

function quickScript(code: number, message: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("${code}: ${message}") end)
      c:RegisterEffect(e)
    end
  `;
}

function hasLuaEffect(actions: ReturnType<typeof getLegalActions>, player: 0 | 1, effectId: string): boolean {
  return actions.some((action) => action.type === "activateEffect" && action.player === player && action.effectId === effectId);
}
