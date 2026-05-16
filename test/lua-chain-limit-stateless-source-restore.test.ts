import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import { expectLuaRestoreResponseLegalActions } from "./lua-restore-response-helpers.js";

describe("Lua stateless source chain-limit restore", () => {
  it("restores descriptor-backed stateless source predicates without requiring the original script body", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }], []);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 420, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: [] } });
    startDuel(session);

    const predicateSource = "function(e,rp,tp) return rp==tp end";
    const registryKey = `lua-chain-limit:100:0:chain:known:closure:source:${encodeURIComponent(predicateSource)}`;
    const snapshot = serializeDuel(session);
    snapshot.state.chainLimits = [{ registryKey, untilChainEnd: true }];

    const restored = restoreDuelWithLuaScripts(snapshot, { readScript: () => undefined }, reader);

    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expectRestoredLegalActions(restored, 1);
    expect(restored.loadedScripts).toEqual([]);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: true });
  });

  it("restores inline no-upvalue source predicates from snapshots", () => {
    runStatelessSourceRestoreCase(false);
  });

  it("restores inline no-upvalue source predicates until chain end", () => {
    runStatelessSourceRestoreCase(true);
  });

  it("keeps unsafe no-upvalue source predicates fail-closed", () => {
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
                Duel.SetChainLimit(function(e,rp,tp) return Debug.Message("unsafe chain limit") or rp==tp end)
              end)
              e:SetOperation(function(e,tp) Debug.Message("unsafe stateless source limit resolved") end)
              c:RegisterEffect(e)
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "response resolved");
        return undefined;
      },
    };

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const session = createDuel({ seed: 342, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const sourceAction = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(sourceAction).toBeDefined();
    const sourceResult = applyResponse(session, sourceAction!);
    expect(sourceResult.ok, sourceResult.error).toBe(true);

    expect(session.state.chainLimits[0]?.registryKey).toBeUndefined();
    const snapshot = serializeDuel(session);
    expect(snapshot.state.chainLimits).toEqual([]);
    const restored = restoreDuelWithLuaScripts(snapshot, source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.chainLimitRegistryKeys).toEqual([]);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual([]);
  });
});

function runStatelessSourceRestoreCase(untilChainEnd: boolean): void {
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
              Duel.${untilChainEnd ? "SetChainLimitTillChainEnd" : "SetChainLimit"}(function(e,rp,tp) return e:GetHandler():IsType(TYPE_SPELL) or rp==tp end)
            end)
            e:SetOperation(function(e,tp) Debug.Message("stateless source limit resolved") end)
            c:RegisterEffect(e)
          end
        `;
      }
      if (name === "c200.lua") return quickScript(200, "same-player monster response resolved");
      if (name === "c300.lua") return quickScript(300, "blocked opponent monster response resolved");
      if (name === "c400.lua") return quickScript(400, "allowed opponent spell response resolved");
      return undefined;
    },
  };

  const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }, { id: 400, type: 2 }], []);
  const session = createDuel({ seed: untilChainEnd ? 341 : 340, startingHandSize: 2, cardReader: createCardReader(cards) });
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

  const predicateSource = "function(e,rp,tp) return e:GetHandler():IsType(TYPE_SPELL) or rp==tp end";
  const registryKey = `lua-chain-limit:100:0:${untilChainEnd ? "chain" : "link"}:known:closure:source:${encodeURIComponent(predicateSource)}`;
  expect(serializeDuel(session).state.chainLimits[0]?.registryKey).toBe(registryKey);
  expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3")).toBe(false);
  expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-4")).toBe(true);

  const tamperedSource = `function(e,rp,tp) return Debug.Message("tampered chain limit") or true end`;
  const tamperedRegistryKey = `lua-chain-limit:100:0:${untilChainEnd ? "chain" : "link"}:known:closure:source:${encodeURIComponent(tamperedSource)}`;
  const snapshot = serializeDuel(session);
  const tamperedSnapshot = {
    ...snapshot,
    state: {
      ...snapshot.state,
      chainLimits: snapshot.state.chainLimits.map((limit) => ({ ...limit, registryKey: tamperedRegistryKey })),
    },
  };
  const tamperedRestored = restoreDuelWithLuaScripts(tamperedSnapshot, source, createCardReader(cards));
  expect(tamperedRestored.restoreComplete).toBe(false);
  expect(tamperedRestored.missingChainLimitRegistryKeys).toEqual([tamperedRegistryKey]);
  expect(getLuaRestoreLegalActions(tamperedRestored, 1)).toEqual([]);
  expect(getLuaRestoreLegalActionGroups(tamperedRestored, 1)).toEqual([]);

  const opponentWindowRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
  expectRestoredChainLimit(opponentWindowRestored, registryKey, untilChainEnd);
  expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-3")).toBe(false);
  expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-4")).toBe(true);
  const restoredSpellAction = getLuaRestoreLegalActions(opponentWindowRestored, 1).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-4");
  expect(restoredSpellAction).toBeDefined();
  const restoredSpellResponse = applyLuaRestoreResponse(opponentWindowRestored, restoredSpellAction!);
  expectLuaRestoreResponseLegalActions(opponentWindowRestored, restoredSpellResponse);

  const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
  expect(opponentPass).toBeDefined();
  const passResult = applyResponse(session, opponentPass!);
  expect(passResult.ok, passResult.error).toBe(true);
  expect(getLegalActions(session, 0).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2")).toBe(true);

  const handoffRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
  expectRestoredChainLimit(handoffRestored, registryKey, untilChainEnd);
  expect(hasGroupedLuaEffect(handoffRestored, 0, "lua-2")).toBe(true);
  const restoredMonsterAction = getLuaRestoreLegalActions(handoffRestored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
  expect(restoredMonsterAction).toBeDefined();
  const restoredMonsterResponse = applyLuaRestoreResponse(handoffRestored, restoredMonsterAction!);
  expectLuaRestoreResponseLegalActions(handoffRestored, restoredMonsterResponse);
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

function hasGroupedLuaEffect(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1, effectId: string): boolean {
  return getLuaRestoreLegalActionGroups(restored, player).some((group) =>
    group.actions.some((action) => action.type === "activateEffect" && action.player === player && action.effectId === effectId),
  );
}
