import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const parityFixtureDir = path.resolve("test");
const parityDocFiles = ["readme.md", path.join("docs", "gameplay-parity-plan.md")];
const pairedScenarioFixtureFiles = new Set(["parity-battle-direct-attack-lock-fixture.test.ts", "parity-missed-timing-event-coverage.test.ts", "parity-missed-timing-fixture.test.ts", "parity-open-fast-coverage.test.ts", "parity-segoc-bucket-fixture.test.ts"]);

describe("parity fixture metadata", () => {
  it("scans existing parity documentation files", () => {
    expect(parityDocFiles.filter((file) => !fs.existsSync(file))).toEqual([]);
  });

  it("keeps parity docs from framing engine gaps as unsupported", () => {
    expect(unsupportedParityDocLanguage()).toEqual([]);
  });

  it("requires expectation blocks in parity fixtures to declare their evidence source", () => {
    expect(missingExpectationSources()).toEqual([]);
  });

  it("requires expectation evidence sources to be EDOPro observations or parity backlog", () => {
    expect(invalidExpectationSources()).toEqual([]);
  });

  it("requires backlog expectations in parity fixtures to explain the EDOPro behavior they track", () => {
    expect(missingBacklogNotes()).toEqual([]);
  });

  it("requires sourced parity expectations to carry observation notes", () => {
    expect(missingExpectationNotes()).toEqual([]);
  });

  it("requires EDOPro expectation notes to reference EDOPro behavior", () => {
    expect(edoproNotesWithoutEdopro()).toEqual([]);
  });

  it("requires backlog expectation notes to reference EDOPro behavior", () => {
    expect(backlogNotesWithoutEdopro()).toEqual([]);
  });

  it("requires UI-facing grouped legal-action expectations to track raw positive legal-action expectations", () => {
    expect(missingLegalActionGroupCoverage()).toEqual([]);
  });

  it("requires direct-attack groups to be backed by raw direct attack expectations", () => {
    expect(missingDirectAttackRawCoverage()).toEqual([]);
  });

  it("requires targeted-attack groups to be backed by raw targeted attack expectations", () => {
    expect(missingTargetedAttackRawCoverage()).toEqual([]);
  });

  it("requires attack groups to be backed by matching raw attack expectation counts", () => {
    expect(missingAttackGroupRawCounts()).toEqual([]);
  });

  it("requires absent attack groups to be backed by matching raw absent attack expectation counts", () => {
    expect(missingAbsentAttackGroupRawCounts()).toEqual([]);
  });

  it("requires UI-facing grouped absence expectations to track raw absent legal-action expectations", () => {
    expect(missingAbsentLegalActionGroupCoverage()).toEqual([]);
  });

  it("requires legal-action expectations to pin aggregate action counts", () => {
    expect(missingLegalActionCountCoverage()).toEqual([]);
  });

  it("requires open-window legal-action expectations to pin window ids", () => {
    expect(missingOpenLegalActionWindowIds()).toEqual([]);
  });

  it("requires open-window legal-action group expectations to pin window ids", () => {
    expect(missingOpenLegalActionGroupWindowIds()).toEqual([]);
  });

  it("requires timing-window legal-action expectations to pin window ids", () => {
    expect(missingTimingLegalActionWindowIds()).toEqual([]);
  });

  it("requires timing-window legal-action expectations with window ids to pin window kinds", () => {
    expect(missingTimingLegalActionWindowKinds()).toEqual([]);
  });

  it("requires timing-window legal-action group expectations to pin window ids", () => {
    expect(missingTimingLegalActionGroupWindowIds()).toEqual([]);
  });

  it("requires legal-action group expectations with window ids to pin window kinds", () => {
    expect(missingLegalActionGroupWindowKinds()).toEqual([]);
  });

  it("requires grouped legal-action entries to pin window ids", () => {
    expect(missingNestedLegalActionGroupWindowIds()).toEqual([]);
  });

  it("requires grouped legal-action entries with window ids to pin window kinds", () => {
    expect(missingNestedLegalActionGroupWindowKinds()).toEqual([]);
  });

  it("requires timing-window expectation blocks to pin window ids", () => {
    expect(missingTimingExpectationWindowIds()).toEqual([]);
  });

  it("requires battle-state expectations to pin battle window state", () => {
    expect(missingBattleWindowCoverage()).toEqual([]);
  });

  it("requires battle-window expectations to pin the matching waiting player", () => expect(mismatchedBattleWindowWaitingPlayers()).toEqual([]));

  it("requires pinned battle steps to match battle-window steps", () => expect(mismatchedBattleWindowSteps()).toEqual([]));

  it("requires non-empty pending trigger expectations to pin trigger bucket summaries", () => {
    expect(missingPendingTriggerBucketCoverage()).toEqual([]);
  });

  it("requires trigger legal-action groups to pin trigger bucket summaries", () => {
    expect(missingTriggerGroupBucketCoverage()).toEqual([]);
  });

  it("requires multi-trigger bucket expectations to pin trigger order prompt state", () => {
    expect(missingTriggerOrderPromptCoverage()).toEqual([]);
  });

  it("requires scripted trigger effects to declare trigger timing", () => {
    expect(missingTriggerEffectTimings()).toEqual([]);
  });

  it("requires parity fixtures to exercise snapshot restore coverage", () => {
    expect(parityFixturesWithoutSnapshotRestore()).toEqual([]);
  });

  it("keeps parity fixture files focused on one observed scenario", () => {
    expect(parityFixturesWithMultipleScenarios()).toEqual([]);
  });

  it("detects missing source, backlog note, and grouped action metadata in fixture text", () => {
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
  });
});

