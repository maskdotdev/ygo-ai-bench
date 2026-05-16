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
    expect(exactCount).toBe(677);
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
    expect(exactCount).toBe(1311);
  });

  it("requires non-coverage Lua restore tests to prove raw, grouped, and flattened restored actions", () => {
    const restoreFiles = fs.readdirSync(testRoot)
      .filter((file) => /^lua-.*\.test\.ts$/.test(file))
      .filter((file) => !/coverage\.test\.ts$/.test(file))
      .filter((file) => {
        const text = fs.readFileSync(path.join(testRoot, file), "utf8");
        return text.includes("restoreDuelWithLuaScripts");
      });
    const missingRestoreEvidence = restoreFiles
      .filter((file) => {
        const text = fs.readFileSync(path.join(testRoot, file), "utf8");
        return !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !hasFlattenedGroupedRestoreEvidence(text);
      });

    expect(restoreFiles).toHaveLength(737);
    expect(missingRestoreEvidence).toEqual([]);
  });

  it("requires source-only event restore branches to prove raw, grouped, and flattened restored actions before consumption", () => {
    const sourceOnlyFiles = fs.readdirSync(testRoot)
      .filter((file) => /^lua-.*source-only-event\.test\.ts$/.test(file));
    const restoreBranches = sourceOnlyFiles
      .flatMap((file) => sourceOnlyRestoreBranches(file));
    const missingRestoreEvidence = restoreBranches
      .filter((branch) => !hasNearbyRestoredActionEvidence(branch.text, branch.variable, readTestFile(branch.file)))
      .map((branch) => `${branch.file}:${branch.line}`);

    expect(sourceOnlyFiles).toHaveLength(14);
    expect(restoreBranches).toHaveLength(15);
    expect(missingRestoreEvidence).toEqual([]);
  });

  it("requires event restore branches to prove raw, grouped, and flattened restored actions before consumption", () => {
    const eventFiles = fs.readdirSync(testRoot)
      .filter((file) => /^lua-.*(?:grouped-event|event)\.test\.ts$/.test(file))
      .filter((file) => !file.includes("source-only"));
    const restoreBranches = eventFiles
      .flatMap((file) => restoreBranchesIn(file));
    const missingRestoreEvidence = restoreBranches
      .filter((branch) => !hasNearbyRestoredActionEvidence(branch.text, branch.variable, readTestFile(branch.file)))
      .map((branch) => `${branch.file}:${branch.line}`);

    expect(eventFiles).toHaveLength(40);
    expect(restoreBranches).toHaveLength(58);
    expect(missingRestoreEvidence).toEqual([]);
  });

  it("requires restored legal-action helper definitions to keep raw, grouped, and flattened proof", () => {
    const helpers = restoredLegalActionHelpers();
    const weak = helpers
      .filter((helper) => !hasStrongRestoreHelper(readTestFile(helper.file), helper.name))
      .map((helper) => `${helper.file}:${helper.line}:${helper.name}`);

    expect(helpers).toHaveLength(256);
    expect(weak).toEqual([]);
  });

  it("requires chain-limit restore helpers to prove raw, grouped, and flattened restored actions", () => {
    const chainLimitRestoreFiles = fs.readdirSync(testRoot)
      .filter((file) => /^lua-chain-limit-.*restore\.test\.ts$/.test(file));
    const helperFiles = chainLimitRestoreFiles
      .filter((file) => fs.readFileSync(path.join(testRoot, file), "utf8").includes("function expectRestoredChainLimit"));
    const weakHelpers = helperFiles
      .filter((file) => {
        const text = fs.readFileSync(path.join(testRoot, file), "utf8");
        const helper = text.slice(text.indexOf("function expectRestoredChainLimit"), text.indexOf("function expectRestoredChainLimit") + 1600);
        return !helper.includes("getLuaRestoreLegalActions")
          || !helper.includes("getLegalActions(restored.session")
          || !helper.includes("getLuaRestoreLegalActionGroups")
          || !hasFlattenedGroupedRestoreEvidence(helper);
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

function restoreBranchesIn(file: string, window = 1500): Array<{ file: string; line: number; text: string; variable: string }> {
  const text = readTestFile(file);
  return [...text.matchAll(/const (\w+) = restoreDuelWithLuaScripts\(/g)]
    .map((match) => ({
      file,
      line: lineNumber(text, match.index ?? 0),
      text: text.slice(match.index ?? 0, (match.index ?? 0) + window),
      variable: match[1]!,
    }));
}

function readTestFile(file: string): string {
  return fs.readFileSync(path.join(testRoot, file), "utf8");
}

function restoredLegalActionHelpers(): Array<{ file: string; line: number; name: string }> {
  return fs.readdirSync(testRoot)
    .filter((file) => file.endsWith(".test.ts"))
    .flatMap((file) => {
      const text = readTestFile(file);
      return [...text.matchAll(/function (expectRestoredLegal(?:Action|Actions|ActionGroups))\b/g)]
        .map((match) => ({ file, line: lineNumber(text, match.index ?? 0), name: match[1]! }));
    });
}

function hasNearbyRestoredActionEvidence(text: string, variable: string, fileText: string): boolean {
  if (hasDirectRestoredActionEvidence(text, variable)) return true;
  return calledStrongRestoreHelpers(text, variable)
    .some((helper) => hasStrongRestoreHelper(fileText, helper));
}

function hasDirectRestoredActionEvidence(text: string, variable: string): boolean {
  return text.includes(`getLuaRestoreLegalActions(${variable},`)
    && text.includes(`getLuaRestoreLegalActionGroups(${variable},`)
    && hasFlattenedGroupedRestoreEvidence(text);
}

function calledStrongRestoreHelpers(text: string, variable: string): string[] {
  return [...text.matchAll(new RegExp(`\\b(expectRestoredLegal(?:Action|Actions|ActionGroups))\\(${variable}(?:\\)|,)`, "g"))]
    .map((match) => match[1]!);
}

function hasStrongRestoreHelper(text: string, helper: string): boolean {
  const helperStart = text.indexOf(`function ${helper}`);
  if (helperStart < 0) return false;
  const helperText = text.slice(helperStart, helperStart + 1200);
  return helperText.includes("getLuaRestoreLegalActions")
    && helperText.includes("getLuaRestoreLegalActionGroups")
    && hasFlattenedGroupedRestoreEvidence(helperText);
}

function hasFlattenedGroupedRestoreEvidence(text: string): boolean {
  return /flatMap\(\(group\) => group\.actions\)\)\.toEqual\([\s\S]*?(?:getLuaRestoreLegalActions|\b(?:actions|response|result|changed|summoned)\.legalActions|\bactions\b)[\s\S]*?\);/.test(text);
}

function hasInventoryGuard(text: string): boolean {
  return text.includes("toHaveLength(")
    || /expect\([^\n]+\.size\)\.toBe\(/.test(text)
    || /expect\([^\n]+\)\.toEqual\(\[\.\.\./.test(text);
}

function lineNumber(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}
