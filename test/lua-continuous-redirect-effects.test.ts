import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createDuel,
  destroyDuelCard,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  startDuel,
} from "#duel/core.js";
import { getCards, moveDuelCard } from "#duel/card-state.js";
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

  it("applies Lua battle-destroy redirects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Battle Redirected Monster", kind: "monster" },
      { code: "200", name: "Destroying Monster", kind: "monster" },
    ];
    const session = createDuel({ seed: 288, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["200"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const redirected = session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "100");
    expect(attacker).toBeTruthy();
    expect(redirected).toBeTruthy();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0);
    moveDuelCard(session.state, redirected!.uid, "monsterZone", 1);
    attacker!.faceUp = true;
    attacker!.position = "faceUpAttack";
    redirected!.faceUp = true;
    redirected!.position = "faceUpAttack";
    session.state.currentAttack = { attackerUid: attacker!.uid, targetUid: redirected!.uid };
    session.state.pendingBattle = { attackerUid: attacker!.uid, targetUid: redirected!.uid };

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_BATTLE_DESTROY_REDIRECT)
        e:SetRange(LOCATION_MZONE)
        e:SetValue(LOCATION_REMOVED)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("battle destroy redirect checked " .. e:GetHandler():GetCode())
          return true
        end)
        c:RegisterEffect(e)
      end
      `,
      "battle-destroy-redirect.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    destroyDuelCard(session.state, redirected!.uid, 1, duelReason.battle | duelReason.destroy, 0);

    expect(host.messages).toContain("battle destroy redirect checked 100");
    expect(session.state.cards.find((card) => card.uid === redirected!.uid)).toMatchObject({ location: "banished", reason: duelReason.battle | duelReason.destroy | duelReason.redirect });
  });

  it("applies Lua battle-destroy redirects carried by the destroying monster", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Destroyed Monster", kind: "monster" },
      { code: "200", name: "Redirecting Destroyer", kind: "monster" },
    ];
    const session = createDuel({ seed: 289, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["200"] },
      1: { main: ["100"] },
    });
    startDuel(session);

    const destroyer = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
    const destroyed = session.state.cards.find((card) => card.controller === 1 && card.location === "hand" && card.code === "100");
    expect(destroyer).toBeTruthy();
    expect(destroyed).toBeTruthy();
    moveDuelCard(session.state, destroyer!.uid, "monsterZone", 0);
    moveDuelCard(session.state, destroyed!.uid, "monsterZone", 1);
    destroyer!.faceUp = true;
    destroyer!.position = "faceUpAttack";
    destroyed!.faceUp = true;
    destroyed!.position = "faceUpAttack";
    session.state.currentAttack = { attackerUid: destroyer!.uid, targetUid: destroyed!.uid };
    session.state.pendingBattle = { attackerUid: destroyer!.uid, targetUid: destroyed!.uid };

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c200={}
      function c200.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_BATTLE_DESTROY_REDIRECT)
        e:SetRange(LOCATION_MZONE)
        e:SetValue(LOCATION_REMOVED)
        e:SetCondition(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("destroyer battle redirect checked " .. e:GetHandler():GetCode())
          return true
        end)
        c:RegisterEffect(e)
      end
      `,
      "battle-destroyer-redirect.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    destroyDuelCard(session.state, destroyed!.uid, 1, duelReason.battle | duelReason.destroy, 0);

    expect(host.messages).toContain("destroyer battle redirect checked 200");
    expect(session.state.cards.find((card) => card.uid === destroyed!.uid)).toMatchObject({ location: "banished", reason: duelReason.battle | duelReason.destroy | duelReason.redirect });
    expect(session.state.cards.find((card) => card.uid === destroyer!.uid)).toMatchObject({ location: "monsterZone" });
  });

  it("applies Lua leave-field redirects to the bottom of the Deck", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Bottom Redirected Monster", kind: "monster" },
      { code: "900", name: "Deck Anchor A", kind: "monster" },
      { code: "901", name: "Deck Anchor B", kind: "monster" },
    ];
    const session = createDuel({ seed: 46, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "900", "901"] },
      1: { main: [] },
    });
    startDuel(session);

    const redirected = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const anchorA = session.state.cards.find((card) => card.controller === 0 && card.code === "900");
    const anchorB = session.state.cards.find((card) => card.controller === 0 && card.code === "901");
    expect(redirected).toBeTruthy();
    expect(anchorA).toBeTruthy();
    expect(anchorB).toBeTruthy();
    moveDuelCard(session.state, anchorA!.uid, "deck", 0);
    moveDuelCard(session.state, anchorB!.uid, "deck", 0);
    anchorA!.sequence = 0;
    anchorB!.sequence = 1;
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
        e:SetValue(LOCATION_DECKBOT)
        c:RegisterEffect(e)
      end
      `,
      "leave-field-deck-bottom-redirect.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const moveResult = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil)
      Debug.Message("deck bottom redirected " .. Duel.SendtoGrave(c, REASON_EFFECT))
      `,
      "leave-field-deck-bottom-redirect-move.lua",
    );

    expect(moveResult.ok, moveResult.error).toBe(true);
    expect(host.messages).toContain("deck bottom redirected 1");
    expect(session.state.cards.find((card) => card.uid === redirected!.uid)).toMatchObject({ location: "deck", reason: 0x4000040 });
    expect(getCards(session.state, 0, "deck").map((card) => card.code)).toEqual(["900", "901", "100"]);
  });

  it("applies Lua leave-field redirects that shuffle into the Deck", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Shuffle Redirected Monster", kind: "monster" },
      { code: "900", name: "Deck Anchor A", kind: "monster" },
      { code: "901", name: "Deck Anchor B", kind: "monster" },
    ];
    const session = createDuel({ seed: 47, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "900", "901"] },
      1: { main: [] },
    });
    startDuel(session);

    const redirected = session.state.cards.find((card) => card.controller === 0 && card.code === "100");
    const anchorA = session.state.cards.find((card) => card.controller === 0 && card.code === "900");
    const anchorB = session.state.cards.find((card) => card.controller === 0 && card.code === "901");
    expect(redirected).toBeTruthy();
    expect(anchorA).toBeTruthy();
    expect(anchorB).toBeTruthy();
    moveDuelCard(session.state, anchorA!.uid, "deck", 0);
    moveDuelCard(session.state, anchorB!.uid, "deck", 0);
    anchorA!.sequence = 0;
    anchorB!.sequence = 1;
    moveDuelCard(session.state, redirected!.uid, "monsterZone", 0);

    const randomCounterBefore = session.state.randomCounter;
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_LEAVE_FIELD_REDIRECT)
        e:SetRange(LOCATION_MZONE)
        e:SetValue(LOCATION_DECKSHF)
        c:RegisterEffect(e)
      end
      `,
      "leave-field-deck-shuffle-redirect.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const moveResult = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil)
      Debug.Message("deck shuffle redirected " .. Duel.SendtoGrave(c, REASON_EFFECT))
      `,
      "leave-field-deck-shuffle-redirect-move.lua",
    );

    expect(moveResult.ok, moveResult.error).toBe(true);
    expect(host.messages).toContain("deck shuffle redirected 1");
    expect(session.state.cards.find((card) => card.uid === redirected!.uid)).toMatchObject({ location: "deck", reason: 0x4000040 });
    expect(getCards(session.state, 0, "deck").map((card) => card.code).sort()).toEqual(["100", "900", "901"]);
    expect(session.state.randomCounter).toBe(randomCounterBefore + 1);
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

  it("applies targeted field redirect effects only to selected cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Targeted Redirect Source", kind: "monster" },
      { code: "200", name: "Redirected Target", kind: "monster" },
      { code: "300", name: "Unredirected Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 46, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "200", "300"] },
      1: { main: [] },
    });
    startDuel(session);

    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      moveDuelCard(session.state, card.uid, "monsterZone", 0);
      card.faceUp = true;
      card.position = "faceUpAttack";
    }
    const redirected = session.state.cards.find((card) => card.code === "200");
    const open = session.state.cards.find((card) => card.code === "300");
    expect(redirected).toBeTruthy();
    expect(open).toBeTruthy();

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EFFECT_TO_GRAVE_REDIRECT)
        e:SetRange(LOCATION_MZONE)
        e:SetValue(LOCATION_REMOVED)
        e:SetTarget(function(e,c) return c:IsCode(200) end)
        c:RegisterEffect(e)
      end
      `,
      "targeted-grave-redirect.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const moveResult = host.loadScript(
      `
      local redirected=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_MZONE, 0, 1, 1, nil)
      local open=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_MZONE, 0, 1, 1, nil)
      Debug.Message("targeted redirect selected " .. Duel.SendtoGrave(redirected, REASON_EFFECT))
      Debug.Message("targeted redirect open " .. Duel.SendtoGrave(open, REASON_EFFECT))
      `,
      "targeted-grave-redirect-move.lua",
    );

    expect(moveResult.ok, moveResult.error).toBe(true);
    expect(host.messages).toContain("targeted redirect selected 1");
    expect(host.messages).toContain("targeted redirect open 1");
    expect(session.state.cards.find((card) => card.uid === redirected!.uid)).toMatchObject({ location: "banished", reason: 0x4000040 });
    expect(session.state.cards.find((card) => card.uid === open!.uid)).toMatchObject({ location: "graveyard", reason: 0x40 });
  });
});
