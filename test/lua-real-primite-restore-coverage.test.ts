import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const PRIMITE_FIXTURE_COUNT = 7;
const primiteKindCounts = {
  activationBanishDestroy: 1,
  battleDamagePrevention: 1,
  fusionExtraCheck: 1,
  lordlyLodeActivationLock: 1,
  normalSummonSetback: 1,
  protectionAndTrigger: 1,
  tributeSummonBanish: 1,
} satisfies Record<PrimiteKind, number>;

type PrimiteKind =
  | "activationBanishDestroy"
  | "battleDamagePrevention"
  | "fusionExtraCheck"
  | "lordlyLodeActivationLock"
  | "normalSummonSetback"
  | "protectionAndTrigger"
  | "tributeSummonBanish";

describe("Lua real Primite restore coverage", () => {
  it("requires Primite fixtures to assert clean restore and restored outcomes", () => {
    const files = primiteFixtureFiles();
    expect(files).toHaveLength(PRIMITE_FIXTURE_COUNT);

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

  it("keeps Primite fixture kinds explicit", () => {
    expect(countPrimiteKinds(primiteFixtureFiles())).toEqual(primiteKindCounts);
  });
});

function primiteFixtureFiles(): Array<{
  file: string;
  kind: PrimiteKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-primite-drillbeam.test.ts",
      kind: "activationBanishDestroy",
      required: [
        "restoredActivation.missingRegistryKeys).toEqual([])",
        "restoredActivation.missingChainLimitRegistryKeys).toEqual([])",
        "restoredSet.missingRegistryKeys).toEqual([])",
        "restoredSet.missingChainLimitRegistryKeys).toEqual([])",
        "category: 0x4000",
        "category: 0x4",
        'location: "banished", faceUp: true',
        'location: "spellTrapZone"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-primite-imperial-dragon.test.ts",
      kind: "tributeSummonBanish",
      required: [
        "getLuaRestoreLegalActionGroups",
        'type: "tributeSummon"',
        'eventName: "normalSummoned"',
        'location: "banished"',
        'summonType: "tribute"',
      ],
    },
    {
      file: "test/lua-real-script-primite-howl-battle-damage.test.ts",
      kind: "battleDamagePrevention",
      required: [
        "target:setcode-or-code-type:432:46986414:16",
        'action.type === "declareAttack"',
        "battleDamage[0]).toBe(0)",
        "lifePoints).toBe(8000)",
      ],
    },
    {
      file: "test/lua-real-script-primite-dragon-ether-beryl.test.ts",
      kind: "normalSummonSetback",
      required: [
        "restored.missingRegistryKeys).toEqual([])",
        "restored.missingChainLimitRegistryKeys).toEqual([])",
        'eventName: "normalSummoned"',
        "operationInfos: [{ category: 0x20",
        'location: "spellTrapZone"',
        'location: "graveyard"',
        "getLuaRestoreLegalActionGroups",
      ],
    },
    {
      file: "test/lua-real-script-primite-fusion-extra-check.test.ts",
      kind: "fusionExtraCheck",
      required: [
        "restored.missingRegistryKeys).toEqual([])",
        "restored.missingChainLimitRegistryKeys).toEqual([])",
        'summonType: "fusion"',
        "summonMaterialUids: [normalMaterial!.uid, effectMaterial!.uid]",
        "reason: duelReason.effect | duelReason.material | duelReason.fusion",
        "host.messages).not.toContain",
        "getLuaRestoreLegalActionGroups",
      ],
    },
    {
      file: "test/lua-real-script-primite-lordly-lode.test.ts",
      kind: "lordlyLodeActivationLock",
      required: [
        "getLuaRestoreLegalActionGroups",
        "cannot-activate:special-summoned-monster-on-field",
        'action.type === "activateEffect"',
        "toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-primite-roar.test.ts",
      kind: "protectionAndTrigger",
      required: [
        "restoredActivation.missingRegistryKeys).toEqual([])",
        "restoredActivation.missingChainLimitRegistryKeys).toEqual([])",
        "restoredProtection.missingRegistryKeys).toEqual([])",
        "restoredProtection.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTrigger.missingRegistryKeys).toEqual([])",
        "restoredTrigger.missingChainLimitRegistryKeys).toEqual([])",
        "target:setcode-or-code-type:432:46986414:16",
        'location: "banished"',
        "getLuaRestoreLegalActionGroups",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: PrimiteKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countPrimiteKinds(fixtures: Array<{ kind: PrimiteKind }>): Record<PrimiteKind, number> {
  return fixtures.reduce<Record<PrimiteKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      activationBanishDestroy: 0,
      battleDamagePrevention: 0,
      fusionExtraCheck: 0,
      lordlyLodeActivationLock: 0,
      normalSummonSetback: 0,
      protectionAndTrigger: 0,
      tributeSummonBanish: 0,
    },
  );
}
