import { describe, expect, it } from "vitest";
import fengari from "fengari";
import { createCardReader, normalizeCdbRows } from "#engine/data-loaders.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { literalFalsePredicate, literalTruePredicate } from "#lua/chain-limit-predicate-descriptors.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

type NamedPredicate = "chlimit" | "chainlm" | "climit" | "chainlimit" | "chlimit2";

const { lua, lauxlib, lualib, to_luastring } = fengari;

describe("Lua named chain-limit predicate restore", () => {
  it("restores named card-table predicates from snapshots", () => {
    expectNamedPredicateRestore(false, "chlimit");
  });

  it("restores named card-table until-chain-end predicates from snapshots", () => {
    expectNamedPredicateRestore(true, "chlimit");
  });

  it("restores Project Ignis chainlm named predicates from snapshots", () => {
    expectNamedPredicateRestore(false, "chainlm");
  });

  it("restores Project Ignis climit and chainlimit named predicates from snapshots", () => {
    for (const predicateName of ["climit", "chainlimit"] as const) {
      expectNamedPredicateRestore(false, predicateName);
    }
  });

  it("restores numbered Project Ignis named predicates from snapshots", () => {
    expectNamedPredicateRestore(true, "chlimit2");
  });

  it("keeps missing named card-table predicates unsafe after snapshot restore", () => {
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") return sourceScript(false, "chlimit");
        if (name === "c200.lua") return quickScript(200, "same-player response resolved");
        if (name === "c300.lua") return quickScript(300, "blocked opponent response resolved");
        return undefined;
      },
    };
    const missingPredicateSource = {
      readScript(name: string) {
        if (name === "c100.lua") return sourceScriptWithoutPredicate();
        return source.readScript(name);
      },
    };
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }], []);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 405, startingHandSize: 2, cardReader: reader });
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

    const registryKey = "lua-chain-limit:100:0:link:known:c100.chlimit";
    expect(serializeDuel(session).state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), missingPredicateSource, reader);
    expect(restored.restoreComplete).toBe(false);
    expect(restored.missingChainLimitRegistryKeys).toEqual([registryKey]);
    expect(restored.incompleteReasons).toEqual([`missing Lua chain-limit registry keys: ${registryKey}`]);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual([]);
    const restoredResponse = applyLuaRestoreResponse(restored, { ...sourceAction!, windowToken: restored.session.state.actionWindowToken });
    expect(restoredResponse).toMatchObject({ ok: false, error: `Lua snapshot restore is incomplete: missing Lua chain-limit registry keys: ${registryKey}`, legalActions: [], legalActionGroups: [] });
  });

  it("keeps runtime-erroring named card-table predicates fail-closed after snapshot restore", () => {
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") return sourceScript(false, "chlimit");
        if (name === "c200.lua") return quickScript(200, "runtime-error same-player response resolved");
        if (name === "c300.lua") return quickScript(300, "runtime-error opponent response resolved");
        return undefined;
      },
    };
    const runtimeErrorSource = {
      readScript(name: string) {
        if (name === "c100.lua") return runtimeErrorPredicateSourceScript();
        return source.readScript(name);
      },
    };
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }], []);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 406, startingHandSize: 2, cardReader: reader });
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

    const registryKey = "lua-chain-limit:100:0:link:known:c100.chlimit";
    expect(serializeDuel(session).state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), runtimeErrorSource, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(getLuaRestoreLegalActions(restored, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3")).toBe(false);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
  });

  it("keeps runtime-erroring live named card-table predicates fail-closed", () => {
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") return runtimeErrorPredicateSourceScript();
        if (name === "c200.lua") return quickScript(200, "runtime-error live same-player response resolved");
        if (name === "c300.lua") return quickScript(300, "runtime-error live opponent response resolved");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }], []);
    const session = createDuel({ seed: 407, startingHandSize: 2, cardReader: createCardReader(cards) });
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
    expect(sourceResult.legalActions.some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3")).toBe(false);
    expect(sourceResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(sourceResult.legalActions);
  });

  it("recognizes named literal false predicates as known false descriptors", () => {
    const source = `
      c100 = {}
      function c100.nl(e,tp,eg,ep,ev,re,r,rp)
        return false
      end
      function c100.conditional(e,tp,eg,ep,ev,re,r,rp)
        if rp==tp then return false end
        return true
      end
    `;
    expectLiteralPredicateDescriptor(source, "nl", true, false);
    expectLiteralPredicateDescriptor(source, "conditional", false, false);
  });

  it("restores named literal true predicates as known true predicates from snapshots", () => {
    expectNamedLiteralTruePredicateRestore(true);
  });

  it("restores named climit effect-type predicate semantics from snapshots", () => {
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") return effectTypeSourceScript();
        if (name === "c200.lua") return activationResponseScript(200, "same-player activation response resolved");
        if (name === "c300.lua") return activationResponseScript(300, "blocked opponent activation response resolved");
        if (name === "c400.lua") return quickScript(400, "allowed opponent quick response resolved");
        return undefined;
      },
    };
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 2 }, { id: 300, type: 2 }, { id: 400, type: 1 }], []);
    const session = createDuel({ seed: 314, startingHandSize: 2, cardReader: createCardReader(cards) });
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

    const registryKey = "lua-chain-limit:100:0:link:known:closure:not-effect-type-response-player:16";
    expect(serializeDuel(session).state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd: false });
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-3")).toBe(false);
    expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-4")).toBe(true);

    const opponentWindowRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(opponentWindowRestored, registryKey, false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-3")).toBe(false);
    expect(hasGroupedLuaEffect(opponentWindowRestored, 1, "lua-4")).toBe(true);

    const opponentPass = getLegalActions(session, 1).find((candidate) => candidate.type === "passChain");
    expect(opponentPass).toBeDefined();
    const passResult = applyResponse(session, opponentPass!);
    expect(passResult.ok, passResult.error).toBe(true);

    const handoffRestored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expectRestoredChainLimit(handoffRestored, registryKey, false);
    expect(hasGroupedLuaEffect(handoffRestored, 0, "lua-2")).toBe(true);
    const restoredAction = getLuaRestoreLegalActions(handoffRestored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
    expect(restoredAction).toBeDefined();
    const restoredResponse = applyLuaRestoreResponse(handoffRestored, restoredAction!);
    expect(restoredResponse.ok, restoredResponse.error).toBe(true);
  });
});

