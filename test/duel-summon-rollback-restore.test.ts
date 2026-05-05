import { describe, expect, it } from "vitest";
import {
  applyResponse,
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  queryPublicState,
  registerEffect,
  restoreDuel,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import type { DuelAction, DuelLocation } from "#duel/types.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards, findPublicCard } from "./full-duel-engine-fixtures.js";

function expectOpenWindowActions(actions: DuelAction[], windowId: number): void {
  for (const action of actions) expect(action).toMatchObject({ windowId, windowKind: "open" });
}

function expectOpenWindowGroups(groups: ReturnType<typeof getGroupedDuelLegalActions>, windowId: number): void {
  for (const group of groups) expect(group).toMatchObject({ windowId, windowKind: "open" });
}

type RestoredFailedMoveCase = {
  name: string;
  seed: number;
  main: string[];
  extra?: string[];
  target: { location: DuelLocation; code: string };
  first: { location: DuelLocation; code: string; moveTo?: DuelLocation };
  blocked: { location: DuelLocation; code: string; moveTo?: DuelLocation };
  block: {
    id: string;
    code: number;
    range: DuelLocation[];
    firstMovedTo: DuelLocation;
    error: string;
  };
  actionType: Extract<DuelAction["type"], "synchroSummon" | "xyzSummon" | "linkSummon" | "ritualSummon" | "tributeSummon">;
  logAction: string;
};

function setupRestoredFailedMoveCase(testCase: RestoredFailedMoveCase) {
  const original = createDuel({ seed: testCase.seed, startingHandSize: testCase.main.length, cardReader: createCardReader(cards) });
  loadDecks(original, {
    0: { main: testCase.main, ...(testCase.extra ? { extra: testCase.extra } : {}) },
    1: { main: testCase.main.map(() => "400") },
  });
  startDuel(original);

  const session = restoreDuel(serializeDuel(original), createCardReader(cards));
  const target = findPublicCard(session, 0, testCase.target.location, testCase.target.code);
  const first = findPublicCard(session, 0, testCase.first.location, testCase.first.code);
  const blocked = findPublicCard(session, 0, testCase.blocked.location, testCase.blocked.code);
  expect(target).toBeTruthy();
  expect(first).toBeTruthy();
  expect(blocked).toBeTruthy();
  if (first && testCase.first.moveTo) moveDuelCard(session.state, first.uid, testCase.first.moveTo, 0);
  if (blocked && testCase.blocked.moveTo) moveDuelCard(session.state, blocked.uid, testCase.blocked.moveTo, 0);

  registerEffect(session, {
    id: testCase.block.id,
    sourceUid: blocked?.uid ?? "missing-blocked-card",
    controller: 0,
    event: "continuous",
    code: testCase.block.code,
    range: testCase.block.range,
    canActivate(ctx) {
      return ctx.duel.cards.find((card) => card.uid === first?.uid)?.location === testCase.block.firstMovedTo;
    },
    operation() {},
  });

  return { session, target: target!, first: first!, blocked: blocked! };
}

const restoredFailedMoveCases: RestoredFailedMoveCase[] = [
  {
    name: "synchro summon material moves",
    seed: 137,
    main: ["100", "300"],
    extra: ["910"],
    target: { location: "extraDeck", code: "910" },
    first: { location: "hand", code: "100", moveTo: "monsterZone" },
    blocked: { location: "hand", code: "300", moveTo: "monsterZone" },
    block: { id: "restored-cannot-send-second-synchro-material", code: 68, range: ["monsterZone"], firstMovedTo: "graveyard", error: "cannot move to graveyard" },
    actionType: "synchroSummon",
    logAction: "synchroMaterial",
  },
  {
    name: "Xyz summon overlay moves",
    seed: 138,
    main: ["100", "300"],
    extra: ["920"],
    target: { location: "extraDeck", code: "920" },
    first: { location: "hand", code: "100", moveTo: "monsterZone" },
    blocked: { location: "hand", code: "300", moveTo: "monsterZone" },
    block: { id: "restored-cannot-overlay-second-material", code: 238, range: ["monsterZone"], firstMovedTo: "overlay", error: "cannot be used as Xyz material" },
    actionType: "xyzSummon",
    logAction: "xyzMaterial",
  },
  {
    name: "Link summon material moves",
    seed: 139,
    main: ["100", "300"],
    extra: ["930"],
    target: { location: "extraDeck", code: "930" },
    first: { location: "hand", code: "100", moveTo: "monsterZone" },
    blocked: { location: "hand", code: "300", moveTo: "monsterZone" },
    block: { id: "restored-cannot-send-second-link-material", code: 68, range: ["monsterZone"], firstMovedTo: "graveyard", error: "cannot move to graveyard" },
    actionType: "linkSummon",
    logAction: "linkMaterial",
  },
  {
    name: "Ritual summon material moves",
    seed: 140,
    main: ["940", "100", "300"],
    target: { location: "hand", code: "940" },
    first: { location: "hand", code: "100" },
    blocked: { location: "hand", code: "300" },
    block: { id: "restored-cannot-send-second-ritual-material", code: 68, range: ["hand"], firstMovedTo: "graveyard", error: "cannot move to graveyard" },
    actionType: "ritualSummon",
    logAction: "ritualMaterial",
  },
  {
    name: "Tribute summon release moves",
    seed: 141,
    main: ["700", "100", "300"],
    target: { location: "hand", code: "700" },
    first: { location: "hand", code: "100", moveTo: "monsterZone" },
    blocked: { location: "hand", code: "300", moveTo: "monsterZone" },
    block: { id: "restored-cannot-send-second-tribute", code: 68, range: ["monsterZone"], firstMovedTo: "graveyard", error: "cannot move to graveyard" },
    actionType: "tributeSummon",
    logAction: "release",
  },
];

describe("duel summon rollback after restore", () => {
  for (const testCase of restoredFailedMoveCases) {
    it(`rolls back failed ${testCase.name} after restoring a snapshot`, () => {
      const { session, target, first, blocked } = setupRestoredFailedMoveCase(testCase);
      const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === testCase.actionType && candidate.uid === target.uid);
      expect(action).toBeTruthy();
      const restoredWindowId = queryPublicState(session).actionWindowId;
      expect(action).toMatchObject({ windowId: restoredWindowId, windowKind: "open" });

      const result = applyResponse(session, action!);

      expect(result.ok).toBe(false);
      expect(result.error).toContain(testCase.block.error);
      expect(session.state.actionWindowId).toBe(restoredWindowId);
      expect(result.state.actionWindowId).toBe(restoredWindowId);
      expect(result.state.windowKind).toBe("open");
      expectOpenWindowActions(result.legalActions, restoredWindowId);
      expectOpenWindowGroups(result.legalActionGroups, restoredWindowId);
      expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, 0));
      expect(session.state.cards.find((card) => card.uid === target.uid)?.location).toBe(testCase.target.location);
      expect(session.state.cards.find((card) => card.uid === first.uid)?.location).toBe(testCase.first.moveTo ?? testCase.first.location);
      expect(session.state.cards.find((card) => card.uid === blocked.uid)?.location).toBe(testCase.blocked.moveTo ?? testCase.blocked.location);
      expect(session.state.cards.find((card) => card.uid === target.uid)?.overlayUids).toEqual([]);
      expect(session.state.pendingTriggers).toHaveLength(0);
      expect(session.state.log.some((entry) => entry.action === testCase.logAction)).toBe(false);
    });
  }
});
