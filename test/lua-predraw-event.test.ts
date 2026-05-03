import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

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

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_PREDRAW)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("predraw resolved " .. tp .. "/" .. Duel.GetFieldGroupCount(tp, LOCATION_HAND, 0))
        end)
        c:RegisterEffect(e)
      end
      `,
      "predraw-trigger.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const end = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "endTurn");
    expect(end).toBeDefined();
    expect(applyResponse(session, end!).ok).toBe(true);

    expect(session.state.turnPlayer).toBe(1);
    expect(session.state.cards.filter((card) => card.controller === 1 && card.location === "hand")).toHaveLength(2);
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["preDraw"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1113 });
    expect(session.state.eventHistory.slice(-4)).toEqual([
      expect.objectContaining({ eventName: "preDraw", eventCode: 1113 }),
      expect.objectContaining({ eventName: "phaseStartMain1", eventCode: 0x2004 }),
      expect.objectContaining({ eventName: "turnStarted" }),
      expect.objectContaining({ eventName: "phaseMain1", eventCode: 0x1004 }),
    ]);

    const trigger = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(applyResponse(session, trigger!).ok).toBe(true);
    drainChain(session);
    expect(host.messages).toContain("predraw resolved 1/2");
  });
});

function drainChain(session: ReturnType<typeof createDuel>): void {
  while (session.state.chain.length > 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const pass = getDuelLegalActions(session, player).find((candidate) => candidate.type === "passChain");
    expect(pass).toBeDefined();
    expect(applyResponse(session, pass!).ok).toBe(true);
  }
}
