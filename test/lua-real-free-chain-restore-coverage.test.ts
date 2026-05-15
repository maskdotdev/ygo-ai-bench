import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const FREE_CHAIN_FIXTURE_COUNT = 11;
const FREE_CHAIN_OPERATION_INFO_FIXTURE_COUNT = 10;
const CHAINED_FREE_CHAIN_FIXTURE_COUNT = 6;

describe("Lua real free-chain restore coverage", () => {
  it("requires representative free-chain fixtures to assert grouped actions and clean Lua registry restore", () => {
    const files = realScriptFreeChainFixtureFiles();
    expect(files).toHaveLength(FREE_CHAIN_FIXTURE_COUNT);

    const missing = files
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
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
        const text = fs.readFileSync(path.join(root, file), "utf8");
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
        const text = fs.readFileSync(path.join(root, file), "utf8");
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
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("chainStarterScript")
          || !text.includes("chainResponderScript")
          || !text.includes("host.messages).toContain")
          || !text.includes("host.messages).not.toContain");
      });

    expect(missing).toEqual([]);
  });
});

function realScriptFreeChainFixtureFiles(): string[] {
  return [
    "lua-real-script-armor-blast-multi-target-free-chain.test.ts",
    "lua-real-script-book-of-moon-free-chain.test.ts",
    "lua-real-script-compulsory-evacuation-device-free-chain.test.ts",
    "lua-real-script-cosmic-cyclone-free-chain.test.ts",
    "lua-real-script-infinite-impermanence-target-param.test.ts",
    "lua-real-script-monster-reborn-free-chain.test.ts",
    "lua-real-script-mystical-space-typhoon-free-chain.test.ts",
    "lua-real-script-omega-judgment-select-unselect-targets.test.ts",
    "lua-real-script-phoenix-wing-wind-blast-discard-cost.test.ts",
    "lua-real-script-raigeki-break-discard-cost.test.ts",
    "lua-real-script-twin-twisters-discard-cost.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
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
