import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const battlePhaseEventFixtureCount = 4;
const battlePhaseEventKindCounts = {
  delayedReturn: 1,
  destroyTrigger: 2,
  positionChange: 1,
} satisfies Record<BattlePhaseEventKind, number>;

type BattlePhaseEventKind = "delayedReturn" | "destroyTrigger" | "positionChange";

describe("Lua real Battle Phase event restore coverage", () => {
  it("requires representative Battle Phase event fixtures to assert clean Lua restore", () => {
    const fixtures = representativeBattlePhaseEventFixtures();
    expect(fixtures).toHaveLength(battlePhaseEventFixtureCount);

    const missing = fixtures
      .filter((fixture) => {
        const text = coverageText(fs.readFileSync(path.join(root, fixture.file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)");
      })
      .map((fixture) => fixture.file);

    expect(missing).toEqual([]);
  });

  it("requires representative Battle Phase event fixtures to prove restored phase-event behavior", () => {
    const fixtures = representativeBattlePhaseEventFixtures();
    expect(fixtures).toHaveLength(battlePhaseEventFixtureCount);

    const weak = fixtures
      .filter((fixture) => {
        const text = coverageText(fs.readFileSync(path.join(root, fixture.file), "utf8"));
        return !fixture.requiredSnippets.every((snippet) => hasCoverageSnippet(text, snippet));
      })
      .map((fixture) => fixture.file);

    expect(weak).toEqual([]);
  });

  it("keeps representative Battle Phase event fixture kinds explicit", () => {
    expect(countBattlePhaseEventKinds(representativeBattlePhaseEventFixtures())).toEqual(battlePhaseEventKindCounts);
  });
});

function representativeBattlePhaseEventFixtures(): Array<{
  file: string;
  kind: BattlePhaseEventKind;
  requiredSnippets: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-giant-orc-battle-phase-position.test.ts",
      kind: "positionChange",
      requiredSnippets: [
        'event: "continuous", code: 0x1080',
        'eventName: "phaseBattle", eventCode: 0x1080',
        'eventName: "positionChanged", eventCode: 1016',
        'position: "faceUpDefense"',
      ],
    },
    {
      file: "test/lua-real-script-scrap-worm-battle-phase-destroy.test.ts",
      kind: "destroyTrigger",
      requiredSnippets: [
        'event: "trigger", triggerEvent: "phaseBattle"',
        'eventName: "phaseBattle"',
        'triggerBucket: "turnMandatory"',
        'action.type === "activateTrigger"',
        'eventName: "destroyed"',
        "eventCode: 1029",
      ],
    },
    {
      file: "test/lua-real-script-skull-conductor-battle-phase-destroy.test.ts",
      kind: "destroyTrigger",
      requiredSnippets: [
        'event: "trigger"',
        'triggerEvent: "phaseBattle"',
        'eventName: "phaseBattle"',
        'triggerBucket: "turnMandatory"',
        'action.type === "activateTrigger"',
        'eventName: "destroyed"',
      ],
    },
    {
      file: "test/lua-real-script-yellow-alert-delayed-return.test.ts",
      kind: "delayedReturn",
      requiredSnippets: [
        'event: "continuous"',
        'triggerEvent": "phaseBattle"',
        'action.type === "changePhase" && action.phase === "main2"',
        'location: "hand", controller: 1',
        "expectAttackTarget(restored.session, secondAttacker!.uid, summonedTarget!.uid, true)",
        "expectAttackTarget(restored.session, secondAttacker!.uid, originalTarget!.uid, false)",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: BattlePhaseEventKind;
    requiredSnippets: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countBattlePhaseEventKinds(
  fixtures: Array<{ kind: BattlePhaseEventKind }>,
): Record<BattlePhaseEventKind, number> {
  return fixtures.reduce<Record<BattlePhaseEventKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      delayedReturn: 0,
      destroyTrigger: 0,
      positionChange: 0,
    },
  );
}
