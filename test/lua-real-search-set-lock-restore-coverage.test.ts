import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const searchSetLockFixtureCount = 6;
const searchSetLockKindCounts = {
  continuousMonsterSetLock: 1,
  continuousSpellTrapSetLock: 1,
  facedownSpecialSummonLock: 1,
  searchCreatedSummonSetLock: 1,
  searchCreatedMultiSetLock: 1,
  searchedCodeActivationLock: 1,
} satisfies Record<SearchSetLockKind, number>;

type SearchSetLockKind =
  | "continuousMonsterSetLock"
  | "continuousSpellTrapSetLock"
  | "facedownSpecialSummonLock"
  | "searchCreatedSummonSetLock"
  | "searchCreatedMultiSetLock"
  | "searchedCodeActivationLock";

describe("Lua real search and set-lock restore coverage", () => {
  it("requires representative search-created set locks to assert clean Lua registry restore", () => {
    const files = searchSetLockFixtureFiles();
    expect(files).toHaveLength(searchSetLockFixtureCount);

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

  it("keeps search and set-lock fixture kinds explicit", () => {
    expect(countSearchSetLockKinds(searchSetLockFixtureFiles())).toEqual(searchSetLockKindCounts);
  });
});

function searchSetLockFixtureFiles(): Array<{
  file: string;
  kind: SearchSetLockKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-ancient-gear-wyvern-facedown-summon-lock.test.ts",
      kind: "facedownSpecialSummonLock",
      required: [
        'luaTargetDescriptor: "target:special-summon-position-facedown"',
        "wyvern facedown special 0",
        "wyvern faceup special 1",
      ],
    },
    {
      file: "test/lua-real-script-ancient-gear-wyvern-set-locks.test.ts",
      kind: "searchCreatedMultiSetLock",
      required: [
        "lockCodes(restored.session.state, wyvern.uid)).toEqual([22, 23, 24, 69])",
        'action.type === "normalSummon"',
        'action.type === "setMonster"',
        'action.type === "setSpellTrap"',
      ],
    },
    {
      file: "test/lua-real-script-hidden-armory-summon-set-lock.test.ts",
      kind: "searchCreatedSummonSetLock",
      required: [
        "lockCodes(restored.session, hiddenArmory.uid)).toEqual([20, 23])",
        "lockCodes(restoredLock.session, hiddenArmory.uid)).toEqual([20, 23])",
        'eventName: "sentToHandConfirmed"',
        'action.type === "normalSummon"',
        'action.type === "setMonster"',
      ],
    },
    {
      file: "test/lua-real-script-dark-simorgh-set-lock.test.ts",
      kind: "continuousSpellTrapSetLock",
      required: [
        'action.type === "normalSummon"',
        'action.type === "setMonster"',
        'action.type === "setSpellTrap"',
        "dark simorgh turn set false/false/true",
      ],
    },
    {
      file: "test/lua-real-script-fusion-conscription-monster-effect-lock.test.ts",
      kind: "searchedCodeActivationLock",
      required: [
        "target:same-code-label",
        "cannot-activate:same-code-monster-effect",
        'action.type === "normalSummon"',
        'action.type === "setMonster"',
        'action.type === "activateEffect"',
      ],
    },
    {
      file: "test/lua-real-script-light-intervention-set-lock.test.ts",
      kind: "continuousMonsterSetLock",
      required: [
        'action.type === "setMonster"',
        'type: "normalSummon", uid: playerHandMonster!.uid',
        "restoredActivation.missingRegistryKeys).toEqual([])",
        "restoredActivation.missingChainLimitRegistryKeys).toEqual([])",
        "restoredLock.missingRegistryKeys).toEqual([])",
        "restoredLock.missingChainLimitRegistryKeys).toEqual([])",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: SearchSetLockKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countSearchSetLockKinds(
  fixtures: Array<{ kind: SearchSetLockKind }>,
): Record<SearchSetLockKind, number> {
  return fixtures.reduce<Record<SearchSetLockKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      continuousMonsterSetLock: 0,
      continuousSpellTrapSetLock: 0,
      facedownSpecialSummonLock: 0,
      searchCreatedSummonSetLock: 0,
      searchCreatedMultiSetLock: 0,
      searchedCodeActivationLock: 0,
    },
  );
}
