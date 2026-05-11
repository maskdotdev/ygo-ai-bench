import { describe, expect, it } from "vitest";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua target-card chain-limit restore", () => {
  it("restores Project Ignis-style target-card handler exclusions from snapshots", () => {
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
                Duel.SelectTarget(tp,Card.IsCode,tp,0,LOCATION_HAND,1,1,nil,300)
                Duel.SetChainLimit(function(te) return not Duel.GetTargetCards(e):IsContains(te:GetHandler()) end)
              end)
              e:SetOperation(function(e,tp) Debug.Message("target-card limit source resolved") end)
              c:RegisterEffect(e)
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "same-player response resolved");
        if (name === "c300.lua") return quickScript(300, "blocked target-card response resolved");
        if (name === "c400.lua") return quickScript(400, "allowed non-target response resolved");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }, { id: 400, type: 1 }, { id: 901, type: 1 }], []);
    const session = createDuel({ seed: 285, startingHandSize: 2, cardReader: createCardReader(cards) });
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

    const blockedUid = session.state.cards.find((card) => card.code === "300")?.uid;
    expect(blockedUid).toBeDefined();
    const registryKey = `lua-chain-limit:100:0:link:known:closure:target-cards-not-handler:${encodeURIComponent(blockedUid!)}`;
    const opponentSnapshot = serializeDuel(session);
    expect(opponentSnapshot.state.chain[0]?.targetUids).toEqual([blockedUid]);
    expect(opponentSnapshot.state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-3")).toBe(false);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-4")).toBe(true);

    const opponentWindowRestored = restoreDuelWithLuaScripts(opponentSnapshot, source, createCardReader(cards));
    expectRestoredChainLimit(opponentWindowRestored, registryKey);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-3")).toBe(false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-4")).toBe(true);

    const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(opponentPass).toBeDefined();
    const passResult = applyResponse(session, opponentPass!);
    expect(passResult.ok, passResult.error).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 0), 0, "lua-2")).toBe(true);

    const handoffRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(handoffRestored, registryKey);
    expect(hasGroupedLuaEffect(handoffRestored, 0, "lua-2")).toBe(true);
    const restoredAction = getLuaRestoreLegalActions(handoffRestored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
    expect(restoredAction).toBeDefined();
    const restoredResponse = applyLuaRestoreResponse(handoffRestored, restoredAction!);
    expect(restoredResponse.ok, restoredResponse.error).toBe(true);
  });

  it("restores named current-chain target-card handler exclusions from snapshots", () => {
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
                Duel.SelectTarget(tp,Card.IsCode,tp,0,LOCATION_HAND,1,1,nil,300)
                Duel.SetChainLimit(c100.chlimit)
              end)
              e:SetOperation(function(e,tp) Debug.Message("named target-card limit source resolved") end)
              c:RegisterEffect(e)
            end
            function c100.chlimit(e,ep,tp)
              local g = Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)
              return tp==ep or not g:IsContains(e:GetHandler())
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "same-player response resolved");
        if (name === "c300.lua") return quickScript(300, "blocked current-chain target-card response resolved");
        if (name === "c400.lua") return quickScript(400, "allowed current-chain non-target response resolved");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }, { id: 400, type: 1 }, { id: 901, type: 1 }], []);
    const session = createDuel({ seed: 321, startingHandSize: 2, cardReader: createCardReader(cards) });
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

    const blockedUid = session.state.cards.find((card) => card.code === "300")?.uid;
    expect(blockedUid).toBeDefined();
    const registryKey = `lua-chain-limit:100:0:link:known:closure:target-cards-not-handler-response-player:${encodeURIComponent(blockedUid!)}`;
    const opponentSnapshot = serializeDuel(session);
    expect(opponentSnapshot.state.chain[0]?.targetUids).toEqual([blockedUid]);
    expect(opponentSnapshot.state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-3")).toBe(false);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-4")).toBe(true);

    const opponentWindowRestored = restoreDuelWithLuaScripts(opponentSnapshot, source, createCardReader(cards));
    expectRestoredChainLimit(opponentWindowRestored, registryKey);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-3")).toBe(false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-4")).toBe(true);

    const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(opponentPass).toBeDefined();
    const passResult = applyResponse(session, opponentPass!);
    expect(passResult.ok, passResult.error).toBe(true);
    expect(hasLuaEffect(getLegalActions(session, 0), 0, "lua-2")).toBe(true);

    const handoffRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(handoffRestored, registryKey);
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

function expectRestoredChainLimit(restored: ReturnType<typeof restoreDuelWithLuaScripts>, registryKey: string): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
  expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
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
