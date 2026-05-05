import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData, DuelPhase } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua phase events", () => {
  it("queues Battle Start phase triggers with the EDOPro battle-start phase mask", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Battle Phase Watcher", kind: "monster" }];
    const session = createDuel({ seed: 182, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_PHASE+PHASE_BATTLE_START)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("phase battle start resolved " .. Duel.GetCurrentPhase())
        end)
        c:RegisterEffect(e)
      end
      `,
      "phase-battle-start-trigger.lua",
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

    expect(session.state.pendingTriggers).toEqual([expect.objectContaining({ eventName: "phaseBattle", eventCode: 0x1008 })]);
    expect(session.state.eventHistory).toContainEqual(expect.objectContaining({ eventName: "phaseBattle", eventCode: 0x1008 }));
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    const triggerResponse = applyResponse(session, trigger!);
    expect(triggerResponse.ok).toBe(true);
    expect(triggerResponse.legalActions).toEqual(getDuelLegalActions(session, triggerResponse.state.waitingFor!));
    expect(triggerResponse.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, triggerResponse.state.waitingFor!));
    expect(triggerResponse.legalActionGroups.flatMap((group) => group.actions)).toEqual(triggerResponse.legalActions);
    expect(host.messages).toContain("phase battle start resolved 8");
  });

  it("does not fire coarse Battle Phase triggers at the Battle Start phase event", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Battle Phase Watcher", kind: "monster" }];
    const session = createDuel({ seed: 183, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_PHASE+PHASE_BATTLE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("coarse battle resolved " .. Duel.GetCurrentPhase())
        end)
        c:RegisterEffect(e)
      end
      `,
      "phase-battle-trigger.lua",
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

    expect(session.state.pendingTriggers).toEqual([]);
    expect(session.state.eventHistory).toContainEqual(expect.objectContaining({ eventName: "phaseBattle", eventCode: 0x1008 }));
    expect(host.messages).not.toContain("coarse battle resolved 8");
  });

  it("queues Lua phase triggers for EVENT_PHASE plus phase masks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Phase Watcher", kind: "monster" },
      { code: "200", name: "Opponent Draw", kind: "monster" },
    ];
    const session = createDuel({ seed: 181, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_PHASE+PHASE_END)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("phase end resolved " .. tp .. "/" .. Duel.GetCurrentPhase())
        end)
        c:RegisterEffect(e)
      end
      `,
      "phase-end-trigger.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    for (const phase of ["battle", "main2", "end"] satisfies DuelPhase[]) {
      const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
      expect(action).toBeDefined();
      const response = applyResponse(session, action!);
      expect(response.ok).toBe(true);
      expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
      expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
      expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
    }

    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["phaseEnd"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventName: "phaseEnd", eventCode: 0x1200 });
    expect(session.state.eventHistory.at(-1)).toMatchObject({ eventName: "phaseEnd", eventCode: 0x1200 });
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    const triggerResponse = applyResponse(session, trigger!);
    expect(triggerResponse.ok).toBe(true);
    expect(triggerResponse.legalActions).toEqual(getDuelLegalActions(session, triggerResponse.state.waitingFor!));
    expect(triggerResponse.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, triggerResponse.state.waitingFor!));
    expect(triggerResponse.legalActionGroups.flatMap((group) => group.actions)).toEqual(triggerResponse.legalActions);
    expect(host.messages).toContain("phase end resolved 0/512");
  });

  it("applies restored Lua phase triggers through restore responses", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Phase Watcher", kind: "monster" },
      { code: "200", name: "Restore Opponent Draw", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name !== "c100.lua") return undefined;
        return `
        c100={}
        function c100.initial_effect(c)
          local e=Effect.CreateEffect(c)
          e:SetType(EFFECT_TYPE_TRIGGER_O)
          e:SetCode(EVENT_PHASE+PHASE_END)
          e:SetRange(LOCATION_HAND)
          e:SetOperation(function(e,tp)
            Debug.Message("restored phase trigger " .. tp .. "/" .. Duel.GetCurrentPhase())
          end)
          c:RegisterEffect(e)
        end
        `;
      },
    };
    const session = createDuel({ seed: 184, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    for (const phase of ["battle", "main2", "end"] satisfies DuelPhase[]) {
      const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
      expect(action).toBeDefined();
      const response = applyResponse(session, action!);
      expect(response.ok).toBe(true);
      expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
      expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
      expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
    }
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["phaseEnd"]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.phase).toBe("end");
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["phaseEnd"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 0x1200 });
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));

    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    const triggerResult = applyLuaRestoreResponse(restored, trigger!);
    expect(triggerResult.ok).toBe(true);
    expect(triggerResult.legalActions).toEqual(getDuelLegalActions(restored.session, triggerResult.state.waitingFor!));
    expect(triggerResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, triggerResult.state.waitingFor!));
    expect(triggerResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(triggerResult.legalActions);
    expect(restored.host.messages).toContain("restored phase trigger 0/512");
  });

  it("restores phase-trigger-created Lua chain windows before fast responses resolve", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Restore Phase Chain Watcher", kind: "monster" },
      { code: "200", name: "Restore Phase Chain Quick", kind: "monster" },
    ];
    const source = {
      readScript(name: string) {
        if (name === "c100.lua") {
          return `
          c100={}
          function c100.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_TRIGGER_O)
            e:SetCode(EVENT_PHASE+PHASE_END)
            e:SetRange(LOCATION_HAND)
            e:SetOperation(function(e,tp) Debug.Message("restored phase chain trigger " .. Duel.GetCurrentPhase()) end)
            c:RegisterEffect(e)
          end
          `;
        }
        if (name === "c200.lua") {
          return `
          c200={}
          function c200.initial_effect(c)
            local e=Effect.CreateEffect(c)
            e:SetType(EFFECT_TYPE_QUICK_O)
            e:SetRange(LOCATION_HAND)
            e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
            e:SetOperation(function(e,tp) Debug.Message("restored phase chain quick") end)
            c:RegisterEffect(e)
          end
          `;
        }
        return undefined;
      },
    };
    const session = createDuel({ seed: 185, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["200"] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    expect(host.loadCardScript(100, source).ok).toBe(true);
    expect(host.loadCardScript(200, source).ok).toBe(true);
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
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    const opened = applyResponse(session, trigger!);
    expect(opened.ok, opened.error).toBe(true);
    expect(opened.legalActions).toEqual(getDuelLegalActions(session, opened.state.waitingFor!));
    expect(opened.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, opened.state.waitingFor!));
    expect(opened.legalActionGroups.flatMap((group) => group.actions)).toEqual(opened.legalActions);
    expect(opened.state).toMatchObject({ waitingFor: 1, windowKind: "chainResponse" });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.session.state.chain.map((link) => link.effectId)).toEqual(session.state.chain.map((link) => link.effectId));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual(getDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual([]);

    const quick = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "activateEffect");
    expect(quick).toBeDefined();
    const chained = applyLuaRestoreResponse(restored, quick!);
    expect(chained.ok, chained.error).toBe(true);
    expect(chained.legalActions).toEqual(getDuelLegalActions(restored.session, chained.state.waitingFor!));
    expect(chained.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, chained.state.waitingFor!));
    expect(chained.legalActionGroups.flatMap((group) => group.actions)).toEqual(chained.legalActions);
    const pass = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    expect(applyLuaRestoreResponse(restored, pass!).ok).toBe(true);
    expect(restored.host.messages).toEqual(["restored phase chain quick", "restored phase chain trigger 512"]);
  });
});
