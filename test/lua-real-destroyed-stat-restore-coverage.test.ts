import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const destroyedStatFixtureCount = 1;
const destroyedStatKindCounts = {
  destroyedRaceAttackGain: 1,
} satisfies Record<DestroyedStatKind, number>;

type DestroyedStatKind = "destroyedRaceAttackGain";
type DestroyedStatFixture = { file: string; kind: DestroyedStatKind; required: string[] };

describe("Lua real destroyed stat restore coverage", () => {
  it("requires destroyed stat fixtures to assert clean Lua registry restore and restored legal-action parity", () => {
    const fixtures = realScriptDestroyedStatFixtures();
    expect(fixtures).toHaveLength(destroyedStatFixtureCount);

    const missing = fixtures.filter(({ file, required }) => {
      const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
      return !text.includes("restoreComplete")
        || !text.includes('incompleteReasons.join("; ")')
        || !text.includes("missingRegistryKeys).toEqual([])")
        || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
        || !text.includes("getLuaRestoreLegalActions")
        || !text.includes("getLuaRestoreLegalActionGroups")
        || !text.includes("getGroupedDuelLegalActions")
        || !text.includes("flatMap((group) => group.actions)).toEqual")
        || !text.includes("EVENT_DESTROYED")
        || !text.includes("EFFECT_TYPE_TRIGGER_F+EFFECT_TYPE_FIELD")
        || !text.includes("EFFECT_FLAG_COPY_INHERIT")
        || !text.includes("EFFECT_UPDATE_ATTACK")
        || !text.includes("GetPreviousRaceOnField")
        || !text.includes("previousRace")
        || !text.includes("destroyed race attack 1500/1500")
        || !text.includes("restored destroyed race attack 1500/1500")
        || required.some((snippet) => !hasCoverageSnippet(text, snippet));
    });

    expect(missing).toEqual([]);
  });

  it("keeps destroyed stat behavior variants explicit", () => {
    expect(countDestroyedStatKinds(realScriptDestroyedStatFixtures())).toEqual(destroyedStatKindCounts);
  });
});

function realScriptDestroyedStatFixtures(): DestroyedStatFixture[] {
  return [
    {
      file: "test/lua-real-script-destroyed-race-atk-gain.test.ts",
      kind: "destroyedRaceAttackGain",
      required: [
        "c:GetPreviousRaceOnField()&RACE_BEAST",
        "c:GetPreviousRaceOnField()&RACE_WINGEDBEAST",
        "c:IsPreviousControler(tp)",
        "e1:SetValue(500)",
        "Duel.Destroy(Group.FromCards(beast, winged), REASON_EFFECT)",
      ],
    },
  ];
}

function countDestroyedStatKinds(fixtures: DestroyedStatFixture[]): Record<DestroyedStatKind, number> {
  const counts = Object.fromEntries(Object.keys(destroyedStatKindCounts).map((kind) => [kind, 0])) as Record<DestroyedStatKind, number>;
  for (const fixture of fixtures) {
    const text = fs.readFileSync(path.join(root, fixture.file), "utf8");
    for (const snippet of fixture.required) {
      if (!hasCoverageSnippet(text, snippet)) throw new Error(`Missing ${fixture.kind} snippet in ${fixture.file}: ${snippet}`);
    }
    counts[fixture.kind] += 1;
  }
  return counts;
}
