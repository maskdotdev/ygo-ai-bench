import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const PIERCING_FIXTURE_COUNT = 3;
const piercingKindCounts = {
  equipPierce: 1,
  fieldPierce: 1,
  raceTargetedFieldPierce: 1,
} satisfies Record<PiercingKind, number>;

type PiercingKind = "equipPierce" | "fieldPierce" | "raceTargetedFieldPierce";

describe("Lua real piercing damage restore coverage", () => {
  it("requires piercing damage fixtures to assert clean Lua registry restore and restored damage semantics", () => {
    const files = piercingFixtureFiles();
    expect(files).toHaveLength(PIERCING_FIXTURE_COUNT);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("battleDamage")
          || !text.includes("lifePoints")
          || !text.includes('eventName: "battleDamageDealt"')
          || !text.includes("eventHistory")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps piercing fixture kinds explicit", () => {
    expect(countPiercingKinds(piercingFixtureFiles())).toEqual(piercingKindCounts);
  });
});

function piercingFixtureFiles(): Array<{
  file: string;
  kind: PiercingKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-ancient-gear-golem-pierce-battle-damage.test.ts",
      kind: "fieldPierce",
      required: [
        "code: 203",
        '"range": [',
        '"monsterZone"',
        "battleDamage).toEqual({ 0: 0, 1: 1500 })",
        "players[1].lifePoints).toBe(6500)",
        'eventName: "battleDamageDealt"',
        "eventReason: duelReason.battle",
      ],
    },
    {
      file: "test/lua-real-script-enraged-battle-ox-pierce.test.ts",
      kind: "raceTargetedFieldPierce",
      required: [
        "code: 203",
        "targetRange: [4, 0]",
        "battleDamage[1]).toBe(700)",
        "players[1].lifePoints).toBe(7300)",
        "battleDamage[1]).toBe(0)",
      ],
    },
    {
      file: "test/lua-real-script-fairy-meteor-crush-equip-pierce.test.ts",
      kind: "equipPierce",
      required: [
        "operationInfos: [{ category: 0x40000",
        "equippedToUid: equippedAttacker!.uid",
        "battleDamage).toEqual({ 0: 0, 1: 800 })",
        "players[1].lifePoints).toBe(7200)",
        'eventName === "battleDamageDealt" && event.eventPlayer === 1)).toEqual([])',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: PiercingKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countPiercingKinds(fixtures: Array<{ kind: PiercingKind }>): Record<PiercingKind, number> {
  return fixtures.reduce<Record<PiercingKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      equipPierce: 0,
      fieldPierce: 0,
      raceTargetedFieldPierce: 0,
    },
  );
}