function missingExpectationSources(): string[] {
  return scriptedFixtureFiles().flatMap((file) => missingSourcesInLines(file, readFixtureLines(file)));
}

function invalidExpectationSources(): string[] {
  return scriptedFixtureFiles().flatMap((file) => invalidSourcesInLines(file, readFixtureLines(file)));
}

function unsupportedParityDocLanguage(): string[] {
  return parityDocFiles.flatMap((file) => {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    return lines.flatMap((line, index) => /unsupported|not supported|out of scope/i.test(line) ? [`${file}:${index + 1}`] : []);
  });
}

function missingBacklogNotes(): string[] {
  return scriptedFixtureFiles().flatMap((file) => missingBacklogNotesInLines(file, readFixtureLines(file)));
}

function missingExpectationNotes(): string[] {
  return parityFixtureFiles().flatMap((file) => missingExpectationNotesInLines(file, readFixtureLines(file)));
}

function backlogNotesWithoutEdopro(): string[] {
  return scriptedFixtureFiles().flatMap((file) => backlogNotesWithoutEdoproInLines(file, readFixtureLines(file)));
}

function edoproNotesWithoutEdopro(): string[] {
  return parityFixtureFiles().flatMap((file) => edoproNotesWithoutEdoproInLines(file, readFixtureLines(file)));
}

function missingLegalActionGroupCoverage(): string[] {
  return parityFixtureFiles().flatMap((file) => missingLegalActionGroupsInLines(file, readFixtureLines(file), "legalActions:", "legalActionGroups:"));
}

function missingDirectAttackRawCoverage(): string[] {
  return parityFixtureFiles().flatMap((file) => missingDirectAttackRawCoverageInLines(file, readFixtureLines(file)));
}

function missingTargetedAttackRawCoverage(): string[] {
  return parityFixtureFiles().flatMap((file) => missingTargetedAttackRawCoverageInLines(file, readFixtureLines(file)));
}

function missingAttackGroupRawCounts(): string[] {
  return parityFixtureFiles().flatMap((file) => missingAttackGroupRawCountsInLines(file, readFixtureLines(file)));
}

function missingAbsentAttackGroupRawCounts(): string[] {
  return parityFixtureFiles().flatMap((file) => missingAbsentAttackGroupRawCountsInLines(file, readFixtureLines(file)));
}

function missingAbsentLegalActionGroupCoverage(): string[] {
  return parityFixtureFiles().flatMap((file) => missingLegalActionGroupsInLines(file, readFixtureLines(file), "absentLegalActions:", "absentLegalActionGroups:"));
}

function missingLegalActionCountCoverage(): string[] {
  return parityFixtureFiles().flatMap((file) => missingLegalActionCountsInLines(file, readFixtureLines(file)));
}

function missingOpenLegalActionWindowIds(): string[] {
  return parityFixtureFiles().flatMap((file) => missingOpenLegalActionWindowIdsInLines(file, readFixtureLines(file)));
}

function missingOpenLegalActionGroupWindowIds(): string[] {
  return parityFixtureFiles().flatMap((file) => missingOpenLegalActionGroupWindowIdsInLines(file, readFixtureLines(file)));
}

function missingTimingLegalActionWindowIds(): string[] {
  return parityFixtureFiles().flatMap((file) => missingTimingLegalActionWindowIdsInLines(file, readFixtureLines(file)));
}

function missingTimingLegalActionWindowKinds(): string[] {
  return parityFixtureFiles().flatMap((file) => missingTimingLegalActionWindowKindsInLines(file, readFixtureLines(file)));
}

