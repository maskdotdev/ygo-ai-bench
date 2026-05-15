import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const damageCalculationFixtureCount = 4;

describe("Lua real damage calculation restore coverage", () => {
  it("requires restored damage calculation and reflection fixtures to prove clean restore and final outcomes", () => {
    const files = damageCalculationFixtureFiles();
    expect(files).toHaveLength(damageCalculationFixtureCount);

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
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function damageCalculationFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-dispatchparazzi-calculate-damage.test.ts",
      required: [
        'eventName: "battleDamageDealt"',
        "players[1].lifePoints).toBe(6300)",
        "players[1].lifePoints).toBe(7200)",
        "pendingBattle).toBeUndefined()",
        'eventName: "destroyed"',
      ],
    },
    {
      file: "test/lua-real-script-gagaga-samurai-calculate-damage.test.ts",
      required: [
        "pendingBattle).toBeUndefined()",
        'position: "faceUpDefense"',
        "players[0].lifePoints).toBe(8000)",
        "players[1].lifePoints).toBe(8000)",
      ],
    },
    {
      file: "test/lua-real-script-natures-reflection-reflect-damage.test.ts",
      required: [
        "reflect-damage:opponent-non-continuous",
        'eventName: "damageDealt"',
        "players[0].lifePoints).toBe(6500)",
        "players[1].lifePoints).toBe(8000)",
      ],
    },
    {
      file: "test/lua-real-script-shadow-spell-goat-damage-calculation-persistent.test.ts",
      required: [
        'battleWindow?.kind).toBe("duringDamageCalculation")',
        "EFFECT_FLAG_DAMAGE_CAL",
        "shadow spell persistent true/true/1/1500",
        "host.messages).not.toContain(\"shadow spell responder resolved\")",
        "battleDamage[0]).toBe(500)",
        "players[0].lifePoints).toBe(7500)",
        "reason: duelReason.effect | duelReason.destroy",
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
