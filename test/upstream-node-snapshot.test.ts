import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createCardReader, createUpstreamSourceConfig, normalizeCdbRows } from "#engine/data-loaders.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function expectLuaRestoreStalePreapply(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1], player: 0 | 1) {
  const staleResult = applyLuaRestoreResponse(restored, { ...action, windowId: action.windowId! - 1 });
  expect(staleResult.ok).toBe(false);
  expect(staleResult.error).toContain("Response is not currently legal");
  expect(staleResult.state.actionWindowId).toBe(restored.session.state.actionWindowId);
  expect(staleResult.legalActions).toEqual(getDuelLegalActions(restored.session, player));
  expect(staleResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(staleResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleResult.legalActions);
}

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
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.effects.map((effect) => effect.registryKey)).toEqual(["lua:100:lua-1-1014"]);
    expect(restored.session.state.effects[0]).toMatchObject({ event: "trigger", triggerEvent: "sentToGraveyard", triggerTiming: "if" });

    expect(getDuelLegalActions(restored.session, 0).some((candidate) => candidate.type === "activateEffect")).toBe(false);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
  });

  it("preserves exact Lua phase trigger codes across restored snapshots", () => {
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
        e:SetCode(EVENT_PHASE + PHASE_BATTLE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("restored coarse battle phase " .. Duel.GetCurrentPhase())
        end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const session = createDuel({ seed: 21, startingHandSize: 1, cardReader: createCardReader(cards) });
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
    expect(restored.session.state.effects[0]).toMatchObject({ triggerEvent: "phaseBattle", triggerCode: 0x1080 });
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const battle = getDuelLegalActions(restored.session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle");
    expect(battle).toBeDefined();
    expectLuaRestoreStalePreapply(restored, battle!, 0);
    const result = applyLuaRestoreAndAssert(restored, battle!);

    expect(restored.session.state.eventHistory).toContainEqual(expect.objectContaining({ eventName: "phaseBattle", eventCode: 0x1008 }));
    expect(restored.session.state.pendingTriggers).toEqual([]);
    expect(restored.host.messages).not.toContain("restored coarse battle phase 8");
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
    const staleActivate = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(staleActivate).toBeDefined();
    const snapshot = serializeDuel(session);
    fs.rmSync(path.join(root, "script", "c100.lua"));

    const restored = restoreDuelWithLuaScripts(snapshot, workspace, createCardReader(cards));

    expect(restored.restoreComplete).toBe(false);
    expect(restored.incompleteReasons).toEqual(["script c100.lua: Script c100.lua was not found", "missing Lua effect registry keys: lua:100:lua-1"]);
    expect(restored.loadedScripts).toEqual([{ ok: false, name: "c100.lua", error: "Script c100.lua was not found" }]);
    expect(restored.registeredEffects).toBe(0);
    expect(restored.restoredRegistryKeys).toEqual([]);
    expect(restored.missingRegistryKeys).toEqual(["lua:100:lua-1"]);
    expect(restored.session.state.effects).toHaveLength(0);
    expect(getDuelLegalActions(restored.session, 0).some((candidate) => candidate.type === "activateEffect")).toBe(false);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual([]);
    const replay = applyLuaRestoreResponse(restored, staleActivate!);
    expect(replay.ok).toBe(false);
    expect(replay.error).toBe("Lua snapshot restore is incomplete: script c100.lua: Script c100.lua was not found; missing Lua effect registry keys: lua:100:lua-1");
    expect(replay.legalActions).toEqual([]);
    expect(replay.legalActionGroups).toEqual([]);
  });

  it("hides prompt responses when Lua snapshot restore is incomplete", () => {
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
        e:SetOperation(function(e,c) Debug.Message("should not run prompt") end)
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
    expect(host.registerInitialEffects()).toBe(1);
    session.state.prompt = { id: "incomplete-lua-prompt", type: "selectOption", player: 1, options: [1, 2], returnTo: 0 };
    session.state.waitingFor = 1;
    const snapshot = serializeDuel(session);
    fs.rmSync(path.join(root, "script", "c100.lua"));

    const restored = restoreDuelWithLuaScripts(snapshot, workspace, createCardReader(cards));

    expect(restored.restoreComplete).toBe(false);
    expect(getDuelLegalActions(restored.session, 1).some((candidate) => candidate.type === "selectOption")).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual([]);
    const result = applyLuaRestoreResponse(restored, { type: "selectOption", player: 1, promptId: "incomplete-lua-prompt", option: 2, label: "Select option 2" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Lua snapshot restore is incomplete: script c100.lua");
    expect(result.state.actionWindowId).toBe(0);
    expect(result.state.windowKind).toBe("prompt");
    expect(result.legalActions).toEqual([]);
    expect(result.legalActionGroups).toEqual([]);
    expect(restored.session.state.prompt?.id).toBe("incomplete-lua-prompt");
  });

  it("rejects trigger responses when Lua snapshot restore is incomplete", () => {
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
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("should not run incomplete trigger")
        end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }], []);
    const session = createDuel({ seed: 25, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: ["300", "300"] },
    });
    startDuel(session);

    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(root));
    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const summonSource = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(summonSource).toBeDefined();
    const summon = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === summonSource!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();

    const snapshot = serializeDuel(session);
    fs.rmSync(path.join(root, "script", "c100.lua"));
    const restored = restoreDuelWithLuaScripts(snapshot, workspace, createCardReader(cards));

    expect(restored.restoreComplete).toBe(false);
    expect(restored.incompleteReasons).toEqual(["script c100.lua: Script c100.lua was not found", "missing Lua effect registry keys: lua:100:lua-1-1100"]);
    expect(restored.session.state.pendingTriggers).toEqual([]);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual([]);
    const result = applyLuaRestoreResponse(restored, trigger!);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Lua snapshot restore is incomplete: script c100.lua");
    expect(result.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(result.state.windowKind).toBe("open");
    expect(result.legalActions).toEqual([]);
    expect(result.legalActionGroups).toEqual([]);
    expect(restored.host.messages).toEqual([]);
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
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(action).toBeDefined();
    expectLuaRestoreStalePreapply(restored, action!, 0);
    const result = applyLuaRestoreAndAssert(restored, action!);
    expect(restored.host.messages).toContain("restored ignition");
    const replay = applyLuaRestoreResponse(restored, action!);
    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(restored.host.messages.filter((message) => message === "restored ignition")).toHaveLength(1);
  });

  it("exposes prompt responses after complete Lua snapshot restore", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const session = createDuel({ seed: 7, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);
    session.state.prompt = { id: "lua-restore-prompt", type: "selectOption", player: 1, options: [3, 5], returnTo: 0 };
    session.state.waitingFor = 1;
    const staleOption = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "selectOption" && candidate.option === 3);
    expect(staleOption).toBeDefined();

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), { readScript: () => undefined }, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.loadedScripts).toEqual([]);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual([]);
    const restoredPromptToken = restored.session.state.actionWindowToken;
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([
      { type: "selectOption", player: 1, promptId: "lua-restore-prompt", option: 3, label: "Select option 3", windowId: 0, windowKind: "prompt", windowToken: restoredPromptToken },
      { type: "selectOption", player: 1, promptId: "lua-restore-prompt", option: 5, label: "Select option 5", windowId: 0, windowKind: "prompt", windowToken: restoredPromptToken },
    ]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const option = getLuaRestoreLegalActions(restored, 1)[1]!;
    expectLuaRestoreStalePreapply(restored, option, 1);
    const staleOptionPreapply = applyLuaRestoreResponse(restored, staleOption!);
    expect(staleOptionPreapply.ok).toBe(false);
    expect(staleOptionPreapply.error).toContain("Response is not currently legal");
    const result = applyLuaRestoreAndAssert(restored, option);
    expect(restored.session.state.prompt).toBeUndefined();
    expect(restored.session.state.waitingFor).toBe(0);
    expect(restored.session.state.log.some((entry) => entry.action === "selectOption" && entry.detail === "Selected option 5")).toBe(true);
    const staleOptionResult = applyLuaRestoreResponse(restored, staleOption!);
    expect(staleOptionResult.ok).toBe(false);
    expect(staleOptionResult.error).toContain("Response is not currently legal");
    expect(staleOptionResult.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleOptionResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(staleOptionResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleOptionResult.legalActions);

    restored.session.state.prompt = { id: "lua-restore-yes-no", type: "selectYesNo", player: 0, description: 101, returnTo: 1 };
    restored.session.state.waitingFor = 0;
    const restoredYesNoToken = restored.session.state.actionWindowToken;
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual([
      { type: "selectYesNo", player: 0, promptId: "lua-restore-yes-no", yes: true, label: "Yes", windowId: 1, windowKind: "prompt", windowToken: restoredYesNoToken },
      { type: "selectYesNo", player: 0, promptId: "lua-restore-yes-no", yes: false, label: "No", windowId: 1, windowKind: "prompt", windowToken: restoredYesNoToken },
    ]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const staleYes = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "selectYesNo" && candidate.yes);
    expect(staleYes).toBeDefined();
    const no = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "selectYesNo" && !candidate.yes);
    expect(no).toBeDefined();
    expectLuaRestoreStalePreapply(restored, no!, 0);
    const noResult = applyLuaRestoreAndAssert(restored, no!);
    expect(restored.session.state.prompt).toBeUndefined();
    expect(restored.session.state.waitingFor).toBe(1);
    expect(restored.session.state.log.some((entry) => entry.action === "selectYesNo" && entry.detail === "Selected no")).toBe(true);
    const staleYesResult = applyLuaRestoreResponse(restored, staleYes!);
    expect(staleYesResult.ok).toBe(false);
    expect(staleYesResult.error).toContain("Response is not currently legal");
    expect(staleYesResult.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(staleYesResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(staleYesResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleYesResult.legalActions);
  });

  it("preserves spent Lua count limits across snapshot restore", () => {
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
        e:SetCountLimit(1)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("restored count ignition")
        end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 400, type: 1 }], []);
    const session = createDuel({ seed: 22, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(root));
    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);
    expect(session.state.usedCountKeys).toHaveLength(1);
    expect(host.messages).toContain("restored count ignition");

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.usedCountKeys).toEqual(session.state.usedCountKeys);

    expect(getLuaRestoreLegalActions(restored, 0).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1")).toBe(false);
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1")).toBe(false);
    expect(restored.host.messages).toEqual([]);
  });

  it("preserves spent Lua shared count codes across snapshot restore", () => {
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
        e1:SetCountLimit(1, 0x444)
        e1:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("restored shared count first")
        end)
        c:RegisterEffect(e1)
        local e2 = Effect.CreateEffect(c)
        e2:SetType(EFFECT_TYPE_IGNITION)
        e2:SetRange(LOCATION_HAND)
        e2:SetCountLimit(1, 0x444)
        e2:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("restored shared count second")
        end)
        c:RegisterEffect(e2)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 400, type: 1 }], []);
    const session = createDuel({ seed: 23, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(root));
    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(getDuelLegalActions(session, 0).filter((candidate) => candidate.type === "activateEffect").map((candidate) => candidate.effectId)).toEqual(["lua-1", "lua-2"]);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-1");
    expect(action).toBeDefined();
    applyAndAssert(session, action!);
    expect(session.state.usedCountKeys).toEqual(["turn-1:0:code-1092"]);
    expect(host.messages).toContain("restored shared count first");

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.effects.map((effect) => effect.id)).toEqual(["lua-1", "lua-2"]);
    expect(restored.session.state.usedCountKeys).toEqual(["turn-1:0:code-1092"]);

    expect(getLuaRestoreLegalActions(restored, 0).filter((candidate) => candidate.type === "activateEffect").map((candidate) => candidate.effectId)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions).filter((candidate) => candidate.type === "activateEffect").map((candidate) => candidate.effectId)).toEqual([]);
    expect(restored.host.messages).toEqual([]);
  });

  it("preserves spent Lua shared count codes for restored pending triggers", () => {
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
        e:SetCode(EVENT_SPSUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetCountLimit(1, 0x555)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("restored pending shared first")
        end)
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
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SPSUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetCountLimit(1, 0x555)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("restored pending shared second")
        end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }, { id: 300, type: 1 }, { id: 400, type: 1 }], []);
    const session = createDuel({ seed: 24, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(root));
    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, workspace).ok).toBe(true);
    expect(host.loadCardScript(200, workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const summon = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(summon).toBeDefined();

    specialSummonDuelCard(session.state, summon!.uid);
    expect(session.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["lua-1-1102", "lua-2-1102"]);
    const firstTrigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.effectId === "lua-1-1102");
    const staleSecondTrigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.effectId === "lua-2-1102");
    expect(firstTrigger).toBeDefined();
    expect(staleSecondTrigger).toBeDefined();
    applyAndAssert(session, firstTrigger!);
    expect(session.state.usedCountKeys).toEqual(["turn-1:0:code-1365"]);
    expect(session.state.pendingTriggers.map((trigger) => trigger.effectId)).toEqual(["lua-2-1102"]);
    expect(getDuelLegalActions(session, 0).filter((candidate) => candidate.type === "activateTrigger")).toEqual([]);
    const declineSecond = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "declineTrigger" && candidate.effectId === "lua-2-1102");
    expect(declineSecond).toBeDefined();
    applyAndAssert(session, declineSecond!);
    expect(host.messages).toContain("restored pending shared first");

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers).toEqual(session.state.pendingTriggers);
    expect(restored.session.state.usedCountKeys).toEqual(["turn-1:0:code-1365"]);

    expect(getLuaRestoreLegalActions(restored, 0).filter((candidate) => candidate.type === "activateTrigger")).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions).filter((candidate) => candidate.type === "activateTrigger")).toEqual([]);
    const staleResult = applyLuaRestoreResponse(restored, staleSecondTrigger!);
    expect(staleResult.ok).toBe(false);
    expect(staleResult.error).toContain("Response is not currently legal");
    expect(staleResult.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(staleResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleResult.legalActions);
    expect(restored.host.messages).toEqual([]);
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
    expect(applyAndAssert(session, action!).state.waitingFor).toBe(1);
    expect(getDuelLegalActions(session, 1).some((candidate) => candidate.type === "activateEffect" && candidate.effectId === "lua-2")).toBe(true);

    const snapshot = serializeDuel(session);
    fs.rmSync(path.join(root, "script", "c100.lua"));
    fs.rmSync(path.join(root, "script", "c200.lua"));

    const restored = restoreDuelWithLuaScripts(snapshot, workspace, createCardReader(cards));

    expect(restored.restoreComplete).toBe(false);
    expect(restored.incompleteReasons).toEqual([
      "script c100.lua: Script c100.lua was not found",
      "script c200.lua: Script c200.lua was not found",
      "missing Lua effect registry keys: lua:100:lua-1, lua:200:lua-2",
    ]);
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
    expect(forgedPass.legalActions).toEqual([]);
    expect(forgedPass.legalActionGroups).toEqual([]);
    expect(forgedPass.legalActionGroups.flatMap((group) => group.actions)).toEqual(forgedPass.legalActions);
    expect(restored.session.state.chain.map((link) => link.effectId)).toEqual(["lua-1"]);
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual([]);
    const restorePass = applyLuaRestoreResponse(restored, { type: "passChain", player: 1, label: "Pass" });
    expect(restorePass.ok).toBe(false);
    expect(restorePass.error).toContain("Lua snapshot restore is incomplete: script c100.lua");
    expect(restorePass.legalActions).toEqual([]);
    expect(restorePass.legalActionGroups).toEqual([]);
    expect(restored.session.state.chain.map((link) => link.effectId)).toEqual(["lua-1"]);
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
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.effects.map((effect) => effect.registryKey)).toEqual(["lua:100:lua-1"]);
  });

});
