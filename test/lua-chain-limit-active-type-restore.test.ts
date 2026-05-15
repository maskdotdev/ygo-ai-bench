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
    expectRestoredLegalActions(restored, 0);
    expectRestoredLegalActions(restored, 1);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey: "lua-chain-limit:100:0:link:known:closure:not-active-type:1", untilChainEnd: false });
    expect(restored.session.state.chainPasses).toEqual([]);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(getLuaRestoreLegalActions(restored, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2")).toBe(false);
    expect(getLuaRestoreLegalActions(restored, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3")).toBe(true);
    expect(hasGroupedLuaEffect(restored, 1, "lua-2")).toBe(false);
    expect(hasGroupedLuaEffect(restored, 1, "lua-3")).toBe(true);
  });

  it("restores named not IsMonsterEffect predicates from snapshots", () => {
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
              e:SetOperation(function(e,tp) Debug.Message("named active-type limit source resolved") end)
              c:RegisterEffect(e)
            end
            function c100.chainlm(re,rp,tp)
              return not re:IsMonsterEffect()
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "blocked named monster response resolved");
        if (name === "c300.lua") return quickScript(300, "allowed named spell response resolved");
        return undefined;
      },
    };

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 2 }], []);
    const session = createDuel({ seed: 335, startingHandSize: 2, cardReader: createCardReader(cards) });
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

    const registryKey = "lua-chain-limit:100:0:link:known:closure:not-active-type:1";
    const snapshot = serializeDuel(session);
    expect(snapshot.state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2")).toBe(false);
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3")).toBe(true);

    const restored = restoreDuelWithLuaScripts(snapshot, source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expectRestoredLegalActions(restored, 1);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(hasGroupedLuaEffect(restored, 1, "lua-2")).toBe(false);
    expect(hasGroupedLuaEffect(restored, 1, "lua-3")).toBe(true);
  });

  it("restores inline not IsActiveType predicates from snapshots", () => {
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
                Duel.SetChainLimit(function(e) return not e:IsActiveType(TYPE_TRAP) end)
              end)
              e:SetOperation(function(e,tp) Debug.Message("direct active-type limit source resolved") end)
              c:RegisterEffect(e)
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "allowed monster response resolved");
        if (name === "c300.lua") return quickScript(300, "blocked trap response resolved");
        return undefined;
      },
    };

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 4 }], []);
    const session = createDuel({ seed: 22, startingHandSize: 2, cardReader: createCardReader(cards) });
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

    const registryKey = "lua-chain-limit:100:0:link:known:closure:not-active-type:4";
    const snapshot = serializeDuel(session);
    expect(snapshot.state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2")).toBe(true);
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3")).toBe(false);

    const restored = restoreDuelWithLuaScripts(snapshot, source, createCardReader(cards));

    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expectRestoredLegalActions(restored, 1);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(getLuaRestoreLegalActions(restored, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2")).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3")).toBe(false);
    expect(hasGroupedLuaEffect(restored, 1, "lua-2")).toBe(true);
    expect(hasGroupedLuaEffect(restored, 1, "lua-3")).toBe(false);
  });

  it("restores active-type predicates after dynamic type changes", () => {
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
                Duel.SetChainLimit(function(e) return not e:IsActiveType(TYPE_SPELL) end)
              end)
              e:SetOperation(function(e,tp) Debug.Message("dynamic active-type limit source resolved") end)
              c:RegisterEffect(e)
            end
          `;
        }
        if (name === "c200.lua") {
          return `
            c200 = {}
            c200.initial_effect = function(c)
              local t = Effect.CreateEffect(c)
              t:SetType(EFFECT_TYPE_SINGLE)
              t:SetCode(EFFECT_CHANGE_TYPE)
              t:SetValue(TYPE_SPELL)
              c:RegisterEffect(t)
              local e = Effect.CreateEffect(c)
              e:SetType(EFFECT_TYPE_QUICK_O)
              e:SetRange(LOCATION_HAND)
              e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
              e:SetOperation(function(e,tp) Debug.Message("blocked dynamic spell response resolved") end)
              c:RegisterEffect(e)
              Debug.Message("changed active type " .. e:GetActiveType() .. "/" .. tostring(e:IsSpellEffect()) .. "/" .. tostring(e:IsMonsterEffect()))
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
              e:SetOperation(function(e,tp) Debug.Message("allowed dynamic monster response resolved") end)
              c:RegisterEffect(e)
              Debug.Message("normal active type " .. e:GetActiveType() .. "/" .. tostring(e:IsMonsterEffect()) .. "/" .. tostring(e:IsSpellEffect()))
            end
          `;
        }
        return undefined;
      },
    };

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }], []);
    const session = createDuel({ seed: 73, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200", "300"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
    expect(host.loadCardScript(300, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    expect(host.messages).toContain("changed active type 2/true/false");
    expect(host.messages).toContain("normal active type 1/true/false");

    const changedUid = session.state.cards.find((card) => card.code === "200" && card.owner === 1)?.uid;
    const normalUid = session.state.cards.find((card) => card.code === "300" && card.owner === 1)?.uid;
    expect(changedUid).toBeDefined();
    expect(normalUid).toBeDefined();
    const sourceAction = getLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(sourceAction).toBeDefined();
    const sourceResult = applyResponse(session, sourceAction!);
    expect(sourceResult.ok, sourceResult.error).toBe(true);

    const registryKey = "lua-chain-limit:100:0:link:known:closure:not-active-type:2";
    const snapshot = serializeDuel(session);
    expect(snapshot.state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.uid === changedUid)).toBe(false);
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.uid === normalUid)).toBe(true);

    const restored = restoreDuelWithLuaScripts(snapshot, source, createCardReader(cards));

    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expectRestoredLegalActions(restored, 1);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.host.messages).toContain("changed active type 2/true/false");
    expect(restored.host.messages).toContain("normal active type 1/true/false");
    expect(getLuaRestoreLegalActions(restored, 1).some((candidate) => candidate.type === "activateEffect" && candidate.uid === changedUid)).toBe(false);
    expect(getLuaRestoreLegalActions(restored, 1).some((candidate) => candidate.type === "activateEffect" && candidate.uid === normalUid)).toBe(true);
  });

  it("restores hex literal not IsActiveType predicates from snapshots", () => {
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
                Duel.SetChainLimit(function(e) return not e:IsActiveType(0x4) end)
              end)
              e:SetOperation(function(e,tp) Debug.Message("hex active-type limit source resolved") end)
              c:RegisterEffect(e)
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "allowed hex monster response resolved");
        if (name === "c300.lua") return quickScript(300, "blocked hex trap response resolved");
        return undefined;
      },
    };

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 4 }], []);
    const session = createDuel({ seed: 339, startingHandSize: 2, cardReader: createCardReader(cards) });
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

    const registryKey = "lua-chain-limit:100:0:link:known:closure:not-active-type:4";
    const snapshot = serializeDuel(session);
    expect(snapshot.state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2")).toBe(true);
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3")).toBe(false);

    const restored = restoreDuelWithLuaScripts(snapshot, source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expectRestoredLegalActions(restored, 1);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(hasGroupedLuaEffect(restored, 1, "lua-2")).toBe(true);
    expect(hasGroupedLuaEffect(restored, 1, "lua-3")).toBe(false);
  });

  it("restores inline not IsActiveType predicates with combined masks", () => {
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
                Duel.SetChainLimit(function(e) return not e:IsActiveType(TYPE_SPELL+TYPE_TRAP) end)
              end)
              e:SetOperation(function(e,tp) Debug.Message("combined active-type limit source resolved") end)
              c:RegisterEffect(e)
            end
          `;
        }
        if (name === "c200.lua") return quickScript(200, "allowed monster response resolved");
        if (name === "c300.lua") return quickScript(300, "blocked spell response resolved");
        if (name === "c400.lua") return quickScript(400, "blocked trap response resolved");
        return undefined;
      },
    };

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 2 }, { id: 400, type: 4 }], []);
    const session = createDuel({ seed: 23, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200", "300", "400"] } });
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

    const registryKey = "lua-chain-limit:100:0:link:known:closure:not-active-type:6";
    const snapshot = serializeDuel(session);
    expect(snapshot.state.chainLimits[0]?.registryKey).toBe(registryKey);
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2")).toBe(true);
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3")).toBe(false);
    expect(getLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-4")).toBe(false);

    const restored = restoreDuelWithLuaScripts(snapshot, source, createCardReader(cards));

    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 0);
    expectRestoredLegalActions(restored, 1);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(getLuaRestoreLegalActions(restored, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2")).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3")).toBe(false);
    expect(getLuaRestoreLegalActions(restored, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-4")).toBe(false);
    expect(hasGroupedLuaEffect(restored, 1, "lua-2")).toBe(true);
    expect(hasGroupedLuaEffect(restored, 1, "lua-3")).toBe(false);
    expect(hasGroupedLuaEffect(restored, 1, "lua-4")).toBe(false);
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

function hasGroupedLuaEffect(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1, effectId: string): boolean {
  return getLuaRestoreLegalActionGroups(restored, player).some((group) =>
    group.actions.some((action) => action.type === "activateEffect" && action.player === player && action.effectId === effectId),
  );
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