function missingTimingLegalActionGroupWindowIds(): string[] {
  return parityFixtureFiles().flatMap((file) => missingTimingLegalActionGroupWindowIdsInLines(file, readFixtureLines(file)));
}

function missingLegalActionGroupWindowKinds(): string[] {
  return parityFixtureFiles().flatMap((file) => missingLegalActionGroupWindowKindsInLines(file, readFixtureLines(file)));
}

function missingNestedLegalActionGroupWindowIds(): string[] {
  return parityFixtureFiles().flatMap((file) => missingNestedLegalActionGroupWindowIdsInLines(file, readFixtureLines(file)));
}

function missingNestedLegalActionGroupWindowKinds(): string[] {
  return parityFixtureFiles().flatMap((file) => missingNestedLegalActionGroupWindowKindsInLines(file, readFixtureLines(file)));
}

function missingTimingExpectationWindowIds(): string[] {
  return parityFixtureFiles().flatMap((file) => missingTimingExpectationWindowIdsInLines(file, readFixtureLines(file)));
}

function missingBattleWindowCoverage(): string[] {
  return parityFixtureFiles().flatMap((file) => missingBattleWindowCoverageInLines(file, readFixtureLines(file)));
}

function mismatchedBattleWindowWaitingPlayers(): string[] { return parityFixtureFiles().flatMap((file) => mismatchedBattleWindowWaitingPlayersInLines(file, readFixtureLines(file))); }
function mismatchedBattleWindowSteps(): string[] { return parityFixtureFiles().flatMap((file) => mismatchedBattleWindowStepsInLines(file, readFixtureLines(file))); }

function missingPendingTriggerBucketCoverage(): string[] {
  return parityFixtureFiles().flatMap((file) => missingPendingTriggerBucketCoverageInLines(file, readFixtureLines(file)));
}

function missingTriggerGroupBucketCoverage(): string[] {
  return parityFixtureFiles().flatMap((file) => missingTriggerGroupBucketCoverageInLines(file, readFixtureLines(file)));
}

function missingTriggerOrderPromptCoverage(): string[] {
  return parityFixtureFiles().flatMap((file) => missingTriggerOrderPromptCoverageInLines(file, readFixtureLines(file)));
}

function missingTriggerEffectTimings(): string[] {
  return scriptedFixtureFiles().flatMap((file) => missingTriggerEffectTimingsInText(file, readFixtureText(file)));
}

function parityFixturesWithoutSnapshotRestore(): string[] {
  return parityFixtureFiles().flatMap((file) => parityFixtureWithoutSnapshotRestoreInLines(file, readFixtureLines(file)));
}

function parityFixturesWithMultipleScenarios(): string[] {
  return parityFixtureFiles().flatMap((file) => parityFixtureScenarioCountProblem(file, readFixtureLines(file)));
}

