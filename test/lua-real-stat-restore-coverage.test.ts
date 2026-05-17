import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const statFixtureCount = 4;
const statKindCounts = {
  battleTargetAttackBoost: 1,
  setAttack: 1,
  setBaseAttack: 1,
  staticAttackAndExtraAttack: 1,
} satisfies Record<StatKind, number>;

type StatKind = "battleTargetAttackBoost" | "setAttack" | "setBaseAttack" | "staticAttackAndExtraAttack";

describe("Lua real stat restore coverage", () => {
  it("requires stat-changing fixtures to assert clean Lua registry restore and restored battle outcomes", () => {
    const files = statFixtureFiles();
    expect(files).toHaveLength(statFixtureCount);

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
          || !text.includes("battleDamage")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps stat fixture kinds explicit", () => {
    expect(countStatKinds(statFixtureFiles())).toEqual(statKindCounts);
  });
});

function statFixtureFiles(): Array<{
  file: string;
  kind: StatKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-d-force-plasma-stat-extra-attack.test.ts",
      kind: "staticAttackAndExtraAttack",
      required: [
        "code ?? -1",
        "d force plasma attack 2200",
        "expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 1200 })",
        "players[1].lifePoints).toBe(6800)",
        "hasAttack(secondActions, plasma!.uid, secondTarget!.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-fortune-lady-past-set-attack.test.ts",
      kind: "setAttack",
      required: [
        "code: 101",
        "code: 105",
        'type === "declareAttack"',
        "lifePoints).toBe(7700)",
      ],
    },
    {
      file: "test/lua-real-script-mirage-knight-battle-target-atk.test.ts",
      kind: "battleTargetAttackBoost",
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
      kind: "setBaseAttack",
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
  ] satisfies Array<{
    file: string;
    kind: StatKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countStatKinds(fixtures: Array<{ kind: StatKind }>): Record<StatKind, number> {
  return fixtures.reduce<Record<StatKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      battleTargetAttackBoost: 0,
      setAttack: 0,
      setBaseAttack: 0,
      staticAttackAndExtraAttack: 0,
    },
  );
}
