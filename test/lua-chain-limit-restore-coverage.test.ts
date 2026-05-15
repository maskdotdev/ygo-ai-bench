import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const testRoot = path.join(root, "test");
const scannerPath = path.join(root, "tools/scan-lua-chain-limit-patterns.mjs");
const upstreamOfficialScriptRoot = path.join(root, ".upstream/ignis/script/official");
const noActiveRestoreWindowGroups = new Set(["SetChainLimit:aux.FALSE"]);
const realScriptChainLimitFixtureCount = 13;
const realScriptOwnedScannerGroupCount = 10;

const officialPatternRestoreCoverage: Record<string, string[]> = {
  "SetChainLimit:aux.FALSE": ["test/lua-real-script-anti-magic-arrows-chain-limit.test.ts"],
  "SetChainLimit:factory:handler-exclusion": ["test/lua-chain-limit-single-card-restore.test.ts"],
  "SetChainLimit:factory:response-chain-player": ["test/lua-real-script-forbidden-droplet-chain-limit.test.ts"],
  "SetChainLimit:inline:active-type": ["test/lua-real-script-forbidden-crown-chain-limit.test.ts"],
  "SetChainLimit:inline:handler-exclusion": ["test/lua-real-script-titanic-galaxy-chain-limit.test.ts"],
  "SetChainLimit:inline:response-chain-player": ["test/lua-real-script-borrelend-chain-limit.test.ts"],
  "SetChainLimit:inline:target-card-handler-exclusion": ["test/lua-chain-limit-target-cards-restore.test.ts"],
  "SetChainLimit:named:active-type": ["test/lua-real-script-giant-starfall-chain-limit.test.ts"],
  "SetChainLimit:named:effect-type": ["test/lua-real-script-galaxy-destroyer-chain-limit.test.ts"],
  "SetChainLimit:named:response-chain-player": ["test/lua-chain-limit-response-chain-player-restore.test.ts"],
  "SetChainLimitTillChainEnd:aux.FALSE": ["test/lua-real-script-obelisk-chain-limit.test.ts"],
  "SetChainLimitTillChainEnd:factory:handler-only": ["test/lua-real-script-ra-chain-limit.test.ts"],
  "SetChainLimitTillChainEnd:inline:response-chain-player": ["test/lua-chain-limit-response-chain-player-restore.test.ts"],
  "SetChainLimitTillChainEnd:named:effect-type": ["test/lua-real-script-goblin-pothole-chain-limit.test.ts"],
  "SetChainLimitTillChainEnd:named:response-chain-player": ["test/lua-chain-limit-response-chain-player-restore.test.ts"],
};

const officialPatternCounts: Record<string, number> = {
  "SetChainLimit:aux.FALSE": 19,
  "SetChainLimit:factory:handler-exclusion": 4,
  "SetChainLimit:factory:response-chain-player": 1,
  "SetChainLimit:inline:active-type": 4,
  "SetChainLimit:inline:handler-exclusion": 4,
  "SetChainLimit:inline:response-chain-player": 11,
  "SetChainLimit:inline:target-card-handler-exclusion": 1,
  "SetChainLimit:named:active-type": 1,
  "SetChainLimit:named:effect-type": 3,
  "SetChainLimit:named:response-chain-player": 36,
  "SetChainLimitTillChainEnd:aux.FALSE": 7,
  "SetChainLimitTillChainEnd:factory:handler-only": 1,
  "SetChainLimitTillChainEnd:inline:response-chain-player": 11,
  "SetChainLimitTillChainEnd:named:effect-type": 7,
  "SetChainLimitTillChainEnd:named:response-chain-player": 30,
};

const officialScannerSummary = {
  filesWithCalls: 123,
  calls: 140,
  unclassifiedCalls: 0,
};

