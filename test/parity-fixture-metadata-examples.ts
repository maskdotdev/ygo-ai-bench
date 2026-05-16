import { expect } from "vitest";

type FixtureLinesCheck = (file: string, lines: string[]) => string[];
type FixtureTextCheck = (file: string, text: string) => string[];

export interface FixtureMetadataScannerExampleChecks {
  backlogNotesWithoutEdoproInLines: FixtureLinesCheck;
  edoproNotesWithoutEdoproInLines: FixtureLinesCheck;
  invalidSourcesInLines: FixtureLinesCheck;
  mismatchedBattleWindowStepsInLines: FixtureLinesCheck;
  mismatchedBattleWindowWaitingPlayersInLines: FixtureLinesCheck;
  missingAbsentAttackGroupRawCountsInLines: FixtureLinesCheck;
  missingAnyLegalActionGroupsInLines: FixtureLinesCheck;
  missingAttackGroupRawCountsInLines: FixtureLinesCheck;
  missingBacklogNotesInLines: FixtureLinesCheck;
  missingBattleWindowCoverageInLines: FixtureLinesCheck;
  missingChainEventTimingsInText: FixtureTextCheck;
  missingDirectAttackRawCoverageInLines: FixtureLinesCheck;
  missingExpectationNotesInLines: FixtureLinesCheck;
  missingLegalActionCountsInLines: FixtureLinesCheck;
  missingLegalActionGroupWindowKindsInLines: FixtureLinesCheck;
  missingNestedLegalActionGroupWindowIdsInLines: FixtureLinesCheck;
  missingNestedLegalActionGroupWindowKindsInLines: FixtureLinesCheck;
  missingOpenLegalActionGroupWindowIdsInLines: FixtureLinesCheck;
  missingOpenLegalActionWindowIdsInLines: FixtureLinesCheck;
  missingPendingTriggerBucketCoverageInLines: FixtureLinesCheck;
  missingPendingTriggerEventTimingsInText: FixtureTextCheck;
  missingSourcesInLines: FixtureLinesCheck;
  missingTargetedAttackRawCoverageInLines: FixtureLinesCheck;
  missingTimingExpectationWindowIdsInLines: FixtureLinesCheck;
  missingTimingLegalActionGroupWindowIdsInLines: FixtureLinesCheck;
  missingTimingLegalActionWindowIdsInLines: FixtureLinesCheck;
  missingTimingLegalActionWindowKindsInLines: FixtureLinesCheck;
  missingTriggerEffectTimingsInText: FixtureTextCheck;
  missingTriggerGroupBucketCoverageInLines: FixtureLinesCheck;
  missingTriggerOrderPromptCoverageInLines: FixtureLinesCheck;
  parityFixtureScenarioCountProblem: FixtureLinesCheck;
  parityFixtureWithoutSnapshotRestoreInLines: FixtureLinesCheck;
}