function expectNamedPredicateRestore(untilChainEnd: boolean, predicateName: NamedPredicate): void {
  const source = {
    readScript(name: string) {
      if (name === "c100.lua") return sourceScript(untilChainEnd, predicateName);
      if (name === "c200.lua") return quickScript(200, "same-player response resolved");
      if (name === "c300.lua") return quickScript(300, "blocked opponent response resolved");
      return undefined;
    },
  };
  const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }], []);
  const session = createDuel({ seed: seedForPredicate(untilChainEnd, predicateName), startingHandSize: 2, cardReader: createCardReader(cards) });
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

  const registryKey = `lua-chain-limit:100:0:${untilChainEnd ? "chain" : "link"}:known:c100.${predicateName}`;
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

function sourceScript(untilChainEnd: boolean, predicateName: NamedPredicate): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e = Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        Duel.${untilChainEnd ? "SetChainLimitTillChainEnd" : "SetChainLimit"}(s.${predicateName})
      end)
      e:SetOperation(function(e,tp) Debug.Message("named limit source resolved") end)
      c:RegisterEffect(e)
    end
    function s.${predicateName}(e,ep,tp)
      return tp==ep and e:GetHandler():IsCode(200)
    end
  `;
}

function sourceScriptWithoutPredicate(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e = Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
      end)
      e:SetOperation(function(e,tp) Debug.Message("missing named limit source resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function runtimeErrorPredicateSourceScript(): string {
  return `
    c100 = {}
    function c100.initial_effect(c)
      local e = Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        Duel.SetChainLimit(c100.chlimit)
      end)
      e:SetOperation(function(e,tp) Debug.Message("runtime-error named limit source resolved") end)
      c:RegisterEffect(e)
    end
    function c100.chlimit(e,ep,tp)
      return e:IsMissingChainLimitProbe()
    end
  `;
}

function expectLiteralPredicateDescriptor(source: string, fieldName: string, expectedFalse: boolean, expectedTrue: boolean): void {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const scriptName = "c100.lua";
  const loadStatus = lauxlib.luaL_loadbuffer(L, to_luastring(source), source.length, to_luastring(scriptName));
  expect(loadStatus).toBe(lua.LUA_OK);
  expect(lua.lua_pcall(L, 0, 0, 0)).toBe(lua.LUA_OK);
  lua.lua_getglobal(L, to_luastring("c100"));
  lua.lua_getfield(L, -1, to_luastring(fieldName));
  expect(lua.lua_isfunction(L, -1)).toBe(true);
  const hostState = { loadedScriptBodies: new Map([[scriptName, source]]) } as Parameters<typeof literalFalsePredicate>[2];
  expect(literalFalsePredicate(L, -1, hostState)).toBe(expectedFalse);
  expect(literalTruePredicate(L, -1, hostState)).toBe(expectedTrue);
  lua.lua_pop(L, 2);
}

function expectNamedLiteralTruePredicateRestore(untilChainEnd: boolean): void {
  const source = {
    readScript(name: string) {
      if (name === "c100.lua") return literalTruePredicateSourceScript(untilChainEnd);
      if (name === "c200.lua") return quickScript(200, "constant same-player response resolved");
      if (name === "c300.lua") return quickScript(300, "constant opponent response resolved");
      return undefined;
    },
  };
  const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }], []);
  const session = createDuel({ seed: 338, startingHandSize: 2, cardReader: createCardReader(cards) });
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

  const registryKey = `lua-chain-limit:100:0:${untilChainEnd ? "chain" : "link"}:known:aux.TRUE`;
  expect(serializeDuel(session).state.chainLimits[0]).toMatchObject({ registryKey, untilChainEnd });
  expect(hasLuaEffect(getLegalActions(session, 1), 1, "lua-3")).toBe(true);
  expect(hasLuaEffect(getLegalActions(session, 0), 0, "lua-2")).toBe(false);

  const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
  expectRestoredChainLimit(restored, registryKey, untilChainEnd);
  expect(hasGroupedLuaEffect(restored, 1, "lua-3")).toBe(true);
  expect(hasGroupedLuaEffect(restored, 0, "lua-2")).toBe(false);
  const restoredAction = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3");
  expect(restoredAction).toBeDefined();
  const restoredResponse = applyLuaRestoreResponse(restored, restoredAction!);
  expect(restoredResponse.ok, restoredResponse.error).toBe(true);
}

function literalTruePredicateSourceScript(untilChainEnd: boolean): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e = Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        Duel.${untilChainEnd ? "SetChainLimitTillChainEnd" : "SetChainLimit"}(s.nl)
      end)
      e:SetOperation(function(e,tp) Debug.Message("constant limit source resolved") end)
      c:RegisterEffect(e)
    end
    function s.nl(e,tp,eg,ep,ev,re,r,rp)
      return true
    end
  `;
}

