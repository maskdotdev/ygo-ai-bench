import { describe, expect, it } from "vitest";
import {
  applyResponse,
  canChangeDuelCardPosition,
  changeDuelCardPosition,
  createDuel,
  flipSummonDuelCard,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  queryPublicState,
  registerEffect,
  restoreDuel,
  serializeDuel,
  specialSummonDuelCard,
  startDuel,
} from "#duel/core.js";
import { duelActivity } from "#duel/activity.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import { createLuaScriptHost } from "#lua/host.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel position changes", () => {
  it("sets a monster face-down and flip summons it later", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const monster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(monster).toBeTruthy();
    const setAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "setMonster" && candidate.uid === monster!.uid);
    expect(setAction).toBeTruthy();
    const setResult = applyAndAssert(session, setAction!);

    expect(setResult.ok).toBe(true);
    expect(setResult.state.cards.find((card) => card.uid === monster!.uid)?.position).toBe("faceDownDefense");
    expect(setResult.state.cards.find((card) => card.uid === monster!.uid)?.faceUp).toBe(false);
    expect(setResult.state.players[0].normalSummonAvailable).toBe(false);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "flipSummon" && candidate.uid === monster!.uid)).toBe(false);

    const endTurn = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "endTurn");
    expect(endTurn).toBeTruthy();
    applyAndAssert(session, endTurn!);
    const opponentEndTurn = getDuelLegalActions(session, 1).find((candidate) => candidate.type === "endTurn");
    expect(opponentEndTurn).toBeTruthy();
    applyAndAssert(session, opponentEndTurn!);
    const flipAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "flipSummon" && candidate.uid === monster!.uid);
    expect(flipAction).toBeTruthy();
    const flipResult = applyAndAssert(session, flipAction!);

    expect(flipResult.ok).toBe(true);
    expect(flipResult.state.cards.find((card) => card.uid === monster!.uid)?.position).toBe("faceUpAttack");
    expect(flipResult.state.cards.find((card) => card.uid === monster!.uid)?.faceUp).toBe(true);
    expect(flipResult.state.log.some((entry) => entry.action === "flipSummon" && entry.card === "Normal Test Monster")).toBe(true);
    const host = createLuaScriptHost(session);
    const luaResult = host.loadScript(
      `
      local c=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, 100), 0, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("flip summoned " .. tostring(c:IsFlipSummoned()) .. "/" .. tostring(c:IsSummonType(SUMMON_TYPE_FLIP)) .. "/" .. c:GetSummonType())
      `,
      "flip-summoned-predicate.lua",
    );
    expect(luaResult.ok, luaResult.error).toBe(true);
    expect(host.messages).toContain("flip summoned true/true/536870912");
  });

  it("collects flip summon trigger effects", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const monster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(monster).toBeTruthy();
    expect(triggerSource).toBeTruthy();
    moveDuelCard(session.state, monster!.uid, "monsterZone", 0).position = "faceDownDefense";
    session.state.cards.find((card) => card.uid === monster!.uid)!.faceUp = false;
    registerEffect(session, {
      id: "flip-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "flipSummoned",
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Flip summoned ${ctx.eventCard?.name}`);
      },
    });

    flipSummonDuelCard(session.state, 0, monster!.uid);

    const state = queryPublicState(session);
    expect(state.pendingTriggers).toHaveLength(1);
    expect(state.pendingTriggers[0]).toMatchObject({ eventName: "flipSummoned", eventCardUid: monster!.uid });
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.effectId === "flip-trigger");
    expect(trigger).toBeTruthy();
    const result = applyAndAssert(session, trigger!);

    expect(result.ok).toBe(true);
    expect(result.state.log.some((entry) => entry.detail === "Flip summoned Normal Test Monster")).toBe(true);
  });

  it("queues Lua flip summon success triggers after Flip Summons", () => {
    const session = createDuel({ seed: 2, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const monster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(monster).toBeTruthy();
    moveDuelCard(session.state, monster!.uid, "monsterZone", 0).position = "faceDownDefense";
    session.state.cards.find((card) => card.uid === monster!.uid)!.faceUp = false;

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_FLIP_SUMMON_SUCCESS)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          Debug.Message("lua flip summon success resolved " .. eg:GetFirst():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "lua-flip-summon-success-trigger.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    flipSummonDuelCard(session.state, 0, monster!.uid);

    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["flipSummoned"]);
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeTruthy();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("lua flip summon success resolved 100");
  });

  it("queues Lua monster set triggers after Sets", () => {
    const session = createDuel({ seed: 3, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const monster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(monster).toBeTruthy();

    const host = createLuaScriptHost(session);
    const loaded = host.loadScript(
      `
      c300={}
      function c300.initial_effect(c)
        local e=Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_TRIGGER_O)
        e:SetCode(EVENT_MSET)
        e:SetRange(LOCATION_HAND)
        e:SetOperation(function(e,tp,eg)
          Debug.Message("lua monster set resolved " .. eg:GetFirst():GetCode())
        end)
        c:RegisterEffect(e)
      end
      `,
      "lua-monster-set-trigger.lua",
    );
    expect(loaded.ok, loaded.error).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const setAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "setMonster" && candidate.uid === monster!.uid);
    expect(setAction).toBeTruthy();
    applyAndAssert(session, setAction!);

    expect(session.state.pendingTriggers.map((trigger) => trigger.eventName)).toEqual(["monsterSet"]);
    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger");
    expect(trigger).toBeTruthy();
    applyAndAssert(session, trigger!);
    expect(host.messages).toContain("lua monster set resolved 100");
  });

  it("blocks manual position changes for monsters summoned or set this turn", () => {
    const session = createDuel({ seed: 4, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const set = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(summoned).toBeTruthy();
    expect(set).toBeTruthy();
    specialSummonDuelCard(session.state, summoned!.uid, 0);
    moveDuelCard(session.state, set!.uid, "monsterZone", 0).position = "faceDownDefense";
    session.state.cards.find((card) => card.uid === set!.uid)!.faceUp = false;
    session.state.activityHistory.push({ player: 0, activity: duelActivity.normalSummon, cardUid: set!.uid });

    expect(canChangeDuelCardPosition(session.state, summoned!.uid, "faceUpDefense")).toBe(false);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "changePosition" && candidate.uid === summoned!.uid)).toBe(false);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "flipSummon" && candidate.uid === set!.uid)).toBe(false);
  });

  it("restores same-turn position and Flip Summon lockouts", () => {
    const session = createDuel({ seed: 5, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const set = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(summoned).toBeTruthy();
    expect(set).toBeTruthy();
    specialSummonDuelCard(session.state, summoned!.uid, 0);
    moveDuelCard(session.state, set!.uid, "monsterZone", 0).position = "faceDownDefense";
    session.state.cards.find((card) => card.uid === set!.uid)!.faceUp = false;
    session.state.activityHistory.push({ player: 0, activity: duelActivity.normalSummon, cardUid: set!.uid });

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));

    expect(restored.state.activityHistory).toEqual(session.state.activityHistory);
    expect(getDuelLegalActions(restored, 0).some((candidate) => candidate.type === "changePosition" && candidate.uid === summoned!.uid)).toBe(false);
    expect(getDuelLegalActions(restored, 0).some((candidate) => candidate.type === "flipSummon" && candidate.uid === set!.uid)).toBe(false);
  });

  it("reoffers restored position and Flip Summon legal actions after the turn cycles", () => {
    const session = createDuel({ seed: 6, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const summoned = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const set = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(summoned).toBeTruthy();
    expect(set).toBeTruthy();
    specialSummonDuelCard(session.state, summoned!.uid, 0);
    const setAction = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "setMonster" && candidate.uid === set!.uid);
    expect(setAction).toBeTruthy();
    applyAndAssert(session, setAction!);

    const restored = restoreDuel(serializeDuel(session), createCardReader(cards));
    applyAndAssert(restored, getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "endTurn")!);
    applyAndAssert(restored, getDuelLegalActions(restored, 1).find((candidate) => candidate.type === "endTurn")!);

    const changePosition = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "changePosition" && candidate.uid === summoned!.uid && candidate.position === "faceUpDefense");
    expect(changePosition).toBeTruthy();
    applyAndAssert(restored, changePosition!);
    expect(restored.state.cards.find((card) => card.uid === summoned!.uid)).toMatchObject({ position: "faceUpDefense", faceUp: true });

    const flipSummon = getDuelLegalActions(restored, 0).find((candidate) => candidate.type === "flipSummon" && candidate.uid === set!.uid);
    expect(flipSummon).toBeTruthy();
    applyAndAssert(restored, flipSummon!);
    expect(restored.state.cards.find((card) => card.uid === set!.uid)).toMatchObject({ position: "faceUpAttack", faceUp: true, summonType: "flip" });
  });

  it("changes monster battle position once per turn", () => {
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["400"] },
    });
    startDuel(session);

    const monster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(monster).toBeTruthy();
    moveDuelCard(session.state, monster!.uid, "monsterZone", 0).position = "faceUpAttack";
    session.state.cards.find((card) => card.uid === monster!.uid)!.faceUp = true;
    expect(canChangeDuelCardPosition(session.state, monster!.uid, "faceUpDefense")).toBe(true);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "changePosition" && candidate.uid === monster!.uid && candidate.position === "faceUpDefense");
    expect(action).toBeTruthy();
    const result = applyAndAssert(session, action!);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === monster!.uid)?.position).toBe("faceUpDefense");
    expect(result.state.positionsChanged).toContain(monster!.uid);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "changePosition" && candidate.uid === monster!.uid)).toBe(false);
    expect(restoreDuel(serializeDuel(session), createCardReader(cards)).state.positionsChanged).toContain(monster!.uid);
  });

  it("blocks manual and effect position changes for Link monsters", () => {
    const linkCards = [
      ...cards,
      { code: "900", name: "Link Position Probe", kind: "extra" as const, typeFlags: 0x4000001, level: 2, attack: 1500, defense: 0, linkMarkers: 0x5 },
    ];
    const session = createDuel({ seed: 6, startingHandSize: 0, cardReader: createCardReader(linkCards) });
    loadDecks(session, {
      0: { main: [], extra: ["900"] },
      1: { main: [] },
    });
    startDuel(session);

    const link = session.state.cards.find((card) => card.code === "900");
    expect(link).toBeTruthy();
    const moved = moveDuelCard(session.state, link!.uid, "monsterZone", 0);
    moved.position = "faceUpAttack";
    moved.faceUp = true;

    expect(canChangeDuelCardPosition(session.state, moved.uid, "faceUpDefense")).toBe(false);
    expect(canChangeDuelCardPosition(session.state, moved.uid, "faceUpDefense", "effect")).toBe(false);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "changePosition" && candidate.uid === moved.uid)).toBe(false);
    expect(() => changeDuelCardPosition(session.state, 0, moved.uid, "faceUpDefense", "effect")).toThrow("cannot change position");
  });

  it("collects position-change trigger effects", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100", "300"] },
      1: { main: ["400", "500"] },
    });
    startDuel(session);

    const monster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    const triggerSource = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "300");
    expect(monster).toBeTruthy();
    expect(triggerSource).toBeTruthy();
    moveDuelCard(session.state, monster!.uid, "monsterZone", 0).position = "faceUpAttack";
    session.state.cards.find((card) => card.uid === monster!.uid)!.faceUp = true;
    registerEffect(session, {
      id: "position-trigger",
      sourceUid: triggerSource!.uid,
      controller: 0,
      event: "trigger",
      triggerEvent: "positionChanged",
      range: ["hand"],
      operation(ctx) {
        ctx.log(`Position changed ${ctx.eventCard?.name}`);
      },
    });

    changeDuelCardPosition(session.state, 0, monster!.uid, "faceUpDefense");

    const state = queryPublicState(session);
    expect(state.pendingTriggers).toHaveLength(1);
    expect(state.pendingTriggers[0]).toMatchObject({ eventName: "positionChanged", eventCardUid: monster!.uid });

    const trigger = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateTrigger" && candidate.effectId === "position-trigger");
    expect(trigger).toBeTruthy();
    const result = applyAndAssert(session, trigger!);

    expect(result.ok).toBe(true);
    expect(result.state.log.some((entry) => entry.detail === "Position changed Normal Test Monster")).toBe(true);
  });
});

function applyAndAssert(session: ReturnType<typeof createDuel>, action: Parameters<typeof applyResponse>[1]) {
  const response = applyResponse(session, action);
  expect(response.ok).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
