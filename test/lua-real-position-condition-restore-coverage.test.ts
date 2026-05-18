import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const POSITION_CONDITION_FIXTURE_COUNT = 1;
const positionConditionKindCounts = {
  attackDefensePositionCondition: 1,
} satisfies Record<PositionConditionKind, number>;
const positionConditionSemanticVariantCounts = {
  checksumDragonPositionPredicatesAndBattleIndestructible: 1,
} satisfies Record<PositionConditionSemanticVariant, number>;

type PositionConditionKind = "attackDefensePositionCondition";

type PositionConditionSemanticVariant = "checksumDragonPositionPredicatesAndBattleIndestructible";

describe("Lua real position condition restore coverage", () => {
  it("requires position predicate fixtures to assert clean Lua registry restore and restored predicates", () => {
    const files = positionConditionFixtureFiles();
    expect(files).toHaveLength(POSITION_CONDITION_FIXTURE_COUNT);

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

  it("keeps position condition fixture kinds explicit", () => {
    expect(countPositionConditionKinds(positionConditionFixtureFiles())).toEqual(positionConditionKindCounts);
  });

  it("keeps named position condition semantic variants explicit", () => {
    expect(countPositionConditionSemanticVariants(positionConditionSemanticVariants())).toEqual(positionConditionSemanticVariantCounts);

    const weak = positionConditionSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });

  it("keeps position condition fixtures script-gated and database-independent", () => {
    const weak = positionConditionSemanticVariants()
      .filter(({ file }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return text.includes("readDatabaseCards")
          || text.includes("hasUpstreamDatabase")
          || !text.includes("workspace.readScript")
          || !text.includes("describe.skipIf(!hasUpstreamScripts || !has");
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function positionConditionFixtureFiles(): Array<{
  file: string;
  kind: PositionConditionKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-checksum-dragon-position-indestructible.test.ts",
      kind: "attackDefensePositionCondition",
      required: [
        "condition:source-attack-position",
        "condition:source-defense-position",
        "property: 0x20000",
        "restoredEffect!.canActivate!(ctx)",
        "destroyDuelCard(restored.session.state",
        "duelReason.battle | duelReason.destroy",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: PositionConditionKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countPositionConditionKinds(
  fixtures: Array<{ kind: PositionConditionKind }>,
): Record<PositionConditionKind, number> {
  return fixtures.reduce<Record<PositionConditionKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      attackDefensePositionCondition: 0,
    },
  );
}

function positionConditionSemanticVariants(): Array<{
  file: string;
  kind: PositionConditionSemanticVariant;
  required: string[];
}> {
  return [
    {
      file: "test/lua-real-script-checksum-dragon-position-indestructible.test.ts",
      kind: "checksumDragonPositionPredicatesAndBattleIndestructible",
      required: [
        'const checksumDragonCode = "94136469"',
        "restores comma-local Attack Position and Defense Position predicates",
        "restores local-handler Attack Position and Defense Position predicates",
        "restores its Attack Position-only battle indestructible effect",
        "luaConditionDescriptor: \"condition:source-attack-position\"",
        "luaConditionDescriptor: \"condition:source-defense-position\"",
        'registryKey: "lua:94136469:lua-2-42"',
        "destroyDuelCard(restored.session.state",
        "defensePositionDestroy).toMatchObject",
      ],
    },
  ];
}

function countPositionConditionSemanticVariants(
  fixtures: Array<{ kind: PositionConditionSemanticVariant }>,
): Record<PositionConditionSemanticVariant, number> {
  return fixtures.reduce<Record<PositionConditionSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      checksumDragonPositionPredicatesAndBattleIndestructible: 0,
    },
  );
}
