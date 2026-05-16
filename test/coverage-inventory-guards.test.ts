import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const testRoot = path.join(root, "test");

describe("coverage inventory guards", () => {
  it("requires filesystem-scanned coverage tests to pin their fixture inventory", () => {
    const weak = fs.readdirSync(testRoot)
      .filter((file) => /coverage\.test\.ts$/.test(file))
      .filter((file) => file !== "coverage-inventory-guards.test.ts")
      .filter((file) => {
        const text = fs.readFileSync(path.join(testRoot, file), "utf8");
        return text.includes("fs.readdirSync") && !hasInventoryGuard(text);
      });

    expect(weak).toEqual([]);
  });

  it("requires Lua real-script proof counts to be exact", () => {
    const files = fs.readdirSync(testRoot)
      .filter((file) => /^lua-real-script-.*\.test\.ts$/.test(file));
    const loose = files
      .flatMap((file) => {
        const text = fs.readFileSync(path.join(testRoot, file), "utf8");
        return [
          ...text.matchAll(/registerInitialEffects\(\)\)\.toBeGreaterThan\(/g),
          ...text.matchAll(/registerInitialEffects\(\)\)\.toBeGreaterThanOrEqual\(/g),
        ]
          .map((match) => `${file}:${lineNumber(text, match.index ?? 0)}`);
      });
    const exactCount = files
      .reduce((count, file) => {
        const text = fs.readFileSync(path.join(testRoot, file), "utf8");
        return count + (text.match(/registerInitialEffects\(\)\)\.toBe\(/g)?.length ?? 0);
      }, 0);

    expect(loose).toEqual([]);
    expect(exactCount).toBe(670);
  });

  it("requires Lua registration proof counts to be exact", () => {
    const files = fs.readdirSync(testRoot)
      .filter((file) => /^lua-.*\.test\.ts$/.test(file));
    const loose = files
      .flatMap((file) => {
        const text = fs.readFileSync(path.join(testRoot, file), "utf8");
        return [
          ...text.matchAll(/registerInitialEffects\(\)\)\.toBeGreaterThan\(/g),
          ...text.matchAll(/registerInitialEffects\(\)\)\.toBeGreaterThanOrEqual\(/g),
        ]
          .map((match) => `${file}:${lineNumber(text, match.index ?? 0)}`);
      });
    const exactCount = files
      .reduce((count, file) => {
        const text = fs.readFileSync(path.join(testRoot, file), "utf8");
        return count + (text.match(/registerInitialEffects\(\)\)\.toBe\(/g)?.length ?? 0);
      }, 0);

    expect(loose).toEqual([]);
    expect(exactCount).toBe(1304);
  });

  it("requires non-coverage Lua restore tests to prove grouped restored actions", () => {
    const restoreFiles = fs.readdirSync(testRoot)
      .filter((file) => /^lua-.*\.test\.ts$/.test(file))
      .filter((file) => !/coverage\.test\.ts$/.test(file))
      .filter((file) => {
        const text = fs.readFileSync(path.join(testRoot, file), "utf8");
        return text.includes("restoreDuelWithLuaScripts");
      });
    const missingGroupedRestoreEvidence = restoreFiles
      .filter((file) => {
        const text = fs.readFileSync(path.join(testRoot, file), "utf8");
        return !text.includes("getLuaRestoreLegalActionGroups");
      });

    expect(restoreFiles).toHaveLength(734);
    expect(missingGroupedRestoreEvidence).toEqual([]);
  });

  it("requires source-only event restore branches to prove grouped restored actions before consumption", () => {
    const sourceOnlyFiles = fs.readdirSync(testRoot)
      .filter((file) => /^lua-.*source-only-event\.test\.ts$/.test(file));
    const restoreBranches = sourceOnlyFiles
      .flatMap((file) => sourceOnlyRestoreBranches(file));
    const missingGroupedRestoreEvidence = restoreBranches
      .filter((branch) => !hasNearbyGroupedRestoreEvidence(branch.text, branch.variable))
      .map((branch) => `${branch.file}:${branch.line}`);

    expect(sourceOnlyFiles).toHaveLength(14);
    expect(restoreBranches).toHaveLength(15);
    expect(missingGroupedRestoreEvidence).toEqual([]);
  });

  it("requires event restore branches to prove grouped restored actions before consumption", () => {
    const eventFiles = fs.readdirSync(testRoot)
      .filter((file) => /^lua-.*(?:grouped-event|event)\.test\.ts$/.test(file))
      .filter((file) => !file.includes("source-only"));
    const restoreBranches = eventFiles
      .flatMap((file) => restoreBranchesIn(file));
    const missingGroupedRestoreEvidence = restoreBranches
      .filter((branch) => !hasNearbyGroupedRestoreEvidence(branch.text, branch.variable))
      .map((branch) => `${branch.file}:${branch.line}`);

    expect(eventFiles).toHaveLength(40);
    expect(restoreBranches).toHaveLength(58);
    expect(missingGroupedRestoreEvidence).toEqual([]);
  });

  it("requires chain-limit restore helpers to prove restored actions and groups", () => {
    const chainLimitRestoreFiles = fs.readdirSync(testRoot)
      .filter((file) => /^lua-chain-limit-.*restore\.test\.ts$/.test(file));
    const helperFiles = chainLimitRestoreFiles
      .filter((file) => fs.readFileSync(path.join(testRoot, file), "utf8").includes("function expectRestoredChainLimit"));
    const weakHelpers = helperFiles
      .filter((file) => {
        const text = fs.readFileSync(path.join(testRoot, file), "utf8");
        const helper = text.slice(text.indexOf("function expectRestoredChainLimit"), text.indexOf("function expectRestoredChainLimit") + 1200);
        return !helper.includes("getLuaRestoreLegalActions")
          || !helper.includes("getLegalActions(restored.session")
          || !helper.includes("getLuaRestoreLegalActionGroups");
      });
    const helperCalls = chainLimitRestoreFiles
      .reduce((count, file) => {
        const text = fs.readFileSync(path.join(testRoot, file), "utf8");
        return count + (text.match(/expectRestoredChainLimit\(/g)?.length ?? 0);
      }, 0);

    expect(chainLimitRestoreFiles).toHaveLength(24);
    expect(helperFiles).toHaveLength(12);
    expect(helperCalls).toBe(81);
    expect(weakHelpers).toEqual([]);
  });

  it("requires test proof floors to be exact", () => {
    const greaterThanAllowlist = new Set([
      "lua-field-query-helpers.test.ts:59",
    ]);
    const loose = fs.readdirSync(testRoot)
      .filter((file) => file.endsWith(".test.ts"))
      .filter((file) => file !== "coverage-inventory-guards.test.ts")
      .flatMap((file) => {
        const text = fs.readFileSync(path.join(testRoot, file), "utf8");
        return [
          ...text.matchAll(/toBeGreaterThan\(/g),
          ...text.matchAll(/toBeGreaterThanOrEqual\(/g),
        ]
          .map((match) => `${file}:${lineNumber(text, match.index ?? 0)}`)
          .filter((location) => !greaterThanAllowlist.has(location));
      });

    expect(loose).toEqual([]);
  });
});

function sourceOnlyRestoreBranches(file: string): Array<{ file: string; line: number; text: string; variable: string }> {
  return restoreBranchesIn(file, 550);
}

function restoreBranchesIn(file: string, window = 650): Array<{ file: string; line: number; text: string; variable: string }> {
  const text = fs.readFileSync(path.join(testRoot, file), "utf8");
  return [...text.matchAll(/const (\w+) = restoreDuelWithLuaScripts\(/g)]
    .map((match) => ({
      file,
      line: lineNumber(text, match.index ?? 0),
      text: text.slice(match.index ?? 0, (match.index ?? 0) + window),
      variable: match[1]!,
    }));
}

function hasNearbyGroupedRestoreEvidence(text: string, variable: string): boolean {
  return new RegExp(`expectRestoredLegal(?:Action|Actions|ActionGroups)\\(${variable}(?:\\)|,)`).test(text)
    || text.includes(`getLuaRestoreLegalActionGroups(${variable},`);
}

function hasInventoryGuard(text: string): boolean {
  return text.includes("toHaveLength(")
    || /expect\([^\n]+\.size\)\.toBe\(/.test(text)
    || /expect\([^\n]+\)\.toEqual\(\[\.\.\./.test(text);
}

function lineNumber(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}
