import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData, DuelPhase } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

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
    expect(applyResponse(session, battle!).ok).toBe(true);

    expect(session.state.pendingTriggers).toEqual([expect.objectContaining({ eventName: "phaseBattle", eventCode: 0x1008 })]);
    expect(session.state.eventHistory).toContainEqual(expect.objectContaining({ eventName: "phaseBattle", eventCode: 0x1008 }));
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(applyResponse(session, trigger!).ok).toBe(true);
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
    expect(applyResponse(session, battle!).ok).toBe(true);

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
      expect(applyResponse(session, action!).ok).toBe(true);
    }

    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["phaseEnd"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventName: "phaseEnd", eventCode: 0x1200 });
    expect(session.state.eventHistory.at(-1)).toMatchObject({ eventName: "phaseEnd", eventCode: 0x1200 });
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(applyResponse(session, trigger!).ok).toBe(true);
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
      expect(applyResponse(session, action!).ok).toBe(true);
    }
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["phaseEnd"]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.phase).toBe("end");
    expect(restored.session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["phaseEnd"]);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 0x1200 });

    const trigger = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    const triggerResult = applyLuaRestoreResponse(restored, trigger!);
    expect(triggerResult.ok).toBe(true);
    expect(triggerResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, triggerResult.state.waitingFor!));
    expect(restored.host.messages).toContain("restored phase trigger 0/512");
  });
});
