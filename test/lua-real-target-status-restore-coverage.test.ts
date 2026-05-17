import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const targetStatusFixtureCount = 4;
const targetStatusKindCounts = {
  notCodeStatus: 1,
  notStatus: 1,
  status: 1,
  summonLocationStatus: 1,
} satisfies Record<TargetStatusKind, number>;
const targetStatusSemanticVariantCounts = {
  mammothGraveyardTargetStatusMask: 1,
  spiritInvitationNotStatusMaskPredicate: 1,
  sprindStatusSummonLocationPredicate: 1,
  trueSunGodNotRaSpecialSummonedAttackLock: 1,
} satisfies Record<TargetStatusSemanticVariant, number>;

type TargetStatusKind = "notCodeStatus" | "notStatus" | "status" | "summonLocationStatus";
type TargetStatusSemanticVariant =
  | "mammothGraveyardTargetStatusMask"
  | "spiritInvitationNotStatusMaskPredicate"
  | "sprindStatusSummonLocationPredicate"
  | "trueSunGodNotRaSpecialSummonedAttackLock";

describe("Lua real target-status restore coverage", () => {
  it("requires target-status descriptor fixtures to assert clean Lua registry restore and restored predicate truth tables", () => {
    const files = targetStatusFixtureFiles();
    expect(files).toHaveLength(targetStatusFixtureCount);

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
          || !text.includes("targetCardPredicate")
          || !text.includes("toBe(true)")
          || !text.includes("toBe(false)")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps target-status fixture kinds explicit", () => {
    expect(countTargetStatusKinds(targetStatusFixtureFiles())).toEqual(targetStatusKindCounts);
  });

  it("keeps named target-status semantic variants explicit", () => {
    expect(countTargetStatusSemanticVariants(targetStatusSemanticVariants())).toEqual(targetStatusSemanticVariantCounts);

    const weak = targetStatusSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function targetStatusFixtureFiles(): Array<{
  file: string;
  kind: TargetStatusKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-target-status-not.test.ts",
      kind: "notStatus",
      required: [
        "target:not-status:",
        "summonType = \"link\"",
        "customStatusMask = 0x20",
      ],
    },
    {
      file: "test/lua-real-script-target-status-summon-location.test.ts",
      kind: "summonLocationStatus",
      required: [
        "target:status-summon-location:",
        "previousLocation = \"extraDeck\"",
        "previousLocation = \"hand\"",
      ],
    },
    {
      file: "test/lua-real-script-target-status.test.ts",
      kind: "status",
      required: [
        "target:status:",
        "summonType = \"link\"",
        "customStatusMask = 0x20000000",
      ],
    },
    {
      file: "test/lua-real-script-true-sun-god-special-summon-attack-lock.test.ts",
      kind: "notCodeStatus",
      required: [
        "target:not-code-status:10000010:1073741824",
        "hasAttack(actions, specialAttacker.uid, target.uid)).toBe(false)",
        "customStatusMask = 0x40000000",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: TargetStatusKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countTargetStatusKinds(fixtures: Array<{ kind: TargetStatusKind }>): Record<TargetStatusKind, number> {
  return fixtures.reduce<Record<TargetStatusKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      notCodeStatus: 0,
      notStatus: 0,
      status: 0,
      summonLocationStatus: 0,
    },
  );
}

function targetStatusSemanticVariants(): Array<{
  file: string;
  kind: TargetStatusSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-target-status.test.ts",
      kind: "mammothGraveyardTargetStatusMask",
      required: [
        'const mammothCode = "59380081"',
        "restores target predicates using IsStatus masks",
        "customStatusMask = 0x20000000",
      ],
    },
    {
      file: "test/lua-real-script-target-status-not.test.ts",
      kind: "spiritInvitationNotStatusMaskPredicate",
      required: [
        'const invitationCode = "86527709"',
        "restores target predicates using not IsStatus masks",
        "customStatusMask = 0x20",
      ],
    },
    {
      file: "test/lua-real-script-target-status-summon-location.test.ts",
      kind: "sprindStatusSummonLocationPredicate",
      required: [
        'const legacyCode = "88851326"',
        "restores target predicates combining IsStatus and IsSummonLocation",
        "previousLocation = \"extraDeck\"",
      ],
    },
    {
      file: "test/lua-real-script-true-sun-god-special-summon-attack-lock.test.ts",
      kind: "trueSunGodNotRaSpecialSummonedAttackLock",
      required: [
        'const sunGodCode = "11587414"',
        "restores its Special-Summoned-this-turn attack lock while leaving ordinary attackers legal",
        "hasAttack(actions, specialAttacker.uid, target.uid)).toBe(false)",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: TargetStatusSemanticVariant;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countTargetStatusSemanticVariants(
  fixtures: Array<{ kind: TargetStatusSemanticVariant }>,
): Record<TargetStatusSemanticVariant, number> {
  return fixtures.reduce<Record<TargetStatusSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      mammothGraveyardTargetStatusMask: 0,
      spiritInvitationNotStatusMaskPredicate: 0,
      sprindStatusSummonLocationPredicate: 0,
      trueSunGodNotRaSpecialSummonedAttackLock: 0,
    },
  );
}
