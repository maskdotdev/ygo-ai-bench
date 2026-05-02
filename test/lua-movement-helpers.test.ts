import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  applyResponse,
  createDuel,
  detachDuelOverlayMaterials,
  destroyDuelCard,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  specialSummonDuelCard,
  startDuel,
  xyzSummonDuelCard,
} from "#duel/core.js";
import { getCards, moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua movement helpers", () => {
  it("lets Lua scripts remove cards from the duel", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Removed From Duel A", kind: "monster" },
      { code: "200", name: "Removed From Duel B", kind: "monster" },
      { code: "300", name: "Remaining Field", kind: "monster" },
    ];
    const session = createDuel({ seed: 94, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);
    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0);
    }

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local remove_group = Duel.GetMatchingGroup(function(c) return c:IsCode(100) or c:IsCode(200) end, 0, LOCATION_MZONE, 0, nil)
      Debug.Message("remove cards result " .. Duel.RemoveCards(remove_group, 0, -2, REASON_RULE))
      Debug.Message("remove cards operated " .. Duel.GetOperatedGroup():GetCount())
      Debug.Message("remove cards field " .. Duel.GetFieldGroupCount(0, LOCATION_MZONE, 0))
      Debug.Message("remove cards hidden " .. Duel.GetMatchingGroupCount(function(c) return c:IsCode(100) or c:IsCode(200) end, 0, LOCATION_MZONE + LOCATION_GRAVE + LOCATION_REMOVED, 0, nil))
      `,
      "remove-cards.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("remove cards result 2");
    expect(host.messages).toContain("remove cards operated 2");
    expect(host.messages).toContain("remove cards field 1");
    expect(host.messages).toContain("remove cards hidden 0");
    expect(session.state.cards.map((card) => card.code).sort()).toEqual(["300"]);
  });

  it("lets Lua scripts banish cards face-down with the third-argument reason", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Hidden Banish", kind: "monster" }];
    const session = createDuel({ seed: 95, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);
    const target = session.state.cards.find((card) => card.code === "100");
    expect(target).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local c = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      Debug.Message("removed face-down " .. Duel.Remove(c, POS_FACEDOWN_DEFENSE, REASON_EFFECT))
      Debug.Message("removed state " .. tostring(c:IsLocation(LOCATION_REMOVED)) .. "/" .. tostring(c:IsFacedown()) .. "/" .. tostring(c:IsPublic()) .. "/" .. c:GetReason())
      `,
      "face-down-remove.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("removed face-down 1");
    expect(host.messages).toContain("removed state true/true/false/64");
    expect(session.state.cards.find((card) => card.code === "100")).toMatchObject({
      faceUp: false,
      location: "banished",
      position: "faceDownDefense",
      reason: 0x40,
    });
  });

  it("raises Lua leave-field triggers for cards moved from the field by effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Leave Field Mover", kind: "monster" },
      { code: "200", name: "Leaving Monster", kind: "monster" },
      { code: "300", name: "Leave Field Trigger", kind: "monster" },
    ];
    const session = createDuel({ seed: 97, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    const mover = session.state.cards.find((card) => card.code === "100");
    const leaving = session.state.cards.find((card) => card.code === "200");
    expect(mover).toBeDefined();
    expect(leaving).toBeDefined();
    moveDuelCard(session.state, mover!.uid, "monsterZone", 0);
    moveDuelCard(session.state, leaving!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_MZONE)
        e:SetOperation(function(e,tp)
          local g=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), tp, LOCATION_MZONE, 0, 1, 1, nil)
          Duel.SendtoGrave(g, REASON_EFFECT)
        end)
        c:RegisterEffect(e)
      end
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_LEAVE_FIELD)
        e:SetRange(LOCATION_HAND)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          local tc=eg:GetFirst()
          return tc and tc:IsCode(200) and tc:IsPreviousLocation(LOCATION_MZONE) and tc:IsReason(REASON_EFFECT)
        end)
        e:SetOperation(function(e,tp,eg)
          local tc=eg:GetFirst()
          Debug.Message("left field trigger " .. tc:GetCode() .. "/" .. tc:GetLeaveFieldDest())
        end)
        c:RegisterEffect(e)
      end
      `,
      "leave-field-trigger.lua",
    );

    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === mover!.uid);
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.uid !== mover!.uid);
    expect(trigger).toBeDefined();
    expect(applyResponse(session, trigger!).ok).toBe(true);
    expect(host.messages).toContain("left field trigger 200/16");
  });

});
