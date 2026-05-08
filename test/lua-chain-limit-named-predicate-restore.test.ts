import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua named chain-limit predicate restore", () => {
  it("restores named card-table predicates from snapshots", () => {
    expectNamedPredicateRestore(false);
  });

  it("restores named card-table until-chain-end predicates from snapshots", () => {
    expectNamedPredicateRestore(true);
  });
});

function expectNamedPredicateRestore(untilChainEnd: boolean): void {
  const source = {
    readScript(name: string) {
      if (name === "c100.lua") return sourceScript(untilChainEnd);
      if (name === "c200.lua") return quickScript(200, "same-player response resolved");
      if (name === "c300.lua") return quickScript(300, "blocked opponent response resolved");
      return undefined;
    },
  };
  const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }], []);
  const session = createDuel({ seed: untilChainEnd ? 288 : 287, startingHandSize: 2, cardReader: createCardReader(cards) });
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

  const registryKey = `lua-chain-limit:100:0:${untilChainEnd ? "chain" : "link"}:known:c100.chlimit`;
  expect(serializeDuel(session).state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd });
  expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-3")).toBe(false);
  expect(hasLuaEffect(getLegalActions(session, 0), 0, "lua-2")).toBe(true);

  const opponentWindowRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
  expectRestoredChainLimit(opponentWindowRestored, registryKey, untilChainEnd);
  expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-3")).toBe(false);
  expect(hasGroupedLuaEffect(opponentWindowRestored, 0, "lua-2")).toBe(true);
  const restoredAction = getLuaRestoreLegalActions(opponentWindowRestored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
  expect(restoredAction).toBeDefined();
  const restoredResponse = applyLuaRestoreResponse(opponentWindowRestored, restoredAction!);
  expect(restoredResponse.ok, restoredResponse.error).toBe(true);
}

function sourceScript(untilChainEnd: boolean): string {
  return `
    c100 = {}
    c100.initial_effect = function(c)
      local e = Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        Duel.${untilChainEnd ? "SetChainLimitTillChainEnd" : "SetChainLimit"}(c100.chlimit)
      end)
      e:SetOperation(function(e,tp) Debug.Message("named limit source resolved") end)
      c:RegisterEffect(e)
    end
    function c100.chlimit(e,ep,tp)
      return tp==ep
    end
  `;
}

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

function expectRestoredChainLimit(restored: ReturnType<typeof restoreDuelWithLuaScripts>, registryKey: string, untilChainEnd: boolean): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
  expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd });
  expectLuaRestoreGroupsMirrorActions(restored, 0);
  expectLuaRestoreGroupsMirrorActions(restored, 1);
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
