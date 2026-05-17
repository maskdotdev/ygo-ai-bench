import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const attackPermissionFixtureCount = 5;
const attackPermissionKindCounts = {
  attackAllOwnMonsterLock: 1,
  attackCostPayment: 1,
  activationOathLock: 1,
  summonTurnLock: 1,
  summonTurnStatusLock: 1,
} satisfies Record<AttackPermissionKind, number>;

type AttackPermissionKind =
  | "attackAllOwnMonsterLock"
  | "attackCostPayment"
  | "activationOathLock"
  | "summonTurnLock"
  | "summonTurnStatusLock";

describe("Lua real attack-permission restore coverage", () => {
  it("requires representative attack permission and cost fixtures to assert clean Lua restore", () => {
    const files = realScriptAttackPermissionFixtureFiles();
    expect(files).toHaveLength(attackPermissionFixtureCount);

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
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps attack-permission fixture kinds explicit", () => {
    expect(countAttackPermissionKinds(realScriptAttackPermissionFixtureFiles())).toEqual(attackPermissionKindCounts);
  });
});

function realScriptAttackPermissionFixtureFiles(): Array<{
  file: string;
  kind: AttackPermissionKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-big-tusked-mammoth-summon-turn-attack-lock.test.ts",
      kind: "summonTurnLock",
      required: [
        "code: 85",
        "hasAttack(actions, freshAttacker.uid, mammoth.uid)).toBe(false)",
        "big tusked mammoth can attack false/true",
      ],
    },
    {
      file: "test/lua-real-script-dark-elf-attack-cost.test.ts",
      kind: "attackCostPayment",
      required: [
        "code: 96",
        "attackCostPaid).toBe(1)",
        "lifePointCostPaid",
      ],
    },
    {
      file: "test/lua-real-script-misfortune-cannot-attack-lock.test.ts",
      kind: "activationOathLock",
      required: [
        "code === 85",
        "targetRange: [0x04, 0]",
        "misfortune attacker can attack false",
      ],
    },
    {
      file: "test/lua-real-script-true-sun-god-special-summon-attack-lock.test.ts",
      kind: "summonTurnStatusLock",
      required: [
        "code: 85",
        "hasAttack(actions, specialAttacker.uid, target.uid)).toBe(false)",
        "true sun god can attack false/true",
      ],
    },
    {
      file: "test/lua-real-script-ultimate-tyranno-attack-lock.test.ts",
      kind: "attackAllOwnMonsterLock",
      required: [
        "code: 85",
        "code: 193",
        "ultimate tyranno can attack true/false",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: AttackPermissionKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countAttackPermissionKinds(
  fixtures: Array<{ kind: AttackPermissionKind }>,
): Record<AttackPermissionKind, number> {
  return fixtures.reduce<Record<AttackPermissionKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      attackAllOwnMonsterLock: 0,
      attackCostPayment: 0,
      activationOathLock: 0,
      summonTurnLock: 0,
      summonTurnStatusLock: 0,
    },
  );
}
