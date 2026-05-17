import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const UNION_FIXTURE_COUNT = 2;
const UNION_PROCEDURE_FIXTURE_COUNT = 1;
const EQUIPPED_UNION_LOCK_FIXTURE_COUNT = 1;
const unionKindCounts = {
  equippedUnionLock: 1,
  unionEquipProcedure: 1,
} satisfies Record<UnionKind, number>;

type UnionKind = "equippedUnionLock" | "unionEquipProcedure";

describe("Lua real Union restore coverage", () => {
  it("requires representative Union fixtures to assert clean Lua registry restore", () => {
    const files = unionFixtureFiles();
    expect(files).toHaveLength(UNION_FIXTURE_COUNT);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])");
      });

    expect(missing).toEqual([]);
  });

  it("requires Union procedure fixtures to prove grouped restored legal-action parity", () => {
    const files = unionProcedureFixtureFiles();
    expect(files).toHaveLength(UNION_PROCEDURE_FIXTURE_COUNT);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("getDuelLegalActions");
      });

    expect(missing).toEqual([]);
  });

  it("requires Union procedure fixtures to pin equip relation, replacement, summon-back, and battle-trigger restore", () => {
    const files = unionProcedureFixtureFiles();
    expect(files).toHaveLength(UNION_PROCEDURE_FIXTURE_COUNT);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !/location:\s*["']spellTrapZone["']/.test(text)
          || !text.includes("equippedToUid")
          || !text.includes("previousEquippedToUid")
          || !/location:\s*["']banished["']/.test(text)
          || !/location:\s*["']monsterZone["']/.test(text)
          || !/eventName:\s*["']battleDestroyed["']/.test(text)
          || !/eventName:\s*["']specialSummoned["']/.test(text);
      });

    expect(missing).toEqual([]);
  });

  it("requires equipped Union lock fixtures to preserve source-equipped lizard descriptors after restore", () => {
    const files = equippedUnionLockFixtureFiles();
    expect(files).toHaveLength(EQUIPPED_UNION_LOCK_FIXTURE_COUNT);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes('luaConditionDescriptor: "condition:source-equipped"')
          || !/range:\s*\[\s*["']spellTrapZone["']\s*\]/.test(text)
          || !text.includes("targetRange: [0, 0xff]")
          || !text.includes("canActivate")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])");
      });

    expect(missing).toEqual([]);
  });

  it("keeps Union fixture kinds explicit", () => {
    expect(countUnionKinds(unionFixtures())).toEqual(unionKindCounts);
  });
});

function unionFixtures(): Array<{ file: string; kind: UnionKind }> {
  return ([
    {
      file: "lua-real-script-union-procedure-actions.test.ts",
      kind: "unionEquipProcedure",
    },
    {
      file: "lua-real-script-dragon-buster-equipped-lizard-lock.test.ts",
      kind: "equippedUnionLock",
    },
  ] satisfies Array<{ file: string; kind: UnionKind }>)
    .map(({ file, kind }) => ({ file: path.join("test", file), kind }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function unionFixtureFiles(): string[] {
  return unionFixtures().map(({ file }) => file);
}

function unionProcedureFixtureFiles(): string[] {
  return [
    "lua-real-script-union-procedure-actions.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function equippedUnionLockFixtureFiles(): string[] {
  return [
    "lua-real-script-dragon-buster-equipped-lizard-lock.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function countUnionKinds(fixtures: Array<{ kind: UnionKind }>): Record<UnionKind, number> {
  return fixtures.reduce<Record<UnionKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      equippedUnionLock: 0,
      unionEquipProcedure: 0,
    },
  );
}
