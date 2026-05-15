import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const EXTRA_ATTACK_FIXTURE_COUNT = 6;

describe("Lua real extra attack restore coverage", () => {
  it("requires representative multi-attack fixtures to assert clean Lua restore and replayed legal attacks", () => {
    const files = realScriptExtraAttackFixtureFiles();
    expect(files).toHaveLength(EXTRA_ATTACK_FIXTURE_COUNT);

    const missing = files
      .filter(({ file, required }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("declareAttack")
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function realScriptExtraAttackFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-alien-hunter-chain-attack.test.ts",
      required: [
        "Duel.ChainAttack",
        'eventName: "battleDestroyed"',
        "attacksDeclared).not.toContain(alienHunter!.uid)",
        "targetUid: followupTarget!.uid",
      ],
    },
    {
      file: "test/lua-real-script-element-doom-chain-attack.test.ts",
      required: [
        "attributeEarth",
        "attributeWind",
        "Duel.ChainAttack",
        'eventName: "battleDestroyed"',
        "attacksDeclared).not.toContain(elementDoom!.uid)",
        "targetUid: followupTarget!.uid",
      ],
    },
    {
      file: "test/lua-real-script-asura-priest-attack-all.test.ts",
      required: [
        "code: 193",
        "hasDirectAttack(openingActions, asura!.uid)).toBe(false)",
        "hasAttack(secondActions, asura!.uid, secondTarget!.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-ghost-bird-extra-monster-attack.test.ts",
      required: [
        "code: 346",
        "hasAttack(actions, ghostBird.uid, target.uid)).toBe(true)",
        "hasDirectAttack(noTargetActions, ghostBird.uid)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-machine-lord-ur-attack-all.test.ts",
      required: [
        "code: 193",
        "code: 200",
        "hasAttack(restoredActions, ur!.uid, secondTarget!.uid)).toBe(true)",
        "battleDamage).toEqual({ 0: 0, 1: 0 })",
      ],
    },
    {
      file: "test/lua-real-script-nitro-warrior-chain-attack-target.test.ts",
      required: [
        "effectId.endsWith(\"-1138\")",
        "targetUid: followupTarget!.uid",
        "battleDamage).toMatchObject({ 1: 1800 })",
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
