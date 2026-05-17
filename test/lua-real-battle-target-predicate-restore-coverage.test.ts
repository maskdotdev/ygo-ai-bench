import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const battleTargetPredicateFixtureCount = 6;
const battleTargetPredicateKindCounts = {
  auxImval1Lock: 1,
  auxImval2Protection: 1,
  endDamageTargetLock: 1,
  nonMatchingSelectionLock: 1,
  statProtectedAllyLock: 1,
  syntheticPredicateDescriptors: 1,
} satisfies Record<BattleTargetPredicateKind, number>;

type BattleTargetPredicateKind =
  | "auxImval1Lock"
  | "auxImval2Protection"
  | "endDamageTargetLock"
  | "nonMatchingSelectionLock"
  | "statProtectedAllyLock"
  | "syntheticPredicateDescriptors";

describe("Lua real battle target predicate restore coverage", () => {
  it("requires battle-target predicate fixtures to assert clean Lua registry restore and restored predicates", () => {
    const files = battleTargetPredicateFixtureFiles();
    expect(files).toHaveLength(battleTargetPredicateFixtureCount);

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

  it("keeps battle-target predicate fixture kinds explicit", () => {
    expect(countBattleTargetPredicateKinds(battleTargetPredicateFixtureFiles())).toEqual(battleTargetPredicateKindCounts);
  });
});

function battleTargetPredicateFixtureFiles(): Array<{
  file: string;
  kind: BattleTargetPredicateKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-battle-target-predicates.test.ts",
      kind: "syntheticPredicateDescriptors",
      required: [
        "target:source-battle-target-type:64",
        "target:source-or-battle-target",
        "target:source-battle-target",
        "currentAttack = { attackerUid:",
        "targetCardPredicate",
      ],
    },
    {
      file: "test/lua-real-script-battle-protection.test.ts",
      kind: "auxImval2Protection",
      required: [
        "restores Machina Sniper and removes other Machina monsters from battle targets",
        "restores Soul-Absorbing Bone Tower and keeps aux.imval2 battle targeting scoped to the attacker",
        "targetCardPredicate",
        "valueCardPredicate",
        "expectAttackTarget(restored.session, attacker!.uid, boneTower!.uid, false)",
        "expectAttackTarget(restored.session, attacker!.uid, zombie!.uid, true)",
      ],
    },
    {
      file: "test/lua-real-script-command-knight-battle-target-lock.test.ts",
      kind: "auxImval1Lock",
      required: [
        "restores its aux.imval1 battle target lock while another controller monster is present",
        "code === 70",
        "valueCardPredicate",
        "hasAttack(actions, attacker.uid, commandKnight.uid)).toBe(false)",
        "hasAttack(actions, attacker.uid, openTarget.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-decoyroid-battle-target-selection-lock.test.ts",
      kind: "nonMatchingSelectionLock",
      required: [
        "restores its non-Decoyroid battle target selection lock",
        "code === 332",
        "valueCardPredicate",
        "hasAttack(actions, attacker.uid, decoyroid.uid)).toBe(true)",
        "hasAttack(actions, attacker.uid, protectedTarget.uid)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-hunter-owl-wind-target-stat.test.ts",
      kind: "statProtectedAllyLock",
      required: [
        "hasAttack(actions, attacker.uid, hunterOwl.uid)).toBe(false)",
        "hasAttack(actions, attacker.uid, windAlly.uid)).toBe(true)",
        "hunter owl target/stat protected",
        "valueCardPredicate",
      ],
    },
    {
      file: "test/lua-real-script-solar-flare-end-damage-target-lock.test.ts",
      kind: "endDamageTargetLock",
      required: [
        "hasAttack(battleActions, attacker.uid, solarFlare.uid)).toBe(false)",
        "hasAttack(battleActions, attacker.uid, pyroAlly.uid)).toBe(true)",
        "triggerBucket: \"turnMandatory\"",
        'eventName: "damageDealt"',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: BattleTargetPredicateKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countBattleTargetPredicateKinds(
  fixtures: Array<{ kind: BattleTargetPredicateKind }>,
): Record<BattleTargetPredicateKind, number> {
  return fixtures.reduce<Record<BattleTargetPredicateKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      auxImval1Lock: 0,
      auxImval2Protection: 0,
      endDamageTargetLock: 0,
      nonMatchingSelectionLock: 0,
      statProtectedAllyLock: 0,
      syntheticPredicateDescriptors: 0,
    },
  );
}
