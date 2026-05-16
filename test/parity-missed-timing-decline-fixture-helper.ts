import { expect } from "vitest";
import { createCardReader } from "#engine/data-loaders.js";
import { makeResponseSelector, makeScriptedStep, runScriptedDuelFixture } from "#engine/parity.js";
import type { DuelCardData, DuelEventName, ScriptedDuelFixture } from "#duel/types.js";
import { absentTriggerActivationGroup, absentWindowEffectGroup, openEffectGroup, triggerActivationGroup, triggerDeclineGroup } from "./parity-legal-action-group-helpers.js";

type MissedTimingDeclineFixtureOptions = {
  eventName: DuelEventName;
  kebabName: string;
  titleName: string;
  seed: number;
};

export function expectMissedTimingDeclineFixture({ eventName, kebabName, titleName, seed }: MissedTimingDeclineFixtureOptions): void {
  const cards: DuelCardData[] = [
    { code: "100", name: `${titleName} Boundary Starter`, kind: "monster", attack: 1800, defense: 1200 },
    { code: "400", name: `${titleName} Optional When`, kind: "monster", attack: 1500, defense: 1600 },
    { code: "500", name: `${titleName} Optional If`, kind: "monster", attack: 1200, defense: 1200 },
    { code: "800", name: `${titleName} Open Quick`, kind: "monster", attack: 500, defense: 500 },
    { code: "700", name: `${titleName} Boundary Filler`, kind: "monster", attack: 1000, defense: 1000 },
  ];
  const fixture: ScriptedDuelFixture = {
    name: `${kebabName} missed timing decline fixture`,
    options: { seed, startingHandSize: 5 },
    decks: {
      0: { main: ["100", "400", "500", "800", "700"] },
      1: { main: ["700", "700", "700", "700", "700"] },
    },
    setup: {
      moveCards: [{ player: 0, code: "700", from: "hand", to: "monsterZone", position: "faceUpAttack" }],
      effects: [
        {
          id: `${kebabName}-decline-multistep`,
          player: 0,
          code: "100",
          location: "hand",
          event: "ignition",
          range: ["hand"],
          collectEventsOnResolve: [{ collectEvent: eventName, eventIsLast: false }],
          moveCardsOnResolve: [{ player: 0, code: "700", from: "monsterZone", to: "graveyard" }],
          logMessage: `${titleName} decline multi step resolved`,
        },
        {
          id: `${kebabName}-decline-optional-when`,
          player: 0,
          code: "400",
          location: "hand",
          event: "trigger",
          triggerEvent: eventName,
          triggerTiming: "when",
          range: ["hand"],
          logMessage: `${titleName} decline optional when should not resolve`,
        },
        {
          id: `${kebabName}-decline-optional-if`,
          player: 0,
          code: "500",
          location: "hand",
          event: "trigger",
          triggerEvent: eventName,
          triggerTiming: "if",
          range: ["hand"],
          logMessage: `${titleName} decline optional if should not resolve`,
        },
        {
          id: `${kebabName}-decline-open-fast`,
          player: 0,
          code: "800",
          location: "hand",
          event: "quick",
          range: ["hand"],
          activationChain: "open",
          logMessage: `${titleName} decline open fast resolved`,
        },
      ],
    },
    responses: [
      makeScriptedStep(makeResponseSelector("activateEffect", 0, { effectId: `${kebabName}-decline-multistep` }), {
        snapshotRestore: "both",
        before: {
          source: "edopro",
          note: `EDOPro keeps the initial ${kebabName} effect window restorable before optional missed-timing filtering`,
          windowId: 0,
          windowKind: "open",
          waitingFor: 0,
          pendingTriggers: [],
          pendingTriggerBuckets: [],
          legalActions: [
            { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: `${kebabName}-decline-open-fast`, count: 1 },
            { type: "activateEffect", player: 0, windowId: 0, windowKind: "open", effectId: `${kebabName}-decline-multistep`, count: 1 },
          ],
          legalActionGroups: [openEffectGroup(0, `${kebabName}-decline-open-fast`, 1, 0)],
          legalActionCounts: { 0: 13, 1: 0 },
          legalActionGroupCounts: { 0: 4, 1: 0 },
          absentLegalActions: [
            { type: "activateTrigger", player: 0, windowId: 0, windowKind: "open", effectId: `${kebabName}-decline-optional-when` },
            { type: "activateTrigger", player: 0, windowId: 0, windowKind: "open", effectId: `${kebabName}-decline-optional-if` },
          ],
          absentLegalActionGroups: [
            absentTriggerActivationGroup(0, `${kebabName}-decline-optional-when`, "turnOptional", 0, "open"),
            absentTriggerActivationGroup(0, `${kebabName}-decline-optional-if`, "turnOptional", 0, "open"),
          ],
        },
        after: {
          source: "edopro",
          note: `EDOPro keeps optional if ${kebabName} triggers available while optional when ${kebabName} triggers miss timing`,
          windowId: 1,
          windowKind: "triggerBucket",
          waitingFor: 0,
          pendingTriggers: [{ player: 0, effectId: `${kebabName}-decline-optional-if`, eventName, eventTriggerTiming: "if" }],
          pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
          legalActions: [
            { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: `${kebabName}-decline-optional-if`, triggerBucket: "turnOptional", count: 1 },
            { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: `${kebabName}-decline-optional-if`, triggerBucket: "turnOptional", count: 1 },
          ],
          legalActionGroups: [
            triggerActivationGroup(0, `${kebabName}-decline-optional-if`, "turnOptional", 1, 1),
            triggerDeclineGroup(0, `${kebabName}-decline-optional-if`, "turnOptional", 1, 1),
          ],
          absentLegalActions: [
            { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: `${kebabName}-decline-optional-when` },
            { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: `${kebabName}-decline-open-fast` },
          ],
          absentLegalActionGroups: [
            absentTriggerActivationGroup(0, `${kebabName}-decline-optional-when`, "turnOptional", 1, "triggerBucket"),
            absentWindowEffectGroup(0, `${kebabName}-decline-open-fast`, 1, "triggerBucket"),
          ],
          logIncludes: [`${titleName} decline multi step resolved`],
          legalActionCounts: { 0: 2, 1: 0 },
          legalActionGroupCounts: { 0: 2, 1: 0 },
        },
      }),
      makeScriptedStep(makeResponseSelector("declineTrigger", 0, { effectId: `${kebabName}-decline-optional-if` }), {
        snapshotRestore: "both",
        before: {
          source: "edopro",
          note: `EDOPro keeps the surviving optional if ${kebabName} trigger decline restorable while optional when remains missed`,
          windowId: 1,
          windowKind: "triggerBucket",
          waitingFor: 0,
          pendingTriggers: [{ player: 0, effectId: `${kebabName}-decline-optional-if`, eventName, eventTriggerTiming: "if" }],
          pendingTriggerBuckets: [{ player: 0, triggerBucket: "turnOptional" }],
          legalActions: [
            { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: `${kebabName}-decline-optional-if`, triggerBucket: "turnOptional", count: 1 },
            { type: "declineTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: `${kebabName}-decline-optional-if`, triggerBucket: "turnOptional", count: 1 },
          ],
          legalActionGroups: [
            triggerActivationGroup(0, `${kebabName}-decline-optional-if`, "turnOptional", 1, 1),
            triggerDeclineGroup(0, `${kebabName}-decline-optional-if`, "turnOptional", 1, 1),
          ],
          absentLegalActions: [
            { type: "activateTrigger", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: `${kebabName}-decline-optional-when` },
            { type: "activateEffect", player: 0, windowId: 1, windowKind: "triggerBucket", effectId: `${kebabName}-decline-open-fast` },
          ],
          absentLegalActionGroups: [
            absentTriggerActivationGroup(0, `${kebabName}-decline-optional-when`, "turnOptional", 1, "triggerBucket"),
            absentWindowEffectGroup(0, `${kebabName}-decline-open-fast`, 1, "triggerBucket"),
          ],
          legalActionCounts: { 0: 2, 1: 0 },
          legalActionGroupCounts: { 0: 2, 1: 0 },
        },
        after: {
          source: "edopro",
          note: `EDOPro exposes open fast effects after declining the surviving optional if ${kebabName} trigger`,
          windowId: 2,
          windowKind: "open",
          waitingFor: 0,
          pendingTriggers: [],
          pendingTriggerBuckets: [],
          chain: [],
          chainPasses: [],
          legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: `${kebabName}-decline-open-fast`, count: 1 }],
          legalActionGroups: [openEffectGroup(0, `${kebabName}-decline-open-fast`, 1, 2)],
          absentLegalActions: [
            { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: `${kebabName}-decline-optional-when` },
            { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: `${kebabName}-decline-optional-if` },
          ],
          absentLegalActionGroups: [
            absentTriggerActivationGroup(0, `${kebabName}-decline-optional-when`, "turnOptional", 2, "open"),
            absentTriggerActivationGroup(0, `${kebabName}-decline-optional-if`, "turnOptional", 2, "open"),
          ],
          logIncludes: [`${titleName} decline multi step resolved`, `${kebabName}-decline-optional-if`],
          legalActionCounts: { 0: 12, 1: 0 },
          legalActionGroupCounts: { 0: 3, 1: 0 },
        },
      }),
    ],
    expected: {
      source: "edopro",
      note: `EDOPro final state exposes open fast effects after declining the ${kebabName} optional if trigger while optional when remains missed`,
      windowId: 2,
      windowKind: "open",
      waitingFor: 0,
      pendingTriggers: [],
      pendingTriggerBuckets: [],
      chain: [],
      chainPasses: [],
      legalActions: [{ type: "activateEffect", player: 0, windowId: 2, windowKind: "open", effectId: `${kebabName}-decline-open-fast`, count: 1 }],
      legalActionGroups: [openEffectGroup(0, `${kebabName}-decline-open-fast`, 1, 2)],
      absentLegalActions: [
        { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: `${kebabName}-decline-optional-when` },
        { type: "activateTrigger", player: 0, windowId: 2, windowKind: "open", effectId: `${kebabName}-decline-optional-if` },
      ],
      absentLegalActionGroups: [
        absentTriggerActivationGroup(0, `${kebabName}-decline-optional-when`, "turnOptional", 2, "open"),
        absentTriggerActivationGroup(0, `${kebabName}-decline-optional-if`, "turnOptional", 2, "open"),
      ],
      logIncludes: [`${titleName} decline multi step resolved`, `${kebabName}-decline-optional-if`],
      legalActionCounts: { 0: 12, 1: 0 },
      legalActionGroupCounts: { 0: 3, 1: 0 },
    },
  };

  expect(runScriptedDuelFixture(fixture, { cardReader: createCardReader(cards) })).toEqual({ ok: true, failures: [] });
}
