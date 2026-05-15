import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const attackCostAndStatFixtureCount = 7;
const legalActionFixtureCount = 4;

describe("Lua real attack cost and attack-stat restore coverage", () => {
  it("requires attack-cost and ATK-threshold restore fixtures to assert clean Lua registry restore", () => {
    const files = attackCostAndStatFixtureFiles();
    expect(files).toHaveLength(attackCostAndStatFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires UI-facing legal-action parity where restored ATK-threshold locks expose actions", () => {
    const files = legalActionFixtureFiles();
    expect(files).toHaveLength(legalActionFixtureCount);

    const missing = files
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("getLuaRestoreLegalActions");
      });

    expect(missing).toEqual([]);
  });
});

function attackCostAndStatFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "lua-real-script-burden-mighty-dynamic-stat.test.ts",
      required: [
        "burden of the mighty attack 1000/1300/1800",
        "getLuaRestoreLegalActionGroups(restoredChain, 1)",
        "expect(restoredStat.session.state.battleDamage[0]).toBe(800)",
        "players[0].lifePoints).toBe(7200)",
      ],
    },
    {
      file: "lua-real-script-fusion-devourer-field-stat.test.ts",
      required: [
        "code: 102",
        "targetRange: [0, 0x04]",
        'battleWindow?.kind).toBe("startDamageStep")',
        "expect(restored.session.state.battleDamage[1]).toBe(devourer!.data.attack)",
      ],
    },
    {
      file: "lua-real-script-panther-warrior-attack-cost.test.ts",
      required: [
        "attackCostPaid).toBe(1)",
        'eventName: "released"',
        "passBattleResponses(restored.session)",
        "players[1].lifePoints).toBe(7500)",
      ],
    },
    {
      file: "lua-real-script-dark-elf-attack-cost.test.ts",
      required: [
        "attackCostPaid).toBe(1)",
        'eventName: "lifePointCostPaid"',
        "players[0].lifePoints).toBe(7000)",
        "players[1].lifePoints).toBe(7500)",
      ],
    },
    {
      file: "lua-real-script-rb-last-stand-extra-machine-current-attack-lock.test.ts",
      required: [
        "special-summon-limit:not-race-attack-lte-extra:32:1500",
        "rb last high machine special 0",
        "rb last low machine special 1",
        "rb last deck special 1",
      ],
    },
    {
      file: "lua-real-script-rb-stage-landing-extra-machine-low-attack-lock.test.ts",
      required: [
        "special-summon-limit:not-race-base-attack-lte-extra:32:1500",
        "rb stage high machine special 0",
        "rb stage low machine special 1",
        "rb stage deck special 1",
      ],
    },
    {
      file: "lua-real-script-valcan-booster-lizard-attack-lock.test.ts",
      required: [
        "target:not-original-race-text-attack-lte:32:1500",
        "targetCardPredicate",
        "effect!.targetCardPredicate!(ctx, machine1500!)).toBe(false)",
        "effect!.targetCardPredicate!(ctx, machine1000!)).toBe(true)",
      ],
    },
  ]
    .map(({ file, required }) => ({ file: path.join("test", file), required }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function legalActionFixtureFiles(): string[] {
  return [
    "lua-real-script-dark-elf-attack-cost.test.ts",
    "lua-real-script-panther-warrior-attack-cost.test.ts",
    "lua-real-script-rb-last-stand-extra-machine-current-attack-lock.test.ts",
    "lua-real-script-rb-stage-landing-extra-machine-low-attack-lock.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}
