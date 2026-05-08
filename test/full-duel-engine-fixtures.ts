import {
  createDuel,
  loadDecks,
  queryPublicState,
  registerEffect,
  startDuel,
} from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData, DuelLocation, DuelSession, PlayerId } from "#duel/types.js";

export const cards: DuelCardData[] = [
  { code: "100", name: "Normal Test Monster", kind: "monster", typeFlags: 0x1001, attack: 1800, defense: 1200 },
  { code: "110", name: "Level Three Tuner", kind: "monster", typeFlags: 0x1001, level: 3, attack: 1200, defense: 800 },
  { code: "200", name: "Test Spell", kind: "spell" },
  { code: "300", name: "Second Monster", kind: "monster", attack: 1000, defense: 1000 },
  { code: "310", name: "Level Four Non-Tuner", kind: "monster", typeFlags: 0x1, level: 4, attack: 1600, defense: 1000 },
  { code: "320", name: "Level Three Non-Tuner", kind: "monster", typeFlags: 0x1, level: 3, attack: 1300, defense: 900 },
  { code: "330", name: "Second Level Four Non-Tuner", kind: "monster", typeFlags: 0x1, level: 4, attack: 1400, defense: 1100 },
  { code: "340", name: "Level One Non-Tuner", kind: "monster", typeFlags: 0x1, level: 1, attack: 500, defense: 500 },
  { code: "350", name: "Pendulum Test Monster", kind: "monster", typeFlags: 0x1000001, level: 4, attack: 1500, defense: 1500 },
  { code: "400", name: "Opponent Monster", kind: "monster", attack: 1500, defense: 1600 },
  { code: "500", name: "Third Monster", kind: "monster", attack: 2400, defense: 2000 },
  { code: "600", name: "One Tribute Monster", kind: "monster", level: 6, attack: 2300, defense: 1800 },
  { code: "700", name: "Two Tribute Monster", kind: "monster", level: 7, attack: 2600, defense: 2100 },
  { code: "900", name: "Fusion Test Monster", kind: "extra", attack: 2800, defense: 2200, fusionMaterials: ["100", "300"] },
  { code: "910", name: "Synchro Test Monster", kind: "extra", attack: 2500, defense: 2000, synchroMaterials: { tuner: "100", nonTuners: ["300"] } },
  { code: "920", name: "Xyz Test Monster", kind: "extra", attack: 2400, defense: 2000, xyzMaterials: ["100", "300"] },
  { code: "930", name: "Link Test Monster", kind: "extra", attack: 2300, linkMaterials: ["100", "300"] },
  { code: "950", name: "Generic Link-2", kind: "extra", attack: 1800, typeFlags: 0x4000001, level: 2 },
  { code: "960", name: "Generic Link-3", kind: "extra", attack: 2400, typeFlags: 0x4000001, level: 3 },
  { code: "970", name: "Generic Level 7 Synchro", kind: "extra", attack: 2600, defense: 2100, typeFlags: 0x2001, level: 7 },
  { code: "980", name: "Generic Rank 4 Xyz", kind: "extra", attack: 2200, defense: 1800, typeFlags: 0x800001, level: 4 },
  { code: "940", name: "Ritual Test Monster", kind: "monster", attack: 2500, defense: 2100, ritualMaterials: ["100", "300"] },
];

export function findPublicCard(session: DuelSession, player: PlayerId, location: DuelLocation, code: string) {
  return queryPublicState(session).cards.find((card) => card.controller === player && card.location === location && card.code === code);
}

export interface FailedMoveAfterFirstFixtureOptions {
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
  };
}

export function setupFailedMoveAfterFirstFixture(options: FailedMoveAfterFirstFixtureOptions) {
  const session = createDuel({ seed: options.seed, startingHandSize: options.main.length, cardReader: createCardReader(cards) });
  loadDecks(session, {
    0: { main: options.main, ...(options.extra ? { extra: options.extra } : {}) },
    1: { main: options.main.map(() => "400") },
  });
  startDuel(session);

  const target = findPublicCard(session, 0, options.target.location, options.target.code);
  const first = findPublicCard(session, 0, options.first.location, options.first.code);
  const blocked = findPublicCard(session, 0, options.blocked.location, options.blocked.code);
  if (first && options.first.moveTo) moveDuelCard(session.state, first.uid, options.first.moveTo, 0);
  if (blocked && options.blocked.moveTo) moveDuelCard(session.state, blocked.uid, options.blocked.moveTo, 0);

  registerEffect(session, {
    id: options.block.id,
    sourceUid: blocked?.uid ?? "missing-blocked-card",
    controller: 0,
    event: "continuous",
    code: options.block.code,
    range: options.block.range,
    canActivate(ctx) {
      return ctx.duel.cards.find((card) => card.uid === first?.uid)?.location === options.block.firstMovedTo;
    },
    operation() {},
  });

  return { session, target, first, blocked };
}
