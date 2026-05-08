import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua captured handler-only chain-limit restore", () => {
  it("restores Project Ignis-style captured handler equality factories from snapshots", () => {
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
            c100 = {}
            c100.initial_effect = function(c)
              local e1 = Effect.CreateEffect(c)
              e1:SetType(EFFECT_TYPE_IGNITION)
              e1:SetRange(LOCATION_HAND)
              e1:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
                if chk==0 then return true end
                Duel.SetChainLimitTillChainEnd(c100.genchainlm(e:GetHandler()))
              end)
              e1:SetOperation(function(e,tp) Debug.Message("handler-only limit source resolved") end)
              c:RegisterEffect(e1)
              local e2 = Effect.CreateEffect(c)
              e2:SetType(EFFECT_TYPE_QUICK_O)
              e2:SetRange(LOCATION_HAND)
              e2:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
              e2:SetOperation(function(e,tp) Debug.Message("same-handler response resolved") end)
              c:RegisterEffect(e2)
            end
            function c100.genchainlm(c)
              return function(e,rp,tp)
                return e:GetHandler()==c
              end
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "blocked same-player other-card response resolved");
        if (name === "c300.lua") return quickScript(300, "blocked opponent response resolved");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }], []);
    const session = createDuel({ seed: 289, startingHandSize: 2, cardReader: createCardReader(cards) });
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

    const sourceUid = session.state.cards.find((card) => card.code === "100")?.uid;
    expect(sourceUid).toBeDefined();
    const registryKey = `lua-chain-limit:100:0:chain:known:closure:card-handler:${sourceUid}`;
    expect(serializeDuel(session).state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    expect(hasLuaEffect(getLegalActions(session, 0), 0, "lua-2")).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 0), 0, "lua-3")).toBe(false);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-4")).toBe(false);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
    expectLuaRestoreGroupsMirrorActions(restored, 0);
    expectLuaRestoreGroupsMirrorActions(restored, 1);
    expect(hasGroupedLuaEffect(restored, 0, "lua-2")).toBe(true);
    expect(hasGroupedLuaEffect(restored, 0, "lua-3")).toBe(false);
    expect(hasGroupedLuaEffect(restored, 1, "lua-4")).toBe(false);

    const restoredAction = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
    expect(restoredAction).toBeDefined();
    const restoredResponse = applyLuaRestoreResponse(restored, restoredAction!);
    expect(restoredResponse.ok, restoredResponse.error).toBe(true);
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

function expectLuaRestoreGroupsMirrorActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
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
