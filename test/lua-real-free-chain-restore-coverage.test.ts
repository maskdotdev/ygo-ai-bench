import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const FREE_CHAIN_FIXTURE_COUNT = 11;
const FREE_CHAIN_OPERATION_INFO_FIXTURE_COUNT = 10;
const CHAINED_FREE_CHAIN_FIXTURE_COUNT = 6;
const FREE_CHAIN_INVENTORY_FIXTURE_COUNT = 11;
const freeChainKindCounts = {
  banishRemoval: 1,
  graveyardRevive: 1,
  multiTargetDestroy: 2,
  positionChange: 1,
  selectUnselectTargets: 1,
  singleDestroy: 2,
  targetNegation: 1,
  toDeckDiscard: 1,
  toHand: 1,
} satisfies Record<FreeChainKind, number>;

type FreeChainKind =
  | "banishRemoval"
  | "graveyardRevive"
  | "multiTargetDestroy"
  | "positionChange"
  | "selectUnselectTargets"
  | "singleDestroy"
  | "targetNegation"
  | "toDeckDiscard"
  | "toHand";

describe("Lua real free-chain restore coverage", () => {
  it("keeps the combined free-chain restore fixture inventory explicit", () => {
    expect(combinedFreeChainFixtureFiles()).toHaveLength(FREE_CHAIN_INVENTORY_FIXTURE_COUNT);
    expect(combinedFreeChainFixtureFiles()).toEqual(realScriptFreeChainInventoryFiles());
  });

  it("keeps free-chain fixture kinds explicit", () => {
    expect(countFreeChainKinds(realScriptFreeChainFixtures())).toEqual(freeChainKindCounts);
  });

  it("requires representative free-chain fixtures to assert grouped actions and clean Lua registry restore", () => {
    const files = realScriptFreeChainFixtureFiles();
    expect(files).toHaveLength(FREE_CHAIN_FIXTURE_COUNT);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])");
      });

    expect(missing).toEqual([]);
  });

  it("requires representative free-chain fixtures to prove restored chain targets and outcomes", () => {
    const files = realScriptFreeChainFixtureFiles();
    expect(files).toHaveLength(FREE_CHAIN_FIXTURE_COUNT);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("applyLuaRestoreResponse")
          || !/state\.chain\)\.toHaveLength\((1|2)\)/.test(text)
          || !text.includes("targetUids")
          || !/location:\s*["'](graveyard|hand|deck|banished|monsterZone)["']/.test(text)
          || !text.includes("host.messages).not.toContain");
      });

    expect(missing).toEqual([]);
  });

  it("requires operation-info metadata for free-chain fixtures whose scripts announce operation categories", () => {
    const files = realScriptFreeChainOperationInfoFixtureFiles();
    expect(files).toHaveLength(FREE_CHAIN_OPERATION_INFO_FIXTURE_COUNT);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("operationInfos")
          || !/category:\s*0x[0-9a-f]+/i.test(text)
          || !/count:\s*[1-9]/.test(text)
          || !/player:\s*[01]/.test(text)
          || !/parameter:\s*0/.test(text);
      });

    expect(missing).toEqual([]);
  });

  it("requires chained free-chain fixtures to prove restored response suppression", () => {
    const files = realScriptChainedFreeChainFixtureFiles();
    expect(files).toHaveLength(CHAINED_FREE_CHAIN_FIXTURE_COUNT);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("chainStarterScript")
          || !text.includes("chainResponderScript")
          || !text.includes("host.messages).toContain")
          || !text.includes("host.messages).not.toContain");
      });

    expect(missing).toEqual([]);
  });
});

function combinedFreeChainFixtureFiles(): string[] {
  return [
    ...realScriptFreeChainFixtureFiles(),
    ...realScriptFreeChainOperationInfoFixtureFiles(),
    ...realScriptChainedFreeChainFixtureFiles(),
  ].filter((file, index, files) => files.indexOf(file) === index).sort();
}

function realScriptFreeChainInventoryFiles(): string[] {
  return realScriptFreeChainFixtureFiles();
}

function realScriptFreeChainFixtureFiles(): string[] {
  return realScriptFreeChainFixtures().map(({ file }) => file);
}

function realScriptFreeChainOperationInfoFixtureFiles(): string[] {
  return realScriptFreeChainFixtureFiles()
    .filter((file) => !file.endsWith("lua-real-script-book-of-moon-free-chain.test.ts"));
}

function realScriptChainedFreeChainFixtureFiles(): string[] {
  return realScriptFreeChainFixtureFiles()
    .filter((file) => !file.endsWith("lua-real-script-armor-blast-multi-target-free-chain.test.ts"))
    .filter((file) => !file.endsWith("lua-real-script-book-of-moon-free-chain.test.ts"))
    .filter((file) => !file.endsWith("lua-real-script-infinite-impermanence-target-param.test.ts"))
    .filter((file) => !file.endsWith("lua-real-script-monster-reborn-free-chain.test.ts"))
    .filter((file) => !file.endsWith("lua-real-script-omega-judgment-select-unselect-targets.test.ts"));
}

function realScriptFreeChainFixtures(): Array<{ file: string; kind: FreeChainKind }> {
  return ([
    {
      file: "lua-real-script-armor-blast-multi-target-free-chain.test.ts",
      kind: "multiTargetDestroy",
    },
    {
      file: "lua-real-script-book-of-moon-free-chain.test.ts",
      kind: "positionChange",
    },
    {
      file: "lua-real-script-compulsory-evacuation-device-free-chain.test.ts",
      kind: "toHand",
    },
    {
      file: "lua-real-script-cosmic-cyclone-free-chain.test.ts",
      kind: "banishRemoval",
    },
    {
      file: "lua-real-script-infinite-impermanence-target-param.test.ts",
      kind: "targetNegation",
    },
    {
      file: "lua-real-script-monster-reborn-free-chain.test.ts",
      kind: "graveyardRevive",
    },
    {
      file: "lua-real-script-mystical-space-typhoon-free-chain.test.ts",
      kind: "singleDestroy",
    },
    {
      file: "lua-real-script-omega-judgment-select-unselect-targets.test.ts",
      kind: "selectUnselectTargets",
    },
    {
      file: "lua-real-script-phoenix-wing-wind-blast-discard-cost.test.ts",
      kind: "toDeckDiscard",
    },
    {
      file: "lua-real-script-raigeki-break-discard-cost.test.ts",
      kind: "singleDestroy",
    },
    {
      file: "lua-real-script-twin-twisters-discard-cost.test.ts",
      kind: "multiTargetDestroy",
    },
  ] satisfies Array<{ file: string; kind: FreeChainKind }>)
    .map(({ file, kind }) => ({ file: path.join("test", file), kind }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function countFreeChainKinds(fixtures: Array<{ kind: FreeChainKind }>): Record<FreeChainKind, number> {
  return fixtures.reduce<Record<FreeChainKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      banishRemoval: 0,
      graveyardRevive: 0,
      multiTargetDestroy: 0,
      positionChange: 0,
      selectUnselectTargets: 0,
      singleDestroy: 0,
      targetNegation: 0,
      toDeckDiscard: 0,
      toHand: 0,
    },
  );
}
