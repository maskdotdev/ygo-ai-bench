import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";

describe("Lua dynamic stat change effects", () => {
  it("uses EFFECT_CHANGE_LEVEL for Pendulum Summon legality and Lua level checks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Change Level Low Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 1, rightScale: 1 },
      { code: "200", name: "Change Level High Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 8, rightScale: 8 },
      { code: "300", name: "Changed Level Pendulum", kind: "monster", typeFlags: 0x1000001, level: 9 },
    ];
    const session = createStartedSession(cards, { main: ["100", "200", "300"] });
    placePendulumScales(session, "100", "200");
    const candidate = session.state.cards.find((card) => card.code === "300");
    expect(candidate).toBeDefined();
    expect(hasPendulumSummon(session, candidate!.uid)).toBe(false);

    const host = createLuaScriptHost(session, { readScript: dynamicStatScript });
    expect(host.loadCardScript(300, { readScript: dynamicStatScript }).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(hasPendulumSummon(session, candidate!.uid)).toBe(true);

    const result = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 300), 0, LOCATION_HAND, 0, 1, 1, nil):GetFirst()
      Debug.Message("change level pendulum " .. c:GetLevel() .. "/" .. tostring(Duel.IsPlayerCanPendulumSummon(0)))
      `,
      "change-level-pendulum.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("change level pendulum 4/true");

    const action = getDuelLegalActions(session, 0).find((candidateAction) => candidateAction.type === "pendulumSummon" && candidateAction.summonUids.includes(candidate!.uid));
    if (!action || action.type !== "pendulumSummon") throw new Error("Expected Pendulum Summon action");
    expect(applyResponse(session, { ...action, summonUids: [candidate!.uid] }).ok).toBe(true);
    expect(session.state.cards.find((card) => card.uid === candidate!.uid)).toMatchObject({ location: "monsterZone", summonType: "pendulum" });
  });

  it("uses scale change effects for Pendulum scales and player checks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Change Scale Low Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 1, rightScale: 1 },
      { code: "200", name: "Changed Scale High Scale", kind: "monster", typeFlags: 0x1000001, level: 4, leftScale: 1, rightScale: 1 },
      { code: "300", name: "Change Scale Pendulum Candidate", kind: "monster", typeFlags: 0x1000001, level: 4 },
    ];
    const session = createStartedSession(cards, { main: ["100", "200", "300"] });
    placePendulumScales(session, "100", "200");
    const candidate = session.state.cards.find((card) => card.code === "300");
    expect(candidate).toBeDefined();
    expect(hasPendulumSummon(session, candidate!.uid)).toBe(false);

    const host = createLuaScriptHost(session, { readScript: dynamicStatScript });
    expect(host.loadCardScript(200, { readScript: dynamicStatScript }).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(hasPendulumSummon(session, candidate!.uid)).toBe(true);

    const result = host.loadScript(
      `
      local pc=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 200), 0, LOCATION_SZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("change scale pendulum " .. pc:GetLeftScale() .. "/" .. pc:GetRightScale() .. "/" .. pc:GetScale() .. "/" .. tostring(Duel.IsPlayerCanPendulumSummon(0)))
      `,
      "change-scale-pendulum.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("change scale pendulum 8/8/8/true");

    const action = getDuelLegalActions(session, 0).find((candidateAction) => candidateAction.type === "pendulumSummon" && candidateAction.summonUids.includes(candidate!.uid));
    if (!action || action.type !== "pendulumSummon") throw new Error("Expected Pendulum Summon action");
    expect(applyResponse(session, { ...action, summonUids: [candidate!.uid] }).ok).toBe(true);
    expect(session.state.cards.find((card) => card.uid === candidate!.uid)).toMatchObject({ location: "monsterZone", summonType: "pendulum" });
  });

  it("uses EFFECT_CHANGE_RANK for Xyz Summon legality and Lua rank checks", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Changed Rank First Material", kind: "monster", level: 4 },
      { code: "101", name: "Changed Rank Second Material", kind: "monster", level: 4 },
      { code: "920", name: "Changed Rank Xyz", kind: "extra", typeFlags: 0x800001, level: 9 },
    ];
    const session = createStartedSession(cards, { main: ["100", "101"], extra: ["920"] });
    const xyz = session.state.cards.find((card) => card.code === "920");
    const materials = session.state.cards.filter((card) => card.code === "100" || card.code === "101");
    expect(xyz).toBeDefined();
    expect(materials).toHaveLength(2);
    for (const material of materials) moveDuelCard(session.state, material.uid, "monsterZone", 0);
    expect(getDuelLegalActions(session, 0).some((action) => action.type === "xyzSummon" && action.uid === xyz!.uid)).toBe(false);

    const host = createLuaScriptHost(session, { readScript: dynamicStatScript });
    expect(host.loadCardScript(920, { readScript: dynamicStatScript }).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const action = getDuelLegalActions(session, 0).find((candidateAction) => candidateAction.type === "xyzSummon" && candidateAction.uid === xyz!.uid);
    expect(action).toBeDefined();

    const result = host.loadScript(
      `
      local xyz=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 920), 0, LOCATION_EXTRA, 0, 1, 1, nil):GetFirst()
      Debug.Message("change rank xyz " .. xyz:GetRank() .. "/" .. tostring(xyz:IsXyzSummonable()))
      `,
      "change-rank-xyz.lua",
    );
    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toContain("change rank xyz 4/true");

    if (!action || action.type !== "xyzSummon") throw new Error("Expected Xyz Summon action");
    expect(applyResponse(session, action).ok).toBe(true);
    expect(session.state.cards.find((card) => card.uid === xyz!.uid)).toMatchObject({ location: "monsterZone", summonType: "xyz" });
  });
});

function createStartedSession(cards: DuelCardData[], deck: { main: string[]; extra?: string[] }): DuelSession {
  const session = createDuel({ seed: 108, startingHandSize: deck.main.length, cardReader: createCardReader(cards) });
  loadDecks(session, { 0: deck, 1: { main: [] } });
  startDuel(session);
  return session;
}

function placePendulumScales(session: DuelSession, lowCode: string, highCode: string): void {
  const low = session.state.cards.find((card) => card.code === lowCode);
  const high = session.state.cards.find((card) => card.code === highCode);
  expect(low).toBeDefined();
  expect(high).toBeDefined();
  moveDuelCard(session.state, low!.uid, "spellTrapZone", 0).sequence = 0;
  moveDuelCard(session.state, high!.uid, "spellTrapZone", 0).sequence = 1;
}

function hasPendulumSummon(session: DuelSession, uid: string): boolean {
  return getDuelLegalActions(session, 0).some((action) => action.type === "pendulumSummon" && action.summonUids.includes(uid));
}

function dynamicStatScript(name: string): string | undefined {
  if (name === "c200.lua") {
    return `
      c200={}
      function c200.initial_effect(c)
        local e1=Effect.CreateEffect(c)
        e1:SetType(EFFECT_TYPE_SINGLE)
        e1:SetCode(EFFECT_CHANGE_LSCALE)
        e1:SetValue(8)
        c:RegisterEffect(e1)
        local e2=Effect.CreateEffect(c)
        e2:SetType(EFFECT_TYPE_SINGLE)
        e2:SetCode(EFFECT_CHANGE_RSCALE)
        e2:SetValue(8)
        c:RegisterEffect(e2)
      end
    `;
  }
  if (name === "c300.lua") {
    return `
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_CHANGE_LEVEL)
        e:SetValue(4)
        c:RegisterEffect(e)
      end
    `;
  }
  if (name === "c920.lua") {
    return `
      c920={}
      function c920.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_SINGLE)
        e:SetCode(EFFECT_CHANGE_RANK)
        e:SetValue(4)
        c:RegisterEffect(e)
      end
    `;
  }
  return undefined;
}
