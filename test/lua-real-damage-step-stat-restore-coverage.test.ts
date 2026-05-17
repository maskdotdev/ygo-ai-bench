import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const damageStepStatFixtureCount = 4;
const damageStepStatKindCounts = {
  activatedDamageStepBoost: 1,
  labelObjectCostBoost: 1,
  mandatoryPreDamageBoost: 1,
  persistentDamageStepDebuff: 1,
} satisfies Record<DamageStepStatKind, number>;

type DamageStepStatKind =
  | "activatedDamageStepBoost"
  | "labelObjectCostBoost"
  | "mandatoryPreDamageBoost"
  | "persistentDamageStepDebuff";

describe("Lua real damage-step stat restore coverage", () => {
  it("requires damage-step stat fixtures to assert clean restore and restored battle outcome", () => {
    const files = damageStepStatFixtureFiles();
    expect(files).toHaveLength(damageStepStatFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("eventHistory")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps damage-step stat fixture kinds explicit", () => {
    expect(countDamageStepStatKinds(damageStepStatFixtureFiles())).toEqual(damageStepStatKindCounts);
  });
});

function damageStepStatFixtureFiles(): Array<{
  file: string;
  kind: DamageStepStatKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-fabled-ashenveil-damage-step-boost.test.ts",
      kind: "activatedDamageStepBoost",
      required: [
        "expectCleanRestore(restoredSetup)",
        "expectCleanRestore(restoredDamageStep)",
        "expectCleanRestore(restoredChain)",
        "expectCleanRestore(restoredBattle)",
        "currentAttack(boostedAshenveil",
        "battleDamage[1]).toBe",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-shinobird-crow-damage-step-stat.test.ts",
      kind: "labelObjectCostBoost",
      required: [
        "restoredSetup.missingRegistryKeys).toEqual([])",
        "restoredSetup.missingChainLimitRegistryKeys).toEqual([])",
        "restoredDamageStep.missingRegistryKeys).toEqual([])",
        "restoredDamageStep.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChain.missingRegistryKeys).toEqual([])",
        "restoredChain.missingChainLimitRegistryKeys).toEqual([])",
        "restoredBattle.missingRegistryKeys).toEqual([])",
        "restoredBattle.missingChainLimitRegistryKeys).toEqual([])",
        "property: 0x4000",
        "effectLabelObjectUid: costSpirit!.uid",
        "currentAttack(restoredCrow",
        "battleDamage[1]).toBe(200)",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-miniaturize-persistent-damage-step-stat.test.ts",
      kind: "persistentDamageStepDebuff",
      required: [
        "expectCleanRestore(restoredSetup)",
        "expectCleanRestore(restoredDamageStep)",
        "expectCleanRestore(restoredChain)",
        "expectCleanRestore(restoredBattle)",
        "property: 0x4000",
        "miniaturize persistent true/true/1/800/3",
        "battleDamage[0]).toBe(100)",
        "eventHistory.filter((event) => event.eventName === \"battleDamageDealt\")",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-cipher-soldier-pre-damage-calculate.test.ts",
      kind: "mandatoryPreDamageBoost",
      required: [
        "triggerEvent: \"beforeDamageCalculation\"",
        "eventName: \"beforeDamageCalculation\"",
        "currentAttack(restored.session.state.cards.find((card) => card.uid === cipherSoldier!.uid)",
        "battleDamage[1]).toBe(1350)",
        "value: 2000",
        "finishBattle(restored.session)",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: DamageStepStatKind;
    required: string[];
  }>);
}

function countDamageStepStatKinds(
  fixtures: Array<{ kind: DamageStepStatKind }>,
): Record<DamageStepStatKind, number> {
  return fixtures.reduce<Record<DamageStepStatKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      activatedDamageStepBoost: 0,
      labelObjectCostBoost: 0,
      mandatoryPreDamageBoost: 0,
      persistentDamageStepDebuff: 0,
    },
  );
}
