import { expect } from "vitest";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, queryPublicState, registerEffect, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelSession, PlayerId, PublicDuelCard } from "#duel/types.js";
import { cards } from "./full-duel-engine-fixtures.js";

interface TriggerBucketFixture {
  session: DuelSession;
  summoned: PublicDuelCard;
  turnFirst: PublicDuelCard;
  turnSecond: PublicDuelCard;
  opponent: PublicDuelCard;
}

interface TriggerCountFixture {
  session: DuelSession;
  firstSummon: PublicDuelCard;
  triggerSource: PublicDuelCard;
  secondSummon: PublicDuelCard;
}

export function setupTriggerBucketFixture(): TriggerBucketFixture {
  const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
  loadDecks(session, {
    0: { main: ["100", "300", "500"] },
    1: { main: ["400", "500", "300"] },
  });
  startDuel(session);

  const summoned = findPublicCard(session, 0, "100");
  const turnFirst = findPublicCard(session, 0, "300");
  const turnSecond = findPublicCard(session, 0, "500");
  const opponent = findPublicCard(session, 1, "400");
  expect(summoned).toBeTruthy();
  expect(turnFirst).toBeTruthy();
  expect(turnSecond).toBeTruthy();
  expect(opponent).toBeTruthy();

  return { session, summoned: summoned!, turnFirst: turnFirst!, turnSecond: turnSecond!, opponent: opponent! };
}

export function setupTriggerCountFixture(): TriggerCountFixture {
  const session = createDuel({ seed: 1, startingHandSize: 3, cardReader: createCardReader(cards) });
  loadDecks(session, {
    0: { main: ["100", "300", "500"] },
    1: { main: ["400", "400", "400"] },
  });
  startDuel(session);

  const firstSummon = findPublicCard(session, 0, "100");
  const triggerSource = findPublicCard(session, 0, "300");
  const secondSummon = findPublicCard(session, 0, "500");
  expect(firstSummon).toBeTruthy();
  expect(triggerSource).toBeTruthy();
  expect(secondSummon).toBeTruthy();

  return { session, firstSummon: firstSummon!, triggerSource: triggerSource!, secondSummon: secondSummon! };
}

export function activateTriggerByEffect(session: DuelSession, effectId: string): void {
  const trigger = getDuelLegalActions(session, 0).find((action) => action.type === "activateTrigger" && action.effectId === effectId);
  expect(trigger).toBeTruthy();
  expect(applyResponse(session, trigger!).ok).toBe(true);
}

export function registerBucketTrigger(session: DuelSession, id: string, source: Pick<PublicDuelCard, "uid">, controller: PlayerId, optional = true): void {
  registerEffect(session, {
    id,
    sourceUid: source.uid,
    controller,
    event: "trigger",
    triggerEvent: "normalSummoned",
    ...(optional ? {} : { optional: false }),
    range: ["hand"],
    operation(ctx) {
      ctx.log(`${id} resolved`);
    },
  });
}

function findPublicCard(session: DuelSession, controller: PlayerId, code: string) {
  return queryPublicState(session).cards.find((card) => card.controller === controller && card.location === "hand" && card.code === code);
}
