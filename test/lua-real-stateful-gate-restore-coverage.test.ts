import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const statefulGateFixtureCount = 4;
const statefulGateKindCounts = {
  deckGraveLock: 1,
  mustAttackAnyTarget: 1,
  mustAttackZoneTarget: 1,
  summonCountThreshold: 1,
} satisfies Record<StatefulGateKind, number>;

type StatefulGateKind = "deckGraveLock" | "mustAttackAnyTarget" | "mustAttackZoneTarget" | "summonCountThreshold";

describe("Lua real stateful gate restore coverage", () => {
  it("requires stateful gate fixtures to assert clean restore and restored legal outcomes", () => {
    const files = statefulGateFixtureFiles();
    expect(files).toHaveLength(statefulGateFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps stateful gate fixture kinds explicit", () => {
    expect(countStatefulGateKinds(statefulGateFixtureFiles())).toEqual(statefulGateKindCounts);
  });
});

function statefulGateFixtureFiles(): Array<{
  file: string;
  kind: StatefulGateKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-berserk-gorilla-must-attack.test.ts",
      kind: "mustAttackAnyTarget",
      required: [
        "code === 191",
        "hasAttack(actions, gorilla!.uid, target!.uid)).toBe(true)",
        'action.type === "changePhase"',
        'action.type === "endTurn"',
      ],
    },
    {
      file: "test/lua-real-script-earthshattering-event-deck-grave-lock.test.ts",
      kind: "deckGraveLock",
      required: [
        "restoredTrigger.missingRegistryKeys).toEqual([])",
        "restoredTrigger.missingChainLimitRegistryKeys).toEqual([])",
        "restoredLock.missingRegistryKeys).toEqual([])",
        "restoredLock.missingChainLimitRegistryKeys).toEqual([])",
        "earthshattering self able grave locked false",
        "earthshattering opp able grave locked false",
        "earthshattering self able grave after end true",
        "earthshattering opp able grave after end true",
      ],
    },
    {
      file: "test/lua-real-script-elfnotes-rhapsodia-must-attack-center.test.ts",
      kind: "mustAttackZoneTarget",
      required: [
        "code: 344",
        "valueCardPredicate",
        "hasAttack(actions, attacker.uid, centerTarget.uid)).toBe(true)",
        "hasAttack(actions, attacker.uid, sideTarget.uid)).toBe(false)",
        "directAttack)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-nibiru-flag-count.test.ts",
      kind: "summonCountThreshold",
      required: [
        "restoredBelowThreshold.missingRegistryKeys).toEqual([])",
        "restoredBelowThreshold.missingChainLimitRegistryKeys).toEqual([])",
        "restoredAtThreshold.missingRegistryKeys).toEqual([])",
        "restoredAtThreshold.missingChainLimitRegistryKeys).toEqual([])",
        "toHaveLength(4)",
        "toHaveLength(5)",
        "nibiruRestoreActions(restoredAtThreshold",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: StatefulGateKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countStatefulGateKinds(fixtures: Array<{ kind: StatefulGateKind }>): Record<StatefulGateKind, number> {
  return fixtures.reduce<Record<StatefulGateKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      deckGraveLock: 0,
      mustAttackAnyTarget: 0,
      mustAttackZoneTarget: 0,
      summonCountThreshold: 0,
    },
  );
}