export function assertFixtureMetadataScannerExamples(checks: FixtureMetadataScannerExampleChecks): void {
  const {
    backlogNotesWithoutEdoproInLines,
    edoproNotesWithoutEdoproInLines,
    invalidSourcesInLines,
    mismatchedBattleWindowStepsInLines,
    mismatchedBattleWindowWaitingPlayersInLines,
    missingAbsentAttackGroupRawCountsInLines,
    missingAnyLegalActionGroupsInLines,
    missingAttackGroupRawCountsInLines,
    missingBacklogNotesInLines,
    missingBattleWindowCoverageInLines,
    missingChainEventTimingsInText,
    missingDirectAttackRawCoverageInLines,
    missingExpectationNotesInLines,
    missingLegalActionCountsInLines,
    missingLegalActionGroupWindowKindsInLines,
    missingNestedLegalActionGroupWindowIdsInLines,
    missingNestedLegalActionGroupWindowKindsInLines,
    missingOpenLegalActionGroupWindowIdsInLines,
    missingOpenLegalActionWindowIdsInLines,
    missingPendingTriggerBucketCoverageInLines,
    missingPendingTriggerEventTimingsInText,
    missingSourcesInLines,
    missingTargetedAttackRawCoverageInLines,
    missingTimingExpectationWindowIdsInLines,
    missingTimingLegalActionGroupWindowIdsInLines,
    missingTimingLegalActionWindowIdsInLines,
    missingTimingLegalActionWindowKindsInLines,
    missingTriggerEffectTimingsInText,
    missingTriggerGroupBucketCoverageInLines,
    missingTriggerOrderPromptCoverageInLines,
    parityFixtureScenarioCountProblem,
    parityFixtureWithoutSnapshotRestoreInLines,
  } = checks;
  const lines = [
    "runScriptedDuelFixture({",
    "after: {",
    "  waitingFor: 0,",
    "  legalActions: [],",
    "},",
    "expected: {",
    '  source: "parity-backlog",',
    "  waitingFor: 0,",
    "},",
  ];

  expect(missingSourcesInLines("fixture.ts", lines)).toEqual(["fixture.ts:2"]);
  expect(invalidSourcesInLines("fixture.ts", [...lines.slice(0, 3), '  source: "local",', ...lines.slice(3)])).toEqual(["fixture.ts:2"]);
  expect(invalidSourcesInLines("fixture.ts", [...lines.slice(0, 3), "  source: 'local',", ...lines.slice(3)])).toEqual(["fixture.ts:2"]);
  expect(missingBacklogNotesInLines("fixture.ts", lines)).toEqual(["fixture.ts:7"]);
  expect(missingExpectationNotesInLines("fixture.ts", [...lines.slice(0, 3), '  source: "edopro",', ...lines.slice(3, 5)])).toEqual(["fixture.ts:2"]);
  expect(edoproNotesWithoutEdoproInLines("fixture.ts", [...lines.slice(0, 3), '  source: "edopro",', ...lines.slice(3, 4), '  note: "local behavior"', ...lines.slice(4)])).toEqual([
    "fixture.ts:2",
  ]);
  expect(edoproNotesWithoutEdoproInLines("fixture.ts", [...lines.slice(0, 3), "  source: 'edopro',", ...lines.slice(3, 4), '  note: "EDOPro observed behavior"', ...lines.slice(4)])).toEqual([]);
  expect(backlogNotesWithoutEdoproInLines("fixture.ts", [...lines.slice(0, 7), '  note: "temporary local behavior",', ...lines.slice(7)])).toEqual(["fixture.ts:7"]);
  expect(backlogNotesWithoutEdoproInLines("fixture.ts", [...lines.slice(0, 6), "  source: 'parity-backlog',", '  note: "temporary local behavior",', ...lines.slice(8)])).toEqual(["fixture.ts:7"]);
  expect(missingAnyLegalActionGroupsInLines("fixture.ts", lines)).toEqual(["fixture.ts:2"]);
  expect(
    missingDirectAttackRawCoverageInLines("fixture.ts", [
      ...lines.slice(0, 4),
      '  legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-card", windowId: 1, windowKind: "open", count: 1 }],',
      '  legalActionGroups: [directAttackGroup(0, "p0-card", 1, 1)],',
      ...lines.slice(4),
    ]),
  ).toEqual(["fixture.ts:2"]);
  expect(
    missingDirectAttackRawCoverageInLines("fixture.ts", [
      ...lines.slice(0, 4),
      '  legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-card", directAttack: true, windowId: 1, windowKind: "open", count: 1 }],',
      '  legalActionGroups: [directAttackGroup(0, "p0-card", 1, 1)],',
      ...lines.slice(4),
    ]),
  ).toEqual([]);
  expect(
    missingTargetedAttackRawCoverageInLines("fixture.ts", [
      ...lines.slice(0, 4),
      '  legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-card", windowId: 1, windowKind: "open", count: 1 }],',
      '  legalActionGroups: [targetedAttackGroup(0, "p0-card", "p1-card", 1, 1)],',
      ...lines.slice(4),
    ]),
  ).toEqual(["fixture.ts:2"]);
  expect(
    missingTargetedAttackRawCoverageInLines("fixture.ts", [
      ...lines.slice(0, 4),
      '  legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-card", targetUid: "p1-card", windowId: 1, windowKind: "open", count: 1 }],',
      '  legalActionGroups: [targetedAttackGroup(0, "p0-card", "p1-card", 1, 1)],',
      ...lines.slice(4),
    ]),
  ).toEqual([]);
  expect(
    missingAttackGroupRawCountsInLines("fixture.ts", [
      ...lines.slice(0, 4),
      '  legalActions: [{ type: "declareAttack", player: 0, attackerUid: "p0-card", targetUid: "p1-card", windowId: 1, windowKind: "open", count: 1 }],',
      '  legalActionGroups: [attackGroup([{ attackerUid: "p0-card", targetUid: "p1-card" }, { attackerUid: "p0-card", directAttack: true }], 1, 1)],',
      ...lines.slice(4),
    ]),
  ).toEqual(["fixture.ts:2"]);
  expect(
    missingAttackGroupRawCountsInLines("fixture.ts", [
      ...lines.slice(0, 4),
      "  legalActions: [",
      '    { type: "declareAttack", player: 0, attackerUid: "p0-card", targetUid: "p1-card", windowId: 1, windowKind: "open", count: 1 },',
      '    { type: "declareAttack", player: 0, attackerUid: "p0-card", directAttack: true, windowId: 1, windowKind: "open", count: 1 },',
      "  ],",
      '  legalActionGroups: [attackGroup([{ attackerUid: "p0-card", targetUid: "p1-card" }, { attackerUid: "p0-card", directAttack: true }], 1, 1)],',
      ...lines.slice(4),
    ]),
  ).toEqual([]);
  expect(
    missingAbsentAttackGroupRawCountsInLines("fixture.ts", [
      ...lines.slice(0, 4),
      '  absentLegalActions: [{ type: "replayAttack", player: 0, attackerUid: "p0-card", windowId: 1, windowKind: "battle" }],',
      '  absentLegalActionGroups: [absentAttackGroup("p0-card", undefined, undefined, 1), absentOpenAttackGroup(0, "p1-card", 1)],',
      ...lines.slice(4),
    ]),
  ).toEqual(["fixture.ts:2"]);
  expect(
    missingAbsentAttackGroupRawCountsInLines("fixture.ts", [
      ...lines.slice(0, 4),
      "  absentLegalActions: [",
      '    { type: "replayAttack", player: 0, attackerUid: "p0-card", windowId: 1, windowKind: "battle" },',
      '    { type: "declareAttack", player: 0, attackerUid: "p1-card", windowId: 1, windowKind: "open" },',
      "  ],",
      '  absentLegalActionGroups: [absentAttackGroup("p0-card", undefined, undefined, 1), absentOpenAttackGroup(0, "p1-card", 1)],',
      ...lines.slice(4),
    ]),
  ).toEqual([]);
  expect(missingLegalActionCountsInLines("fixture.ts", lines)).toEqual(["fixture.ts:2"]);
  expect(missingLegalActionCountsInLines("fixture.ts", [...lines.slice(0, 4), "  legalActionCounts: { 0: 1, 1: 0 },", "  legalActionGroups: [turnGroup(1)],", ...lines.slice(4)])).toEqual(["fixture.ts:2"]);
  expect(missingOpenLegalActionWindowIdsInLines("fixture.ts", [...lines.slice(0, 4), '  legalActions: [{ type: "endTurn", player: 0, windowKind: "open" }],', ...lines.slice(4)])).toEqual([
    "fixture.ts:5",
  ]);
  expect(
    missingTimingLegalActionWindowIdsInLines("fixture.ts", [
      ...lines.slice(0, 4),
      '  legalActions: [{ type: "passDamage", player: 0, windowKind: "battle" }],',
      '  absentLegalActions: [{ type: "activateEffect", player: 1, windowKind: "chainResponse", effectId: "fixture-chain" }],',
      ...lines.slice(4),
    ]),
  ).toEqual(["fixture.ts:5", "fixture.ts:6"]);
  expect(
    missingTimingLegalActionWindowIdsInLines("fixture.ts", [
      ...lines.slice(0, 4),
      "  legalActions: [",
      '    { type: "activateEffect", player: 0, effectId: "fixture-effect", count: 1 },',
      '    { type: "passAttack", player: 0, windowKind: "battle", count: 1 },',
      "  ],",
      ...lines.slice(4),
    ]),
  ).toEqual(["fixture.ts:5"]);
  expect(
    missingTimingLegalActionWindowKindsInLines("fixture.ts", [
      ...lines.slice(0, 3),
      '  windowKind: "battle",',
      '  legalActions: [{ type: "passDamage", player: 0, windowId: 2 }],',
      ...lines.slice(4),
    ]),
  ).toEqual(["fixture.ts:5"]);
  expect(
    missingOpenLegalActionGroupWindowIdsInLines("fixture.ts", [
      ...lines.slice(0, 4),
      "  legalActionGroups: [",
      "    {",
      '      label: "Turn",',
      '      windowKind: "open",',
      '      actions: [{ type: "endTurn", player: 0, windowId: 1, windowKind: "open" }],',
      "    },",
      "  ],",
      ...lines.slice(4),
    ]),
  ).toEqual(["fixture.ts:6"]);
  expect(
    missingTimingLegalActionGroupWindowIdsInLines("fixture.ts", [
      ...lines.slice(0, 4),
      "  legalActionGroups: [",
      "    {",
      '      label: "Pass",',
      '      windowKind: "battle",',
      '      actions: [{ type: "passAttack", player: 0, windowId: 2, windowKind: "battle" }],',
      "    },",
      "  ],",
      ...lines.slice(4),
    ]),
  ).toEqual(["fixture.ts:6"]);
  expect(
    missingLegalActionGroupWindowKindsInLines("fixture.ts", [
      ...lines.slice(0, 4),
      "  legalActionGroups: [",
      "    {",
      '      label: "Pass",',
      "      windowId: 2,",
      '      actions: [{ type: "passAttack", player: 0, windowId: 2, windowKind: "battle" }],',
      "    },",
      "  ],",
      ...lines.slice(4),
    ]),
  ).toEqual(["fixture.ts:6"]);
  expect(
    missingNestedLegalActionGroupWindowIdsInLines("fixture.ts", [
      ...lines.slice(0, 4),
      "  legalActionGroups: [",
      "    {",
      '      label: "Pass",',
      "      windowId: 2,",
      '      windowKind: "battle",',
      '      actions: [{ type: "passAttack", player: 0, windowKind: "battle" }],',
      "    },",
      "  ],",
      ...lines.slice(4),
    ]),
  ).toEqual(["fixture.ts:6"]);
  expect(
    missingNestedLegalActionGroupWindowKindsInLines("fixture.ts", [
      ...lines.slice(0, 4),
      "  legalActionGroups: [",
      "    {",
      '      label: "Pass",',
      "      windowId: 2,",
      '      windowKind: "battle",',
      '      actions: [{ type: "passAttack", player: 0, windowId: 2 }],',
      "    },",
      "  ],",
      ...lines.slice(4),
    ]),
  ).toEqual(["fixture.ts:6"]);
  expect(
    missingTimingExpectationWindowIdsInLines("fixture.ts", [
      ...lines.slice(0, 3),
      '  windowKind: "battle",',
      '  legalActions: [{ type: "passAttack", player: 0, windowId: 2, windowKind: "battle" }],',
      ...lines.slice(4),
    ]),
  ).toEqual(["fixture.ts:2"]);
  expect(missingBattleWindowCoverageInLines("fixture.ts", [...lines.slice(0, 4), "  pendingBattle: true,", ...lines.slice(4)])).toEqual(["fixture.ts:2"]);
  expect(missingBattleWindowCoverageInLines("fixture.ts", [...lines.slice(0, 4), "  currentAttack: false,", ...lines.slice(4)])).toEqual(["fixture.ts:2"]);
  expect(
    missingBattleWindowCoverageInLines("fixture.ts", [
      ...lines.slice(0, 4),
      "  pendingBattle: true,",
      '  battleWindow: { kind: "attackNegationResponse" },',
      ...lines.slice(4),
    ]),
  ).toEqual([]);
  expect(missingBattleWindowCoverageInLines("fixture.ts", [...lines.slice(0, 4), "  pendingBattle: false,", "  battleWindow: null,", ...lines.slice(4)])).toEqual([]);
  const battleWindowMismatch = [...lines.slice(0, 2), '  windowKind: "battle",', "  waitingFor: 1,", '  battleWindow: { kind: "startDamageStep", responsePlayer: 0 },', ...lines.slice(2)];
  const battleWindowMatch = [...lines.slice(0, 2), '  windowKind: "battle",', "  waitingFor: 1,", '  battleWindow: { kind: "startDamageStep", responsePlayer: 1 },', ...lines.slice(2)];
  expect(mismatchedBattleWindowWaitingPlayersInLines("fixture.ts", battleWindowMismatch)).toEqual(["fixture.ts:2"]);
  expect(mismatchedBattleWindowWaitingPlayersInLines("fixture.ts", battleWindowMatch)).toEqual([]);
  expect(mismatchedBattleWindowWaitingPlayersInLines("fixture.ts", [...lines.slice(0, 2), '  windowKind: "battle",', '  battleWindow: { kind: "startDamageStep", responsePlayer: 1 },', ...lines.slice(2)])).toEqual(["fixture.ts:2"]);
  const chainResponseWithBattleState = [...lines.slice(0, 2), '  windowKind: "chainResponse",', "  waitingFor: 1,", '  battleWindow: { kind: "attackNegationResponse", responsePlayer: 0 },', ...lines.slice(2)];
  expect(mismatchedBattleWindowWaitingPlayersInLines("fixture.ts", chainResponseWithBattleState)).toEqual([]);
  expect(mismatchedBattleWindowStepsInLines("fixture.ts", [...lines.slice(0, 2), '  windowKind: "battle",', '  battleStep: "attack",', '  battleWindow: { kind: "startDamageStep", step: "damage" },', ...lines.slice(2)])).toEqual(["fixture.ts:2"]);
  expect(mismatchedBattleWindowStepsInLines("fixture.ts", [...lines.slice(0, 2), '  windowKind: "battle",', '  battleStep: "damage",', '  battleWindow: { kind: "startDamageStep", step: "damage" },', ...lines.slice(2)])).toEqual([]);
  expect(missingPendingTriggerBucketCoverageInLines("fixture.ts", [...lines.slice(0, 4), "  pendingTriggers: [{ player: 0, effectId: 'trigger' }],", ...lines.slice(4)])).toEqual([
    "fixture.ts:2",
  ]);
  expect(
    missingPendingTriggerBucketCoverageInLines("fixture.ts", [
      ...lines.slice(0, 4),
      "  pendingTriggers: [{ player: 0, effectId: 'trigger' }],",
      "  pendingTriggerBuckets: [{ player: 0, triggerBucket: 'turnOptional' }],",
      ...lines.slice(4),
    ]),
  ).toEqual([]);
  expect(missingPendingTriggerBucketCoverageInLines("fixture.ts", [...lines.slice(0, 4), "  pendingTriggers: [],", ...lines.slice(4)])).toEqual([]);
  expect(missingPendingTriggerEventTimingsInText("fixture.ts", [
    "after: {",
    "  pendingTriggers: [{ player: 0, effectId: 'trigger', eventName: 'normalSummoned' }],",
    "},",
  ].join("\n"))).toEqual(["fixture.ts:2"]);
  expect(missingPendingTriggerEventTimingsInText("fixture.ts", [
    "after: {",
    "  pendingTriggers: [{ player: 0, effectId: 'trigger', eventName: 'normalSummoned', eventTriggerTiming: 'if' }],",
    "},",
  ].join("\n"))).toEqual([]);
  expect(missingPendingTriggerEventTimingsInText("fixture.ts", [
    "after: {",
    "  eventHistory: [{ eventName: 'normalSummoned' }],",
    "  pendingTriggers: [],",
    "},",
  ].join("\n"))).toEqual([]);
  expect(missingChainEventTimingsInText("fixture.ts", [
    "after: {",
    "  chain: [{ player: 0, effectId: 'trigger', eventName: 'normalSummoned' }],",
    "},",
  ].join("\n"))).toEqual(["fixture.ts:2"]);
  expect(missingChainEventTimingsInText("fixture.ts", [
    "after: {",
    "  chain: [{ player: 0, effectId: 'trigger', eventName: 'normalSummoned', eventTriggerTiming: 'if' }],",
    "},",
  ].join("\n"))).toEqual([]);
  expect(missingChainEventTimingsInText("fixture.ts", [
    "after: {",
    "  eventHistory: [{ eventName: 'normalSummoned' }],",
    "},",
  ].join("\n"))).toEqual([]);
  expect(
    missingTriggerGroupBucketCoverageInLines("fixture.ts", [
      ...lines.slice(0, 4),
      "  legalActionGroups: [",
      "    {",
      '      label: "Trigger Activations",',
      '      windowId: 1,',
      '      windowKind: "triggerBucket",',
      '      actions: [{ type: "activateTrigger", player: 0, triggerBucket: "turnOptional" }],',
      "    },",
      "  ],",
      ...lines.slice(4),
    ]),
  ).toEqual(["fixture.ts:6"]);
  expect(
    missingTriggerGroupBucketCoverageInLines("fixture.ts", [
      ...lines.slice(0, 4),
      "  legalActionGroups: [",
      "    {",
      '      label: "Trigger Declines",',
      '      windowId: 1,',
      '      windowKind: "triggerBucket",',
      '      triggerBucket: { player: 0, triggerBucket: "turnOptional" },',
      '      actions: [{ type: "declineTrigger", player: 0, triggerBucket: "turnOptional" }],',
      "    },",
      "  ],",
      ...lines.slice(4),
    ]),
  ).toEqual([]);
  expect(
    missingTriggerOrderPromptCoverageInLines("fixture.ts", [
      ...lines.slice(0, 4),
      "  pendingTriggers: [",
      "    { player: 0, effectId: 'first' },",
      "    { player: 0, effectId: 'second' },",
      "  ],",
      "  pendingTriggerBuckets: [{ player: 0, triggerBucket: 'turnOptional' }],",
      ...lines.slice(4),
    ]),
  ).toEqual(["fixture.ts:2"]);
  expect(
    missingTriggerOrderPromptCoverageInLines("fixture.ts", [
      ...lines.slice(0, 4),
      "  pendingTriggers: [",
      "    { player: 0, effectId: 'first' },",
      "    { player: 0, effectId: 'second' },",
      "  ],",
      "  pendingTriggerBuckets: [{ player: 0, triggerBucket: 'turnOptional' }],",
      "  triggerOrderPrompt: { type: 'orderTriggers', player: 0, triggerBucket: 'turnOptional' },",
      ...lines.slice(4),
    ]),
  ).toEqual([]);
  expect(
    missingTriggerOrderPromptCoverageInLines("fixture.ts", [
      ...lines.slice(0, 4),
      "  pendingTriggers: [{ player: 0, effectId: 'only' }],",
      "  pendingTriggerBuckets: [{ player: 0, triggerBucket: 'turnOptional' }],",
      ...lines.slice(4),
    ]),
  ).toEqual([]);
  expect(
    missingTriggerEffectTimingsInText(
      "fixture.ts",
      [
        "runScriptedDuelFixture({",
        "  setup: {",
        "    effects: [",
        "      {",
        '        id: "trigger",',
        '        event: "trigger",',
        '        triggerEvent: "sentToGraveyard",',
        '        range: ["hand"],',
        "      },",
        "    ],",
        "  },",
        "});",
      ].join("\n"),
    ),
  ).toEqual(["fixture.ts:7"]);
  expect(
    missingTriggerEffectTimingsInText(
      "fixture.ts",
      [
        "runScriptedDuelFixture({",
        "  setup: {",
        "    effects: [",
        "      {",
        '        id: "trigger",',
        '        event: "trigger",',
        '        triggerEvent: "sentToGraveyard",',
        '        triggerTiming: "if",',
        '        range: ["hand"],',
        "      },",
        "    ],",
        "  },",
        "});",
      ].join("\n"),
    ),
  ).toEqual([]);
  expect(parityFixtureWithoutSnapshotRestoreInLines("fixture.ts", lines)).toEqual(["fixture.ts"]);
  expect(parityFixtureScenarioCountProblem("fixture.ts", ["describe('fixture', () => {", "  it('one', () => {})", "});"])).toEqual([]);
  expect(parityFixtureScenarioCountProblem("fixture.ts", ["describe('fixture', () => {", "});"])).toEqual(["fixture.ts: expected 1 scenario, found 0"]);
  expect(parityFixtureScenarioCountProblem("fixture.ts", ["describe('fixture', () => {", "  it('one', () => {})", "  it('two', () => {})", "});"])).toEqual([
    "fixture.ts: expected 1 scenario, found 2",
  ]);

}
