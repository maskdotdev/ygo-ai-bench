import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const MOVEMENT_LOCK_FIXTURE_COUNT = 3;
const movementLockKindCounts = {
  banishLock: 1,
  deckToGraveLock: 1,
  searchLock: 1,
} satisfies Record<MovementLockKind, number>;

type MovementLockKind = "banishLock" | "deckToGraveLock" | "searchLock";

describe("Lua real movement-lock restore coverage", () => {
  it("requires representative movement locks to assert clean Lua restore and blocked movement probes", () => {
    const files = movementLockFixtureFiles();
    expect(files).toHaveLength(MOVEMENT_LOCK_FIXTURE_COUNT);

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

  it("keeps movement-lock fixture kinds explicit", () => {
    expect(countMovementLockKinds(movementLockFixtureFiles())).toEqual(movementLockKindCounts);
  });
});

function movementLockFixtureFiles(): Array<{
  file: string;
  kind: MovementLockKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-artifact-lancea-banish-lock.test.ts",
      kind: "banishLock",
      required: [
        "EFFECT_CANNOT_REMOVE",
        "lancea self able remove locked false",
        "lancea opp able remove locked false",
        "lancea self remove locked 0/0",
        "lancea opp remove locked 0/0",
        "lancea self remove after end 1/1",
        "lancea opp remove after end 1/1",
      ],
    },
    {
      file: "test/lua-real-script-dimension-fortress-deck-grave-lock.test.ts",
      kind: "deckToGraveLock",
      required: [
        "code: 68",
        "targetRange: [1, 1]",
        "fortress self able grave false",
        "fortress opp able grave false",
        "fortress self grave result 0/0",
        "fortress opp grave result 0/0",
      ],
    },
    {
      file: "test/lua-real-script-thunder-king-search-lock.test.ts",
      kind: "searchLock",
      required: [
        "code: 65",
        "targetRange: [1, 1]",
        "thunder self able hand false",
        "thunder opp able hand false",
        "thunder self hand result 0/0",
        "thunder opp hand result 0/0",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: MovementLockKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countMovementLockKinds(fixtures: Array<{ kind: MovementLockKind }>): Record<MovementLockKind, number> {
  return fixtures.reduce<Record<MovementLockKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      banishLock: 0,
      deckToGraveLock: 0,
      searchLock: 0,
    },
  );
}
