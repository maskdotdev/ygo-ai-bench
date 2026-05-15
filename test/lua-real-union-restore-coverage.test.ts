import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const UNION_FIXTURE_COUNT = 2;
const UNION_PROCEDURE_FIXTURE_COUNT = 1;
const EQUIPPED_UNION_LOCK_FIXTURE_COUNT = 1;

describe("Lua real Union restore coverage", () => {
  it("requires representative Union fixtures to assert clean Lua registry restore", () => {
    const files = unionFixtureFiles();
    expect(files).toHaveLength(UNION_FIXTURE_COUNT);

    const missing = files
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])");
      });

    expect(missing).toEqual([]);
  });

  it("requires Union procedure fixtures to prove grouped restored legal-action parity", () => {
    const files = unionProcedureFixtureFiles();
    expect(files).toHaveLength(UNION_PROCEDURE_FIXTURE_COUNT);

    const missing = files
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("getLuaRestoreLegalActionGroups")
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
        const text = fs.readFileSync(path.join(root, file), "utf8");
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
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes('luaConditionDescriptor: "condition:source-equipped"')
          || !/range:\s*\[\s*["']spellTrapZone["']\s*\]/.test(text)
          || !text.includes("targetRange: [0, 0xff]")
          || !text.includes("canActivate")
          || !text.includes("missingRegistryKeys).toEqual([])");
      });

    expect(missing).toEqual([]);
  });
});

function unionFixtureFiles(): string[] {
  return [
    ...unionProcedureFixtureFiles(),
    ...equippedUnionLockFixtureFiles(),
  ]
    .sort();
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
