import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

describe("Lua predraw events", () => {
  it("queues predraw triggers before the turn draw is applied", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Predraw Watcher", kind: "monster" },
      { code: "200", name: "Turn Draw Card", kind: "monster" },
      { code: "300", name: "Turn Holder", kind: "monster" },
    ];
    const session = createDuel({ seed: 196, startingHandSize: 0, drawPerTurn: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["300"] },
      1: { main: ["100", "200"] },
    });
    startDuel(session);
    const watcher = session.state.cards.find((card) => card.controller === 1 && card.code === "100");
    expect(watcher).toBeDefined();
    moveDuelCard(session.state, watcher!.uid, "hand", 1);

    const source = {
      readScript(name: string) {
        if (name !== "c100.lua") return undefined;
        return `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_PREDRAW)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg,ep,ev)
          Debug.Message("predraw resolved " .. tp .. "/" .. ep .. "/" .. ev .. "/" .. Duel.GetFieldGroupCount(tp, LOCATION_HAND, 0))
        end)
        c:RegisterEffect(e)
      end
      `;
      },
    };

    const host = createLuaScriptHost(session);
    const loaded = host.loadCardScript(100, source);
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const end = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "endTurn");
    expect(end).toBeDefined();
    const endResponse = applyResponse(session, end!);
    expect(endResponse.ok).toBe(true);
    expect(endResponse.legalActions).toEqual(getDuelLegalActions(session, endResponse.state.waitingFor!));
    expect(endResponse.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, endResponse.state.waitingFor!));
    expect(endResponse.legalActionGroups.flatMap((group) => group.actions)).toEqual(endResponse.legalActions);

    expect(session.state.turnPlayer).toBe(1);
    expect(session.state.cards.filter((card) => card.controller === 1 && card.location === "hand")).toHaveLength(2);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["preDraw"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1113, eventPlayer: 1, eventValue: 1 });
    expect(session.state.eventHistory.slice(-4)).toEqual([
      expect.objectContaining({ eventName: "preDraw", eventCode: 1113, eventPlayer: 1, eventValue: 1 }),
      expect.objectContaining({ eventName: "phaseStartMain1", eventCode: 0x2004 }),
      expect.objectContaining({ eventName: "turnStarted" }),
      expect.objectContaining({ eventName: "phaseMain1", eventCode: 0x1004 }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, createCardReader(cards));
    expect(restored.restoreComplete).toBe(true);
    expect(restored.session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1113, eventPlayer: 1, eventValue: 1 });
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual(getDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    const restoredTrigger = getLuaRestoreLegalActions(restored, 1).find((candidate) => candidate.type === "activateTrigger");
    expect(restoredTrigger).toBeDefined();
    const restoredTriggerResult = applyLuaRestoreResponse(restored, restoredTrigger!);
    expect(restoredTriggerResult.ok).toBe(true);
    expect(restoredTriggerResult.legalActions).toEqual(getDuelLegalActions(restored.session, restoredTriggerResult.state.waitingFor!));
    expect(restoredTriggerResult.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, restoredTriggerResult.state.waitingFor!));
    expect(restoredTriggerResult.legalActionGroups.flatMap((group) => group.actions)).toEqual(restoredTriggerResult.legalActions);
    drainRestoredChain(restored);
    expect(restored.host.messages).toContain("predraw resolved 1/1/1/2");

    const trigger = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    const triggerResponse = applyResponse(session, trigger!);
    expect(triggerResponse.ok).toBe(true);
    expect(triggerResponse.legalActions).toEqual(getDuelLegalActions(session, triggerResponse.state.waitingFor!));
    expect(triggerResponse.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, triggerResponse.state.waitingFor!));
    expect(triggerResponse.legalActionGroups.flatMap((group) => group.actions)).toEqual(triggerResponse.legalActions);
    drainChain(session);
    expect(host.messages).toContain("predraw resolved 1/1/1/2");
  });
});

function drainChain(session: ReturnType<typeof createDuel>): void {
  while (session.state.chain.length > 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    const result = applyResponse(session, pass!);
    expect(result.ok).toBe(true);
    expect(result.legalActions).toEqual(getDuelLegalActions(session, result.state.waitingFor!));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, result.state.waitingFor!));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function drainRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    const result = applyLuaRestoreResponse(restored, pass!);
    expect(result.ok).toBe(true);
    expect(result.legalActions).toEqual(getDuelLegalActions(restored.session, result.state.waitingFor!));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, result.state.waitingFor!));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}
