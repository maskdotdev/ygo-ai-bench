import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua active-type allow chain-limit restore", () => {
  it("restores response-player-or-monster-effect predicates from snapshots", () => {
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
                Duel.SetChainLimit(c100.chlimit)
              end)
              e:SetOperation(function(e,tp) Debug.Message("active-type allow limit source resolved") end)
              c:RegisterEffect(e)
            end
            function c100.chlimit(e,rp,tp)
              return tp==rp or e:IsMonsterEffect()
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "same-player spell response resolved", "EFFECT_TYPE_QUICK_O");
        if (name === "c300.lua") return quickScript(300, "allowed opponent monster response resolved", "EFFECT_TYPE_QUICK_O");
        if (name === "c400.lua") return quickScript(400, "blocked opponent spell response resolved", "EFFECT_TYPE_QUICK_O");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([
      { id: 100, type: 1 },
      { id: 200, type: 2 },
      { id: 300, type: 1 },
      { id: 400, type: 2 },
    ], []);
    const session = createDuel({ seed: 318, startingHandSize: 2, cardReader: createCardReader(cards) });
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
    const opened = applyResponse(session, sourceAction!);
    expect(opened.ok, opened.error).toBe(true);

    const registryKey = "lua-chain-limit:100:0:link:known:closure:active-type-response-player:1";
    expect(serializeDuel(session).state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-3")).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-4")).toBe(false);

    const opponentWindowRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(opponentWindowRestored, registryKey);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-3")).toBe(true);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-4")).toBe(false);

    const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(opponentPass).toBeDefined();
    const passed = applyResponse(session, opponentPass!);
    expect(passed.ok, passed.error).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 0), 0, "lua-2")).toBe(true);

    const handoffRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(handoffRestored, registryKey);
    expect(hasGroupedLuaEffect(handoffRestored, 0, "lua-2")).toBe(true);
    const restoredAction = getLuaRestoreLegalActions(handoffRestored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
    expect(restoredAction).toBeDefined();
    const restoredResponse = applyLuaRestoreResponse(handoffRestored, restoredAction!);
    expect(restoredResponse.ok, restoredResponse.error).toBe(true);
  });

  it("restores named response-player-or-monster-effect until-chain-end predicates from snapshots", () => {
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
                Duel.SetChainLimitTillChainEnd(c100.chlimit)
              end)
              e:SetOperation(function(e,tp) Debug.Message("active-type allow until-chain-end limit source resolved") end)
              c:RegisterEffect(e)
            end
            function c100.chlimit(e,rp,tp)
              return tp==rp or e:IsMonsterEffect()
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "same-player spell response under until-chain-end limit resolved", "EFFECT_TYPE_QUICK_O");
        if (name === "c300.lua") return quickScript(300, "allowed opponent monster response under until-chain-end limit resolved", "EFFECT_TYPE_QUICK_O");
        if (name === "c400.lua") return quickScript(400, "blocked opponent spell response under until-chain-end limit resolved", "EFFECT_TYPE_QUICK_O");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([
      { id: 100, type: 1 },
      { id: 200, type: 2 },
      { id: 300, type: 1 },
      { id: 400, type: 2 },
    ], []);
    const session = createDuel({ seed: 339, startingHandSize: 2, cardReader: createCardReader(cards) });
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
    const opened = applyResponse(session, sourceAction!);
    expect(opened.ok, opened.error).toBe(true);

    const registryKey = "lua-chain-limit:100:0:chain:known:closure:active-type-response-player:1";
    expect(serializeDuel(session).state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-3")).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-4")).toBe(false);

    const opponentWindowRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(opponentWindowRestored, registryKey, true);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-3")).toBe(true);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-4")).toBe(false);

    const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(opponentPass).toBeDefined();
    const passed = applyResponse(session, opponentPass!);
    expect(passed.ok, passed.error).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 0), 0, "lua-2")).toBe(true);

    const handoffRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(handoffRestored, registryKey, true);
    expect(hasGroupedLuaEffect(handoffRestored, 0, "lua-2")).toBe(true);
    const restoredAction = getLuaRestoreLegalActions(handoffRestored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
    expect(restoredAction).toBeDefined();
    const restoredResponse = applyLuaRestoreResponse(handoffRestored, restoredAction!);
    expect(restoredResponse.ok, restoredResponse.error).toBe(true);
  });
});

function quickScript(code: number, message: string, effectType: string): string {
  return `
    c${code} = {}
    c${code}.initial_effect = function(c)
      local e = Effect.CreateEffect(c)
      e:SetType(${effectType})
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("${message}") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectRestoredChainLimit(restored: ReturnType<typeof restoreDuelWithLuaScripts>, registryKey: string, untilChainEnd = false): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
  expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd });
  expectRestoredLegalActions(restored, 0);
  expectRestoredLegalActions(restored, 1);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
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
