import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCardReader, createUpstreamSourceConfig, normalizeCdbRows } from "#engine/data-loaders.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { setupLuaChainFixture } from "./lua-chain-fixtures.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

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
    expect(applyResponse(session, summon!).ok).toBe(true);
    const staleTrigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger");
    expect(staleTrigger).toBeDefined();

    expect(applyResponse(session, staleTrigger!).ok).toBe(true);
    const replay = applyResponse(session, staleTrigger!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.legalActions).toEqual(getDuelLegalActions(session, 0));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(session.state.pendingTriggers).toHaveLength(0);
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
    expect(applyResponse(session, summon!).ok).toBe(true);
    const staleDecline = getDuelLegalActions(session, 0).find((action) => action.type === "declineTrigger");
    expect(staleDecline).toBeDefined();

    expect(applyResponse(session, staleDecline!).ok).toBe(true);
    const replay = applyResponse(session, staleDecline!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.legalActions).toEqual(getDuelLegalActions(session, 0));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(session.state.pendingTriggers).toHaveLength(0);
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
    expect(host.loadCardScript(20200, workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const summonSource = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "20100");
    expect(summonSource).toBeDefined();
    const summon = getDuelLegalActions(session, 0).find((action) => action.type === "normalSummon" && action.uid === summonSource!.uid);
    expect(summon).toBeDefined();
    expect(applyResponse(session, summon!).ok).toBe(true);
    const staleDecline = getDuelLegalActions(session, 0).find((action) => action.type === "declineTrigger");
    expect(staleDecline).toBeDefined();

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete).toBe(true);
    const restoredDecline = getDuelLegalActions(restored.session, 0).find((action) => action.type === "declineTrigger");
    expect(restoredDecline).toBeDefined();
    expect(applyLuaRestoreResponse(restored, restoredDecline!).ok).toBe(true);
    const replay = applyLuaRestoreResponse(restored, staleDecline!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(restored.session.state.pendingTriggers).toHaveLength(0);
    expect(restored.host.messages).toEqual([]);
  });
});
