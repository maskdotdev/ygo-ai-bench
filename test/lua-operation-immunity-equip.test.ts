import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

describe("Lua operation immunity equip", () => {
  it("blocks equipping immune targets unless the active effect ignores immunity", () => {
    const cards: DuelCardData[] = [
      { code: "170", name: "Equip Source", kind: "monster" },
      { code: "171", name: "Ignore Equip Source", kind: "monster" },
      { code: "270", name: "Immune Equip Target", kind: "monster" },
      { code: "370", name: "Open Equip Target", kind: "monster" },
      { code: "570", name: "Protected Equip Spell", kind: "spell", typeFlags: 0x40002 },
      { code: "571", name: "Open Equip Spell", kind: "spell", typeFlags: 0x40002 },
      { code: "572", name: "Ignore Equip Spell", kind: "spell", typeFlags: 0x40002 },
    ];
    const session = createDuel({ seed: 219, startingHandSize: 5, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["170", "171", "570", "571", "572"] },
      1: { main: ["270", "370"] },
    });
    startDuel(session);
    for (const code of ["270", "370"]) {
      const target = session.state.cards.find((card) => card.controller === 1 && card.code === code);
      expect(target).toBeTruthy();
      moveDuelCard(session.state, target!.uid, "monsterZone", 1);
      target!.faceUp = true;
      target!.position = "faceUpAttack";
    }

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      local function own_card(code)
        return Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, code), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      end
      local function opponent_card(code)
        return Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, code), 1, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      end
      c170={}
      function c170.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("equip protected " .. tostring(Duel.Equip(0, own_card(570), opponent_card(270))))
          Debug.Message("equip open " .. tostring(Duel.Equip(0, own_card(571), opponent_card(370))))
        end)
        c:RegisterEffect(e)
      end
      c171={}
      function c171.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("ignore equip protected " .. tostring(Duel.Equip(0, own_card(572), opponent_card(270))))
        end)
        c:RegisterEffect(e)
      end
      c270={}
      function c270.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_IMMUNE_EFFECT)
        e:SetRange(LOCATION_MZONE)
        e:SetValue(function(e,te)
          return te:GetOwnerPlayer()==0
        end)
        c:RegisterEffect(e)
      end
      `,
      "operation-immunity-equip.lua",
    );
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const source = session.state.cards.find((card) => card.controller === 0 && card.code === "170");
    const ignoreSource = session.state.cards.find((card) => card.controller === 0 && card.code === "171");
    expect(source).toBeTruthy();
    expect(ignoreSource).toBeTruthy();
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeTruthy();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(host.messages).toEqual(expect.arrayContaining(["equip protected false", "equip open true"]));
    expect(session.state.cards.find((card) => card.code === "570")).toMatchObject({ location: "hand" });
    expect(session.state.cards.find((card) => card.code === "570")?.equippedToUid).toBeUndefined();
    expect(session.state.cards.find((card) => card.code === "571")).toMatchObject({ location: "spellTrapZone", equippedToUid: session.state.cards.find((card) => card.code === "370")!.uid });

    const ignoreAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === ignoreSource!.uid);
    expect(ignoreAction).toBeTruthy();
    expect(applyResponse(session, ignoreAction!).ok).toBe(true);

    expect(host.messages).toContain("ignore equip protected true");
    expect(session.state.cards.find((card) => card.code === "572")).toMatchObject({ location: "spellTrapZone", equippedToUid: session.state.cards.find((card) => card.code === "270")!.uid });
  });
});
