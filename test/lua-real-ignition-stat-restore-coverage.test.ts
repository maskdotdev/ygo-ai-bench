import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const ignitionStatFixtureCount = 1;
const ignitionStatKindCounts = {
  noTurnResetAttackLevelBoost: 1,
} satisfies Record<IgnitionStatKind, number>;

type IgnitionStatKind = "noTurnResetAttackLevelBoost";
type IgnitionStatFixture = { file: string; kind: IgnitionStatKind; required: string[] };

describe("Lua real ignition stat restore coverage", () => {
  it("requires ignition stat fixtures to assert clean Lua registry restore and restored legal-action parity", () => {
    const fixtures = realScriptIgnitionStatFixtures();
    expect(fixtures).toHaveLength(ignitionStatFixtureCount);

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
        || !text.includes("EFFECT_FLAG_NO_TURN_RESET")
        || !text.includes("EFFECT_UPDATE_ATTACK")
        || !text.includes("EFFECT_UPDATE_LEVEL")
        || !text.includes("SetCountLimit(1)")
        || !text.includes("no-turn-reset")
        || required.some((snippet) => !hasCoverageSnippet(text, snippet));
    });

    expect(missing).toEqual([]);
  });

  it("keeps ignition stat behavior variants explicit", () => {
    expect(countIgnitionStatKinds(realScriptIgnitionStatFixtures())).toEqual(ignitionStatKindCounts);
  });
});

function realScriptIgnitionStatFixtures(): IgnitionStatFixture[] {
  return [
    {
      file: "test/lua-real-script-wind-up-no-turn-reset-stat.test.ts",
      kind: "noTurnResetAttackLevelBoost",
      required: [
        "e1:SetType(EFFECT_TYPE_IGNITION)",
        "e1:SetRange(LOCATION_MZONE)",
        "c:IsFaceup() and c:IsRelateToEffect(e)",
        "e1:SetValue(600)",
        "e2:SetValue(2)",
        "e1:SetValue(400)",
        "e2:SetValue(1)",
        "currentAttack(card, state)",
        "currentLevel(card, state)",
      ],
    },
  ];
}

function countIgnitionStatKinds(fixtures: IgnitionStatFixture[]): Record<IgnitionStatKind, number> {
  const counts = Object.fromEntries(Object.keys(ignitionStatKindCounts).map((kind) => [kind, 0])) as Record<IgnitionStatKind, number>;
  for (const fixture of fixtures) {
    const text = fs.readFileSync(path.join(root, fixture.file), "utf8");
    for (const snippet of fixture.required) {
      if (!hasCoverageSnippet(text, snippet)) throw new Error(`Missing ${fixture.kind} snippet in ${fixture.file}: ${snippet}`);
    }
    counts[fixture.kind] += 1;
  }
  return counts;
}
