import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const statFixtureCount = 3;

describe("Lua real stat restore coverage", () => {
  it("requires stat-changing fixtures to assert clean Lua registry restore and restored battle outcomes", () => {
    const files = statFixtureFiles();
    expect(files).toHaveLength(statFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("battleDamage")
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function statFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-fortune-lady-past-set-attack.test.ts",
      required: [
        "code: 101",
        "code: 105",
        'type === "declareAttack"',
        "lifePoints).toBe(7700)",
      ],
    },
    {
      file: "test/lua-real-script-mirage-knight-battle-target-atk.test.ts",
      required: [
        'battleWindow?.kind).toBe("duringDamageCalculation")',
        "currentAttack(restoredDamageCalc.session.state.cards.find((card) => card.uid === mirage!.uid)!, restoredDamageCalc.session.state)).toBe(4700)",
        "expect(restoredDamageCalc.session.state.battleDamage).toEqual({ 0: 0, 1: 2800 })",
        'eventName: "battleDamageDealt"',
        'location: "banished"',
      ],
    },
    {
      file: "test/lua-real-script-shrink-set-base-attack.test.ts",
      required: [
        "restoredChain.missingRegistryKeys).toEqual([])",
        "restoredChain.missingChainLimitRegistryKeys).toEqual([])",
        "restoredBattle.missingRegistryKeys).toEqual([])",
        "restoredBattle.missingChainLimitRegistryKeys).toEqual([])",
        "code: 103",
        "value: 1000",
        'type === "passChain"',
        'type === "declareAttack"',
        "host.messages).not.toContain",
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
