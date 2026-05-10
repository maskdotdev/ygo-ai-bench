import { describe, expect, it } from "vitest";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, registerEffect, restoreDuel, serializeDuel, specialSummonDuelCard, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData, DuelSession, PlayerId } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

function setupRestoredSameTurnLockout(seed: number): DuelSession {
  const cards: DuelCardData[] = [
    { code: "100", name: "Restored Operation Summoned", kind: "monster" },
    { code: "200", name: "Restored Operation Set", kind: "monster" },
  ];
  const session = createDuel({ seed, startingHandSize: 2, cardReader: createCardReader(cards) });
  loadDecks(session, {
    0: { main: ["100", "200"] },
    1: { main: [] },
  });
  startDuel(session);

  const summoned = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
  const set = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "200");
  expect(summoned).toBeDefined();
  expect(set).toBeDefined();
  specialSummonDuelCard(session.state, summoned!.uid, 0);
  const setAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "setMonster" && candidate.uid === set!.uid);
  expect(setAction).toBeDefined();
  applyAndAssert(session, setAction!);

  return restoreDuel(serializeDuel(session), createCardReader(cards));
}

describe("Lua position lockout helpers", () => {
  it("allows restored same-turn Lua effect position changes", () => {
    const restored = setupRestoredSameTurnLockout(200);
    const host = createLuaScriptHost(restored);
    const result = host.loadScript(
      `
      local summoned = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local set = Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      Debug.Message("restored change summoned " .. Duel.ChangePosition(summoned, POS_FACEUP_DEFENSE))
      Debug.Message("restored change set " .. Duel.ChangePosition(set, POS_FACEUP_ATTACK))
      Debug.Message("restored change operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "restored-change-position-lockout.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["restored change summoned 1", "restored change set 1", "restored change operated 1"]);
  });

  it("rejects restored same-turn Rush position toggles", () => {
    const restored = setupRestoredSameTurnLockout(201);
    const host = createLuaScriptHost(restored);
    const result = host.loadScript(
      `
      local summoned = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local set = Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      Duel.ChangeToFaceupAttackOrFacedownDefense(summoned, 0)
      Debug.Message("restored rush summoned " .. summoned:GetPosition() .. "/" .. Duel.GetOperatedGroup():GetCount())
      Duel.ChangeToFaceupAttackOrFacedownDefense(set, 0)
      Debug.Message("restored rush set " .. set:GetPosition() .. "/" .. Duel.GetOperatedGroup():GetCount())
      `,
      "restored-rush-position-lockout.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["restored rush summoned 1/0", "restored rush set 8/0"]);
  });

  it("allows restored position changes after the turn cycles", () => {
    const restored = setupRestoredSameTurnLockout(202);
    applyRestoredEndTurn(restored, 0);
    applyRestoredEndTurn(restored, 1);

    const host = createLuaScriptHost(restored);
    const result = host.loadScript(
      `
      local summoned = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local set = Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      Debug.Message("restored reset change summoned " .. Duel.ChangePosition(summoned, POS_FACEUP_DEFENSE))
      Debug.Message("restored reset change set " .. Duel.ChangePosition(set, POS_FACEUP_ATTACK))
      Debug.Message("restored reset change operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "restored-change-position-reset.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["restored reset change summoned 1", "restored reset change set 1", "restored reset change operated 1"]);
  });

  it("allows restored same-turn Lua effect turn-set operations", () => {
    const restored = setupRestoredSameTurnLockout(204);
    const host = createLuaScriptHost(restored);
    const result = host.loadScript(
      `
      local summoned = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      Debug.Message("restored turn set blocked " .. Duel.ChangePosition(summoned, POS_FACEDOWN_DEFENSE))
      Debug.Message("restored turn set operated " .. Duel.GetOperatedGroup():GetCount())
      `,
      "restored-turn-set-lockout.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["restored turn set blocked 1", "restored turn set operated 1"]);
  });

  it("allows restored Lua turn-set operations after the turn cycles", () => {
    const restored = setupRestoredSameTurnLockout(205);
    applyRestoredEndTurn(restored, 0);
    applyRestoredEndTurn(restored, 1);

    const host = createLuaScriptHost(restored);
    const result = host.loadScript(
      `
      local summoned = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      Debug.Message("restored turn set allowed " .. Duel.ChangePosition(summoned, POS_FACEDOWN_DEFENSE))
      Debug.Message("restored turn set position " .. summoned:GetPosition() .. "/" .. tostring(summoned:IsFaceup()))
      `,
      "restored-turn-set-reset.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["restored turn set allowed 1", "restored turn set position 8/false"]);
  });

  it("applies Lua cannot-turn-set effects without blocking ordinary position changes", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Turn Set Locked", kind: "monster" }];
    const session = createDuel({ seed: 206, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const monster = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(monster).toBeDefined();
    specialSummonDuelCard(session.state, monster!.uid, 0);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "endTurn")!);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "endTurn")!);
    registerEffect(session, {
      id: "cannot-turn-set",
      sourceUid: monster!.uid,
      controller: 0,
      event: "continuous",
      code: 69,
      range: ["monsterZone"],
      operation: () => undefined,
    });

    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local monster = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      Debug.Message("turn set effect predicate " .. tostring(monster:IsCanTurnSet()))
      Debug.Message("turn set effect operation " .. Duel.ChangePosition(monster, POS_FACEDOWN_DEFENSE))
      Debug.Message("turn set effect defense " .. tostring(monster:IsCanChangePosition(POS_FACEUP_DEFENSE)))
      `,
      "cannot-turn-set-effect.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["turn set effect predicate false", "turn set effect operation 0", "turn set effect defense true"]);
  });

  it("applies Lua cannot-change-position-by-effect effects without blocking manual position actions", () => {
    const cards: DuelCardData[] = [{ code: "100", name: "Effect Position Locked", kind: "monster" }];
    const session = createDuel({ seed: 207, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: [] },
    });
    startDuel(session);

    const monster = session.state.cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(monster).toBeDefined();
    specialSummonDuelCard(session.state, monster!.uid, 0);
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "endTurn")!);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "endTurn")!);
    registerEffect(session, {
      id: "cannot-change-position-by-effect",
      sourceUid: monster!.uid,
      controller: 0,
      event: "continuous",
      code: 87,
      range: ["monsterZone"],
      operation: () => undefined,
    });

    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "changePosition" && candidate.uid === monster!.uid && candidate.position === "faceUpDefense")).toBe(true);
    const host = createLuaScriptHost(session);
    const result = host.loadScript(
      `
      local monster = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      Debug.Message("effect position predicate " .. tostring(monster:IsCanChangePosition(POS_FACEUP_DEFENSE)))
      Debug.Message("effect position operation " .. Duel.ChangePosition(monster, POS_FACEUP_DEFENSE))
      `,
      "cannot-change-position-by-effect.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["effect position predicate false", "effect position operation 0"]);
    const manualAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePosition" && candidate.uid === monster!.uid && candidate.position === "faceUpDefense");
    expect(manualAction).toBeDefined();
    applyAndAssert(session, manualAction!);
    expect(session.state.cards.find((card) => card.uid === monster!.uid)).toMatchObject({ position: "faceUpDefense", faceUp: true });
  });

  it("applies targeted field position lockouts only to selected cards", () => {
    const cards: DuelCardData[] = [
      { code: "100", name: "Position Lock Source", kind: "monster" },
      { code: "200", name: "Position Locked", kind: "monster" },
      { code: "300", name: "Position Open", kind: "monster" },
    ];
    const session = createDuel({ seed: 208, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100", "200", "300"] }, 1: { main: [] } });
    startDuel(session);

    for (const card of session.state.cards.filter((candidate) => candidate.controller === 0 && candidate.location === "hand")) {
      specialSummonDuelCard(session.state, card.uid, 0);
    }
    applyAndAssert(session, getDuelLegalActions(session, 0).find((candidate) => candidate.type === "endTurn")!);
    applyAndAssert(session, getDuelLegalActions(session, 1).find((candidate) => candidate.type === "endTurn")!);

    const host = createLuaScriptHost(session);
    const setup = host.loadScript(
      `
      c100={}
      function c100.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_FIELD+EFFECT_TYPE_CONTINUOUS)
        e:SetCode(EFFECT_CANNOT_CHANGE_POSITION)
        e:SetRange(LOCATION_MZONE)
        e:SetTarget(function(e,c) return c:IsCode(200) end)
        c:RegisterEffect(e)
      end
      `,
      "targeted-position-lockout.lua",
    );
    expect(setup.ok, setup.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const result = host.loadScript(
      `
      local locked=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,200),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      local open=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,300),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("targeted position predicates " .. tostring(locked:IsCanChangePosition(POS_FACEUP_DEFENSE)) .. "/" .. tostring(open:IsCanChangePosition(POS_FACEUP_DEFENSE)))
      Debug.Message("targeted position operations " .. Duel.ChangePosition(locked, POS_FACEUP_DEFENSE) .. "/" .. Duel.ChangePosition(open, POS_FACEUP_DEFENSE))
      Debug.Message("targeted position values " .. locked:GetPosition() .. "/" .. open:GetPosition())
      `,
      "targeted-position-lockout-check.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["targeted position predicates false/true", "targeted position operations 0/1", "targeted position values 1/4"]);
  });

  it("allows restored Rush position toggles after the turn cycles", () => {
    const restored = setupRestoredSameTurnLockout(203);
    applyRestoredEndTurn(restored, 0);
    applyRestoredEndTurn(restored, 1);

    const host = createLuaScriptHost(restored);
    const result = host.loadScript(
      `
      local summoned = Duel.GetFieldCard(0, LOCATION_MZONE, 0)
      local set = Duel.GetFieldCard(0, LOCATION_MZONE, 1)
      Duel.ChangeToFaceupAttackOrFacedownDefense(summoned, 0)
      Debug.Message("restored reset rush summoned " .. summoned:GetPosition() .. "/" .. Duel.GetOperatedGroup():GetCount())
      Duel.ChangeToFaceupAttackOrFacedownDefense(set, 0)
      Debug.Message("restored reset rush set " .. set:GetPosition() .. "/" .. Duel.GetOperatedGroup():GetCount())
      `,
      "restored-rush-position-reset.lua",
    );

    expect(result.ok, result.error).toBe(true);
    expect(host.messages).toEqual(["restored reset rush summoned 8/1", "restored reset rush set 1/1"]);
  });
});

function applyRestoredEndTurn(session: DuelSession, player: PlayerId): void {
  const endTurn = getDuelLegalActions(session, player).find((candidate) => candidate.type === "endTurn");
  expect(getGroupedDuelLegalActions(session, player).flatMap((group) => group.actions)).toContainEqual(endTurn);
  applyAndAssert(session, endTurn!);
}

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
