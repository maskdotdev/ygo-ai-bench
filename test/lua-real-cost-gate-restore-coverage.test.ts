import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const costGateFixtureCount = 4;
const costGateKindCounts = {
  actionCostGate: 1,
  costCreatedSpecialOath: 1,
  ritualExtraDeckLock: 1,
  summonTypeCostPredicate: 1,
} satisfies Record<CostGateKind, number>;

type CostGateKind = "actionCostGate" | "costCreatedSpecialOath" | "ritualExtraDeckLock" | "summonTypeCostPredicate";

describe("Lua real cost gate restore coverage", () => {
  it("requires summon and action cost fixtures to assert clean Lua registry restore and restored gates", () => {
    const files = costGateFixtureFiles();
    expect(files).toHaveLength(costGateFixtureCount);

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
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps cost-gate fixture kinds explicit", () => {
    expect(countCostGateKinds(costGateFixtureFiles())).toEqual(costGateKindCounts);
  });
});

function costGateFixtureFiles(): Array<{
  file: string;
  kind: CostGateKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-spsummon-cost.test.ts",
      kind: "summonTypeCostPredicate",
      required: [
        "cost:special-summon-type-not:",
        "cost:special-summon-type-is:",
        "kochi blocked false",
        "kochi open true",
        "restoredCost?.({ summonTypeCode: luaSummonTypeSpecial + 181 }",
        "restoredCost?.({ summonTypeCode: luaSummonTypeSpecial + 182 }",
        "summonTypeCode:",
      ],
    },
    {
      file: "test/lua-real-script-summon-set-cost.test.ts",
      kind: "actionCostGate",
      required: [
        "restoredBlocked.missingRegistryKeys).toEqual([])",
        "restoredBlocked.missingChainLimitRegistryKeys).toEqual([])",
        "restoredOpen.missingRegistryKeys).toEqual([])",
        "restoredOpen.missingChainLimitRegistryKeys).toEqual([])",
        'type: "normalSummon"',
        'type: "setMonster"',
        'type: "setSpellTrap"',
        'type: "activateEffect"',
        "canSpecialSummonDuelCard(restoredBlocked.session.state",
        "canSpecialSummonDuelCard(restoredOpen.session.state",
        "lifePoints).toBe(1)",
      ],
    },
    {
      file: "test/lua-real-script-dogmatikalamity-extra-ritual-lock.test.ts",
      kind: "ritualExtraDeckLock",
      required: [
        "restored.missingRegistryKeys).toEqual([])",
        "restored.missingChainLimitRegistryKeys).toEqual([])",
        'luaTargetDescriptor: "special-summon-limit:extra"',
        "canSpecialSummonDuelCard(session.state, pendulumExtra!.uid, 0)).toBe(true)",
        "canSpecialSummonDuelCard(restored.session.state, pendulumExtra!.uid, 0)).toBe(false)",
        "canSpecialSummonDuelCard(restored.session.state, pendulumExtra!.uid, 0)).toBe(true)",
        'summonType: "ritual"',
      ],
    },
    {
      file: "test/lua-real-script-thunder-sea-horse-special-oath.test.ts",
      kind: "costCreatedSpecialOath",
      required: [
        "cost-created temporary EFFECT_CANNOT_SPECIAL_SUMMON",
        "restoredLock.missingRegistryKeys).toEqual([])",
        "restoredLock.missingChainLimitRegistryKeys).toEqual([])",
        "getLuaRestoreLegalActions(restoredLock, 0)).toEqual(getLegalActions(restoredLock.session, 0))",
        "sea horse can special locked false",
        "sea horse special locked 0",
        "sea horse can special after end true",
        "sea horse special after end 1",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: CostGateKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countCostGateKinds(fixtures: Array<{ kind: CostGateKind }>): Record<CostGateKind, number> {
  return fixtures.reduce<Record<CostGateKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      actionCostGate: 0,
      costCreatedSpecialOath: 0,
      ritualExtraDeckLock: 0,
      summonTypeCostPredicate: 0,
    },
  );
}
