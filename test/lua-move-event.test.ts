import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua move events", () => {
  it("queues Lua generic move triggers after cards move", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Move Starter", kind: "monster" },
      { code: "200", name: "Move Target", kind: "monster" },
      { code: "300", name: "Move Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 178, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["200"] },
    });
    startDuel(session);
    const target = session.state.cards.find((card) => card.code === "200");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "graveyard", 1);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local starter=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 1, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      local watcher=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()

      local move=Effect.CreateEffect(starter)
      move:SetType(EFFECT_TYPE_IGNITION)
      move:SetRange(LOCATION_HAND)
      move:SetOperation(function(e,tp)
        Debug.Message("move event count " .. Duel.SendtoHand(target, 1, REASON_EFFECT))
      end)
      starter:RegisterEffect(move)

      local e=Effect.CreateEffect(watcher)
      e:SetType(EFFECT_TYPE_TRIGGER_O)
      e:SetCode(EVENT_MOVE)
      e:SetRange(LOCATION_HAND)
      e:SetOperation(function(e,tp,eg)
        Debug.Message("move trigger resolved " .. eg:GetFirst():GetCode())
      end)
      watcher:RegisterEffect(e)
      `,
      "generic-move-trigger.lua",
    );

    expect(result.ok, result.error).toBe(true);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);
    expect(host.messages).toContain("move event count 1");
    expect(session.state.cards.find((card) => card.code === "200")).toMatchObject({ location: "hand", controller: 1 });
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["moved"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1030, eventCardUid: target!.uid });
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeDefined();
    expect(applyResponse(session, trigger!).ok).toBe(true);
    expect(host.messages).toContain("move trigger resolved 200");
  });
});