describe("Lua chain-limit restore coverage", () => {
  it.skipIf(!fs.existsSync(upstreamOfficialScriptRoot))("maps every official chain-limit scanner group to restore coverage", () => {
    const output = execFileSync(process.execPath, [scannerPath, "--scripts", upstreamOfficialScriptRoot, "--limit", "1000", "--fail-on-unclassified"], { encoding: "utf8" });
    const groups = scannerGroups(output);

    expect(scannerSummary(output)).toEqual(officialScannerSummary);
    expect(groups).toEqual(Object.keys(officialPatternRestoreCoverage).sort());
    expect(scannerGroupCounts(output)).toEqual(officialPatternCounts);
    for (const [group, files] of Object.entries(officialPatternRestoreCoverage)) {
      expect(files, group).not.toEqual([]);
      for (const file of files) {
        expect(fs.existsSync(path.join(root, file)), `${group} -> ${file}`).toBe(true);
        assertRestoreCoverageFile(group, file);
      }
    }
  });

  it("requires real-script chain-limit fixtures to assert complete restored registry coverage", () => {
    const files = realScriptChainLimitFixtureFiles();
    expect(files).toHaveLength(realScriptChainLimitFixtureCount);

    const missing = files
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])");
      });

    expect(missing).toEqual([]);
  });

  it("keeps most official chain-limit scanner groups owned by real-script fixtures", () => {
    const realScriptOwnedGroups = Object.values(officialPatternRestoreCoverage)
      .filter((files) => files.some((file) => file.includes("/lua-real-script-")))
      .length;

    expect(realScriptOwnedGroups).toBeGreaterThanOrEqual(realScriptOwnedScannerGroupCount);
  });
});

function assertRestoreCoverageFile(group: string, file: string): void {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  const missing = [
    ["restoreDuelWithLuaScripts", text.includes("restoreDuelWithLuaScripts")],
    ["restoreComplete", text.includes("restoreComplete")],
    ["incomplete restore diagnostics", text.includes('incompleteReasons.join("; ")')],
    ["missingRegistryKeys", text.includes("missingRegistryKeys")],
    ["no missing Lua registry keys assertion", text.includes("missingRegistryKeys).toEqual([])")],
    ["missingChainLimitRegistryKeys", text.includes("missingChainLimitRegistryKeys")],
    ["no missing registry keys assertion", text.includes("missingChainLimitRegistryKeys).toEqual([])")],
    ["serialized chain-limit assertion", noActiveRestoreWindowGroups.has(group) || /state\.chainLimits\[0\][\s\S]{0,160}(registryKey|toMatchObject)/.test(text)],
    ["restored legal-action assertion", text.includes("getLuaRestoreLegalActions") || text.includes("getLuaRestoreLegalActionGroups")],
    ["restored grouped legal-action assertion", text.includes("getLuaRestoreLegalActionGroups") && text.includes("getGroupedDuelLegalActions")],
    ["flattened grouped action assertion", text.includes("flatMap((group) => group.actions)") && text.includes("getLuaRestoreLegalActions")],
  ]
    .filter(([, present]) => !present)
    .map(([label]) => label);
  expect(missing, group).toEqual([]);
}

function scannerGroups(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*\d+\s+(SetChainLimit(?:TillChainEnd)?:\S+)/)?.[1])
    .filter((group): group is string => group !== undefined)
    .sort();
}

function scannerGroupCounts(output: string): Record<string, number> {
  return Object.fromEntries(
    output
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*(\d+)\s+(SetChainLimit(?:TillChainEnd)?:\S+)/))
      .filter((match): match is RegExpMatchArray => match !== null)
      .map((match) => [match[2]!, Number(match[1]!)]),
  );
}

function scannerSummary(output: string): typeof officialScannerSummary {
  const filesWithCalls = output.match(/^files with calls:\s*(\d+)$/m);
  const calls = output.match(/^calls:\s*(\d+)$/m);
  const unclassifiedCalls = output.match(/^unclassified calls:\s*(\d+)$/m);
  expect(filesWithCalls).not.toBeNull();
  expect(calls).not.toBeNull();
  expect(unclassifiedCalls).not.toBeNull();
  return {
    filesWithCalls: Number(filesWithCalls![1]),
    calls: Number(calls![1]),
    unclassifiedCalls: Number(unclassifiedCalls![1]),
  };
}

function realScriptChainLimitFixtureFiles(): string[] {
  return fs.readdirSync(testRoot)
    .filter((file) => /^lua-real-script-.*chain-limit.*\.test\.ts$/.test(file))
    .map((file) => path.join("test", file))
    .sort();
}
