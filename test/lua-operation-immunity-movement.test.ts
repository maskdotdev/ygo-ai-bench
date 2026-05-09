import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData, DuelLocation } from "#duel/types.js";

function placeCard(session: ReturnType<typeof createDuel>, code: string, location: DuelLocation): void {
  const card = session.state.cards.find((candidate) => candidate.controller === 1 && candidate.code === code);
  expect(card).toBeTruthy();
  moveDuelCard(session.state, card!.uid, location, 1);
  card!.faceUp = true;
  card!.position = "faceUpAttack";
}

describe("Lua operation immunity movement", () => {
  it("blocks effect-reason movement helpers for immune cards", () => {
    const cards: DuelCardData[] = [
      { code: "110", name: "Movement Source", kind: "monster" },
      { code: "111", name: "Ignore Immunity Source", kind: "monster" },
      { code: "220", name: "Immune Remove Target", kind: "monster" },
      { code: "221", name: "Immune Hand Target", kind: "monster" },
      { code: "222", name: "Immune Deck Target", kind: "monster" },
      { code: "223", name: "Immune Generic Target", kind: "monster" },
      { code: "224", name: "Immune Extra Target", kind: "extra" },
      { code: "320", name: "Open Remove Target", kind: "monster" },
      { code: "321", name: "Open Hand Target", kind: "monster" },
      { code: "322", name: "Open Deck Target", kind: "monster" },
      { code: "323", name: "Open Generic Target", kind: "monster" },
      { code: "324", name: "Open Extra Target", kind: "extra" },
    ];
    const session = createDuel({ seed: 213, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["110", "111"] },
      1: { main: ["220", "221", "222", "223", "320", "321", "322", "323"], extra: ["224", "324"] },
    });
    startDuel(session);

    for (const code of ["220", "221", "222", "223", "224"]) placeCard(session, code, "monsterZone");
    for (const code of ["320", "321", "322", "323", "324"]) placeCard(session, code, "spellTrapZone");

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      local function pick(code)
        return Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, code), 1, LOCATION_ONFIELD, 0, 1, 1, nil)
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
      c110={}
      function c110.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("remove protected " .. Duel.Remove(pick(220), POS_FACEUP, REASON_EFFECT))
          Debug.Message("hand protected " .. Duel.SendtoHand(pick(221), nil, REASON_EFFECT))
          Debug.Message("deck protected " .. Duel.SendtoDeck(pick(222), nil, SEQ_DECKTOP, REASON_EFFECT))
          Debug.Message("generic protected " .. Duel.Sendto(pick(223), LOCATION_GRAVE, REASON_EFFECT))
          Debug.Message("extra protected " .. Duel.SendtoExtra(pick(224), nil, REASON_EFFECT))
          Debug.Message("remove open " .. Duel.Remove(pick(320), POS_FACEUP, REASON_EFFECT))
          Debug.Message("hand open " .. Duel.SendtoHand(pick(321), nil, REASON_EFFECT))
          Debug.Message("deck open " .. Duel.SendtoDeck(pick(322), nil, SEQ_DECKTOP, REASON_EFFECT))
          Debug.Message("generic open " .. Duel.Sendto(pick(323), LOCATION_GRAVE, REASON_EFFECT))
          Debug.Message("extra open " .. Duel.SendtoExtra(pick(324), nil, REASON_EFFECT))
        end)
        c:RegisterEffect(e)
      end
      c111={}
      function c111.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("ignore remove protected " .. Duel.Remove(pick(220), POS_FACEUP, REASON_EFFECT))
          Debug.Message("ignore hand protected " .. Duel.SendtoHand(pick(221), nil, REASON_EFFECT))
          Debug.Message("ignore deck protected " .. Duel.SendtoDeck(pick(222), nil, SEQ_DECKTOP, REASON_EFFECT))
          Debug.Message("ignore generic protected " .. Duel.Sendto(pick(223), LOCATION_GRAVE, REASON_EFFECT))
          Debug.Message("ignore extra protected " .. Duel.SendtoExtra(pick(224), nil, REASON_EFFECT))
        end)
        c:RegisterEffect(e)
      end
      c220={initial_effect=register_immune}
      c221={initial_effect=register_immune}
      c222={initial_effect=register_immune}
      c223={initial_effect=register_immune}
      c224={initial_effect=register_immune}
      `,
      "operation-immunity-more-movement.lua",
    );
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(7);

    const source = session.state.cards.find((card) => card.controller === 0 && card.code === "110");
    const ignoreSource = session.state.cards.find((card) => card.controller === 0 && card.code === "111");
    expect(source).toBeTruthy();
    expect(ignoreSource).toBeTruthy();
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeTruthy();
    expect(applyResponse(session, action!).ok).toBe(true);

    for (const message of ["remove protected 0", "hand protected 0", "deck protected 0", "generic protected 0", "extra protected 0"]) {
      expect(host.messages).toContain(message);
    }
    for (const message of ["remove open 1", "hand open 1", "deck open 1", "generic open 1", "extra open 1"]) {
      expect(host.messages).toContain(message);
    }
    for (const code of ["220", "221", "222", "223", "224"]) {
      expect(session.state.cards.find((card) => card.code === code)).toMatchObject({ location: "monsterZone" });
    }
    expect(session.state.cards.find((card) => card.code === "320")).toMatchObject({ location: "banished" });
    expect(session.state.cards.find((card) => card.code === "321")).toMatchObject({ location: "hand" });
    expect(session.state.cards.find((card) => card.code === "322")).toMatchObject({ location: "deck" });
    expect(session.state.cards.find((card) => card.code === "323")).toMatchObject({ location: "graveyard" });
    expect(session.state.cards.find((card) => card.code === "324")).toMatchObject({ location: "extraDeck" });

    const ignoreAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === ignoreSource!.uid);
    expect(ignoreAction).toBeTruthy();
    expect(applyResponse(session, ignoreAction!).ok).toBe(true);

    for (const message of ["ignore remove protected 1", "ignore hand protected 1", "ignore deck protected 1", "ignore generic protected 1", "ignore extra protected 1"]) {
      expect(host.messages).toContain(message);
    }
    expect(session.state.cards.find((card) => card.code === "220")).toMatchObject({ location: "banished" });
    expect(session.state.cards.find((card) => card.code === "221")).toMatchObject({ location: "hand" });
    expect(session.state.cards.find((card) => card.code === "222")).toMatchObject({ location: "deck" });
    expect(session.state.cards.find((card) => card.code === "223")).toMatchObject({ location: "graveyard" });
    expect(session.state.cards.find((card) => card.code === "224")).toMatchObject({ location: "extraDeck" });
  });

  it("does not block cost-reason movement with effect immunity", () => {
    const cards: DuelCardData[] = [
      { code: "120", name: "Cost Movement Source", kind: "monster" },
      { code: "230", name: "Immune Cost Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 214, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["120"] },
      1: { main: ["230"] },
    });
    startDuel(session);
    placeCard(session, "230", "monsterZone");

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      c120={}
      function c120.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 230), 1, LOCATION_MZONE, 0, 1, 1, nil)
          Debug.Message("cost remove protected " .. Duel.Remove(target, POS_FACEUP, REASON_COST))
        end)
        c:RegisterEffect(e)
      end
      c230={}
      function c230.initial_effect(c)
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
      "operation-immunity-cost-movement.lua",
    );
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const source = session.state.cards.find((card) => card.controller === 0 && card.code === "120");
    expect(source).toBeTruthy();
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeTruthy();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(host.messages).toContain("cost remove protected 1");
    expect(session.state.cards.find((card) => card.code === "230")).toMatchObject({ location: "banished" });
  });

  it("blocks effect release but not cost release for immune cards", () => {
    const cards: DuelCardData[] = [
      { code: "130", name: "Release Source", kind: "monster" },
      { code: "240", name: "Immune Release Target", kind: "monster" },
      { code: "340", name: "Open Release Target", kind: "monster" },
    ];
    const session = createDuel({ seed: 215, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["130"] },
      1: { main: ["240", "340"] },
    });
    startDuel(session);
    placeCard(session, "240", "monsterZone");
    placeCard(session, "340", "monsterZone");

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      local function pick(code)
        return Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, code), 1, LOCATION_MZONE, 0, 1, 1, nil)
      end
      c130={}
      function c130.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp)
          Debug.Message("effect release protected " .. Duel.Release(pick(240), REASON_EFFECT))
          Debug.Message("effect release open " .. Duel.Release(pick(340), REASON_EFFECT))
          Debug.Message("cost release protected " .. Duel.Release(pick(240), REASON_COST))
        end)
        c:RegisterEffect(e)
      end
      c240={}
      function c240.initial_effect(c)
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
      "operation-immunity-release-movement.lua",
    );
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const source = session.state.cards.find((card) => card.controller === 0 && card.code === "130");
    expect(source).toBeTruthy();
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === source!.uid);
    expect(action).toBeTruthy();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(host.messages).toContain("effect release protected 0");
    expect(host.messages).toContain("effect release open 1");
    expect(host.messages).toContain("cost release protected 1");
    expect(session.state.cards.find((card) => card.code === "240")).toMatchObject({ location: "graveyard" });
    expect(session.state.cards.find((card) => card.code === "340")).toMatchObject({ location: "graveyard" });
  });
});
