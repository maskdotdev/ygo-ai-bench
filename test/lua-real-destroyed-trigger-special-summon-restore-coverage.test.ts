import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const destroyedTriggerSpecialSummonFixtureCount = 1;
const destroyedTriggerSpecialSummonKindCounts = {
  trapActivationDeckReptileSummon: 1,
} satisfies Record<DestroyedTriggerSpecialSummonKind, number>;

type DestroyedTriggerSpecialSummonKind = "trapActivationDeckReptileSummon";

describe("Lua real destroyed-trigger Special Summon restore coverage", () => {
  it("requires destroyed-trigger Special Summon fixtures to assert clean restore and exact outcomes", () => {
    const files = realScriptDestroyedTriggerSpecialSummonFixtureSnippets();
    expect(files).toHaveLength(destroyedTriggerSpecialSummonFixtureCount);

    const weak = files
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

    expect(weak).toEqual([]);
  });

  it("keeps destroyed-trigger Special Summon fixture kinds explicit", () => {
    expect(countDestroyedTriggerSpecialSummonKinds(realScriptDestroyedTriggerSpecialSummonFixtureSnippets())).toEqual(
      destroyedTriggerSpecialSummonKindCounts,
    );
  });
});

function realScriptDestroyedTriggerSpecialSummonFixtureSnippets(): Array<{
  file: string;
  kind: DestroyedTriggerSpecialSummonKind;
  required: string[];
}> {
  return [
    {
      file: "test/lua-real-script-snake-whistle-destroyed-reptile-deck-summon.test.ts",
      kind: "trapActivationDeckReptileSummon",
      required: [
        'const snakeWhistleCode = "81791932"',
        "restores Snake Whistle's EVENT_DESTROYED Trap activation and Special Summons a low-level Reptile from Deck",
        "e1:SetType(EFFECT_TYPE_ACTIVATE)",
        "e1:SetCode(EVENT_DESTROYED)",
        "Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_DECK)",
        "Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_DECK,0,1,1,nil,e,tp)",
        "Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)",
        'activationLocation: "spellTrapZone"',
        'eventName: "destroyed"',
        'eventName: "specialSummoned"',
        "operationInfos: [{ category: 0x200",
      ],
    },
  ];
}

function countDestroyedTriggerSpecialSummonKinds(
  fixtures: Array<{ kind: DestroyedTriggerSpecialSummonKind }>,
): Record<DestroyedTriggerSpecialSummonKind, number> {
  return fixtures.reduce<Record<DestroyedTriggerSpecialSummonKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    { trapActivationDeckReptileSummon: 0 },
  );
}
