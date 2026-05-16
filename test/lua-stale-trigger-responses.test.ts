import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCardReader, createUpstreamSourceConfig, normalizeCdbRows } from "#engine/data-loaders.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { setupLuaChainFixture } from "./lua-chain-fixtures.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function expectRestoredLegalActionGroups(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe("Lua stale trigger responses", () => {
  it("rejects stale Lua trigger activations after the trigger is consumed", () => {
    const { session, host } = setupLuaChainFixture({
      seed: 105,
      startingHandSize: 2,
      cards: [
        { code: "18100", name: "Lua Stale Trigger Summon", kind: "monster" },
        { code: "18200", name: "Lua Stale Activate Trigger", kind: "monster" },
        { code: "18300", name: "Lua Stale Trigger Filler", kind: "monster" },
      ],
      decks: {
        0: { main: ["18100", "18200"] },
        1: { main: ["18300", "18300"] },
      },
      expectedEffects: 1,
      scriptName: "lua-stale-trigger-activation.lua",
      script: `
      c18200={}
      function c18200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua stale activate trigger resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
    });
    const summonSource = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "18100");
    expect(summonSource).toBeDefined();
    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summonSource!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);
    const staleTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger");
    expect(staleTrigger).toBeDefined();

    applyAndAssert(session, staleTrigger!);
    const replay = applyResponse(session, staleTrigger!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.legalActions).toEqual(getDuelLegalActions(session, 0));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(session.state.pendingTriggers).toHaveLength(0);
    expect(queryPublicState(session).pendingTriggerBuckets).toEqual([]);
    expect(host.messages).toEqual(["lua stale activate trigger resolved"]);
  });

  it("rejects stale Lua trigger declines after the trigger is consumed", () => {
    const { session, host } = setupLuaChainFixture({
      seed: 106,
      startingHandSize: 2,
      cards: [
        { code: "19100", name: "Lua Stale Decline Summon", kind: "monster" },
        { code: "19200", name: "Lua Stale Decline Trigger", kind: "monster" },
        { code: "19300", name: "Lua Stale Decline Filler", kind: "monster" },
      ],
      decks: {
        0: { main: ["19100", "19200"] },
        1: { main: ["19300", "19300"] },
      },
      expectedEffects: 1,
      scriptName: "lua-stale-trigger-decline.lua",
      script: `
      c19200={}
      function c19200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua stale decline trigger should not resolve")
        end)
        c:RegisterEffect(e)
      end
      `,
    });
    const summonSource = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "19100");
    expect(summonSource).toBeDefined();
    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summonSource!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);
    const staleDecline = getDuelLegalActions(session, 0).find((action) => action.type === "declineTrigger");
    expect(staleDecline).toBeDefined();

    applyAndAssert(session, staleDecline!);
    const replay = applyResponse(session, staleDecline!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.legalActions).toEqual(getDuelLegalActions(session, 0));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(session.state.pendingTriggers).toHaveLength(0);
    expect(queryPublicState(session).pendingTriggerBuckets).toEqual([]);
    expect(host.messages).toEqual([]);
  });

  it("rejects stale restored Lua trigger declines after the trigger is consumed", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "duel-upstream-"));
    tempRoots.push(root);
    fs.mkdirSync(path.join(root, "script"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "script", "c20200.lua"),
      `
      c20200={}
      function c20200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("restored stale decline trigger should not resolve")
        end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows([{ id: 20100, type: 1 }, { id: 20200, type: 1 }, { id: 20300, type: 1 }], []);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 107, startingHandSize: 2, cardReader: reader });
    loadDecks(session, {
      0: { main: ["20100", "20200"] },
      1: { main: ["20300", "20300"] },
    });
    startDuel(session);

    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(root));
    const host = createLuaScriptHost(session);
    const loaded = host.loadCardScript(20200, workspace);
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const summonSource = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "20100");
    expect(summonSource).toBeDefined();
    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summonSource!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);
    const staleDecline = getDuelLegalActions(session, 0).find((action) => action.type === "declineTrigger");
    expect(staleDecline).toBeDefined();

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored, 0);
    const restoredDecline = getDuelLegalActions(restored.session, 0).find((action) => action.type === "declineTrigger");
    expect(restoredDecline).toBeDefined();
    expect(restoredDecline).toMatchObject({ windowId: queryPublicState(restored.session).actionWindowId, windowKind: "triggerBucket" });
    const stalePreapply = applyLuaRestoreResponse(restored, staleDecline!);
    expect(stalePreapply.ok).toBe(false);
    expect(stalePreapply.error).toContain("Response is not currently legal");
    expect(stalePreapply.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(stalePreapply.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(stalePreapply.legalActionGroups.flatMap((group) => group.actions)).toEqual(stalePreapply.legalActions);
    applyLuaRestoreAndAssert(restored, restoredDecline!);
    const replay = applyLuaRestoreResponse(restored, staleDecline!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(restored.session.state.pendingTriggers).toHaveLength(0);
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toEqual([]);
    expect(restored.host.messages).toEqual([]);
  });

  it("rejects stale restored Lua trigger activations after the trigger is consumed", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "duel-upstream-"));
    tempRoots.push(root);
    fs.mkdirSync(path.join(root, "script"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "script", "c21200.lua"),
      `
      c21200={}
      function c21200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("restored stale activate trigger resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows([{ id: 21100, type: 1 }, { id: 21200, type: 1 }, { id: 21300, type: 1 }], []);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 108, startingHandSize: 2, cardReader: reader });
    loadDecks(session, {
      0: { main: ["21100", "21200"] },
      1: { main: ["21300", "21300"] },
    });
    startDuel(session);

    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(root));
    const host = createLuaScriptHost(session);
    const loaded = host.loadCardScript(21200, workspace);
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const summonSource = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "21100");
    expect(summonSource).toBeDefined();
    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summonSource!.uid);
    expect(summon).toBeDefined();
    applyAndAssert(session, summon!);
    const staleTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger");
    expect(staleTrigger).toBeDefined();

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActionGroups(restored, 0);
    const restoredTrigger = getDuelLegalActions(restored.session, 0).find((action) => action.type === "activateTrigger");
    expect(restoredTrigger).toBeDefined();
    expect(restoredTrigger).toMatchObject({ windowId: queryPublicState(restored.session).actionWindowId, windowKind: "triggerBucket" });
    const stalePreapply = applyLuaRestoreResponse(restored, staleTrigger!);
    expect(stalePreapply.ok).toBe(false);
    expect(stalePreapply.error).toContain("Response is not currently legal");
    expect(stalePreapply.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(stalePreapply.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(stalePreapply.legalActionGroups.flatMap((group) => group.actions)).toEqual(stalePreapply.legalActions);
    const restoredActivation = applyLuaRestoreAndAssert(restored, restoredTrigger!);
    expect(restoredActivation.state).toMatchObject({ waitingFor: 0, windowKind: "open" });
    expect(restored.session.state.chainPasses).toEqual([]);
    expect(restoredActivation.state.chain).toHaveLength(0);
    expect(restoredActivation.state.pendingTriggers).toHaveLength(0);
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toEqual([]);
    const replay = applyLuaRestoreResponse(restored, staleTrigger!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(restored.session.state.pendingTriggers).toHaveLength(0);
    expect(queryPublicState(restored.session).pendingTriggerBuckets).toEqual([]);
    expect(restored.host.messages).toEqual(["restored stale activate trigger resolved"]);
  });
});

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function applyLuaRestoreAndAssert(restored: Parameters<typeof applyLuaRestoreResponse>[0], action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
