import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const testRoot = path.join(root, "test");

const sourceOnlyEventFixtures = [
  "lua-attack-disabled-source-only-event.test.ts",
  "lua-battle-damage-source-only-event.test.ts",
  "lua-battle-destroyed-source-only-event.test.ts",
  "lua-battle-source-only-event.test.ts",
  "lua-battle-timing-source-only-event.test.ts",
  "lua-become-target-source-only-event.test.ts",
  "lua-equip-source-only-event.test.ts",
  "lua-flip-summon-source-only-event.test.ts",
  "lua-leave-field-source-only-grouped-event.test.ts",
  "lua-move-source-only-grouped-event.test.ts",
  "lua-pre-battle-damage-source-only-event.test.ts",
  "lua-pre-material-source-only-event.test.ts",
  "lua-set-source-only-event.test.ts",
  "lua-summon-attempt-source-only-event.test.ts",
  "lua-summon-material-source-only-event.test.ts",
  "lua-summon-negated-source-only-event.test.ts",
] as const;
const sourceOnlyEventKindCounts = {
  battle: 5,
  equipmentTarget: 2,
  movementGrouped: 2,
  set: 1,
  summon: 6,
} satisfies Record<SourceOnlyEventKind, number>;

describe("Lua source-only event coverage", () => {
  it("keeps the source-only event fixture inventory explicit", () => {
    expect(discoveredSourceOnlyEventFixtures()).toEqual([...sourceOnlyEventFixtures].map((file) => path.join("test", file)));
  });

  it("keeps restoreable source-only event fixtures covered by Lua-aware restore assertions", () => {
    const missing = sourceOnlyEventFixtures
      .filter((file) => {
        const text = fs.readFileSync(path.join(testRoot, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("applyLuaRestoreResponse");
      });

    expect(missing).toEqual([]);
  });

  it("keeps source-only event fixture kinds explicit", () => {
    expect(countSourceOnlyEventKinds(sourceOnlyEventFixtures)).toEqual(sourceOnlyEventKindCounts);
  });
});

type SourceOnlyEventKind = "battle" | "equipmentTarget" | "movementGrouped" | "set" | "summon";

function discoveredSourceOnlyEventFixtures(): string[] {
  return fs.readdirSync(testRoot)
    .filter((file) => /source-only.*event\.test\.ts$/.test(file))
    .map((file) => path.join("test", file))
    .sort();
}

function countSourceOnlyEventKinds(files: readonly string[]): Record<SourceOnlyEventKind, number> {
  return files.reduce<Record<SourceOnlyEventKind, number>>(
    (counts, file) => {
      counts[classifySourceOnlyEventKind(file)] += 1;
      return counts;
    },
    {
      battle: 0,
      equipmentTarget: 0,
      movementGrouped: 0,
      set: 0,
      summon: 0,
    },
  );
}

function classifySourceOnlyEventKind(file: string): SourceOnlyEventKind {
  if (
    file === "lua-attack-disabled-source-only-event.test.ts" ||
    file === "lua-battle-damage-source-only-event.test.ts" ||
    file === "lua-battle-destroyed-source-only-event.test.ts" ||
    file === "lua-battle-source-only-event.test.ts" ||
    file === "lua-battle-timing-source-only-event.test.ts"
  ) {
    return "battle";
  }
  if (
    file === "lua-become-target-source-only-event.test.ts" ||
    file === "lua-equip-source-only-event.test.ts"
  ) {
    return "equipmentTarget";
  }
  if (
    file === "lua-leave-field-source-only-grouped-event.test.ts" ||
    file === "lua-move-source-only-grouped-event.test.ts"
  ) {
    return "movementGrouped";
  }
  if (file === "lua-set-source-only-event.test.ts") return "set";
  if (
    file === "lua-flip-summon-source-only-event.test.ts" ||
    file === "lua-pre-battle-damage-source-only-event.test.ts" ||
    file === "lua-pre-material-source-only-event.test.ts" ||
    file === "lua-summon-attempt-source-only-event.test.ts" ||
    file === "lua-summon-material-source-only-event.test.ts" ||
    file === "lua-summon-negated-source-only-event.test.ts"
  ) {
    return "summon";
  }
  throw new Error(`Unclassified source-only event fixture: ${file}`);
}