function missingSourcesInLines(file: string, lines: string[]): string[] {
  const missingSources: string[] = [];
  lines.forEach((line, index) => {
    if (!/^\s*(before|after|expected): \{/.test(line)) return;
    if (sourceLineInBlock(expectationBlock(lines, index)) === undefined) missingSources.push(`${file}:${index + 1}`);
  });
  return missingSources;
}

function invalidSourcesInLines(file: string, lines: string[]): string[] {
  const invalidSources: string[] = [];
  lines.forEach((line, index) => {
    if (!/^\s*(before|after|expected): \{/.test(line)) return;
    const sourceLine = sourceLineInBlock(expectationBlock(lines, index));
    if (sourceLine !== undefined && !/source:\s*["'](edopro|parity-backlog)["']/.test(sourceLine)) invalidSources.push(`${file}:${index + 1}`);
  });
  return invalidSources;
}

function missingBacklogNotesInLines(file: string, lines: string[]): string[] {
  const missingNotes: string[] = [];
  lines.forEach((line, index) => {
    if (!hasParityBacklogSource(line)) return;
    if (!expectationBlock(lines, index).includes("note:")) missingNotes.push(`${file}:${index + 1}`);
  });
  return missingNotes;
}

function missingExpectationNotesInLines(file: string, lines: string[]): string[] {
  const missingNotes: string[] = [];
  lines.forEach((line, index) => {
    if (!/^\s*(before|after|expected): \{/.test(line)) return;
    const block = expectationBlock(lines, index);
    if (sourceLineInBlock(block) !== undefined && !block.includes("note:")) missingNotes.push(`${file}:${index + 1}`);
  });
  return missingNotes;
}

function backlogNotesWithoutEdoproInLines(file: string, lines: string[]): string[] {
  const missingEdopro: string[] = [];
  lines.forEach((line, index) => {
    if (!hasParityBacklogSource(line)) return;
    const noteLine = expectationBlock(lines, index).split("\n").find((blockLine) => blockLine.includes("note:"));
    if (noteLine !== undefined && !/edopro/i.test(noteLine)) missingEdopro.push(`${file}:${index + 1}`);
  });
  return missingEdopro;
}

function edoproNotesWithoutEdoproInLines(file: string, lines: string[]): string[] {
  const missingEdopro: string[] = [];
  lines.forEach((line, index) => {
    if (!hasEdoproSource(line)) return;
    const noteLine = expectationBlock(lines, index).split("\n").find((blockLine) => blockLine.includes("note:"));
    if (noteLine !== undefined && !/edopro/i.test(noteLine)) missingEdopro.push(`${file}:${findExpectationHeader(lines, index) + 1}`);
  });
  return missingEdopro;
}

function missingAnyLegalActionGroupsInLines(file: string, lines: string[]): string[] {
  return [
    ...missingLegalActionGroupsInLines(file, lines, "legalActions:", "legalActionGroups:"),
    ...missingLegalActionGroupsInLines(file, lines, "absentLegalActions:", "absentLegalActionGroups:"),
  ];
}

function missingLegalActionGroupsInLines(file: string, lines: string[], rawSearch: string, groupSearch: string): string[] {
  const missingGroups: string[] = [];
  lines.forEach((line, index) => {
    if (!/^\s*(before|after|expected): \{/.test(line)) return;
    const block = expectationBlock(lines, index);
    const rawCount = occurrenceCount(block, rawSearch);
    const groupCount = occurrenceCount(block, groupSearch);
    if (rawCount > groupCount) missingGroups.push(`${file}:${index + 1}`);
  });
  return missingGroups;
}

function missingDirectAttackRawCoverageInLines(file: string, lines: string[]): string[] {
  const missingRawDirectAttacks: string[] = [];
  lines.forEach((line, index) => {
    if (!/^\s*(before|after|expected): \{/.test(line)) return;
    const block = expectationBlock(lines, index);
    if (!block.includes("directAttackGroup(")) return;
    const rawDirectAttack = block.match(/\{[^{}]*type:\s*["']declareAttack["'][^{}]*directAttack:\s*true[^{}]*\}/);
    if (rawDirectAttack === null) missingRawDirectAttacks.push(`${file}:${index + 1}`);
  });
  return missingRawDirectAttacks;
}

function missingTargetedAttackRawCoverageInLines(file: string, lines: string[]): string[] {
  const missingRawTargetedAttacks: string[] = [];
  lines.forEach((line, index) => {
    if (!/^\s*(before|after|expected): \{/.test(line)) return;
    const block = expectationBlock(lines, index);
    if (!block.includes("targetedAttackGroup(")) return;
    const rawTargetedAttack = block.match(/\{[^{}]*type:\s*["']declareAttack["'][^{}]*targetUid:\s*["'][^"']+["'][^{}]*\}/);
    if (rawTargetedAttack === null) missingRawTargetedAttacks.push(`${file}:${index + 1}`);
  });
  return missingRawTargetedAttacks;
}

function missingAttackGroupRawCountsInLines(file: string, lines: string[]): string[] {
  const missingRawAttackCounts: string[] = [];
  lines.forEach((line, index) => {
    if (!/^\s*(before|after|expected): \{/.test(line)) return;
    const block = expectationBlock(lines, index);
    const groupedAttackCount = attackGroupChoiceCount(block);
    if (groupedAttackCount === 0) return;
    const rawAttackCount = rawDeclareAttackCount(block);
    if (rawAttackCount < groupedAttackCount) missingRawAttackCounts.push(`${file}:${index + 1}`);
  });
  return missingRawAttackCounts;
}

function attackGroupChoiceCount(block: string): number {
  const groups = [...block.matchAll(/attackGroup\(\[([\s\S]*?)\]\s*,/g)];
  return groups.reduce((total, group) => total + occurrenceCount(group[1] ?? "", "attackerUid:"), 0);
}

function rawDeclareAttackCount(block: string): number {
  const rawActions = block.split(/\n\s*(legalActionGroups|absentLegalActions|absentLegalActionGroups):/)[0] ?? block;
  return (rawActions.match(/\{[^{}]*type:\s*["']declareAttack["'][^{}]*\}/g) ?? []).length;
}

function missingAbsentAttackGroupRawCountsInLines(file: string, lines: string[]): string[] {
  const missingRawAbsentAttackCounts: string[] = [];
  lines.forEach((line, index) => {
    if (!/^\s*(before|after|expected): \{/.test(line)) return;
    const block = expectationBlock(lines, index);
    const groupedAbsentAttackCount = absentAttackGroupChoiceCount(block);
    if (groupedAbsentAttackCount === 0) return;
    const rawAbsentAttackCount = rawAbsentAttackActionCount(block);
    if (rawAbsentAttackCount < groupedAbsentAttackCount) missingRawAbsentAttackCounts.push(`${file}:${index + 1}`);
  });
  return missingRawAbsentAttackCounts;
}

function absentAttackGroupChoiceCount(block: string): number {
  return occurrenceCount(block, "absentAttackGroup(") + occurrenceCount(block, "absentOpenAttackGroup(");
}

function rawAbsentAttackActionCount(block: string): number {
  const rawAbsentActions = block.split(/\n\s*absentLegalActionGroups:/)[0] ?? block;
  return (rawAbsentActions.match(/\{[^{}]*type:\s*["'](declareAttack|replayAttack)["'][^{}]*\}/g) ?? []).length;
}

function missingLegalActionCountsInLines(file: string, lines: string[]): string[] {
  const missingCounts: string[] = [];
  lines.forEach((line, index) => {
    if (!/^\s*(before|after|expected): \{/.test(line)) return;
    const block = expectationBlock(lines, index);
    if (block.includes("legalActions:") && !block.includes("legalActionCounts:")) missingCounts.push(`${file}:${index + 1}`);
    if (block.includes("legalActionGroups:") && !block.includes("legalActionGroupCounts:")) missingCounts.push(`${file}:${index + 1}`);
  });
  return [...new Set(missingCounts)];
}

function missingTimingExpectationWindowIdsInLines(file: string, lines: string[]): string[] {
  const missingWindowIds: string[] = [];
  lines.forEach((line, index) => {
    if (!/^\s*(before|after|expected): \{/.test(line)) return;
    const block = expectationBlock(lines, index);
    if (!blockHasWindowKind(block, ["battle", "chainResponse", "triggerBucket"])) return;
    const header = block.split(/\n\s*(legalActions|absentLegalActions|legalActionGroups|absentLegalActionGroups):/)[0] ?? block;
    if (!/\bwindowId:/.test(header)) missingWindowIds.push(`${file}:${index + 1}`);
  });
  return missingWindowIds;
}

function missingBattleWindowCoverageInLines(file: string, lines: string[]): string[] {
  return lines.flatMap((line, index) => {
    if (!/^\s*(before|after|expected): \{/.test(line)) return [];
    const block = expectationBlock(lines, index);
    return /\b(pendingBattle|currentAttack):/.test(block) && !/\bbattleWindow:/.test(block) ? [`${file}:${index + 1}`] : [];
  });
}

function mismatchedBattleWindowWaitingPlayersInLines(file: string, lines: string[]): string[] {
  return lines.flatMap((line, index) => {
    if (!/^\s*(before|after|expected): \{/.test(line)) return [];
    const block = expectationBlock(lines, index);
    if (!/\bwindowKind:\s*["']battle["']/.test(expectationHeaderText(block))) return [];
    const responsePlayer = block.match(/\bbattleWindow:\s*\{[^{}]*\bresponsePlayer:\s*([01])/)?.[1];
    if (responsePlayer === undefined) return [];
    const waitingFor = block.match(/\bwaitingFor:\s*([01])/)?.[1];
    return waitingFor !== responsePlayer ? [`${file}:${index + 1}`] : [];
  });
}

function mismatchedBattleWindowStepsInLines(file: string, lines: string[]): string[] {
  return lines.flatMap((line, index) => {
    if (!/^\s*(before|after|expected): \{/.test(line)) return [];
    const block = expectationBlock(lines, index);
    if (!/\bwindowKind:\s*["']battle["']/.test(expectationHeaderText(block))) return [];
    const step = block.match(/\bbattleWindow:\s*\{[^{}]*\bstep:\s*["']([^"']+)["']/)?.[1];
    if (step === undefined) return [];
    const battleStep = block.match(/\bbattleStep:\s*["']([^"']+)["']/)?.[1];
    return battleStep !== undefined && battleStep !== step ? [`${file}:${index + 1}`] : [];
  });
}

function expectationHeaderText(block: string): string { return block.split(/\n\s*(legalActions|absentLegalActions|legalActionGroups|absentLegalActionGroups):/)[0] ?? block; }

function missingPendingTriggerBucketCoverageInLines(file: string, lines: string[]): string[] {
  const missingBuckets: string[] = [];
  lines.forEach((line, index) => {
    if (!/^\s*(before|after|expected): \{/.test(line)) return;
    const block = expectationBlock(lines, index);
    if (!block.includes("pendingTriggers:") || block.includes("pendingTriggers: []")) return;
    if (!block.includes("pendingTriggerBuckets:")) missingBuckets.push(`${file}:${index + 1}`);
  });
  return missingBuckets;
}

function missingTriggerGroupBucketCoverageInLines(file: string, lines: string[]): string[] {
  const missingBuckets: string[] = [];
  lines.forEach((line, index) => {
    if (!/label:\s*["']Trigger (Activations|Declines)["']/.test(line)) return;
    const groupBlock = expectationBlock(lines, index);
    const header = groupBlock.split("actions:")[0] ?? "";
    if (!/triggerBucket:\s*\{/.test(header)) missingBuckets.push(`${file}:${findBlockStart(lines, index) + 1}`);
  });
  return [...new Set(missingBuckets)];
}

function missingTriggerOrderPromptCoverageInLines(file: string, lines: string[]): string[] {
  const missingPrompts: string[] = [];
  lines.forEach((line, index) => {
    if (!/^\s*(before|after|expected): \{/.test(line)) return;
    const block = expectationBlock(lines, index);
    if (!block.includes("pendingTriggers:") || !block.includes("pendingTriggerBuckets:")) return;
    if (activePendingTriggerBucketSize(block) > 1 && !block.includes("triggerOrderPrompt:")) missingPrompts.push(`${file}:${index + 1}`);
  });
  return missingPrompts;
}

function missingTriggerEffectTimingsInText(file: string, text: string): string[] {
  const missingTimings: string[] = [];
  let index = 0;
  while ((index = text.indexOf("triggerEvent:", index)) !== -1) {
    const objectStart = findObjectStart(text, index);
    const objectEnd = objectStart < 0 ? -1 : findObjectEnd(text, objectStart);
    if (objectStart >= 0 && objectEnd >= 0 && !text.slice(objectStart, objectEnd).includes("triggerTiming:")) missingTimings.push(`${file}:${lineNumberAt(text, index)}`);
    index += "triggerEvent:".length;
  }
  return missingTimings;
}

function findObjectStart(text: string, sourceIndex: number): number {
  for (let index = sourceIndex; index >= 0; index -= 1) {
    if (text[index] === "{") return index;
  }
  return -1;
}

function findObjectEnd(text: string, startIndex: number): number {
  let depth = 0;
  let quote: string | undefined;
  let escaped = false;
  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index] ?? "";
    if (quote !== undefined) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) return index + 1;
  }
  return -1;
}

function lineNumberAt(text: string, sourceIndex: number): number {
  return text.slice(0, sourceIndex).split("\n").length;
}

function activePendingTriggerBucketSize(block: string): number {
  const triggerBuckets = block.match(/pendingTriggerBuckets:\s*\[([\s\S]*?)\]/);
  if (!triggerBuckets) return 0;
  const pendingTriggerText = block.match(/pendingTriggers:\s*\[([\s\S]*?)\]\s*,\s*pendingTriggerBuckets:/)?.[1] ?? "";
  const activeBucket = triggerBuckets[1]?.match(/\{\s*player:\s*(\d+),\s*triggerBucket:\s*["']([^"']+)["']/);
  if (!activeBucket) return 0;
  const bucketCount = [...(triggerBuckets[1] ?? "").matchAll(/\{\s*player:\s*\d+,\s*triggerBucket:\s*["'][^"']+["']/g)].length;
  return pendingTriggerCount(pendingTriggerText, Number(activeBucket[1]), activeBucket[2] ?? "", bucketCount);
}

function pendingTriggerCount(pendingTriggerText: string, player: number, triggerBucket: string, bucketCount: number): number {
  const compact = pendingTriggerText.replace(/\s+/g, " ");
  const bucketPattern = new RegExp(`\\{[^{}]*player:\\s*${player}\\b[^{}]*triggerBucket:\\s*["']${triggerBucket}["'][^{}]*\\}`, "g");
  const explicitBucketCount = (compact.match(bucketPattern) ?? []).length;
  if (explicitBucketCount > 0) return explicitBucketCount;
  if (bucketCount > 1) return 0;
  const playerPattern = new RegExp(`\\{[^{}]*player:\\s*${player}\\b[^{}]*\\}`, "g");
  return (compact.match(playerPattern) ?? []).length;
}

function missingOpenLegalActionWindowIdsInLines(file: string, lines: string[]): string[] {
  return missingLegalActionWindowIdsInLines(file, lines, ["open"]);
}

function missingOpenLegalActionGroupWindowIdsInLines(file: string, lines: string[]): string[] {
  return missingLegalActionGroupWindowIdsInLines(file, lines, ["open"]);
}

function missingTimingLegalActionWindowIdsInLines(file: string, lines: string[]): string[] {
  return missingLegalActionWindowIdsInLines(file, lines, ["battle", "chainResponse", "triggerBucket"]);
}

function missingTimingLegalActionWindowKindsInLines(file: string, lines: string[]): string[] {
  const missingWindowKinds: string[] = [];
  lines.forEach((line, index) => {
    if (!/(legalActions|absentLegalActions):/.test(line)) return;
    const block = expectationBlock(lines, findExpectationHeader(lines, index));
    if (!blockHasWindowKind(block, ["battle", "chainResponse", "triggerBucket"])) return;
    const actionObjects = legalActionArrayText(lines, index).match(/\{[^{}]*windowId:\s*\d+[^{}]*\}/g) ?? [];
    if (actionObjects.some((action) => !/\bwindowKind:/.test(action))) missingWindowKinds.push(`${file}:${index + 1}`);
  });
  return missingWindowKinds;
}

function missingTimingLegalActionGroupWindowIdsInLines(file: string, lines: string[]): string[] {
  return missingLegalActionGroupWindowIdsInLines(file, lines, ["battle", "chainResponse", "triggerBucket"]);
}

function missingLegalActionWindowIdsInLines(file: string, lines: string[], windowKinds: string[]): string[] {
  const missingWindowIds: string[] = [];
  lines.forEach((line, index) => {
    if (!/(legalActions|absentLegalActions):/.test(line)) return;
    const actionObjects = legalActionArrayText(lines, index).match(/\{[^{}]*windowKind:\s*["'][^"']+["'][^{}]*\}/g) ?? [];
    if (actionObjects.some((action) => actionHasWindowKind(action, windowKinds) && !/\bwindowId:/.test(action))) missingWindowIds.push(`${file}:${index + 1}`);
  });
  return missingWindowIds;
}

function legalActionArrayText(lines: string[], startIndex: number): string {
  const collected: string[] = [];
  let bracketDepth = 0;
  let sawArray = false;
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    collected.push(line);
    if (line.includes("[")) sawArray = true;
    if (sawArray) bracketDepth += bracketDelta(line);
    if (sawArray && bracketDepth <= 0) break;
  }
  return collected.join("\n");
}

function missingLegalActionGroupWindowIdsInLines(file: string, lines: string[], windowKinds: string[]): string[] {
  const missingWindowIds: string[] = [];
  lines.forEach((line, index) => {
    if (!/label:\s*["']/.test(line)) return;
    const groupBlock = expectationBlock(lines, index);
    if (!blockHasWindowKind(groupBlock, windowKinds)) return;
    if (!/actions:\s*\[/.test(groupBlock)) return;
    const header = groupBlock.split("actions:")[0] ?? "";
    if (!/\bwindowId:/.test(header)) missingWindowIds.push(`${file}:${findBlockStart(lines, index) + 1}`);
  });
  return [...new Set(missingWindowIds)];
}

function missingLegalActionGroupWindowKindsInLines(file: string, lines: string[]): string[] {
  const missingWindowKinds: string[] = [];
  lines.forEach((line, index) => {
    if (!/label:\s*["']/.test(line)) return;
    const groupBlock = expectationBlock(lines, index);
    if (!/actions:\s*\[/.test(groupBlock)) return;
    const header = groupBlock.split("actions:")[0] ?? "";
    if (!/\bwindowId:/.test(header) || /\bwindowKind:/.test(header)) return;
    const actionObjects = groupBlock.match(/\{[^{}]*windowKind:\s*["'](battle|chainResponse|triggerBucket|open)["'][^{}]*\}/g) ?? [];
    if (actionObjects.length > 0) missingWindowKinds.push(`${file}:${findBlockStart(lines, index) + 1}`);
  });
  return [...new Set(missingWindowKinds)];
}

function missingNestedLegalActionGroupWindowIdsInLines(file: string, lines: string[]): string[] {
  const missingWindowIds: string[] = [];
  lines.forEach((line, index) => {
    if (!/label:\s*["']/.test(line)) return;
    const groupBlock = expectationBlock(lines, index);
    if (!/actions:\s*\[/.test(groupBlock)) return;
    const actionObjects = groupBlock.match(/\{[^{}]*windowKind:\s*["'](battle|chainResponse|triggerBucket|open)["'][^{}]*\}/g) ?? [];
    if (actionObjects.some((action) => !/\bwindowId:/.test(action))) missingWindowIds.push(`${file}:${findBlockStart(lines, index) + 1}`);
  });
  return [...new Set(missingWindowIds)];
}

function missingNestedLegalActionGroupWindowKindsInLines(file: string, lines: string[]): string[] {
  const missingWindowKinds: string[] = [];
  lines.forEach((line, index) => {
    if (!/label:\s*["']/.test(line)) return;
    const groupBlock = expectationBlock(lines, index);
    if (!/actions:\s*\[/.test(groupBlock)) return;
    const actionObjects = groupBlock.match(/\{[^{}]*windowId:\s*\d+[^{}]*\}/g) ?? [];
    if (actionObjects.some((action) => !/\bwindowKind:/.test(action))) missingWindowKinds.push(`${file}:${findBlockStart(lines, index) + 1}`);
  });
  return [...new Set(missingWindowKinds)];
}

function actionHasWindowKind(action: string, windowKinds: string[]): boolean {
  return windowKinds.some((windowKind) => new RegExp(`windowKind:\\s*["']${windowKind}["']`).test(action));
}

function blockHasWindowKind(block: string, windowKinds: string[]): boolean {
  return windowKinds.some((windowKind) => new RegExp(`windowKind:\\s*["']${windowKind}["']`).test(block));
}

function parityFixtureWithoutSnapshotRestoreInLines(file: string, lines: string[]): string[] {
  const text = lines.join("\n");
  return text.includes("runScriptedDuelFixture") && !text.includes("snapshotRestore") ? [file] : [];
}

function parityFixtureScenarioCountProblem(file: string, lines: string[]): string[] {
  if (pairedScenarioFixtureFiles.has(file)) return [];
  const scenarioCount = lines.filter((line) => /^\s+it\(/.test(line)).length;
  return scenarioCount === 1 ? [] : [`${file}: expected 1 scenario, found ${scenarioCount}`];
}

function parityFixtureFiles(): string[] {
  return fs.readdirSync(parityFixtureDir).filter((name) => /^parity-.*\.test\.ts$/.test(name) && name !== "parity-fixture-metadata.test.ts");
}

function scriptedFixtureFiles(): string[] {
  return fs.readdirSync(parityFixtureDir).filter((name) => {
    if (!name.endsWith(".test.ts") || name === "parity-fixture-metadata.test.ts") return false;
    return fs.readFileSync(path.join(parityFixtureDir, name), "utf8").includes("runScriptedDuelFixture");
  });
}

function readFixtureLines(file: string): string[] {
  return readFixtureText(file).split("\n");
}

function readFixtureText(file: string): string {
  return fs.readFileSync(path.join(parityFixtureDir, file), "utf8");
}

function expectationBlock(lines: string[], sourceIndex: number): string {
  const start = findBlockStart(lines, sourceIndex);
  let depth = 0;
  const block: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    block.push(line);
    depth += braceDelta(line);
    if (depth === 0) break;
  }
  return block.join("\n");
}

function findBlockStart(lines: string[], sourceIndex: number): number {
  for (let index = sourceIndex; index >= 0; index -= 1) {
    if ((lines[index] ?? "").includes("{")) return index;
  }
  return sourceIndex;
}

function findExpectationHeader(lines: string[], sourceIndex: number): number {
  for (let index = sourceIndex; index >= 0; index -= 1) {
    if (/^\s*(before|after|expected): \{/.test(lines[index] ?? "")) return index;
  }
  return sourceIndex;
}

function braceDelta(line: string): number {
  return [...line].reduce((total, char) => total + (char === "{" ? 1 : char === "}" ? -1 : 0), 0);
}

function bracketDelta(line: string): number {
  return [...line].reduce((total, char) => total + (char === "[" ? 1 : char === "]" ? -1 : 0), 0);
}

function occurrenceCount(text: string, search: string): number {
  return text.split(search).length - 1;
}

function sourceLineInBlock(block: string): string | undefined {
  return block.split("\n").find((line) => /\bsource:/.test(line));
}

function hasParityBacklogSource(line: string): boolean {
  return /source:\s*["']parity-backlog["']/.test(line);
}

function hasEdoproSource(line: string): boolean {
  return /source:\s*["']edopro["']/.test(line);
}
