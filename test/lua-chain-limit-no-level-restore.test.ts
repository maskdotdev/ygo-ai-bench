import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua no-Level monster chain-limit restore", () => {
  it("restores official no-Level monster effect chain-limit predicates from snapshots", () => {
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
              e:SetOperation(function(e,tp) Debug.Message("no-Level limit source resolved") end)
              c:RegisterEffect(e)
            end
            function c100.chainlm(re,rp,tp)
              return not (re:IsMonsterEffect() and not re:GetHandler():HasLevel())
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "same-player Level monster response resolved");
        if (name === "c300.lua") return quickScript(300, "opponent Level monster response resolved");
        if (name === "c400.lua") return quickScript(400, "blocked opponent no-Level monster response resolved");
        if (name === "c500.lua") return quickScript(500, "opponent Spell response resolved");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([
      { id: 100, type: 1, level: 4 },
      { id: 200, type: 1, level: 4 },
      { id: 300, type: 1, level: 4 },
      { id: 400, type: 0x800001, level: 4 },
      { id: 500, type: 2 },
      { id: 901, type: 1, level: 4 },
    ], []);
    const session = createDuel({ seed: 322, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "901"] }, 1: { main: ["300", "400", "500"] } });
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

    const registryKey = "lua-chain-limit:100:0:link:known:closure:not-monster-without-level";
    const opponentSnapshot = serializeDuel(session);
    expect(opponentSnapshot.state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-3")).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-4")).toBe(false);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-5")).toBe(true);

    const opponentWindowRestored = restoreDuelWithLuaScripts(opponentSnapshot, source, createCardReader(cards));
    expectRestoredChainLimit(opponentWindowRestored, registryKey);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-3")).toBe(true);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-4")).toBe(false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-5")).toBe(true);

    const restoredAction = getLuaRestoreLegalActions(opponentWindowRestored, 1).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3");
    expect(restoredAction).toBeDefined();
    const restoredResponse = applyLuaRestoreResponse(opponentWindowRestored, restoredAction!);
    expect(restoredResponse.ok, restoredResponse.error).toBe(true);

    const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(opponentPass).toBeDefined();
    const passResult = applyResponse(session, opponentPass!);
    expect(passResult.ok, passResult.error).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 0), 0, "lua-2")).toBe(true);
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

function expectRestoredChainLimit(restored: ReturnType<typeof restoreDuelWithLuaScripts>, registryKey: string): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
  expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
  expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getLegalActions(restored.session, 0));
  expect(getLuaRestoreLegalActions(restored, 1)).toEqual(getLegalActions(restored.session, 1));
  expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
  expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
  expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
  expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
}

function hasLuaEffect(actions: ReturnType<typeof getLegalActions>, player: 0 | 1, effectId: string): boolean {
  return actions.some((action) => action.type === "activateEffect" && action.player === player && action.effectId === effectId);
}

function hasGroupedLuaEffect(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1, effectId: string): boolean {
  return getLuaRestoreLegalActionGroups(restored, player).some((group) =>
    group.actions.some((action) => action.type === "activateEffect" && action.player === player && action.effectId === effectId),
  );
}
