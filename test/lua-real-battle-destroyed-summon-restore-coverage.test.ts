import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const battleDestroyedSummonFixtureCount = 2;
const battleDestroyedSummonKindCounts = {
  optionalDeckDefenseSpecialSummon: 1,
  optionalDeckSpecialSummon: 1,
} satisfies Record<BattleDestroyedSummonKind, number>;
const battleDestroyedSummonSemanticVariantCounts = {
  phantomMagicianHeroDefenseDeckSummon: 1,
  tricularBattleDestroyedDeckSummon: 1,
} satisfies Record<BattleDestroyedSummonSemanticVariant, number>;

type BattleDestroyedSummonKind = "optionalDeckDefenseSpecialSummon" | "optionalDeckSpecialSummon";
type BattleDestroyedSummonSemanticVariant = "phantomMagicianHeroDefenseDeckSummon" | "tricularBattleDestroyedDeckSummon";

describe("Lua real battle-destroyed summon restore coverage", () => {
  it("requires battle-destroyed summon fixtures to assert clean restore and exact Special Summon outcomes", () => {
    const files = battleDestroyedSummonFixtureFiles();
    expect(files).toHaveLength(battleDestroyedSummonFixtureCount);

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
          || !text.includes("pendingTriggers")
          || !text.includes("eventHistory")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps battle-destroyed summon fixture kinds explicit", () => {
    expect(countBattleDestroyedSummonKinds(battleDestroyedSummonFixtureFiles())).toEqual(battleDestroyedSummonKindCounts);
  });

  it("keeps named battle-destroyed summon semantic variants explicit", () => {
    expect(countBattleDestroyedSummonSemanticVariants(battleDestroyedSummonSemanticVariants())).toEqual(
      battleDestroyedSummonSemanticVariantCounts,
    );

    const weak = battleDestroyedSummonSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function battleDestroyedSummonFixtureFiles(): Array<{
  file: string;
  kind: BattleDestroyedSummonKind;
  required: string[];
}> {
  return [
    {
      file: "test/lua-real-script-phantom-magician-battle-destroyed-defense-summon.test.ts",
      kind: "optionalDeckDefenseSpecialSummon",
      required: [
        'const phantomMagicianCode = "24103628"',
        'const heroTargetCode = "24103630"',
        "restores Phantom Magician's battle-destroyed HERO filter and face-up Defense Special Summon",
        'triggerBucket: "opponentOptional"',
        'eventName: "battleDestroyed"',
        'eventName: "specialSummoned"',
        'position: "faceUpDefense"',
        'location: "deck", controller: 0',
      ],
    },
    {
      file: "test/lua-real-script-tricular-battle-destroyed-summon.test.ts",
      kind: "optionalDeckSpecialSummon",
      required: [
        'const tricularCode = "20797524"',
        'const bicularId = "83392426"',
        "restores Tricular's optional battle-destroyed trigger and Special Summons Bicular from Deck",
        'eventName: "battleDestroyed"',
        'triggerBucket": "opponentOptional"',
        'eventName: "specialSummoned"',
        'location: "monsterZone"',
        "eventReasonEffectId: 1",
      ],
    },
  ];
}

function battleDestroyedSummonSemanticVariants(): Array<{
  file: string;
  kind: BattleDestroyedSummonSemanticVariant;
  required: string[];
}> {
  return [
    {
      file: "test/lua-real-script-phantom-magician-battle-destroyed-defense-summon.test.ts",
      kind: "phantomMagicianHeroDefenseDeckSummon",
      required: [
        'triggerEvent: "battleDestroyed"',
        "triggerSourceOnly: true",
        'type === "activateTrigger"',
        "c:IsSetCard(SET_HERO)",
        "POS_FACEUP_DEFENSE",
        "eventReasonCardUid: phantomMagician.uid",
      ],
    },
    {
      file: "test/lua-real-script-tricular-battle-destroyed-summon.test.ts",
      kind: "tricularBattleDestroyedDeckSummon",
      required: [
        'triggerEvent: "battleDestroyed"',
        "triggerSourceOnly: true",
        'type === "activateTrigger"',
        'eventName: "specialSummoned"',
        "eventReasonCardUid: tricular!.uid",
      ],
    },
  ];
}

function countBattleDestroyedSummonKinds(fixtures: Array<{ kind: BattleDestroyedSummonKind }>): Record<BattleDestroyedSummonKind, number> {
  return fixtures.reduce<Record<BattleDestroyedSummonKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    { optionalDeckDefenseSpecialSummon: 0, optionalDeckSpecialSummon: 0 },
  );
}

function countBattleDestroyedSummonSemanticVariants(
  fixtures: Array<{ kind: BattleDestroyedSummonSemanticVariant }>,
): Record<BattleDestroyedSummonSemanticVariant, number> {
  return fixtures.reduce<Record<BattleDestroyedSummonSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    { phantomMagicianHeroDefenseDeckSummon: 0, tricularBattleDestroyedDeckSummon: 0 },
  );
}
