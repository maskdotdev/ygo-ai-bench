import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, getLegalActions as getDuelLegalActions, restoreDuel, serializeDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader } from "#engine/data-loaders.js";
import { setupLuaChainFixture } from "./lua-chain-fixtures.js";

describe("Lua effect reset", () => {
  it("removes Lua RESET_TOGRAVE effects when their source goes to the Graveyard", () => {
    const { session } = setupLuaChainFixture({
      seed: 119,
      startingHandSize: 1,
      cards: [
        { code: "21100", name: "Lua Reset Grave Source", kind: "monster" },
        { code: "21200", name: "Lua Reset Grave Filler", kind: "monster" },
      ],
      decks: {
        0: { main: ["21100"] },
        1: { main: ["21200"] },
      },
      expectedEffects: 1,
      scriptName: "lua-effect-reset-to-grave.lua",
      script: `
      c21100={}
      function c21100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetReset(RESET_EVENT + RESET_TOGRAVE)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua reset to grave should not resolve")
        end)
        c:RegisterEffect(e)
      end
      `,
    });
    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "21100");
    expect(source).toBeDefined();

    moveDuelCard(session.state, source!.uid, "graveyard", 0);

    expect(session.state.effects).toHaveLength(0);
  });

  it("removes Lua reset-event effects when their source leaves range", () => {
    const { session } = setupLuaChainFixture({
      seed: 115,
      startingHandSize: 1,
      cards: [
        { code: "20100", name: "Lua Reset Source", kind: "monster" },
        { code: "20200", name: "Lua Reset Filler", kind: "monster" },
      ],
      decks: {
        0: { main: ["20100"] },
        1: { main: ["20200"] },
      },
      expectedEffects: 1,
      scriptName: "lua-effect-reset.lua",
      script: `
      c20100={}
      function c20100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetReset(RESET_EVENT + RESETS_STANDARD)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua reset effect should not resolve")
        end)
        c:RegisterEffect(e)
      end
      `,
    });
    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "20100");
    expect(source).toBeDefined();
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateEffect")).toBe(true);

    moveDuelCard(session.state, source!.uid, "graveyard", 0);

    expect(session.state.effects).toHaveLength(0);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateEffect")).toBe(false);
  });

  it("preserves Lua RESET_TOGRAVE metadata across snapshot restore", () => {
    const cardData = [
      { code: "22100", name: "Lua Reset Snapshot Source", kind: "monster" },
      { code: "22200", name: "Lua Reset Snapshot Filler", kind: "monster" },
    ] satisfies DuelCardData[];
    const { session } = setupLuaChainFixture({
      seed: 122,
      startingHandSize: 1,
      cards: cardData,
      decks: {
        0: { main: ["22100"] },
        1: { main: ["22200"] },
      },
      expectedEffects: 1,
      scriptName: "lua-effect-reset-snapshot.lua",
      script: `
      c22100={}
      function c22100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetReset(RESET_EVENT + RESET_TOGRAVE)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua reset snapshot should not resolve")
        end)
        c:RegisterEffect(e)
      end
      `,
    });
    const registryKey = session.state.effects[0]?.registryKey;
    expect(registryKey).toBeDefined();

    const restored = restoreDuel(serializeDuel(session), createCardReader(cardData), {
      [registryKey!]: (effect) => ({
        ...effect,
        operation(ctx) {
          ctx.log("Restored Lua reset snapshot");
        },
      }),
    });
    const source = restored.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "22100");
    expect(source).toBeDefined();
    expect(restored.state.effects[0]).toMatchObject({ registryKey, reset: { flags: 0x1000 + 0x40000 } });

    moveDuelCard(restored.state, source!.uid, "graveyard", 0);

    expect(restored.state.effects).toHaveLength(0);
  });

  it("removes Lua RESET_PHASE effects when entering their target phase", () => {
    const { session } = setupLuaChainFixture({
      seed: 125,
      startingHandSize: 1,
      cards: [
        { code: "23100", name: "Lua Reset Phase Source", kind: "monster" },
        { code: "23200", name: "Lua Reset Phase Filler", kind: "monster" },
      ],
      decks: {
        0: { main: ["23100"] },
        1: { main: ["23200"] },
      },
      expectedEffects: 1,
      scriptName: "lua-effect-reset-phase.lua",
      script: `
      c23100={}
      function c23100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetReset(RESET_PHASE + PHASE_BATTLE)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua phase reset should not resolve")
        end)
        c:RegisterEffect(e)
      end
      `,
    });
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateEffect")).toBe(true);

    const battle = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === "battle");
    expect(battle).toBeDefined();
    expect(applyResponse(session, battle!).ok).toBe(true);

    expect(session.state.effects).toHaveLength(0);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "activateEffect")).toBe(false);
  });

  it("removes Lua RESET_CHAIN effects after their chain resolves", () => {
    const { session } = setupLuaChainFixture({
      seed: 129,
      startingHandSize: 1,
      cards: [
        { code: "24100", name: "Lua Reset Chain Source", kind: "monster" },
        { code: "24200", name: "Lua Reset Chain Filler", kind: "monster" },
      ],
      decks: {
        0: { main: ["24100"] },
        1: { main: ["24200"] },
      },
      expectedEffects: 1,
      scriptName: "lua-effect-reset-chain.lua",
      script: `
      c24100={}
      function c24100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetReset(RESET_CHAIN)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua reset chain resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
    });
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(session.state.effects).toHaveLength(0);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "activateEffect")).toBe(false);
  });

  it("clears Lua count-limit usage when RESET_CHAIN removes an effect", () => {
    const { session } = setupLuaChainFixture({
      seed: 132,
      startingHandSize: 1,
      cards: [
        { code: "25100", name: "Lua Reset Count Source", kind: "monster" },
        { code: "25200", name: "Lua Reset Count Filler", kind: "monster" },
      ],
      decks: {
        0: { main: ["25100"] },
        1: { main: ["25200"] },
      },
      expectedEffects: 1,
      scriptName: "lua-effect-reset-chain-count.lua",
      script: `
      c25100={}
      function c25100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetCountLimit(1)
        e:SetReset(RESET_CHAIN)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua reset count resolved")
        end)
        c:RegisterEffect(e)
      end
      `,
    });
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeDefined();
    expect(applyResponse(session, action!).ok).toBe(true);

    expect(session.state.effects).toHaveLength(0);
    expect(session.state.usedCountKeys).toHaveLength(0);
  });

  it("removes Lua RESET_TOFIELD effects when their source enters the field", () => {
    const { session } = setupLuaChainFixture({
      seed: 136,
      startingHandSize: 1,
      cards: [
        { code: "26100", name: "Lua Reset Field Source", kind: "monster" },
        { code: "26200", name: "Lua Reset Field Filler", kind: "monster" },
      ],
      decks: {
        0: { main: ["26100"] },
        1: { main: ["26200"] },
      },
      expectedEffects: 1,
      scriptName: "lua-effect-reset-to-field.lua",
      script: `
      c26100={}
      function c26100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND + LOCATION_MZONE)
        e:SetReset(RESET_EVENT + RESET_TOFIELD)
        e:SetOperation(function(e,tp,eg,ep,ev,re,r,rp)
          Debug.Message("lua reset to field should not resolve")
        end)
        c:RegisterEffect(e)
      end
      `,
    });
    const source = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "26100");
    expect(source).toBeDefined();

    moveDuelCard(session.state, source!.uid, "monsterZone", 0);

    expect(session.state.effects).toHaveLength(0);
  });
});
