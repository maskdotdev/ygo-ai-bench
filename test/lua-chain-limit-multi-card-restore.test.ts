import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua multi-card chain-limit restore", () => {
  it("restores captured multi-card handler-exclusion predicates from snapshots", () => {
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
                local tc1 = Duel.GetFirstMatchingCard(Card.IsCode,tp,0,LOCATION_HAND,nil,300)
                local tc2 = Duel.GetFirstMatchingCard(Card.IsCode,tp,0,LOCATION_HAND,nil,400)
                Duel.SetChainLimit(function(e,rp,tp)
                  local rc=e:GetHandler()
                  return rc~=tc1 and rc~=tc2
                end)
              end)
              e:SetOperation(function(e,tp) Debug.Message("multi-card limit source resolved") end)
              c:RegisterEffect(e)
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "allowed multi-card response resolved");
        if (name === "c300.lua") return quickScript(300, "blocked first multi-card response resolved");
        if (name === "c400.lua") return quickScript(400, "blocked second multi-card response resolved");
        return undefined;
      },
    };

    const cards = normalizeCdbRows([
      { id: 100, type: 1 },
      { id: 200, type: 1 },
      { id: 300, type: 1 },
      { id: 400, type: 1 },
      { id: 900, type: 1 },
      { id: 901, type: 1 },
    ], []);
    const session = createDuel({ seed: 270, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "900", "901"] }, 1: { main: ["200", "300", "400"] } });
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

    const snapshot = serializeDuel(session);
    const registryKey = snapshot.state.chainLimits[0]?.registryKey;
    const blockedUids = session.state.cards.filter((card) => card.code === "300" || card.code === "400").map((card) => card.uid);
    expect(registryKey).toContain(":known:closure:cards-not-handler:");
    expect(registryKey).toContain(encodeURIComponent(blockedUids[0]!));
    expect(registryKey).toContain(encodeURIComponent(blockedUids[1]!));
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-2")).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-3")).toBe(false);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-4")).toBe(false);

    const restored = restoreDuelWithLuaScripts(snapshot, source, createCardReader(cards));

    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(hasLuaEffect(getLuaRestoreLegalActions(restored, 1), 1, "lua-2")).toBe(true);
    expect(hasLuaEffect(getLuaRestoreLegalActions(restored, 1), 1, "lua-3")).toBe(false);
    expect(hasLuaEffect(getLuaRestoreLegalActions(restored, 1), 1, "lua-4")).toBe(false);
    expect(hasGroupedLuaEffect(restored, 1, "lua-2")).toBe(true);
    expect(hasGroupedLuaEffect(restored, 1, "lua-3")).toBe(false);
    expect(hasGroupedLuaEffect(restored, 1, "lua-4")).toBe(false);

    const restoredAction = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
    expect(restoredAction).toBeDefined();
    const response = applyLuaRestoreResponse(restored, restoredAction!);
    expect(response.ok, response.error).toBe(true);
  });

  it("restores response-player multi-card handler-exclusion predicates from snapshots", () => {
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
                local tc1 = Duel.GetFirstMatchingCard(Card.IsCode,tp,0,LOCATION_HAND,nil,300)
                local tc2 = Duel.GetFirstMatchingCard(Card.IsCode,tp,0,LOCATION_HAND,nil,400)
                Duel.SetChainLimit(function(e,rp,tp)
                  local rc=e:GetHandler()
                  return rp==tp or (rc~=tc1 and rc~=tc2)
                end)
              end)
              e:SetOperation(function(e,tp) Debug.Message("response-player multi-card limit source resolved") end)
              c:RegisterEffect(e)
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "same-player multi-card response resolved");
        if (name === "c300.lua") return quickScript(300, "blocked first opponent multi-card response resolved");
        if (name === "c400.lua") return quickScript(400, "blocked second opponent multi-card response resolved");
        if (name === "c500.lua") return quickScript(500, "allowed opponent multi-card response resolved");
        return undefined;
      },
    };

    const cards = normalizeCdbRows([
      { id: 100, type: 1 },
      { id: 200, type: 1 },
      { id: 300, type: 1 },
      { id: 400, type: 1 },
      { id: 500, type: 1 },
      { id: 900, type: 1 },
    ], []);
    const session = createDuel({ seed: 271, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: ["300", "400", "500", "900"] } });
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

    const snapshot = serializeDuel(session);
    const registryKey = snapshot.state.chainLimits[0]?.registryKey;
    const blockedUids = session.state.cards.filter((card) => card.code === "300" || card.code === "400").map((card) => card.uid);
    expect(registryKey).toContain(":known:closure:cards-not-handler-response-player:");
    expect(registryKey).toContain(encodeURIComponent(blockedUids[0]!));
    expect(registryKey).toContain(encodeURIComponent(blockedUids[1]!));
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-3")).toBe(false);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-4")).toBe(false);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-5")).toBe(true);

    const restored = restoreDuelWithLuaScripts(snapshot, source, createCardReader(cards));

    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(hasLuaEffect(getLuaRestoreLegalActions(restored, 1), 1, "lua-3")).toBe(false);
    expect(hasLuaEffect(getLuaRestoreLegalActions(restored, 1), 1, "lua-4")).toBe(false);
    expect(hasLuaEffect(getLuaRestoreLegalActions(restored, 1), 1, "lua-5")).toBe(true);
    expect(hasGroupedLuaEffect(restored, 1, "lua-3")).toBe(false);
    expect(hasGroupedLuaEffect(restored, 1, "lua-4")).toBe(false);
    expect(hasGroupedLuaEffect(restored, 1, "lua-5")).toBe(true);

    const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(opponentPass).toBeDefined();
    const passResult = applyResponse(session, opponentPass!);
    expect(passResult.ok, passResult.error).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 0), 0, "lua-2")).toBe(true);

    const handoffRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(handoffRestored.restoreComplete, handoffRestored.incompleteReasons.join("; ")).toBe(true);
    expect(handoffRestored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(hasGroupedLuaEffect(handoffRestored, 0, "lua-2")).toBe(true);
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

function hasLuaEffect(actions: ReturnType<typeof getLegalActions>, player: 0 | 1, effectId: string): boolean {
  return actions.some((action) => action.type === "activateEffect" && action.player === player && action.effectId === effectId);
}

function hasGroupedLuaEffect(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1, effectId: string): boolean {
  return getLuaRestoreLegalActionGroups(restored, player).some((group) =>
    group.actions.some((action) => action.type === "activateEffect" && action.player === player && action.effectId === effectId),
  );
}
