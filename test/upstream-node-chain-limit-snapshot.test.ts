import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCardReader, createUpstreamSourceConfig, normalizeCdbRows } from "#engine/data-loaders.js";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Node upstream chain-limit snapshot restore", () => {
  it("reports Lua chain-limit predicates that cannot be restored from snapshots", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "duel-upstream-"));
    tempRoots.push(root);
    fs.mkdirSync(path.join(root, "script"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "script", "c100.lua"),
      `
      c100 = {}
      c100.initial_effect = function(c)
        local e = Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return true end
          Duel.SetChainLimitTillChainEnd(function(te,rp,tp) return te:GetHandler():GetCode()==200 end)
        end)
        e:SetOperation(function(e,c) Debug.Message("limit source") end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );
    fs.writeFileSync(
      path.join(root, "script", "c200.lua"),
      `
      c200 = {}
      c200.initial_effect = function(c)
        local e = Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c) return Duel.GetCurrentChain()>0 end)
        e:SetOperation(function(e,c) Debug.Message("quick response") end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );
    fs.writeFileSync(
      path.join(root, "script", "c400.lua"),
      `
      c400 = {}
      c400.initial_effect = function(c)
        local e = Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c) return Duel.GetCurrentChain()>0 end)
        e:SetOperation(function(e,c) Debug.Message("blocked quick response") end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 400, type: 1 }], []);
    const session = createDuel({ seed: 5, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200", "400"] },
    });
    startDuel(session);

    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(root));
    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, workspace).ok).toBe(true);
    expect(host.loadCardScript(200, workspace).ok).toBe(true);
    expect(host.loadCardScript(400, workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);
    expect(getDuelLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2")).toBe(true);
    expect(getDuelLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3")).toBe(false);

    const snapshot = serializeDuel(session);
    expect(snapshot.state.chainLimits.map((limit) => limit.registryKey).filter(Boolean)).toHaveLength(1);
    const restored = restoreDuelWithLuaScripts(snapshot, workspace, createCardReader(cards));
    expect(restored.restoreComplete).toBe(false);
    expect(restored.chainLimitRegistryKeys).toHaveLength(1);
    expect(restored.missingChainLimitRegistryKeys).toEqual(restored.chainLimitRegistryKeys);
    expect(restored.incompleteReasons).toEqual([`missing Lua chain-limit registry keys: ${restored.chainLimitRegistryKeys[0]}`]);
    expect(restored.session.state.chainLimits).toHaveLength(1);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ untilChainEnd: true });
    expect(restored.session.state.chainLimits[0]).not.toHaveProperty("registryKey");
    expect(getDuelLegalActions(restored.session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2")).toBe(false);
    expect(getDuelLegalActions(restored.session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3")).toBe(false);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual([]);
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual([]);
    const forgedResult = applyLuaRestoreResponse(restored, { type: "activateEffect", player: 1, uid: "forged", effectId: "lua-3", label: "Forged" });
    expect(forgedResult.ok).toBe(false);
    expect(forgedResult.error).toContain("Lua snapshot restore is incomplete: missing Lua chain-limit registry keys: lua-chain-limit:");
    expect(forgedResult.legalActions).toEqual([]);
    expect(forgedResult.legalActionGroups).toEqual([]);

    const chainLimitOnlySnapshot = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
    chainLimitOnlySnapshot.state.effects = [];
    const chainLimitOnlyRestored = restoreDuelWithLuaScripts(chainLimitOnlySnapshot, workspace, createCardReader(cards));
    expect(chainLimitOnlyRestored.loadedScripts).toContainEqual({ ok: true, name: "c100.lua" });
    expect(chainLimitOnlyRestored.chainLimitRegistryKeys).toEqual(restored.chainLimitRegistryKeys);
    expect(chainLimitOnlyRestored.missingChainLimitRegistryKeys).toEqual(restored.chainLimitRegistryKeys);
  });

  it("restores known Lua chain-limit predicates from snapshots", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "duel-upstream-"));
    tempRoots.push(root);
    fs.mkdirSync(path.join(root, "script"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "script", "c100.lua"),
      `
      c100 = {}
      c100.initial_effect = function(c)
        local e = Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return true end
          Duel.SetChainLimit(aux.TRUE)
        end)
        e:SetOperation(function(e,c) Debug.Message("known limit source") end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );
    fs.writeFileSync(
      path.join(root, "script", "c200.lua"),
      `
      c200 = {}
      c200.initial_effect = function(c)
        local e = Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c) return Duel.GetCurrentChain()>0 end)
        e:SetOperation(function(e,c) Debug.Message("allowed by known limit") end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const session = createDuel({ seed: 7, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(root));
    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, workspace).ok).toBe(true);
    expect(host.loadCardScript(200, workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);
    expect(getDuelLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2")).toBe(true);

    const snapshot = serializeDuel(session);
    expect(snapshot.state.chainLimits).toEqual([
      expect.objectContaining({ registryKey: "lua-chain-limit:100:0:link:known:aux.TRUE", untilChainEnd: false, expiresAtChainLength: 1 }),
    ]);
    const restored = restoreDuelWithLuaScripts(snapshot, workspace, createCardReader(cards));

    expect(restored.restoreComplete).toBe(true);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ registryKey: "lua-chain-limit:100:0:link:known:aux.TRUE", untilChainEnd: false, expiresAtChainLength: 1 });
    const restoredAction = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
    expect(restoredAction).toBeDefined();
    expect(applyLuaRestoreResponse(restored, restoredAction!).ok).toBe(true);
  });

  it("restores named Lua chain-limit predicates from snapshots", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "duel-upstream-"));
    tempRoots.push(root);
    fs.mkdirSync(path.join(root, "script"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "script", "c100.lua"),
      `
      c100 = {}
      c100.initial_effect = function(c)
        local e = Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetTarget(c100.target)
        e:SetOperation(function(e,c) Debug.Message("named limit source") end)
        c:RegisterEffect(e)
      end
      function c100.target(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        Duel.SetChainLimit(c100.chlimit)
      end
      function c100.chlimit(te,rp,tp)
        return rp==1
      end
      `,
      "utf8",
    );
    fs.writeFileSync(
      path.join(root, "script", "c200.lua"),
      `
      c200 = {}
      c200.initial_effect = function(c)
        local e = Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c) return Duel.GetCurrentChain()>0 end)
        e:SetOperation(function(e,c) Debug.Message("allowed named response") end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const session = createDuel({ seed: 8, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(root));
    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, workspace).ok).toBe(true);
    expect(host.loadCardScript(200, workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);
    expect(getDuelLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2")).toBe(true);

    const snapshot = serializeDuel(session);
    expect(snapshot.state.chainLimits).toEqual([
      expect.objectContaining({ registryKey: "lua-chain-limit:100:0:link:known:c100.chlimit", untilChainEnd: false, expiresAtChainLength: 1 }),
    ]);
    const restored = restoreDuelWithLuaScripts(snapshot, workspace, createCardReader(cards));

    expect(restored.restoreComplete).toBe(true);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    const restoredAction = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
    expect(restoredAction).toBeDefined();
    expect(applyLuaRestoreResponse(restored, restoredAction!).ok).toBe(true);
  });

  it("restores single-card Lua chain-limit closures from snapshots", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "duel-upstream-"));
    tempRoots.push(root);
    fs.mkdirSync(path.join(root, "script"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "script", "c100.lua"),
      `
      c100 = {}
      c100.initial_effect = function(c)
        local e = Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetTarget(c100.target)
        e:SetOperation(function(e,c) Debug.Message("closure limit source") end)
        c:RegisterEffect(e)
      end
      function c100.target(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return true end
        local tc = Duel.GetFirstMatchingCard(Card.IsCode,tp,0,LOCATION_HAND,nil,300)
        Duel.SetChainLimit(c100.limit(tc))
      end
      function c100.limit(c)
        return function(e,rp,tp)
          return e:GetHandler()~=c
        end
      end
      `,
      "utf8",
    );
    fs.writeFileSync(
      path.join(root, "script", "c200.lua"),
      `
      c200 = {}
      c200.initial_effect = function(c)
        local e = Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c) return Duel.GetCurrentChain()>0 end)
        e:SetOperation(function(e,c) Debug.Message("allowed closure response") end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );
    fs.writeFileSync(
      path.join(root, "script", "c300.lua"),
      `
      c300 = {}
      c300.initial_effect = function(c)
        local e = Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c) return Duel.GetCurrentChain()>0 end)
        e:SetOperation(function(e,c) Debug.Message("blocked closure response") end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }], []);
    const session = createDuel({ seed: 9, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200", "300"] },
    });
    startDuel(session);

    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(root));
    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, workspace).ok).toBe(true);
    expect(host.loadCardScript(200, workspace).ok).toBe(true);
    expect(host.loadCardScript(300, workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);
    expect(getDuelLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2")).toBe(true);
    expect(getDuelLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3")).toBe(false);

    const snapshot = serializeDuel(session);
    expect(snapshot.state.chainLimits[0]?.registryKey).toContain(":known:closure:card-not-handler:");
    const restored = restoreDuelWithLuaScripts(snapshot, workspace, createCardReader(cards));

    expect(restored.restoreComplete).toBe(true);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActions(restored, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3")).toBe(false);
    const restoredAction = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2");
    expect(restoredAction).toBeDefined();
    expect(applyLuaRestoreResponse(restored, restoredAction!).ok).toBe(true);
  });

  it("reports Lua one-chain limit predicates that cannot be restored from snapshots", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "duel-upstream-"));
    tempRoots.push(root);
    fs.mkdirSync(path.join(root, "script"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "script", "c100.lua"),
      `
      c100 = {}
      c100.initial_effect = function(c)
        local e = Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return true end
          Duel.SetChainLimit(function(te,rp,tp) return te:GetHandler():GetCode()==200 end)
        end)
        e:SetOperation(function(e,c) Debug.Message("one-chain limit source") end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );
    fs.writeFileSync(
      path.join(root, "script", "c200.lua"),
      `
      c200 = {}
      c200.initial_effect = function(c)
        local e = Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,c) return Duel.GetCurrentChain()>0 end)
        e:SetOperation(function(e,c) Debug.Message("one-chain quick response") end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const session = createDuel({ seed: 6, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(root));
    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, workspace).ok).toBe(true);
    expect(host.loadCardScript(200, workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);
    expect(getDuelLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2")).toBe(true);

    const snapshot = serializeDuel(session);
    expect(snapshot.state.chainLimits).toEqual([
      expect.objectContaining({ registryKey: expect.stringMatching(/^lua-chain-limit:100:0:link:/), untilChainEnd: false, expiresAtChainLength: 1 }),
    ]);
    const restored = restoreDuelWithLuaScripts(snapshot, workspace, createCardReader(cards));

    expect(restored.restoreComplete).toBe(false);
    expect(restored.chainLimitRegistryKeys).toEqual(snapshot.state.chainLimits.map((limit) => limit.registryKey));
    expect(restored.missingChainLimitRegistryKeys).toEqual(restored.chainLimitRegistryKeys);
    expect(restored.incompleteReasons).toEqual([`missing Lua chain-limit registry keys: ${restored.chainLimitRegistryKeys[0]}`]);
    expect(restored.session.state.chainLimits).toHaveLength(1);
    expect(restored.session.state.chainLimits[0]).toMatchObject({ untilChainEnd: false, expiresAtChainLength: 1 });
    expect(restored.session.state.chainLimits[0]).not.toHaveProperty("registryKey");
    expect(getDuelLegalActions(restored.session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2")).toBe(false);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual([]);
    expect(applyLuaRestoreResponse(restored, { type: "passChain", player: 0, label: "Pass" })).toMatchObject({
      ok: false,
      legalActions: [],
      legalActionGroups: [],
    });
  });
});
