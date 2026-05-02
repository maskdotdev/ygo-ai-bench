import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createDuel,
  destroyDuelCard,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  startDuel,
} from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { duelReason } from "#duel/reasons.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua continuous redirect effects", () => {
  it("applies Lua continuous banish redirect effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Banish Redirected Monster", kind: "monster" }];
    const session = createDuel({ seed: 42, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const redirected = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(redirected).toBeTruthy();
    moveDuelCard(session.state, redirected!.uid, "monsterZone", 0);
    redirected!.faceUp = true;
    redirected!.position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_REMOVE_REDIRECT)
        e:SetRange(LOCATION_MZONE)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("banish redirect checked " .. e:GetHandler():GetCode())
          return true
        end)
        c:RegisterEffect(e)
      end
      `,
      "banish-redirect.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const moveResult = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil)
      Debug.Message("banish redirected " .. Duel.Remove(c, POS_FACEUP_ATTACK, REASON_EFFECT))
      `,
      "banish-redirect-move.lua",
    );

    expect(moveResult.ok, moveResult.error).toBe(true);
    expect(host.messages).toContain("banish redirect checked 100");
    expect(host.messages).toContain("banish redirected 1");
    expect(session.state.cards.find((card) => card.uid === redirected!.uid)).toMatchObject({ location: "graveyard", reason: 0x4000040 });
  });

  it("applies Lua continuous leave-field redirect effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Leave Redirected Monster", kind: "monster" }];
    const session = createDuel({ seed: 43, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const redirected = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(redirected).toBeTruthy();
    moveDuelCard(session.state, redirected!.uid, "monsterZone", 0);
    redirected!.faceUp = true;
    redirected!.position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_LEAVE_FIELD_REDIRECT)
        e:SetRange(LOCATION_MZONE)
        e:SetValue(LOCATION_REMOVED)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("leave redirect checked " .. e:GetHandler():GetCode())
          return true
        end)
        c:RegisterEffect(e)
      end
      `,
      "leave-field-redirect.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const moveResult = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil)
      Debug.Message("leave redirected " .. Duel.SendtoHand(c, 0, REASON_EFFECT))
      `,
      "leave-field-redirect-move.lua",
    );

    expect(moveResult.ok, moveResult.error).toBe(true);
    expect(host.messages).toContain("leave redirect checked 100");
    expect(host.messages).toContain("leave redirected 1");
    expect(session.state.cards.find((card) => card.uid === redirected!.uid)).toMatchObject({ location: "banished", reason: 0x4000040 });
  });

  it("applies Lua continuous hand and deck redirect effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Hand Redirected Monster", kind: "monster" },
      { code: "200", name: "Deck Redirected Monster", kind: "monster" },
    ];
    const session = createDuel({ seed: 44, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const handRedirected = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const deckRedirected = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(handRedirected).toBeTruthy();
    expect(deckRedirected).toBeTruthy();
    moveDuelCard(session.state, handRedirected!.uid, "monsterZone", 0);
    moveDuelCard(session.state, deckRedirected!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_TO_HAND_REDIRECT)
        e:SetRange(LOCATION_MZONE)
        e:SetValue(LOCATION_GRAVE)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("hand redirect checked " .. e:GetHandler():GetCode())
          return true
        end)
        c:RegisterEffect(e)
      end
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_TO_DECK_REDIRECT)
        e:SetRange(LOCATION_MZONE)
        e:SetValue(LOCATION_REMOVED)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("deck redirect checked " .. e:GetHandler():GetCode())
          return true
        end)
        c:RegisterEffect(e)
      end
      `,
      "hand-deck-redirect.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const moveResult = host.loadScript(
      `
      local hand_card=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil)
      local deck_card=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil)
      Debug.Message("hand redirected " .. Duel.SendtoHand(hand_card, 0, REASON_EFFECT))
      Debug.Message("deck redirected " .. Duel.SendtoDeck(deck_card, 0, REASON_EFFECT))
      `,
      "hand-deck-redirect-move.lua",
    );

    expect(moveResult.ok, moveResult.error).toBe(true);
    expect(host.messages).toContain("hand redirect checked 100");
    expect(host.messages).toContain("deck redirect checked 200");
    expect(host.messages).toContain("hand redirected 1");
    expect(host.messages).toContain("deck redirected 1");
    expect(session.state.cards.find((card) => card.uid === handRedirected!.uid)).toMatchObject({ location: "graveyard", reason: 0x4000040 });
    expect(session.state.cards.find((card) => card.uid === deckRedirected!.uid)).toMatchObject({ location: "banished", reason: 0x4000040 });
  });

  it("reports zero when redirected Lua move helpers hit destination restrictions", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Blocked Redirect Source", kind: "monster" },
      { code: "200", name: "Blocked Redirect Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 45, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const target = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(target).toBeTruthy();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_CANNOT_TO_GRAVE)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_HAND)
        e:SetTargetRange(1,0)
        c:RegisterEffect(e)
      end
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_TO_HAND_REDIRECT)
        e:SetRange(LOCATION_MZONE)
        e:SetValue(LOCATION_GRAVE)
        c:RegisterEffect(e)
      end
      `,
      "blocked-redirected-move.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    const moveResult = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil)
      Debug.Message("blocked redirected hand " .. Duel.SendtoHand(c, 0, REASON_EFFECT))
      `,
      "blocked-redirected-move-run.lua",
    );

    expect(moveResult.ok, moveResult.error).toBe(true);
    expect(host.messages).toContain("blocked redirected hand 0");
    expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "monsterZone" });
  });

  it("applies Lua player-targeted redirect effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Field Redirect Source", kind: "monster" },
      { code: "200", name: "Redirected Ally", kind: "monster" },
    ];
    const session = createDuel({ seed: 44, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200"] },
      1: { main: [] },
    });
    startDuel(session);

    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const redirected = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    expect(source).toBeTruthy();
    expect(redirected).toBeTruthy();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0);
    moveDuelCard(session.state, redirected!.uid, "monsterZone", 0);
    source!.faceUp = true;
    source!.position = "faceUpAttack";
    redirected!.faceUp = true;
    redirected!.position = "faceUpAttack";

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_TO_GRAVE_REDIRECT)
        e:SetProperty(EFFECT_FLAG_PLAYER_TARGET)
        e:SetRange(LOCATION_MZONE)
        e:SetTargetRange(1,0)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("field redirect checked " .. tp)
          return true
        end)
        c:RegisterEffect(e)
      end
      `,
      "field-grave-redirect.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const moveResult = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil)
      Debug.Message("field send redirected " .. Duel.SendtoGrave(c, REASON_EFFECT))
      `,
      "field-grave-redirect-move.lua",
    );

    expect(moveResult.ok, moveResult.error).toBe(true);
    expect(host.messages).toContain("field redirect checked 0");
    expect(host.messages).toContain("field send redirected 1");
    expect(session.state.cards.find((card) => card.uid === source!.uid)).toMatchObject({ location: "monsterZone" });
    expect(session.state.cards.find((card) => card.uid === redirected!.uid)).toMatchObject({ location: "banished", reason: 0x4000040 });
  });
});
