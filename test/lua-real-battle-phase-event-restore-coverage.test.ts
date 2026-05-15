import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const battlePhaseEventFixtureCount = 2;

describe("Lua real Battle Phase event restore coverage", () => {
  it("requires representative Battle Phase event fixtures to assert clean Lua restore", () => {
    const fixtures = representativeBattlePhaseEventFixtures();
    expect(fixtures).toHaveLength(battlePhaseEventFixtureCount);

    const missing = fixtures
      .filter((fixture) => {
        const text = fs.readFileSync(path.join(root, fixture.file), "utf8");
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
        const text = fs.readFileSync(path.join(root, fixture.file), "utf8");
        return !fixture.requiredSnippets.every((snippet) => text.includes(snippet));
      })
      .map((fixture) => fixture.file);

    expect(weak).toEqual([]);
  });
});

function representativeBattlePhaseEventFixtures(): Array<{ file: string; requiredSnippets: string[] }> {
  return [
    {
      file: "test/lua-real-script-giant-orc-battle-phase-position.test.ts",
      requiredSnippets: [
        'event: "continuous", code: 0x1080',
        'eventName: "phaseBattle", eventCode: 0x1080',
        'eventName: "positionChanged", eventCode: 1016',
        'position: "faceUpDefense"',
      ],
    },
    {
      file: "test/lua-real-script-scrap-worm-battle-phase-destroy.test.ts",
      requiredSnippets: [
        'event: "trigger", triggerEvent: "phaseBattle"',
        'eventName: "phaseBattle"',
        'triggerBucket: "turnMandatory"',
        'action.type === "activateTrigger"',
        'eventName: "destroyed"',
        "eventCode: 1029",
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
