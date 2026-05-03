import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createCardReader, createUpstreamSourceConfig, normalizeCdbRows } from "#engine/data-loaders.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Node upstream snapshot restore", () => {
  it("rehydrates Lua effects from restored snapshots", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "duel-upstream-"));
    tempRoots.push(root);
    fs.mkdirSync(path.join(root, "script"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "script", "c100.lua"),
      `
      c100 = {}
      c100.initial_effect = function(c)
        local e = Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_TO_GRAVE)
        e:SetProperty(EFFECT_FLAG_DELAY)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,c)
          Debug.Message("restored lua operation " .. c:GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const session = createDuel({ seed: 2, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(root));
    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const snapshot = serializeDuel(session);

    const restored = restoreDuelWithLuaScripts(snapshot, workspace, createCardReader(cards));
    expect(restored.loadedScripts).toEqual([{ ok: true, name: "c100.lua" }]);
    expect(restored.restoreComplete).toBe(true);
    expect(restored.registeredEffects).toBe(1);
    expect(restored.restoredRegistryKeys).toEqual(["lua:100:lua-1-1014"]);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.session.state.effects.map((effect) => effect.registryKey)).toEqual(["lua:100:lua-1-1014"]);
    expect(restored.session.state.effects[0]).toMatchObject({ event: "trigger", triggerEvent: "sentToGraveyard", triggerTiming: "if" });

    expect(getDuelLegalActions(restored.session, 0).some((candidate) => candidate.type === "activateEffect")).toBe(false);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
  });

  it("reports missing Lua scripts during snapshot restore", () => {
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
        e:SetOperation(function(e,c) Debug.Message("should not run") end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const session = createDuel({ seed: 3, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(root));
    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const snapshot = serializeDuel(session);
    fs.rmSync(path.join(root, "script", "c100.lua"));

    const restored = restoreDuelWithLuaScripts(snapshot, workspace, createCardReader(cards));

    expect(restored.restoreComplete).toBe(false);
    expect(restored.loadedScripts).toEqual([{ ok: false, name: "c100.lua", error: "Script c100.lua was not found" }]);
    expect(restored.registeredEffects).toBe(0);
    expect(restored.restoredRegistryKeys).toEqual([]);
    expect(restored.missingRegistryKeys).toEqual(["lua:100:lua-1"]);
    expect(restored.session.state.effects).toHaveLength(0);
    expect(getDuelLegalActions(restored.session, 0).some((candidate) => candidate.type === "activateEffect")).toBe(false);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual([]);
  });

  it("exposes legal actions after complete Lua snapshot restore", () => {
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
        e:SetOperation(function(e,c) Debug.Message("restored ignition") end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const session = createDuel({ seed: 3, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(root));
    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, createCardReader(cards));

    expect(restored.restoreComplete).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActions(restored, 0).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1")).toBe(true);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
  });

  it("hides chain responses when a pending Lua chain link cannot be restored", () => {
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
        e:SetOperation(function(e,c) Debug.Message("missing chain source resolved") end)
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
    expect(applyResponse(session, action!).state.waitingFor).toBe(1);
    expect(getDuelLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2")).toBe(true);

    const snapshot = serializeDuel(session);
    fs.rmSync(path.join(root, "script", "c100.lua"));
    fs.rmSync(path.join(root, "script", "c200.lua"));

    const restored = restoreDuelWithLuaScripts(snapshot, workspace, createCardReader(cards));

    expect(restored.restoreComplete).toBe(false);
    expect(restored.loadedScripts).toEqual([
      { ok: false, name: "c100.lua", error: "Script c100.lua was not found" },
      { ok: false, name: "c200.lua", error: "Script c200.lua was not found" },
    ]);
    expect(restored.session.state.chain.map((link) => link.effectId)).toEqual(["lua-1"]);
    expect(restored.session.state.effects).toEqual([]);
    expect(getDuelLegalActions(restored.session, 1)).toEqual([]);
    expect(getGroupedDuelLegalActions(restored.session, 1)).toEqual([]);
    const forgedPass = applyResponse(restored.session, { type: "passChain", player: 1, label: "Pass" });
    expect(forgedPass.ok).toBe(false);
    expect(forgedPass.error).toContain("Response is not currently legal");
    expect(forgedPass.legalActionGroups).toEqual([]);
    expect(restored.session.state.chain.map((link) => link.effectId)).toEqual(["lua-1"]);
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual([]);
  });

  it("filters Lua effects not present in the restored snapshot", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "duel-upstream-"));
    tempRoots.push(root);
    fs.mkdirSync(path.join(root, "script"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "script", "c100.lua"),
      `
      c100 = {}
      c100.initial_effect = function(c)
        local e1 = Effect.CreateEffect(c)
        e1:SetType(EFFECT_TYPE_IGNITION)
        e1:SetRange(LOCATION_HAND)
        e1:SetOperation(function(e,c) Debug.Message("kept effect") end)
        c:RegisterEffect(e1)
        local e2 = Effect.CreateEffect(c)
        e2:SetType(EFFECT_TYPE_IGNITION)
        e2:SetRange(LOCATION_HAND)
        e2:SetOperation(function(e,c) Debug.Message("extra effect") end)
        c:RegisterEffect(e2)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const session = createDuel({ seed: 4, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(root));
    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const snapshot = serializeDuel(session);
    snapshot.state.effects = snapshot.state.effects.filter((effect) => effect.registryKey === "lua:100:lua-1");

    const restored = restoreDuelWithLuaScripts(snapshot, workspace, createCardReader(cards));

    expect(restored.registeredEffects).toBe(1);
    expect(restored.restoreComplete).toBe(true);
    expect(restored.restoredRegistryKeys).toEqual(["lua:100:lua-1"]);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.session.state.effects.map((effect) => effect.registryKey)).toEqual(["lua:100:lua-1"]);
  });

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
    expect(getDuelLegalActions(restored.session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3")).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual([]);
    const forgedAction = getDuelLegalActions(restored.session, 1).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-3");
    expect(forgedAction).toBeDefined();
    expect(getLuaRestoreLegalActions(restored, 1)).not.toContain(forgedAction);
  });

});
