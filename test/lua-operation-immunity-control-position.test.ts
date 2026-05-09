import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData, PlayerId } from "#duel/types.js";

function placeMonster(session: ReturnType<typeof createDuel>, code: string, controller: PlayerId): void {
  const card = session.state.cards.find((candidate) => candidate.controller === controller && candidate.code === code);
  expect(card).toBeTruthy();
  moveDuelCard(session.state, card!.uid, "monsterZone", controller);
  card!.faceUp = true;
  card!.position = "faceUpAttack";
}

describe("Lua operation immunity control and position changes", () => {
  it("blocks effect control changes and swaps of immune cards", () => {
    const cards: DuelCardData[] = [
      { code: "150", name: "Control Source", kind: "monster" },
      { code: "151", name: "Ignore Control Source", kind: "monster" },
      { code: "250", name: "Immune Control Target", kind: "monster" },
      { code: "251", name: "Immune Swap Target", kind: "monster" },
      { code: "350", name: "Open Control Target", kind: "monster" },
      { code: "351", name: "Open Swap Target", kind: "monster" },
      { code: "450", name: "Own Swap Target", kind: "monster" },
      { code: "451", name: "Own Ignore Swap Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 217, startingHandSize: 4, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["150", "151", "450", "451"] },
      1: { main: ["250", "251", "350", "351"] },
    });
    startDuel(session);
    for (const code of ["250", "251", "350", "351"]) placeMonster(session, code, 1);
    for (const code of ["450", "451"]) placeMonster(session, code, 0);

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      local function own_card(code)
        return Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, code), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      end
      local function opponent_card(code)
        return Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, code), 1, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      end
      local function opponent_group(code)
        return Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, code), 1, LOCATION_MZONE, 0, 1, 1, nil)
      end
      local function register_immune(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_IMMUNE_EFFECT)
        e:SetRange(LOCATION_MZONE)
        e:SetValue(function(e,te)
          return te:GetOwnerPlayer()==0
        end)
        c:RegisterEffect(e)
      end
      c150={}
      function c150.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("control protected " .. Duel.GetControl(opponent_group(250), 0))
          Debug.Message("control open " .. Duel.GetControl(opponent_group(350), 0))
          Debug.Message("swap protected " .. tostring(Duel.SwapControl(own_card(450), opponent_card(251))))
          Debug.Message("swap open " .. tostring(Duel.SwapControl(own_card(450), opponent_card(351))))
        end)
        c:RegisterEffect(e)
      end
      c151={}
      function c151.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("ignore control protected " .. Duel.GetControl(opponent_group(250), 0))
          Debug.Message("ignore swap protected " .. tostring(Duel.SwapControl(own_card(451), opponent_card(251))))
        end)
        c:RegisterEffect(e)
      end
      c250={initial_effect=register_immune}
      c251={initial_effect=register_immune}
      `,
      "operation-immunity-control.lua",
    );
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const source = session.state.cards.find((card) => card.controller === 0 && card.code === "150");
    const ignoreSource = session.state.cards.find((card) => card.controller === 0 && card.code === "151");
    expect(source).toBeTruthy();
    expect(ignoreSource).toBeTruthy();
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeTruthy();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(host.messages).toEqual(expect.arrayContaining(["control protected 0", "control open 1", "swap protected false", "swap open true"]));
    expect(session.state.cards.find((card) => card.code === "250")).toMatchObject({ controller: 1 });
    expect(session.state.cards.find((card) => card.code === "350")).toMatchObject({ controller: 0 });
    expect(session.state.cards.find((card) => card.code === "251")).toMatchObject({ controller: 1 });
    expect(session.state.cards.find((card) => card.code === "351")).toMatchObject({ controller: 0 });
    expect(session.state.cards.find((card) => card.code === "450")).toMatchObject({ controller: 1 });

    const ignoreAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === ignoreSource!.uid);
    expect(ignoreAction).toBeTruthy();
    expect(applyResponse(session, ignoreAction!).ok).toBe(true);

    expect(host.messages).toEqual(expect.arrayContaining(["ignore control protected 1", "ignore swap protected true"]));
    expect(session.state.cards.find((card) => card.code === "250")).toMatchObject({ controller: 0 });
    expect(session.state.cards.find((card) => card.code === "251")).toMatchObject({ controller: 0 });
    expect(session.state.cards.find((card) => card.code === "451")).toMatchObject({ controller: 1 });
  });

  it("blocks effect position changes of immune cards", () => {
    const cards: DuelCardData[] = [
      { code: "160", name: "Position Source", kind: "monster" },
      { code: "161", name: "Ignore Position Source", kind: "monster" },
      { code: "260", name: "Immune Position Target", kind: "monster" },
      { code: "261", name: "Immune Toggle Target", kind: "monster" },
      { code: "360", name: "Open Position Target", kind: "monster" },
      { code: "361", name: "Open Toggle Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 218, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["160", "161"] },
      1: { main: ["260", "261", "360", "361"] },
    });
    startDuel(session);
    for (const code of ["260", "261", "360", "361"]) placeMonster(session, code, 1);

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      local function target(code)
        return Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, code), 1, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      end
      local function target_group(code)
        return Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, code), 1, LOCATION_MZONE, 0, 1, 1, nil)
      end
      local function register_immune(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_IMMUNE_EFFECT)
        e:SetRange(LOCATION_MZONE)
        e:SetValue(function(e,te)
          return te:GetOwnerPlayer()==0
        end)
        c:RegisterEffect(e)
      end
      c160={}
      function c160.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("position protected " .. Duel.ChangePosition(target_group(260), POS_FACEUP_DEFENSE))
          Debug.Message("position open " .. Duel.ChangePosition(target_group(360), POS_FACEUP_DEFENSE))
          local protected_toggle=target(261)
          local open_toggle=target(361)
          Duel.ChangeToFaceupAttackOrFacedownDefense(protected_toggle, 0)
          Duel.ChangeToFaceupAttackOrFacedownDefense(open_toggle, 0)
          Debug.Message("toggle positions " .. protected_toggle:GetPosition() .. "/" .. open_toggle:GetPosition())
        end)
        c:RegisterEffect(e)
      end
      c161={}
      function c161.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("ignore position protected " .. Duel.ChangePosition(target_group(260), POS_FACEUP_DEFENSE))
          local protected_toggle=target(261)
          Duel.ChangeToFaceupAttackOrFacedownDefense(protected_toggle, 0)
          Debug.Message("ignore toggle protected " .. protected_toggle:GetPosition())
        end)
        c:RegisterEffect(e)
      end
      c260={initial_effect=register_immune}
      c261={initial_effect=register_immune}
      `,
      "operation-immunity-position.lua",
    );
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const source = session.state.cards.find((card) => card.controller === 0 && card.code === "160");
    const ignoreSource = session.state.cards.find((card) => card.controller === 0 && card.code === "161");
    expect(source).toBeTruthy();
    expect(ignoreSource).toBeTruthy();
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeTruthy();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(host.messages).toEqual(expect.arrayContaining(["position protected 0", "position open 1", "toggle positions 1/8"]));
    expect(session.state.cards.find((card) => card.code === "260")).toMatchObject({ position: "faceUpAttack", faceUp: true });
    expect(session.state.cards.find((card) => card.code === "261")).toMatchObject({ position: "faceUpAttack", faceUp: true });
    expect(session.state.cards.find((card) => card.code === "360")).toMatchObject({ position: "faceUpDefense", faceUp: true });
    expect(session.state.cards.find((card) => card.code === "361")).toMatchObject({ position: "faceDownDefense", faceUp: false });

    const ignoreAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === ignoreSource!.uid);
    expect(ignoreAction).toBeTruthy();
    expect(applyResponse(session, ignoreAction!).ok).toBe(true);

    expect(host.messages).toEqual(expect.arrayContaining(["ignore position protected 1", "ignore toggle protected 8"]));
    expect(session.state.cards.find((card) => card.code === "260")).toMatchObject({ position: "faceUpDefense", faceUp: true });
    expect(session.state.cards.find((card) => card.code === "261")).toMatchObject({ position: "faceDownDefense", faceUp: false });
  });
});
