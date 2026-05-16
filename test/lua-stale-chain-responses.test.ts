import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import { setupLuaChainFixture } from "./lua-chain-fixtures.js";

describe("Lua stale chain responses", () => {
  it("rejects stale Lua pass responses after a chain resolves", () => {
    const { session, host } = setupLuaChainFixture({
      seed: 101,
      startingHandSize: 2,
      cards: [
        { code: "16100", name: "Lua Stale Pass Source", kind: "monster" },
        { code: "16200", name: "Lua Stale Pass Quick", kind: "monster" },
        { code: "16300", name: "Lua Stale Pass Filler", kind: "monster" },
      ],
      decks: {
        0: { main: ["16100", "16300"] },
        1: { main: ["16200", "16300"] },
      },
      expectedEffects: 2,
      scriptName: "lua-stale-pass-response.lua",
      script: `
      c16100={}
      function c16100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua stale pass source resolved")
        end)
        c:RegisterEffect(e)
      end
      c16200={}
      function c16200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          return Duel.GetCurrentChain()>0
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua stale pass quick resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
    });
    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "16100");
    expect(source).toBeDefined();
    const sourceAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === source!.uid);
    expect(sourceAction).toBeDefined();
    const opened = applyAndAssert(session, sourceAction!);
    expect(opened.state.waitingFor).toBe(1);
    const stalePass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(stalePass).toBeDefined();

    applyAndAssert(session, stalePass!);
    const replay = applyResponse(session, stalePass!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.state.actionWindowId).toBe(session.state.actionWindowId);
    expect(replay.legalActions).toEqual(getDuelLegalActions(session, 0));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(session.state.chain).toHaveLength(0);
    expectNoPublicTriggerWindow(session);
    expect(host.messages).toEqual(["lua stale pass source resolved"]);
  });

  it("rejects stale Lua quick responses after their chain window closes", () => {
    const { session, host } = setupLuaChainFixture({
      seed: 102,
      startingHandSize: 2,
      cards: [
        { code: "17100", name: "Lua Stale Quick Source", kind: "monster" },
        { code: "17200", name: "Lua Stale Self Quick", kind: "monster" },
        { code: "17300", name: "Lua Stale Quick Filler", kind: "monster" },
      ],
      decks: {
        0: { main: ["17100", "17200"] },
        1: { main: ["17300", "17300"] },
      },
      expectedEffects: 2,
      scriptName: "lua-stale-quick-response.lua",
      script: `
      c17100={}
      function c17100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua stale quick source resolved")
        end)
        c:RegisterEffect(e)
      end
      c17200={}
      function c17200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_QUICK_O)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          return Duel.GetCurrentChain()>0
        end)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua stale self quick resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
    });
    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "17100");
    expect(source).toBeDefined();
    const sourceAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === source!.uid);
    expect(sourceAction).toBeDefined();
    const opened = applyAndAssert(session, sourceAction!);
    expect(opened.state.waitingFor).toBe(0);
    const staleQuick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect");
    const pass = getDuelLegalActions(session, 0).find((action) => action.type === "passChain");
    expect(staleQuick).toBeDefined();
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);

    const replay = applyResponse(session, staleQuick!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.state.actionWindowId).toBe(session.state.actionWindowId);
    expect(replay.legalActions).toEqual(getDuelLegalActions(session, 0));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 0));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(session.state.chain).toHaveLength(0);
    expectNoPublicTriggerWindow(session);
    expect(host.messages).toEqual(["lua stale quick source resolved"]);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateEffect")).toBe(true);
  });

  it("rejects stale Lua pass responses captured before snapshot restore", () => {
    const cards = [
      { code: "18100", name: "Lua Restore Stale Pass Source", kind: "monster" as const },
      { code: "18200", name: "Lua Restore Stale Pass Quick", kind: "monster" as const },
      { code: "18300", name: "Lua Restore Stale Pass Filler", kind: "monster" as const },
    ];
    const source = {
      readScript(name: string) {
        if (name === "c18100.lua") {
          return `
          c18100={}
          function c18100.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_IGNITION)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
              Debug.Message("restored stale pass source resolved")
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c18200.lua") {
          return `
          c18200={}
          function c18200.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_QUICK_O)
            e:SetRange(LOCATION_HAND)
            e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
              return Duel.GetCurrentChain()>0
            end)
            e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
              Debug.Message("restored stale pass quick resolved")
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 103, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["18100", "18300"] },
      1: { main: ["18200", "18300"] },
    });
    startDuel(session);
    const host = createLuaScriptHost(session);
    const sourceScript = host.loadCardScript(18100, source);
    const quickScript = host.loadCardScript(18200, source);
    expect(sourceScript.ok, sourceScript.error).toBe(true);
    expect(quickScript.ok, quickScript.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const sourceCard = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "18100");
    expect(sourceCard).toBeDefined();
    const sourceAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === sourceCard!.uid);
    expect(sourceAction).toBeDefined();
    const opened = applyAndAssert(session, sourceAction!);
    expect(opened.state.waitingFor).toBe(1);
    const stalePass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(stalePass).toBeDefined();

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual(getDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    const restoredPass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(restoredPass).toBeDefined();
    expect(restoredPass).toMatchObject({ windowId: queryPublicState(restored.session).actionWindowId, windowKind: "chainResponse" });
    expect(hasGroupedAction(restored, 1, "passChain")).toBe(true);
    const stalePreapply = applyLuaRestoreResponse(restored, stalePass!);
    expect(stalePreapply.ok).toBe(false);
    expect(stalePreapply.error).toContain("Response is not currently legal");
    expect(stalePreapply.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(stalePreapply.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(stalePreapply.legalActionGroups.flatMap((group) => group.actions)).toEqual(stalePreapply.legalActions);
    const restoredPassResult = applyLuaRestoreAndAssert(restored, restoredPass!);
    expect(restoredPassResult.state).toMatchObject({ waitingFor: 0, windowKind: "open" });
    expect(restoredPassResult.state.chain).toEqual([]);
    expect(restored.session.state.chainPasses).toEqual([]);

    const replay = applyLuaRestoreResponse(restored, stalePass!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(replay.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(restored.session.state.chain).toHaveLength(0);
    expectNoPublicTriggerWindow(restored.session);
    expect(restored.host.messages).toEqual(["restored stale pass source resolved"]);
  });

  it("rejects stale Lua pass responses after a restored quick response", () => {
    const cards = [
      { code: "20100", name: "Lua Restore Quick Stale Pass Source", kind: "monster" as const },
      { code: "20200", name: "Lua Restore Quick Stale Pass Response", kind: "monster" as const },
      { code: "20300", name: "Lua Restore Quick Stale Pass Filler", kind: "monster" as const },
    ];
    const source = {
      readScript(name: string) {
        if (name === "c20100.lua") {
          return `
          c20100={}
          function c20100.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_IGNITION)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
              Debug.Message("restored quick stale pass source resolved")
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c20200.lua") {
          return `
          c20200={}
          function c20200.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_QUICK_O)
            e:SetRange(LOCATION_HAND)
            e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
              return Duel.GetCurrentChain()>0
            end)
            e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
              Debug.Message("restored quick stale pass response resolved")
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 105, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["20100", "20300"] },
      1: { main: ["20200", "20300"] },
    });
    startDuel(session);
    const host = createLuaScriptHost(session);
    const sourceScript = host.loadCardScript(20100, source);
    const quickScript = host.loadCardScript(20200, source);
    expect(sourceScript.ok, sourceScript.error).toBe(true);
    expect(quickScript.ok, quickScript.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const sourceCard = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "20100");
    expect(sourceCard).toBeDefined();
    const sourceAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === sourceCard!.uid);
    expect(sourceAction).toBeDefined();
    const opened = applyAndAssert(session, sourceAction!);
    expect(opened.state.waitingFor).toBe(1);
    const stalePass = getDuelLegalActions(session, 1).find((action) => action.type === "passChain");
    expect(stalePass).toBeDefined();

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual(getDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    const restoredQuick = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "activateEffect");
    expect(restoredQuick).toBeDefined();
    expect(restoredQuick).toMatchObject({ windowId: queryPublicState(restored.session).actionWindowId, windowKind: "chainResponse" });
    expect(hasGroupedAction(restored, 1, "activateEffect", restoredQuick!.effectId)).toBe(true);
    const stalePreapply = applyLuaRestoreResponse(restored, stalePass!);
    expect(stalePreapply.ok).toBe(false);
    expect(stalePreapply.error).toContain("Response is not currently legal");
    expect(stalePreapply.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(stalePreapply.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(stalePreapply.legalActionGroups.flatMap((group) => group.actions)).toEqual(stalePreapply.legalActions);
    const restoredQuickResult = applyLuaRestoreAndAssert(restored, restoredQuick!);
    expect(restoredQuickResult.state.chain).toHaveLength(2);
    expect(restoredQuickResult.state.waitingFor).toBe(1);

    const replay = applyLuaRestoreResponse(restored, stalePass!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(replay.legalActions).toEqual(getDuelLegalActions(restored.session, 1));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);

    const currentPass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(currentPass).toBeDefined();
    expect(hasGroupedAction(restored, 1, "passChain")).toBe(true);
    const currentPassResult = applyLuaRestoreAndAssert(restored, currentPass!);
    expect(currentPassResult.state).toMatchObject({ waitingFor: 0, windowKind: "open" });
    expect(currentPassResult.state.chain).toEqual([]);
    expect(restored.session.state.chainPasses).toEqual([]);

    const staleCurrentPass = applyLuaRestoreResponse(restored, currentPass!);

    expect(staleCurrentPass.ok).toBe(false);
    expect(staleCurrentPass.error).toContain("Response is not currently legal");
    expect(staleCurrentPass.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleCurrentPass.legalActions).toEqual(getDuelLegalActions(restored.session, currentPassResult.state.waitingFor!));
    expect(staleCurrentPass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, currentPassResult.state.waitingFor!));
    expect(staleCurrentPass.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleCurrentPass.legalActions);
    expect(restored.host.messages).toEqual(["restored quick stale pass response resolved", "restored quick stale pass source resolved"]);
    expect(restored.session.state.chain).toHaveLength(0);
    expectNoPublicTriggerWindow(restored.session);
  });

  it("rejects stale Lua quick responses captured before snapshot restore", () => {
    const cards = [
      { code: "19100", name: "Lua Restore Stale Quick Source", kind: "monster" as const },
      { code: "19200", name: "Lua Restore Stale Quick Response", kind: "monster" as const },
      { code: "19300", name: "Lua Restore Stale Quick Filler", kind: "monster" as const },
    ];
    const source = {
      readScript(name: string) {
        if (name === "c19100.lua") {
          return `
          c19100={}
          function c19100.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_IGNITION)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
              Debug.Message("restored stale quick source resolved")
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c19200.lua") {
          return `
          c19200={}
          function c19200.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_QUICK_O)
            e:SetRange(LOCATION_HAND)
            e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
              return Duel.GetCurrentChain()>0
            end)
            e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
              Debug.Message("restored stale quick response resolved")
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 104, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["19100", "19200"] },
      1: { main: ["19300", "19300"] },
    });
    startDuel(session);
    const host = createLuaScriptHost(session);
    const sourceScript = host.loadCardScript(19100, source);
    const quickScript = host.loadCardScript(19200, source);
    expect(sourceScript.ok, sourceScript.error).toBe(true);
    expect(quickScript.ok, quickScript.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const sourceCard = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "19100");
    expect(sourceCard).toBeDefined();
    const sourceAction = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === sourceCard!.uid);
    expect(sourceAction).toBeDefined();
    const opened = applyAndAssert(session, sourceAction!);
    expect(opened.state.waitingFor).toBe(0);
    const staleQuick = getDuelLegalActions(session, 0).find((action) => action.type === "activateEffect" && sourceAction!.type === "activateEffect" && action.effectId !== sourceAction!.effectId);
    expect(staleQuick).toBeDefined();

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const restoredPass = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "passChain");
    expect(restoredPass).toBeDefined();
    expect(restoredPass).toMatchObject({ windowId: queryPublicState(restored.session).actionWindowId, windowKind: "chainResponse" });
    expect(hasGroupedAction(restored, 0, "passChain")).toBe(true);
    const staleBeforeRestoredPass = applyLuaRestoreResponse(restored, { ...restoredPass!, windowId: restoredPass!.windowId! - 1 });
    expect(staleBeforeRestoredPass.ok).toBe(false);
    expect(staleBeforeRestoredPass.error).toContain("Response is not currently legal");
    expect(staleBeforeRestoredPass.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleBeforeRestoredPass.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(staleBeforeRestoredPass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(staleBeforeRestoredPass.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleBeforeRestoredPass.legalActions);

    const restoredPassResult = applyLuaRestoreAndAssert(restored, restoredPass!);
    expect(restoredPassResult.state).toMatchObject({ waitingFor: 0, windowKind: "open" });
    expect(restoredPassResult.state.chain).toEqual([]);
    expect(restored.session.state.chainPasses).toEqual([]);

    const staleRestoredPass = applyLuaRestoreResponse(restored, restoredPass!);

    expect(staleRestoredPass.ok).toBe(false);
    expect(staleRestoredPass.error).toContain("Response is not currently legal");
    expect(staleRestoredPass.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(staleRestoredPass.legalActions).toEqual(getDuelLegalActions(restored.session, restoredPassResult.state.waitingFor!));
    expect(staleRestoredPass.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, restoredPassResult.state.waitingFor!));
    expect(staleRestoredPass.legalActionGroups.flatMap((group) => group.actions)).toEqual(staleRestoredPass.legalActions);

    const replay = applyLuaRestoreResponse(restored, staleQuick!);

    expect(replay.ok).toBe(false);
    expect(replay.error).toContain("Response is not currently legal");
    expect(replay.state.actionWindowId).toBe(restored.session.state.actionWindowId);
    expect(replay.legalActions).toEqual(getDuelLegalActions(restored.session, 0));
    expect(replay.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(replay.legalActionGroups.flatMap((group) => group.actions)).toEqual(replay.legalActions);
    expect(restored.session.state.chain).toHaveLength(0);
    expectNoPublicTriggerWindow(restored.session);
    expect(restored.host.messages).toEqual(["restored stale quick source resolved"]);
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

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const response = applyLuaRestoreResponse(restored, action);
  const publicState = queryPublicState(restored.session);
  expect(response.ok, response.error).toBe(true);
  expect(response.state.pendingTriggerBuckets).toEqual(publicState.pendingTriggerBuckets);
  if ("triggerOrderPrompt" in publicState) expect(response.state.triggerOrderPrompt).toEqual(publicState.triggerOrderPrompt);
  else expect(response.state).not.toHaveProperty("triggerOrderPrompt");
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function hasGroupedAction(restored: Parameters<typeof getLuaRestoreLegalActions>[0], player: 0 | 1, type: "activateEffect" | "passChain", effectId?: string): boolean {
  return getLuaRestoreLegalActionGroups(restored, player).some((group) =>
    group.actions.some((action) => action.type === type && (effectId === undefined || ("effectId" in action && action.effectId === effectId))),
  );
}

function expectNoPublicTriggerWindow(session: ReturnType<typeof createDuel>): void {
  const publicState = queryPublicState(session);
  expect(publicState.pendingTriggerBuckets).toEqual([]);
  expect(publicState).not.toHaveProperty("triggerOrderPrompt");
}
