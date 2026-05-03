import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua return-to-grave events", () => {
  it("queues return-to-grave triggers when Lua returns a banished card to the Graveyard", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Return Source", kind: "monster" },
      { code: "200", name: "Return Target", kind: "monster" },
      { code: "300", name: "Return Watcher", kind: "monster" },
    ];
    const session = createDuel({ seed: 204, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local tc=Duel.SelectMatchingCard(tp,aux.FilterBoolFunction(Card.IsCode,200),tp,LOCATION_HAND,0,1,1,nil):GetFirst()
          Debug.Message("banish count " .. Duel.Remove(tc,POS_FACEUP,REASON_EFFECT+REASON_TEMPORARY))
          Debug.Message("return count " .. Duel.ReturnToGrave(tc))
        end)
        c:RegisterEffect(e)
      end

      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_RETURN_TO_GRAVE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          Debug.Message("return trigger " .. eg:GetFirst():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "return-to-grave-event.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid.includes("100"));
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    const target = session.state.cards.find((card) => card.code === "200");
    expect(host.messages).toContain("banish count 1");
    expect(host.messages).toContain("return count 1");
    expect(target).toMatchObject({ location: "graveyard", reason: 0x20000 });
    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["returnedToGraveyard"]);
    expect(session.state.pendingTriggers[0]).toMatchObject({ eventCode: 1203, eventCardUid: target!.uid });
    expect(session.state.eventHistory).toEqual([
      expect.objectContaining({ eventName: "chainActivating", eventCode: 1021 }),
      expect.objectContaining({ eventName: "chaining", eventCode: 1027 }),
      expect.objectContaining({ eventName: "chainSolving", eventCode: 1020 }),
      expect.objectContaining({ eventName: "moved", eventCode: 1030 }),
      expect.objectContaining({ eventName: "banished", eventCode: 1011 }),
      expect.objectContaining({ eventName: "moved", eventCode: 1030 }),
      expect.objectContaining({ eventName: "returnedToGraveyard", eventCode: 1203 }),
      expect.objectContaining({ eventName: "chainSolved", eventCode: 1022 }),
    ]);
  });
});
