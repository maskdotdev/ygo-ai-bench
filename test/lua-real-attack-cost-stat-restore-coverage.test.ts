import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const attackCostAndStatFixtureCount = 8;
const legalActionFixtureCount = 4;
const attackCostAndStatKindCounts = {
  attackCostLp: 1,
  attackCostRelease: 1,
  baseAttackExtraDeckLock: 1,
  currentAttackExtraDeckLock: 1,
  dynamicFieldStat: 1,
  dynamicLinkedGroupStat: 1,
  fieldSetAttack: 1,
  targetAttackPredicate: 1,
} satisfies Record<AttackCostAndStatKind, number>;

type AttackCostAndStatKind =
  | "attackCostLp"
  | "attackCostRelease"
  | "baseAttackExtraDeckLock"
  | "currentAttackExtraDeckLock"
  | "dynamicFieldStat"
  | "dynamicLinkedGroupStat"
  | "fieldSetAttack"
  | "targetAttackPredicate";

describe("Lua real attack cost and attack-stat restore coverage", () => {
  it("requires attack-cost and ATK-threshold restore fixtures to assert clean Lua registry restore", () => {
    const files = attackCostAndStatFixtureFiles();
    expect(files).toHaveLength(attackCostAndStatFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires UI-facing legal-action parity where restored ATK-threshold locks expose actions", () => {
    const files = legalActionFixtureFiles();
    expect(files).toHaveLength(legalActionFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("getLuaRestoreLegalActions");
      });

    expect(missing).toEqual([]);
  });

  it("keeps attack-cost and attack-stat fixture kinds explicit", () => {
    expect(countAttackCostAndStatKinds(attackCostAndStatFixtureFiles())).toEqual(attackCostAndStatKindCounts);
  });
});

function attackCostAndStatFixtureFiles(): Array<{
  file: string;
  kind: AttackCostAndStatKind;
  required: string[];
}> {
  return ([
    {
      file: "lua-real-script-burden-mighty-dynamic-stat.test.ts",
      kind: "dynamicFieldStat",
      required: [
        "burden of the mighty attack 1000/1300/1800",
        "getLuaRestoreLegalActionGroups(restoredChain, 1)",
        "expect(restoredStat.session.state.battleDamage[0]).toBe(800)",
        "players[0].lifePoints).toBe(7200)",
      ],
    },
    {
      file: "lua-real-script-elphase-linked-group-stat.test.ts",
      kind: "dynamicLinkedGroupStat",
      required: [
        "restores GetLinkedGroupCount dynamic ATK from the monster it points to",
        "currentAttack(elphase, session.state)).toBe((elphase.data.attack ?? 0) + 300)",
        "currentAttack(restoredElphase, restored.session.state)).toBe((elphase.data.attack ?? 0) + 300)",
        "elphase linked group stat 1/",
      ],
    },
    {
      file: "lua-real-script-fusion-devourer-field-stat.test.ts",
      kind: "fieldSetAttack",
      required: [
        "code: 102",
        "targetRange: [0, 0x04]",
        'battleWindow?.kind).toBe("startDamageStep")',
        "expect(restored.session.state.battleDamage[1]).toBe(devourer!.data.attack)",
      ],
    },
    {
      file: "lua-real-script-panther-warrior-attack-cost.test.ts",
      kind: "attackCostRelease",
      required: [
        "attackCostPaid).toBe(1)",
        'eventName: "released"',
        "passBattleResponses(restored.session)",
        "players[1].lifePoints).toBe(7500)",
      ],
    },
    {
      file: "lua-real-script-dark-elf-attack-cost.test.ts",
      kind: "attackCostLp",
      required: [
        "attackCostPaid).toBe(1)",
        'eventName: "lifePointCostPaid"',
        "players[0].lifePoints).toBe(7000)",
        "players[1].lifePoints).toBe(7500)",
      ],
    },
    {
      file: "lua-real-script-rb-last-stand-extra-machine-current-attack-lock.test.ts",
      kind: "currentAttackExtraDeckLock",
      required: [
        "special-summon-limit:not-race-attack-lte-extra:32:1500",
        "rb last high machine special 0",
        "rb last low machine special 1",
        "rb last deck special 1",
      ],
    },
    {
      file: "lua-real-script-rb-stage-landing-extra-machine-low-attack-lock.test.ts",
      kind: "baseAttackExtraDeckLock",
      required: [
        "special-summon-limit:not-race-base-attack-lte-extra:32:1500",
        "rb stage high machine special 0",
        "rb stage low machine special 1",
        "rb stage deck special 1",
      ],
    },
    {
      file: "lua-real-script-valcan-booster-lizard-attack-lock.test.ts",
      kind: "targetAttackPredicate",
      required: [
        "target:not-original-race-text-attack-lte:32:1500",
        "targetCardPredicate",
        "effect!.targetCardPredicate!(ctx, machine1500!)).toBe(false)",
        "effect!.targetCardPredicate!(ctx, machine1000!)).toBe(true)",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: AttackCostAndStatKind;
    required: string[];
  }>)
    .map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }))
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

function countAttackCostAndStatKinds(
  fixtures: Array<{ kind: AttackCostAndStatKind }>,
): Record<AttackCostAndStatKind, number> {
  return fixtures.reduce<Record<AttackCostAndStatKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      attackCostLp: 0,
      attackCostRelease: 0,
      baseAttackExtraDeckLock: 0,
      currentAttackExtraDeckLock: 0,
      dynamicFieldStat: 0,
      dynamicLinkedGroupStat: 0,
      fieldSetAttack: 0,
      targetAttackPredicate: 0,
    },
  );
}
