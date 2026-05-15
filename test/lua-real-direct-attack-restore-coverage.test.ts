import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const DIRECT_ATTACK_FIXTURE_COUNT = 5;

describe("Lua real direct-attack restore coverage", () => {
  it("requires representative direct-attack fixtures to assert clean Lua restore and replayed legal actions", () => {
    const files = realScriptDirectAttackFixtureFiles();
    expect(files).toHaveLength(DIRECT_ATTACK_FIXTURE_COUNT);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function realScriptDirectAttackFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-dragonic-halberd-cannot-direct.test.ts",
      required: [
        "code: 73",
        "hasDirectAttack(actions, halberd.uid)).toBe(false)",
        "hasDirectAttack(actions, ordinary.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-inaba-white-rabbit-direct-only.test.ts",
      required: [
        "directAttack: true",
        "targetUid: defender!.uid",
        "battleDamage).toEqual({ 0: 0, 1: 700 })",
      ],
    },
    {
      file: "test/lua-real-script-jinzo-seven-direct-attack.test.ts",
      required: [
        "hasAttack(actions, jinzo.uid, defender.uid)).toBe(true)",
        "hasDirectAttack(actions, jinzo.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-reverse-buster-direct-target-lock.test.ts",
      required: [
        "code === 332",
        'luaValueDescriptor: "value-card:not-facedown"',
        "hasDirectAttack(actions, buster.uid)).toBe(false)",
        "hasAttack(actions, buster.uid, faceUpTarget.uid)).toBe(false)",
        "hasAttack(actions, buster.uid, faceDownTarget.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-toon-defense-change-attack-target.test.ts",
      required: [
        'eventName: "attackDeclared"',
        "currentAttack?.targetUid).toBeUndefined()",
        "battleDamage).toMatchObject({ 1: 1800 })",
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
