import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData } from "#duel/types.js";

function banishFromOpponentField(session: ReturnType<typeof createDuel>, code: string): void {
  const card = session.state.cards.find((candidate) => candidate.controller === 1 && candidate.code === code);
  expect(card).toBeTruthy();
  moveDuelCard(session.state, card!.uid, "monsterZone", 1);
  card!.faceUp = true;
  card!.position = "faceUpAttack";
  moveDuelCard(session.state, card!.uid, "banished", 1);
}

describe("Lua operation immunity return to field", () => {
  it("blocks effect ReturnToField for immune banished cards", () => {
    const cards: DuelCardData[] = [
      { code: "192", name: "Return Source", kind: "monster" },
      { code: "193", name: "Ignore Return Source", kind: "monster" },
      { code: "292", name: "Immune Return Target", kind: "monster" },
      { code: "392", name: "Open Return Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 222, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["192", "193"] },
      1: { main: ["292", "392"] },
    });
    startDuel(session);
    banishFromOpponentField(session, "292");
    banishFromOpponentField(session, "392");

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      local function banished_card(code)
        return Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, code), 1, LOCATION_REMOVED, 0, 1, 1, nil):GetFirst()
      end
      c192={}
      function c192.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("return protected " .. tostring(Duel.ReturnToField(banished_card(292), POS_FACEUP_ATTACK)))
          Debug.Message("return open " .. tostring(Duel.ReturnToField(banished_card(392), POS_FACEUP_ATTACK)))
        end)
        c:RegisterEffect(e)
      end
      c193={}
      function c193.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("ignore return protected " .. tostring(Duel.ReturnToField(banished_card(292), POS_FACEUP_ATTACK)))
        end)
        c:RegisterEffect(e)
      end
      c292={}
      function c292.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_IMMUNE_EFFECT)
        e:SetRange(LOCATION_REMOVED)
        e:SetValue(function(e,te)
          return te:GetOwnerPlayer()==0
        end)
        c:RegisterEffect(e)
      end
      `,
      "operation-immunity-return-field.lua",
    );
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const source = session.state.cards.find((card) => card.controller === 0 && card.code === "192");
    const ignoreSource = session.state.cards.find((card) => card.controller === 0 && card.code === "193");
    expect(source).toBeTruthy();
    expect(ignoreSource).toBeTruthy();
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeTruthy();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(host.messages).toEqual(expect.arrayContaining(["return protected false", "return open true"]));
    expect(session.state.cards.find((card) => card.code === "292")).toMatchObject({ location: "banished" });
    expect(session.state.cards.find((card) => card.code === "392")).toMatchObject({ location: "monsterZone" });

    const ignoreAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === ignoreSource!.uid);
    expect(ignoreAction).toBeTruthy();
    expect(applyResponse(session, ignoreAction!).ok).toBe(true);

    expect(host.messages).toContain("ignore return protected true");
    expect(session.state.cards.find((card) => card.code === "292")).toMatchObject({ location: "monsterZone" });
  });
});