function seedForPredicate(untilChainEnd: boolean, predicateName: NamedPredicate): number {
  const offsets: Record<NamedPredicate, number> = {
    chlimit: 0,
    chainlm: 1,
    climit: 2,
    chainlimit: 3,
    chlimit2: 4,
  };
  return 287 + offsets[predicateName] + (untilChainEnd ? 20 : 0);
}

function quickScript(code: number, message: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e = Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("${message}") end)
      c:RegisterEffect(e)
    end
  `;
}

function activationResponseScript(code: number, message: string): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e = Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O+EFFECT_TYPE_ACTIVATE)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("${message}") end)
      c:RegisterEffect(e)
    end
  `;
}

function effectTypeSourceScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e = Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_HAND)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        Duel.SetChainLimit(s.climit)
      end)
      e:SetOperation(function(e,tp) Debug.Message("named climit source resolved") end)
      c:RegisterEffect(e)
    end
    function s.climit(e,lp,tp)
      return lp==tp or not e:IsHasType(EFFECT_TYPE_ACTIVATE)
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

function hasLuaEffect(actions: ReturnType<typeof getLegalActions>, player: 0 | 1, effectId: string): boolean {
  return actions.some((action) => action.type === "activateEffect" && action.player === player && action.effectId === effectId);
}

function hasGroupedLuaEffect(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1, effectId: string): boolean {
  return getLuaRestoreLegalActionGroups(restored, player).some((group) =>
    group.actions.some((action) => action.type === "activateEffect" && action.player === player && action.effectId === effectId),
  );
}
