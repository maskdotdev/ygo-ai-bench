import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const searchSetLockFixtureCount = 6;

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
});

function searchSetLockFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-ancient-gear-wyvern-facedown-summon-lock.test.ts",
      required: [
        'luaTargetDescriptor: "target:special-summon-position-facedown"',
        "wyvern facedown special 0",
        "wyvern faceup special 1",
      ],
    },
    {
      file: "test/lua-real-script-ancient-gear-wyvern-set-locks.test.ts",
      required: [
        "lockCodes(restored.session.state, wyvern.uid)).toEqual([22, 23, 24, 69])",
        'action.type === "normalSummon"',
        'action.type === "setMonster"',
        'action.type === "setSpellTrap"',
      ],
    },
    {
      file: "test/lua-real-script-hidden-armory-summon-set-lock.test.ts",
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
      required: [
        'action.type === "normalSummon"',
        'action.type === "setMonster"',
        'action.type === "setSpellTrap"',
        "dark simorgh turn set false/false/true",
      ],
    },
    {
      file: "test/lua-real-script-fusion-conscription-monster-effect-lock.test.ts",
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
      required: [
        'action.type === "setMonster"',
        'type: "normalSummon", uid: playerHandMonster!.uid',
        "restoredActivation.missingRegistryKeys).toEqual([])",
        "restoredActivation.missingChainLimitRegistryKeys).toEqual([])",
        "restoredLock.missingRegistryKeys).toEqual([])",
        "restoredLock.missingChainLimitRegistryKeys).toEqual([])",
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
