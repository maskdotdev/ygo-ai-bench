import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createDuel,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  queryPublicState,
  registerEffect,
  startDuel,
  tributeSummonDuelCard,
} from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { duelReason } from "#duel/reasons.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel tribute summons", () => {
  it("tribute summons a level 5 or 6 monster with one tribute", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["600", "100", "300"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const tributeMonster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "600");
    const tribute = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(tributeMonster).toBeTruthy();
    expect(tribute).toBeTruthy();
    moveDuelCard(session.state, tribute!.uid, "monsterZone", 0);

    expect(getDuelLegalActions(session, 0).some((action) => action.type === "normalSummon" && action.uid === tributeMonster!.uid)).toBe(false);
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "tributeSummon" && candidate.uid === tributeMonster!.uid && candidate.tributeUids.includes(tribute!.uid));
    expect(action).toBeTruthy();
    const result = applyResponse(session, action!);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === tribute!.uid)?.location).toBe("graveyard");
    expect(result.state.cards.find((card) => card.uid === tributeMonster!.uid)?.location).toBe("monsterZone");
    expect(result.state.players[0].normalSummonAvailable).toBe(false);
    expect(result.state.log.some((entry) => entry.action === "release" && entry.card === "Normal Test Monster")).toBe(true);
    expect(result.state.log.some((entry) => entry.action === "tributeSummon" && entry.card === "One Tribute Monster")).toBe(true);
  });

  it("applies graveyard redirects to tribute summon releases", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["600", "100", "300"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const tributeMonster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "600");
    const tribute = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(tributeMonster).toBeTruthy();
    expect(tribute).toBeTruthy();
    moveDuelCard(session.state, tribute!.uid, "monsterZone", 0);

    registerEffect(session, {
      id: "tribute-grave-redirect",
      sourceUid: tribute!.uid,
      controller: 0,
      event: "continuous",
      code: 63,
      range: ["monsterZone"],
      operation() {},
    });

    tributeSummonDuelCard(session.state, 0, tributeMonster!.uid, [tribute!.uid]);

    const released = session.state.cards.find((card) => card.uid === tribute!.uid);
    expect(released?.location).toBe("banished");
    expect(released?.reason && (released.reason & duelReason.release)).toBe(duelReason.release);
    expect(released?.reason && (released.reason & duelReason.redirect)).toBe(duelReason.redirect);
    expect(session.state.cards.find((card) => card.uid === tributeMonster!.uid)?.location).toBe("monsterZone");
  });

  it("blocks tribute summons with unreleasable summon materials", () => {
    const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["600", "100", "300"] },
      1: { main: ["400", "400", "400"] },
    });
    startDuel(session);

    const tributeMonster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "600");
    const tribute = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(tributeMonster).toBeTruthy();
    expect(tribute).toBeTruthy();
    moveDuelCard(session.state, tribute!.uid, "monsterZone", 0);

    registerEffect(session, {
      id: "unreleasable-summon",
      sourceUid: tribute!.uid,
      controller: 0,
      event: "continuous",
      code: 43,
      range: ["monsterZone"],
      operation() {},
    });

    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "tributeSummon" && candidate.uid === tributeMonster!.uid)).toBe(false);
    expect(() => tributeSummonDuelCard(session.state, 0, tributeMonster!.uid, [tribute!.uid])).toThrow("cannot be released");
    expect(session.state.cards.find((card) => card.uid === tributeMonster!.uid)?.location).toBe("hand");
    expect(session.state.cards.find((card) => card.uid === tribute!.uid)?.location).toBe("monsterZone");
  });

  it("tribute summons a level 7 or higher monster with two tributes even from a full monster zone", () => {
    const session = createDuel({ seed: 1, startingHandSize: 6, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["700", "100", "300", "300", "300", "500"] },
      1: { main: ["400", "400", "400", "400", "400", "400"] },
    });
    startDuel(session);

    const tributeMonster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "700");
    const tributes = queryPublicState(session).cards.filter((card) => card.controller === 0 && card.location === "hand" && card.kind === "monster" && card.uid !== tributeMonster!.uid);
    expect(tributeMonster).toBeTruthy();
    expect(tributes).toHaveLength(5);
    for (const card of tributes) moveDuelCard(session.state, card.uid, "monsterZone", 0);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "tributeSummon" && candidate.uid === tributeMonster!.uid && candidate.tributeUids.length === 2);
    expect(action).toBeTruthy();
    expect(action?.type).toBe("tributeSummon");
    if (!action || action.type !== "tributeSummon") throw new Error("Expected tribute summon action");
    const result = applyResponse(session, action!);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === tributeMonster!.uid)?.location).toBe("monsterZone");
    expect(action.tributeUids.every((uid) => result.state.cards.find((card) => card.uid === uid)?.location === "graveyard")).toBe(true);
    expect(result.state.cards.filter((card) => card.controller === 0 && card.location === "monsterZone")).toHaveLength(4);
    expect(() => tributeSummonDuelCard(session.state, 0, tributeMonster!.uid, action.tributeUids)).toThrow("not in hand");
  });

  it("normal summons high-level monsters while no-tribute effects apply", () => {
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["700", "100"] },
      1: { main: ["400", "400"] },
    });
    startDuel(session);

    const tributeMonster = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "700");
    const source = queryPublicState(session).cards.find((card) => card.controller === 0 && card.location === "hand" && card.code === "100");
    expect(tributeMonster).toBeTruthy();
    expect(source).toBeTruthy();
    moveDuelCard(session.state, source!.uid, "monsterZone", 0);

    expect(getDuelLegalActions(session, 0).some((action) => action.type === "normalSummon" && action.uid === tributeMonster!.uid)).toBe(false);
    registerEffect(session, {
      id: "no-tribute-summon",
      sourceUid: source!.uid,
      controller: 0,
      event: "continuous",
      code: 160001029,
      property: 0x800,
      targetRange: [1, 0],
      range: ["monsterZone"],
      operation() {},
    });
    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "normalSummon" && candidate.uid === tributeMonster!.uid);
    expect(action).toBeTruthy();
    const result = applyResponse(session, action!);

    expect(result.ok).toBe(true);
    expect(result.state.cards.find((card) => card.uid === tributeMonster!.uid)?.location).toBe("monsterZone");
    expect(result.state.cards.find((card) => card.uid === source!.uid)?.location).toBe("monsterZone");
    expect(result.state.log.some((entry) => entry.action === "normalSummon" && entry.card === "Two Tribute Monster")).toBe(true);
  });
});
