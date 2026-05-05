import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

describe("Lua lose-condition lockout helpers", () => {
  it("prevents LP-zero defeat while a player is affected by cannot-lose-LP effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "LP Loss Protector", kind: "monster", level: 4 }];
    const session = createDuel({ seed: 220, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_CANNOT_LOSE_LP)
        e:SetRange(LOCATION_HAND)
        e:SetTargetRange(1,0)
        c:RegisterEffect(e)
      end
      `,
      "cannot-lose-lp.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const checked = host.loadScript(
      `
      Debug.Message("damage " .. Duel.Damage(0, 8000, REASON_EFFECT))
      Debug.Message("lp " .. Duel.GetLP(0))
      `,
      "cannot-lose-lp-check.lua",
    );

    expect(checked.ok, checked.error).toBe(true);
    expect(host.messages).toEqual(["damage 8000", "lp 0"]);
    expect(session.state.players[0].lifePoints).toBe(0);
    expect(session.state.status).toBe("awaiting");
  });

  it("prevents Duel.Win from defeating a player affected by cannot-lose-effect effects", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Effect Loss Protector", kind: "monster", level: 4 }];
    const session = createDuel({ seed: 225, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: [] } });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_CANNOT_LOSE_EFFECT)
        e:SetRange(LOCATION_HAND)
        e:SetTargetRange(1,0)
        c:RegisterEffect(e)
      end
      `,
      "cannot-lose-effect.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const checked = host.loadScript(
      `
      Duel.Win(1, WIN_REASON_EXODIA)
      `,
      "cannot-lose-effect-check.lua",
    );

    expect(checked.ok, checked.error).toBe(true);
    expect(session.state.status).toBe("awaiting");
    expect(session.state.winner).toBeUndefined();
    expect(session.state.winReason).toBeUndefined();
  });

  it("ends the duel when a mandatory turn draw cannot draw from an empty deck", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Vanished Deck Card", kind: "monster", level: 4 }];
    const session = createDuel({ seed: 226, startingHandSize: 0, drawPerTurn: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: [] }, 1: { main: ["100"] } });
    startDuel(session);
    const deckCard = session.state.cards.find((card) => card.controller === 1 && card.location === "deck");
    expect(deckCard).toBeDefined();
    moveDuelCard(session.state, deckCard!.uid, "graveyard", 1);

    const end = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "endTurn");
    expect(end).toBeDefined();
    expect(applyResponse(session, end!).ok).toBe(true);

    expect(session.state.status).toBe("ended");
    expect(session.state.winner).toBe(0);
    expect(session.state.waitingFor).toBeUndefined();
  });

  it("prevents empty-deck turn draw defeat while a player is affected by cannot-lose-deck effects", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Deck Loss Protector", kind: "monster", level: 4 },
      { code: "200", name: "Emptied Deck Card", kind: "monster", level: 4 },
    ];
    const session = createDuel({ seed: 227, startingHandSize: 1, drawPerTurn: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: [] }, 1: { main: ["100", "200"] } });
    startDuel(session);
    const protector = session.state.cards.find((card) => card.controller === 1 && card.code === "100");
    const deckCard = session.state.cards.find((card) => card.controller === 1 && card.code === "200");
    expect(protector).toBeDefined();
    expect(deckCard).toBeDefined();
    moveDuelCard(session.state, protector!.uid, "hand", 1);
    moveDuelCard(session.state, deckCard!.uid, "graveyard", 1);

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD)
        e:SetCode(EFFECT_CANNOT_LOSE_DECK)
        e:SetRange(LOCATION_HAND)
        e:SetTargetRange(1,0)
        c:RegisterEffect(e)
      end
      `,
      "cannot-lose-deck.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const end = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "endTurn");
    expect(end).toBeDefined();
    expect(applyResponse(session, end!).ok).toBe(true);

    expect(session.state.status).toBe("awaiting");
    expect(session.state.turnPlayer).toBe(1);
    expect(session.state.phase).toBe("main1");
    expect(session.state.winner).toBeUndefined();
  });
});
