import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Lua real material restriction restore coverage", () => {
  it("requires material and special-summon restriction fixtures to assert clean restore and restored gates", () => {
    const missing = restrictionFixtureFiles()
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

function restrictionFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-necro-vulture-rank-up-magic-xyz-lock.test.ts",
      required: [
        "target:xyz-summon-not-related-setcode:149",
        "luaSummonTypeXyz",
        "targetCardPredicate",
        "luaBaseEffectId(offSetEffectId!)",
        "luaBaseEffectId(rumEffectId!)",
        "toBe(true)",
        "toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-concours-material-lock.test.ts",
      required: [
        "code: 248",
        "target:not-setcode-any:",
        "cannot-material:controller-summon-types:",
        "fusionSummonDuelCard(restored.session.state, 0, blockedFusion!.uid",
        "cannot be used as fusion material",
        "fusionSummonDuelCard(restored.session.state, 1, opponentFusion!.uid",
        "fusionSummonDuelCard(restored.session.state, 0, allowedFusion!.uid",
      ],
    },
    {
      file: "test/lua-real-script-kewl-tune-synchro-tuner-lock.test.ts",
      required: [
        "Duel.IsPlayerCanSpecialSummon",
        "Duel.SpecialSummon(non_tuner",
        "Duel.SpecialSummon(tuner",
        "kewl tune can special true/false",
        "kewl tune non-tuner special 0",
        "kewl tune tuner special 1",
      ],
    },
    {
      file: "test/lua-real-script-r-genex-oracle-synchro-material-lock.test.ts",
      required: [
        "code: 236",
        "cannot-material:target-not-setcode:2",
        'action.type === "synchroSummon"',
        "synchroSummonDuelCard(restored.session.state",
        "cannot be used as synchro material",
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
