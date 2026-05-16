import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData, DuelPhase } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua phase-start events", () => {
  it("queues Battle Start triggers with the EDOPro battle-start phase mask", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Battle Start Watcher", kind: "monster" }];
    const session = createDuel({ seed: 201, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_PHASE_START+PHASE_BATTLE_START)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("battle start " .. Duel.GetCurrentPhase())
        end)
        c:RegisterEffect(e)
      end
      `,
      "phase-start-battle-trigger.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const battle = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle");
    expect(battle).toBeDefined();
    const battleResponse = applyResponse(session, battle!);
    expect(battleResponse.ok).toBe(true);
    expect(battleResponse.legalActions).toEqual(getDuelLegalActions(session, battleResponse.state.waitingFor!));
    expect(battleResponse.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, battleResponse.state.waitingFor!));
    expect(battleResponse.legalActionGroups.flatMap((group) => group.actions)).toEqual(battleResponse.legalActions);

    expect(session.state.pendingTriggers).toEqual([expect.objectContaining({ eventName: "phaseStartBattle", eventCode: 0x2008 })]);
    expect(session.state.eventHistory).toContainEqual(expect.objectContaining({ eventName: "phaseStartBattle", eventCode: 0x2008 }));
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    const triggerResponse = applyResponse(session, trigger!);
    expect(triggerResponse.ok).toBe(true);
    expect(triggerResponse.legalActions).toEqual(getDuelLegalActions(session, triggerResponse.state.waitingFor!));
    expect(triggerResponse.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, triggerResponse.state.waitingFor!));
    expect(triggerResponse.legalActionGroups.flatMap((group) => group.actions)).toEqual(triggerResponse.legalActions);
    expect(host.messages).toContain("battle start 8");
  });

  it("queues Lua phase-start triggers before regular phase triggers", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Phase Start Watcher", kind: "monster" },
      { code: "200", name: "Phase End Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 200, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_PHASE_START+PHASE_END)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("phase start end " .. Duel.GetCurrentPhase())
        end)
        c:RegisterEffect(e)
      end

      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_PHASE+PHASE_END)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("phase end " .. Duel.GetCurrentPhase())
        end)
        c:RegisterEffect(e)
      end
      `,
      "phase-start-end-trigger.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    for (const phase of ["battle", "main2", "end"] satisfies DuelPhase[]) {
      const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
      expect(action).toBeDefined();
      const response = applyResponse(session, action!);
      expect(response.ok).toBe(true);
      expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
      expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
      expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
    }

    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["phaseStartEnd", "phaseEnd"]);
    expect(session.state.pendingTriggers).toEqual([
      expect.objectContaining({ eventName: "phaseStartEnd", eventCode: 0x2200 }),
      expect.objectContaining({ eventName: "phaseEnd", eventCode: 0x1200 }),
    ]);
    expect(session.state.eventHistory.map((event) => event.eventName).slice(-3)).toEqual(["phaseStartEnd", "phaseChanged", "phaseEnd"]);
    expect(session.state.eventHistory.slice(-3)).toEqual([
      expect.objectContaining({ eventName: "phaseStartEnd", eventCode: 0x2200 }),
      expect.objectContaining({ eventName: "phaseChanged" }),
      expect.objectContaining({ eventName: "phaseEnd", eventCode: 0x1200 }),
    ]);
  });

  it("applies restored Lua phase-start triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Phase Start Watcher", kind: "monster" },
      { code: "200", name: "Restore Phase End Watcher", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
          c100={}
          function c100.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_O)
            e:SetCode(EVENT_PHASE_START+PHASE_END)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp)
              Debug.Message("restored phase start " .. Duel.GetCurrentPhase())
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c200.lua") {
          return `
          c200={}
          function c200.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_O)
            e:SetCode(EVENT_PHASE+PHASE_END)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp)
              Debug.Message("restored phase end " .. Duel.GetCurrentPhase())
            end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 202, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const phaseStartScript = host.loadCardScript(100, source);
    const phaseEndScript = host.loadCardScript(200, source);
    expect(phaseStartScript.ok, phaseStartScript.error).toBe(true);
    expect(phaseEndScript.ok, phaseEndScript.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    for (const phase of ["battle", "main2", "end"] satisfies DuelPhase[]) {
      const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
      expect(action).toBeDefined();
      const response = applyResponse(session, action!);
      expect(response.ok).toBe(true);
      expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
      expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
      expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
    }
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["phaseStartEnd", "phaseEnd"]);
    const originalPhaseStartTrigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(originalPhaseStartTrigger).toBeDefined();

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.session.state.phase).toBe("end");
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["phaseStartEnd", "phaseEnd"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 0x2200 });
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expectGroupedActionsToContainLegalActions(restored, 0);
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(
      getLuaRestoreLegalActionGroups(restored, 0).some(
        (group) =>
          group.windowId === restored.session.state.actionWindowId &&
          group.windowKind === "triggerBucket" &&
          group.actions.some(
            (action) =>
              action.type === "activateTrigger" &&
              action.player === 0 &&
              action.effectId === trigger!.effectId &&
              action.windowId === restored.session.state.actionWindowId &&
              action.windowKind === "triggerBucket",
          ),
      ),
    ).toBe(true);
    const originalTriggerPreapply = applyLuaRestoreResponse(restored, originalPhaseStartTrigger!);
    expect(originalTriggerPreapply.ok).toBe(false);
    expect(originalTriggerPreapply.error).toContain("Response is not currently legal");
    assertPublicRestoreMetadata(restored, originalTriggerPreapply);
    expectLuaRestoreStalePreapply(restored, trigger!, 0);
    applyLuaRestoreAndAssert(restored, trigger!);
    expect(restored.host.messages).toContain("restored phase start 512");
    expect(restored.session.state.pendingTriggers.map((pending) => pending.eventName)).toEqual(["phaseEnd"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 0x1200 });
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const phaseEndTrigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(phaseEndTrigger).toBeDefined();
    expect(
      getLuaRestoreLegalActionGroups(restored, 0).some(
        (group) =>
          group.windowId === restored.session.state.actionWindowId &&
          group.windowKind === "triggerBucket" &&
          group.actions.some(
            (action) =>
              action.type === "activateTrigger" &&
              action.player === 0 &&
              action.effectId === phaseEndTrigger!.effectId &&
              action.windowId === restored.session.state.actionWindowId &&
              action.windowKind === "triggerBucket",
          ),
      ),
    ).toBe(true);
    expectLuaRestoreStalePreapply(restored, phaseEndTrigger!, 0);
    applyLuaRestoreAndAssert(restored, phaseEndTrigger!);
    expect(restored.host.messages).toContain("restored phase end 512");
  });
});

function expectGroupedActionsToContainLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  const groupedActions = getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions);
  const legalActions = getLuaRestoreLegalActions(restored, player);
  expect(groupedActions).toHaveLength(legalActions.length);
  expect(groupedActions).toEqual(expect.arrayContaining(legalActions));
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1]) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  assertPublicRestoreMetadata(restored, response);
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function expectLuaRestoreStalePreapply(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: Parameters<typeof applyLuaRestoreResponse>[1], player: 0 | 1): void {
  const response = applyLuaRestoreResponse(restored, { ...action, windowId: action.windowId! - 1 });
  expect(response.ok).toBe(false);
  expect(response.error).toContain("Response is not currently legal");
  expect(response.state.actionWindowId).toBe(restored.session.state.actionWindowId);
  assertPublicRestoreMetadata(restored, response);
  expect(response.legalActions).toEqual(getDuelLegalActions(restored.session, player));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
}

function assertPublicRestoreMetadata(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: ReturnType<typeof applyLuaRestoreResponse>): void {
  const publicState = queryPublicState(restored.session);
  expect(response.state.pendingTriggerBuckets).toEqual(publicState.pendingTriggerBuckets);
  if ("triggerOrderPrompt" in publicState) expect(response.state.triggerOrderPrompt).toEqual(publicState.triggerOrderPrompt);
  else expect(response.state).not.toHaveProperty("triggerOrderPrompt");
}
