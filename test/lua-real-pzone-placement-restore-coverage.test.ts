import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const pzonePlacementFixtureCount = 2;
const pzonePlacementKindCounts = {
  destroyedFromMonsterZoneMoveToPzone: 2,
} satisfies Record<PzonePlacementKind, number>;

type PzonePlacementKind = "destroyedFromMonsterZoneMoveToPzone";

describe("Lua real PZone placement restore coverage", () => {
  it("requires PZone placement fixtures to assert clean restore, legal actions, and exact movement", () => {
    const fixtures = pzonePlacementFixtures();
    expect(fixtures).toHaveLength(pzonePlacementFixtureCount);

    const missing = fixtures
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

  it("keeps PZone placement fixture kinds explicit", () => {
    expect(countPzonePlacementKinds(pzonePlacementFixtures())).toEqual(pzonePlacementKindCounts);
  });
});

function pzonePlacementFixtures(): Array<{
  file: string;
  kind: PzonePlacementKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-bright-armageddon-destroyed-pzone.test.ts",
      kind: "destroyedFromMonsterZoneMoveToPzone",
      required: [
        'const brightCode = "72402069"',
        "D/D/D Super Doom King Bright Armageddon",
        "restores destroyed-from-monster-zone trigger placement into its Pendulum Zone",
        "e4:SetCode(EVENT_DESTROYED)",
        "return e:GetHandler():IsPreviousLocation(LOCATION_MZONE)",
        "Duel.CheckPendulumZones(tp)",
        "Duel.MoveToField(c,tp,tp,LOCATION_PZONE,POS_FACEUP,true)",
        'location: "spellTrapZone"',
        'eventName: "destroyed"',
        'eventName: "moved"',
        "reasonEffectId: 9",
      ],
    },
    {
      file: "test/lua-real-script-nirvana-high-paladin-destroyed-pzone.test.ts",
      kind: "destroyedFromMonsterZoneMoveToPzone",
      required: [
        'const nirvanaCode = "80896940"',
        "Nirvana High Paladin",
        "restores destroyed-from-monster-zone trigger placement into the Pendulum Zone",
        "e7:SetCode(EVENT_DESTROYED)",
        "Duel.CheckPendulumZones(tp)",
        "Duel.MoveToField(c,tp,tp,LOCATION_PZONE,POS_FACEUP,true)",
        'location: "spellTrapZone"',
        'eventName: "destroyed"',
        'eventName: "moved"',
        "reasonEffectId: 10",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: PzonePlacementKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countPzonePlacementKinds(fixtures: Array<{ kind: PzonePlacementKind }>): Record<PzonePlacementKind, number> {
  return fixtures.reduce<Record<PzonePlacementKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      destroyedFromMonsterZoneMoveToPzone: 0,
    },
  );
}
