import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const damageCalculationFixtureCount = 4;
const damageCalculationKindCounts = {
  calculateDamageRetarget: 2,
  effectDamageReflection: 1,
  persistentDamageCalculationDebuff: 1,
} satisfies Record<DamageCalculationKind, number>;

type DamageCalculationKind = "calculateDamageRetarget" | "effectDamageReflection" | "persistentDamageCalculationDebuff";

describe("Lua real damage calculation restore coverage", () => {
  it("requires restored damage calculation and reflection fixtures to prove clean restore and final outcomes", () => {
    const files = damageCalculationFixtureFiles();
    expect(files).toHaveLength(damageCalculationFixtureCount);

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
          || !text.includes("applyLuaRestoreResponse")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps damage-calculation fixture kinds explicit", () => {
    expect(countDamageCalculationKinds(damageCalculationFixtureFiles())).toEqual(damageCalculationKindCounts);
  });
});

function damageCalculationFixtureFiles(): Array<{
  file: string;
  kind: DamageCalculationKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-dispatchparazzi-calculate-damage.test.ts",
      kind: "calculateDamageRetarget",
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
      kind: "calculateDamageRetarget",
      required: [
        "pendingBattle).toBeUndefined()",
        'position: "faceUpDefense"',
        "players[0].lifePoints).toBe(8000)",
        "players[1].lifePoints).toBe(8000)",
      ],
    },
    {
      file: "test/lua-real-script-natures-reflection-reflect-damage.test.ts",
      kind: "effectDamageReflection",
      required: [
        "reflect-damage:opponent-non-continuous",
        'eventName: "damageDealt"',
        "players[0].lifePoints).toBe(6500)",
        "players[1].lifePoints).toBe(8000)",
      ],
    },
    {
      file: "test/lua-real-script-shadow-spell-goat-damage-calculation-persistent.test.ts",
      kind: "persistentDamageCalculationDebuff",
      required: [
        'battleWindow?.kind).toBe("duringDamageCalculation")',
        "EFFECT_FLAG_DAMAGE_CAL",
        "property: 0x8000",
        "shadow spell persistent true/true/1/1500",
        "host.messages).not.toContain(\"shadow spell responder resolved\")",
        "battleDamage[0]).toBe(500)",
        "players[0].lifePoints).toBe(7500)",
        "reason: duelReason.effect | duelReason.destroy",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: DamageCalculationKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countDamageCalculationKinds(
  fixtures: Array<{ kind: DamageCalculationKind }>,
): Record<DamageCalculationKind, number> {
  return fixtures.reduce<Record<DamageCalculationKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      calculateDamageRetarget: 0,
      effectDamageReflection: 0,
      persistentDamageCalculationDebuff: 0,
    },
  );
}
