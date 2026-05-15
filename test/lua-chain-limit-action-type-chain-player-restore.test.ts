import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua action-type chain-player chain-limit restore", () => {
  it("restores captured event-player action-type predicates from snapshots", () => {
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") return sourceScript();
        if (name === "c200.lua") return quickScript("200", "same-player monster response resolved");
        if (name === "c500.lua") return quickScript("500", "blocked same-player action response resolved");
        if (name === "c300.lua") return quickScript("300", "blocked opponent action response resolved");
        if (name === "c400.lua") return quickScript("400", "allowed opponent monster response resolved");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([
      { id: 100, type: 1 },
      { id: 200, type: 1 },
      { id: 500, type: 0x10000000 },
      { id: 300, type: 0x10000000 },
      { id: 400, type: 1 },
      { id: 901, type: 1 },
    ], []);
    const session = createDuel({ seed: 316, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "500"] }, 1: { main: ["300", "400", "901"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(500, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.loadCardScript(400, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(5);

    const sourceAction = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(sourceAction).toBeDefined();
    const sourceResult = applyResponse(session, sourceAction!);
    expect(sourceResult.ok, sourceResult.error).toBe(true);

    const registryKey = "lua-chain-limit:100:0:link:known:closure:not-source-type-unless-chain-player:268435456:1";
    expect(serializeDuel(session).state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-4")).toBe(false);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-5")).toBe(true);

    const opponentWindowRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(opponentWindowRestored, registryKey);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-4")).toBe(false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-5")).toBe(true);

    const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(opponentPass).toBeDefined();
    const passResult = applyResponse(session, opponentPass!);
    expect(passResult.ok, passResult.error).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 0), 0, "lua-2")).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 0), 0, "lua-3")).toBe(false);

    const handoffRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(handoffRestored, registryKey);
    expect(hasGroupedLuaEffect(handoffRestored, 0, "lua-2")).toBe(true);
    expect(hasGroupedLuaEffect(handoffRestored, 0, "lua-3")).toBe(false);
    const restoredAction = getLuaRestoreLegalActions(handoffRestored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
    expect(restoredAction).toBeDefined();
    const restoredResponse = applyLuaRestoreResponse(handoffRestored, restoredAction!);
    expect(restoredResponse.ok, restoredResponse.error).toBe(true);
  });

  it("restores hex literal captured event-player action-type predicates from snapshots", () => {
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") return sourceScript("0x10000000", "hex action-type limit source resolved");
        if (name === "c200.lua") return quickScript("200", "same-player hex monster response resolved");
        if (name === "c500.lua") return quickScript("500", "blocked same-player hex action response resolved");
        if (name === "c300.lua") return quickScript("300", "blocked opponent hex action response resolved");
        if (name === "c400.lua") return quickScript("400", "allowed opponent hex monster response resolved");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([
      { id: 100, type: 1 },
      { id: 200, type: 1 },
      { id: 500, type: 0x10000000 },
      { id: 300, type: 0x10000000 },
      { id: 400, type: 1 },
      { id: 901, type: 1 },
    ], []);
    const session = createDuel({ seed: 317, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "500"] }, 1: { main: ["300", "400", "901"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(500, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.loadCardScript(400, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(5);

    const sourceAction = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(sourceAction).toBeDefined();
    const sourceResult = applyResponse(session, sourceAction!);
    expect(sourceResult.ok, sourceResult.error).toBe(true);

    const registryKey = "lua-chain-limit:100:0:link:known:closure:not-source-type-unless-chain-player:268435456:1";
    expect(serializeDuel(session).state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-4")).toBe(false);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-5")).toBe(true);

    const opponentWindowRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(opponentWindowRestored, registryKey);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-4")).toBe(false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-5")).toBe(true);

    const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(opponentPass).toBeDefined();
    const passResult = applyResponse(session, opponentPass!);
    expect(passResult.ok, passResult.error).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 0), 0, "lua-2")).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 0), 0, "lua-3")).toBe(false);

    const handoffRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(handoffRestored, registryKey);
    expect(hasGroupedLuaEffect(handoffRestored, 0, "lua-2")).toBe(true);
    expect(hasGroupedLuaEffect(handoffRestored, 0, "lua-3")).toBe(false);
    const restoredAction = getLuaRestoreLegalActions(handoffRestored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
    expect(restoredAction).toBeDefined();
    const restoredResponse = applyLuaRestoreResponse(handoffRestored, restoredAction!);
    expect(restoredResponse.ok, restoredResponse.error).toBe(true);
  });
});

function sourceScript(typeLiteral = "TYPE_ACTION", message = "action-type limit source resolved"): string {
  return `
    c100 = {}
    c100.initial_effect = function(c)
      local e = Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        local ep = 0
        Duel.SetChainLimit(c100.limit(ep))
      end)
      e:SetOperation(function(e,tp) Debug.Message("${message}") end)
      c:RegisterEffect(e)
    end
    function c100.limit(ep)
      return function(e,lp,tp)
        return not (e:GetHandler():IsType(${typeLiteral}) and tp~=1-ep)
      end
    end
  `;
}

function quickScript(code: string, message: string): string {
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
