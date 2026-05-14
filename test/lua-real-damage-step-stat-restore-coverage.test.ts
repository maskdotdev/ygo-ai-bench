import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Lua real damage-step stat restore coverage", () => {
  it("requires damage-step stat fixtures to assert clean restore and restored battle outcome", () => {
    const missing = damageStepStatFixtureFiles()
      .filter(({ file, required }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function damageStepStatFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-shinobird-crow-damage-step-stat.test.ts",
      required: [
        "restoredSetup.missingRegistryKeys).toEqual([])",
        "restoredDamageStep.missingRegistryKeys).toEqual([])",
        "restoredChain.missingRegistryKeys).toEqual([])",
        "restoredBattle.missingRegistryKeys).toEqual([])",
        "effectLabelObjectUid: costSpirit!.uid",
        "currentAttack(restoredCrow",
        "battleDamage[1]).toBe(200)",
        "host.messages).not.toContain",
      ],
    },
  ];
}
