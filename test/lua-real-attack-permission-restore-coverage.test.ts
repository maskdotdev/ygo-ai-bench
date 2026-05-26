import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const attackPermissionFixtureCount = 7;
const attackPermissionKindCounts = {
  attackAllOwnMonsterLock: 1,
  attackCostPayment: 1,
  activationOathLock: 1,
  goukiNonGoukiAttackLock: 2,
  summonTurnLock: 1,
  summonTurnStatusLock: 1,
} satisfies Record<AttackPermissionKind, number>;
const attackPermissionSemanticVariantCounts = {
  bigTuskedMammothSummonTurnPredicateLock: 1,
  darkElfLpAttackCostPayment: 1,
  misfortuneActivationOathCannotAttackLock: 1,
  trueSunGodSpecialSummonStatusAttackLock: 1,
  ultimateTyrannoOwnMonsterAttackAllLock: 1,
} satisfies Record<AttackPermissionSemanticVariant, number>;

type AttackPermissionKind =
  | "attackAllOwnMonsterLock"
  | "attackCostPayment"
  | "activationOathLock"
  | "goukiNonGoukiAttackLock"
  | "summonTurnLock"
  | "summonTurnStatusLock";
type AttackPermissionSemanticVariant =
  | "bigTuskedMammothSummonTurnPredicateLock"
  | "darkElfLpAttackCostPayment"
  | "misfortuneActivationOathCannotAttackLock"
  | "trueSunGodSpecialSummonStatusAttackLock"
  | "ultimateTyrannoOwnMonsterAttackAllLock";

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

  it("keeps named attack-permission semantic variants explicit", () => {
    expect(countAttackPermissionSemanticVariants(realScriptAttackPermissionSemanticVariants())).toEqual(attackPermissionSemanticVariantCounts);

    const weak = realScriptAttackPermissionSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
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
      file: "test/lua-real-script-gouki-finishing-move-link-attack-pierce-lock.test.ts",
      kind: "goukiNonGoukiAttackLock",
      required: [
        'const finishingMoveCode = "35870016"',
        "ge1:SetCode(EFFECT_CANNOT_ATTACK_ANNOUNCE)",
        "ge1:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)",
        "target:not-setcode:252",
        "action.type === \"declareAttack\" && action.attackerUid === nonGouki.uid",
        "action.type === \"declareAttack\" && action.attackerUid === goukiLink.uid",
      ],
    },
    {
      file: "test/lua-real-script-gouki-finishing-move-link-pierce-lock-stat.test.ts",
      kind: "goukiNonGoukiAttackLock",
      required: [
        'const finishingMoveCode = "35870016"',
        "ge1:SetCode(EFFECT_CANNOT_ATTACK_ANNOUNCE)",
        "ge1:SetProperty(EFFECT_FLAG_IGNORE_IMMUNE)",
        "targetRange: [4, 0]",
        "effectCannotAttackAnnounce",
        "nonGouki",
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
      goukiNonGoukiAttackLock: 0,
      summonTurnLock: 0,
      summonTurnStatusLock: 0,
    },
  );
}

function realScriptAttackPermissionSemanticVariants(): Array<{
  file: string;
  kind: AttackPermissionSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-big-tusked-mammoth-summon-turn-attack-lock.test.ts",
      kind: "bigTuskedMammothSummonTurnPredicateLock",
      required: [
        'const mammothCode = "59380081"',
        "restores its field cannot-attack status predicate while leaving ordinary attackers legal",
        "targetRange: [0, 0x04]",
        "hasAttack(actions, freshAttacker.uid, mammoth.uid)).toBe(false)",
        "big tusked mammoth can attack false/true",
      ],
    },
    {
      file: "test/lua-real-script-dark-elf-attack-cost.test.ts",
      kind: "darkElfLpAttackCostPayment",
      required: [
        'const darkElfCode = "21417692"',
        "restores Dark Elf after its attack cost is paid",
        "does not expose Dark Elf attacks when the LP attack cost cannot be paid",
        "attackCostPaid).toBe(1)",
        'eventName: "lifePointCostPaid"',
      ],
    },
    {
      file: "test/lua-real-script-misfortune-cannot-attack-lock.test.ts",
      kind: "misfortuneActivationOathCannotAttackLock",
      required: [
        'const misfortuneCode = "1036974"',
        "restores its activation-cost attack oath and suppresses later battle actions",
        "targetRange: [0x04, 0]",
        "misfortune attacker can attack false",
        "code === 85",
      ],
    },
    {
      file: "test/lua-real-script-true-sun-god-special-summon-attack-lock.test.ts",
      kind: "trueSunGodSpecialSummonStatusAttackLock",
      required: [
        'const sunGodCode = "11587414"',
        "restores its Special-Summoned-this-turn attack lock while leaving ordinary attackers legal",
        "hasAttack(actions, specialAttacker.uid, target.uid)).toBe(false)",
        "hasAttack(actions, normalAttacker.uid, target.uid)).toBe(true)",
        "true sun god can attack false/true",
      ],
    },
    {
      file: "test/lua-real-script-ultimate-tyranno-attack-lock.test.ts",
      kind: "ultimateTyrannoOwnMonsterAttackAllLock",
      required: [
        'const tyrannoCode = "15894048"',
        "restores its conditional own-monster attack lock while leaving Ultimate Tyranno's attacks legal",
        "code: 193",
        "hasAttack(actions, tyranno.uid, firstTarget.uid)).toBe(true)",
        "ultimate tyranno can attack true/false",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: AttackPermissionSemanticVariant;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countAttackPermissionSemanticVariants(
  fixtures: Array<{ kind: AttackPermissionSemanticVariant }>,
): Record<AttackPermissionSemanticVariant, number> {
  return fixtures.reduce<Record<AttackPermissionSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      bigTuskedMammothSummonTurnPredicateLock: 0,
      darkElfLpAttackCostPayment: 0,
      misfortuneActivationOathCannotAttackLock: 0,
      trueSunGodSpecialSummonStatusAttackLock: 0,
      ultimateTyrannoOwnMonsterAttackAllLock: 0,
    },
  );
}
