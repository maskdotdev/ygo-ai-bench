import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const attackRetargetFixtureCount = 4;

describe("Lua real attack retarget restore coverage", () => {
  it("requires representative attack-retarget fixtures to assert clean Lua restore and replayed target changes", () => {
    const files = realScriptAttackRetargetFixtureFiles();
    expect(files).toHaveLength(attackRetargetFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("currentAttack")
          || !text.includes("pendingBattle")
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function realScriptAttackRetargetFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-card-blocker-change-attack-target.test.ts",
      required: [
        "effectId.endsWith(\"-1131\")",
        "targetUid: blocker!.uid",
        "battleDamage).toMatchObject({ 1: 1400 })",
      ],
    },
    {
      file: "test/lua-real-script-call-earthbound-change-attack-target.test.ts",
      required: [
        'action.type === "activateEffect"',
        "targetUid: newTarget!.uid",
        "battleDamage).toMatchObject({ 1: 1300 })",
      ],
    },
    {
      file: "test/lua-real-script-chocolate-magician-girl-retarget.test.ts",
      required: [
        'eventName: "battleTargeted"',
        "targetUid: spellcaster!.uid",
        "battleDamage).toMatchObject({ 1: 400 })",
      ],
    },
    {
      file: "test/lua-real-script-ultimate-divine-beast-retarget.test.ts",
      required: [
        'eventName: "attackDeclared"',
        "targetUid: divine!.uid",
        "battleWindow?.kind).not.toBe(\"replayDecision\")",
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
