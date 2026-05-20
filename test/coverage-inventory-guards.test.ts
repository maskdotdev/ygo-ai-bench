import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const testRoot = path.join(root, "test");

describe("coverage inventory guards", () => {
  it("requires fixture classifiers in coverage tests to fail closed unless explicitly exempted", () => {
    const exemptClassifiers = new Set(["lua-real-response-restore-coverage.test.ts:classifyResponseFixture"]);
    const softClassifiers = fs.readdirSync(testRoot)
      .filter((file) => /coverage\.test\.ts$/.test(file))
      .filter((file) => file !== "coverage-inventory-guards.test.ts")
      .flatMap((file) => {
        const text = fs.readFileSync(path.join(testRoot, file), "utf8");
        return [...text.matchAll(/function (classify\w+)\b/g)]
          .filter((match) => {
            const classifierName = match[1]!;
            if (exemptClassifiers.has(`${file}:${classifierName}`)) return false;
            const classifierText = text.slice(match.index ?? 0, functionBodyEnd(text, match.index ?? 0));
            return !classifierText.includes("throw new Error(`Unclassified");
          })
          .map((match) => `${file}:${lineNumber(text, match.index ?? 0)}:${match[1]!}`);
      });

    expect(softClassifiers).toEqual([]);
  });

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
    expect(exactCount).toBe(1031);
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
    expect(exactCount).toBe(1665);
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

    expect(restoreFiles).toHaveLength(1074);
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

    expect(helpers).toHaveLength(473);
    expect(weak).toEqual([]);
  });

  it("requires Lua restore response helpers to prove raw, grouped, and flattened returned legal actions", () => {
    const helpers = luaRestoreResponseHelpers();
    const helpersByKey = new Map(helpers.map((helper) => [helperKey(helper), helper]));
    const weak = helpers
      .filter((helper) => !hasStrongLuaRestoreResponseHelper(helper, helpersByKey))
      .map((helper) => `${helper.file}:${helper.line}:${helper.name}`);

    expect(helpers).toHaveLength(313);
    expect(weak).toEqual([]);
  });

  it("requires restore legal-window helpers to prove raw, grouped, and flattened returned legal actions", () => {
    const helpers = restoreLegalWindowHelpers();
    const weak = helpers
      .filter((helper) => !hasReturnedRawLegalActionProof(helper.text)
        || !hasReturnedGroupedLegalActionProof(helper.text)
        || !hasReturnedLegalActionFlattenProof(helper.text))
      .map((helper) => `${helper.file}:${helper.line}`);
    const helperReferences = fs.readdirSync(testRoot)
      .filter((file) => file.endsWith(".test.ts"))
      .filter((file) => file !== "coverage-inventory-guards.test.ts")
      .reduce((count, file) => count + (readTestFile(file).match(/assertRestoreLegalWindow\(/g)?.length ?? 0), 0);

    expect(helpers).toHaveLength(7);
    expect(helperReferences).toBe(95);
    expect(weak).toEqual([]);
  });

  it("requires local legal-window helpers to prove raw, grouped, and flattened returned legal actions", () => {
    const helpers = localLegalWindowHelpers();
    const weak = helpers
      .filter((helper) => !hasReturnedRawLegalActionProof(helper.text)
        || !hasReturnedGroupedLegalActionProof(helper.text)
        || !hasReturnedLegalActionFlattenProof(helper.text))
      .map((helper) => `${helper.file}:${helper.line}:${helper.name}`);
    const helperReferences = fs.readdirSync(testRoot)
      .filter((file) => file.endsWith(".test.ts"))
      .filter((file) => file !== "coverage-inventory-guards.test.ts")
      .reduce((count, file) => count + (readTestFile(file).match(/assertLegalWindow(?:Metadata)?\(/g)?.length ?? 0), 0);

    expect(helpers).toHaveLength(4);
    expect(helperReferences).toBe(63);
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

  it("requires chain-limit restored responses to prove returned legal-action surfaces", () => {
    const calls = chainLimitRestoreResponseCalls();
    const negative = calls.filter((call) => call.text.includes("ok: false"));
    const weakPositive = calls
      .filter((call) => !call.text.includes("ok: false"))
      .filter((call) => !hasStrongChainLimitRestoreResponse(call))
      .map((call) => `${call.file}:${call.line}:${call.responseVariable}`);

    expect(calls).toHaveLength(40);
    expect(negative).toHaveLength(1);
    expect(weakPositive).toEqual([]);
  });

  it("requires stale rejected responses to prove returned legal-action surfaces", () => {
    const calls = staleRejectedResponseCalls();
    const weak = calls
      .filter((call) => !hasReturnedLegalActionSurfaceProof(call.text, call.responseVariable))
      .map((call) => `${call.file}:${call.line}:${call.responseVariable}`);

    expect(calls).toHaveLength(31);
    expect(weak).toEqual([]);
  });

  it("requires stale response helpers to preserve returned legal-action proof", () => {
    const helpers = staleResponseHelpers();
    const weak = helpers
      .filter((helper) => !hasStrongStaleResponseHelper(helper))
      .map((helper) => `${helper.file}:${helper.line}:${helper.name}`);
    const helperReferences = fs.readdirSync(testRoot)
      .filter((file) => file.endsWith(".test.ts"))
      .filter((file) => file !== "coverage-inventory-guards.test.ts")
      .reduce((count, file) => count + (readTestFile(file).match(/\b(?:assert|expect)Stale\w*\(/g)?.length ?? 0), 0);

    expect(helpers).toHaveLength(11);
    expect(helperReferences).toBe(75);
    expect(weak).toEqual([]);
  });

  it("requires public restore metadata helpers to prove trigger buckets and order prompts", () => {
    const helpers = publicRestoreMetadataHelpers();
    const weak = helpers
      .filter((helper) => !hasStrongPublicRestoreMetadataHelper(helper.text))
      .map((helper) => `${helper.file}:${helper.line}`);
    const helperReferences = fs.readdirSync(testRoot)
      .filter((file) => file.endsWith(".ts"))
      .filter((file) => file !== "coverage-inventory-guards.test.ts")
      .reduce((count, file) => count + (readTestFile(file).match(/\bassertPublicRestoreMetadata\(/g)?.length ?? 0), 0);

    expect(helpers).toHaveLength(27);
    expect(helperReferences).toBe(90);
    expect(weak).toEqual([]);
  });

  it("requires current-window metadata helpers to prove action and group window stamps", () => {
    const helpers = currentWindowMetadataHelpers();
    const weak = helpers
      .filter((helper) => !hasStrongCurrentWindowMetadataHelper(helper.text))
      .map((helper) => `${helper.file}:${helper.line}`);
    const helperReferences = fs.readdirSync(testRoot)
      .filter((file) => file.endsWith(".ts"))
      .filter((file) => file !== "coverage-inventory-guards.test.ts")
      .reduce((count, file) => count + (readTestFile(file).match(/\bexpectCurrentWindowMetadata\(/g)?.length ?? 0), 0);

    expect(helpers).toHaveLength(3);
    expect(helperReferences).toBe(11);
    expect(weak).toEqual([]);
  });

  it("requires failed restore surface helpers to preserve returned legal windows", () => {
    const helpers = failedRestoreSurfaceHelpers();
    const weak = helpers
      .filter((helper) => !hasStrongFailedRestoreSurfaceHelper(helper.text))
      .map((helper) => `${helper.file}:${helper.line}`);
    const helperReferences = fs.readdirSync(testRoot)
      .filter((file) => file.endsWith(".ts"))
      .filter((file) => file !== "coverage-inventory-guards.test.ts")
      .reduce((count, file) => count + (readTestFile(file).match(/\bassertFailedRestoreSurface\(/g)?.length ?? 0), 0);

    expect(helpers).toHaveLength(1);
    expect(helperReferences).toBe(10);
    expect(weak).toEqual([]);
  });

  it("requires Lua real-script and parity fixtures to assert outcomes instead of bare throw checks", () => {
    const files = fs.readdirSync(testRoot)
      .filter((file) => /^(?:lua-real|parity).*\.test\.ts$/.test(file));
    const weak = files
      .flatMap((file) => {
        const text = readTestFile(file);
        return [...text.matchAll(/(?:\.not\.toThrow\(\)|\.toThrow\(\))/g)]
          .map((match) => `${file}:${lineNumber(text, match.index ?? 0)}`);
      });

    expect(files).toHaveLength(1950);
    expect(weak).toEqual([]);
  });

  it("requires test proof floors to be exact", () => {
    const loose = fs.readdirSync(testRoot)
      .filter((file) => file.endsWith(".test.ts"))
      .filter((file) => file !== "coverage-inventory-guards.test.ts")
      .flatMap((file) => {
        const text = fs.readFileSync(path.join(testRoot, file), "utf8");
        return [
          ...text.matchAll(/toBeGreaterThan\(/g),
          ...text.matchAll(/toBeGreaterThanOrEqual\(/g),
        ]
          .map((match) => `${file}:${lineNumber(text, match.index ?? 0)}`);
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
    .filter((file) => file !== "coverage-inventory-guards.test.ts")
    .flatMap((file) => {
      const text = readTestFile(file);
      return [...text.matchAll(/function (expectRestoredLegal(?:Action|Actions|ActionGroups))\b/g)]
        .map((match) => ({ file, line: lineNumber(text, match.index ?? 0), name: match[1]! }));
    });
}

type LuaRestoreResponseHelper = { file: string; line: number; name: string; text: string };

function luaRestoreResponseHelpers(): LuaRestoreResponseHelper[] {
  return fs.readdirSync(testRoot)
    .filter((file) => file.endsWith(".ts"))
    .flatMap((file) => {
      const text = readTestFile(file);
      return [...text.matchAll(/(?:export\s+)?function (applyLuaRestoreAndAssert|expectLuaRestoreStalePreapply|assertLuaRestoreLegalWindow)\b/g)]
        .map((match) => {
          const start = match.index ?? 0;
          return {
            file,
            line: lineNumber(text, start),
            name: match[1]!,
            text: text.slice(start, functionBodyEnd(text, start)),
          };
        });
    });
}

function helperKey(helper: Pick<LuaRestoreResponseHelper, "file" | "name">): string {
  return `${helper.file}:${helper.name}`;
}

type RestoreLegalWindowHelper = { file: string; line: number; text: string };

function restoreLegalWindowHelpers(): RestoreLegalWindowHelper[] {
  return fs.readdirSync(testRoot)
    .filter((file) => file.endsWith(".test.ts"))
    .filter((file) => file !== "coverage-inventory-guards.test.ts")
    .flatMap((file) => {
      const text = readTestFile(file);
      return [...text.matchAll(/function assertRestoreLegalWindow\b/g)]
        .map((match) => {
          const start = match.index ?? 0;
          return {
            file,
            line: lineNumber(text, start),
            text: text.slice(start, functionBodyEnd(text, start)),
          };
        });
    });
}

type LocalLegalWindowHelper = { file: string; line: number; name: string; text: string };

function localLegalWindowHelpers(): LocalLegalWindowHelper[] {
  return fs.readdirSync(testRoot)
    .filter((file) => file.endsWith(".test.ts"))
    .filter((file) => file !== "coverage-inventory-guards.test.ts")
    .flatMap((file) => {
      const text = readTestFile(file);
      return [...text.matchAll(/function (assertLegalWindow(?:Metadata)?)\b/g)]
        .map((match) => {
          const start = match.index ?? 0;
          return {
            file,
            line: lineNumber(text, start),
            name: match[1]!,
            text: text.slice(start, functionBodyEnd(text, start)),
          };
        });
    });
}

function functionBodyEnd(text: string, start: number): number {
  const open = functionBodyOpen(text, start);
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    if (text[index] === "{") depth++;
    else if (text[index] === "}") {
      depth--;
      if (depth === 0) return index + 1;
    }
  }
  throw new Error(`Unclosed function body after ${start}`);
}

function functionBodyOpen(text: string, start: number): number {
  const paramsOpen = text.indexOf("(", start);
  let depth = 0;
  for (let index = paramsOpen; index < text.length; index++) {
    if (text[index] === "(") depth++;
    else if (text[index] === ")") {
      depth--;
      if (depth === 0) {
        const open = text.indexOf("{", index);
        if (open >= 0) return open;
        break;
      }
    }
  }
  throw new Error(`Missing function body after ${start}`);
}

function hasStrongLuaRestoreResponseHelper(
  helper: LuaRestoreResponseHelper,
  helpersByKey: Map<string, LuaRestoreResponseHelper>,
  seen = new Set<string>(),
): boolean {
  const key = helperKey(helper);
  if (seen.has(key)) return false;
  seen.add(key);
  if (hasReturnedRawLegalActionProof(helper.text)
    && hasReturnedGroupedLegalActionProof(helper.text)
    && hasReturnedLegalActionFlattenProof(helper.text)) {
    return true;
  }
  return [...helper.text.matchAll(/\b(assertLuaRestoreLegalWindow)\(/g)]
    .some((match) => {
      const callee = helpersByKey.get(`${helper.file}:${match[1]!}`);
      return callee !== undefined && hasStrongLuaRestoreResponseHelper(callee, helpersByKey, seen);
    });
}

function hasReturnedRawLegalActionProof(text: string): boolean {
  return /\b(\w+)\.legalActions\)\.toEqual\([\s\S]{0,180}\b(?:getDuelLegalActions|getLegalActions|getLuaRestoreLegalActions)\(/.test(text);
}

function hasReturnedGroupedLegalActionProof(text: string): boolean {
  return /\b(\w+)\.legalActionGroups\)\.toEqual\([\s\S]{0,220}\b(?:getGroupedDuelLegalActions|getLuaRestoreLegalActionGroups)\(/.test(text);
}

function hasReturnedLegalActionFlattenProof(text: string): boolean {
  return /\b(\w+)\.legalActionGroups\.flatMap\(\(group\) => group\.actions\)\)\.toEqual\(\s*\1\.legalActions\s*\);/.test(text);
}

function chainLimitRestoreResponseCalls(): Array<{ file: string; line: number; restoredVariable: string; responseVariable: string; text: string }> {
  return fs.readdirSync(testRoot)
    .filter((file) => /^lua-chain-limit-.*restore\.test\.ts$/.test(file))
    .flatMap((file) => {
      const text = readTestFile(file);
      return [...text.matchAll(/const (\w+) = applyLuaRestoreResponse\((\w+),/g)]
        .map((match) => ({
          file,
          line: lineNumber(text, match.index ?? 0),
          responseVariable: match[1]!,
          restoredVariable: match[2]!,
          text: text.slice(match.index ?? 0, (match.index ?? 0) + 900),
        }));
    });
}

function hasStrongChainLimitRestoreResponse(call: { restoredVariable: string; responseVariable: string; text: string }): boolean {
  return call.text.includes(`expectLuaRestoreResponseLegalActions(${call.restoredVariable}, ${call.responseVariable})`)
    || hasReturnedLegalActionSurfaceProof(call.text, call.responseVariable);
}

function staleRejectedResponseCalls(): Array<{ file: string; line: number; responseVariable: string; text: string }> {
  return fs.readdirSync(testRoot)
    .filter((file) => /^(?:lua|duel)-stale-.*responses\.test\.ts$/.test(file))
    .flatMap((file) => {
      const text = readTestFile(file);
      return [...text.matchAll(/const (\w+) = apply(?:LuaRestore)?Response\(/g)]
        .map((match) => ({
          file,
          line: lineNumber(text, match.index ?? 0),
          responseVariable: match[1]!,
          text: text.slice(match.index ?? 0, (match.index ?? 0) + 900),
        }))
        .filter((call) => call.text.includes("Response is not currently legal"));
    });
}

function hasReturnedLegalActionSurfaceProof(text: string, responseVariable: string): boolean {
  return text.includes(`${responseVariable}.legalActions`)
    && text.includes(`${responseVariable}.legalActionGroups`)
    && text.includes(`${responseVariable}.legalActionGroups.flatMap((group) => group.actions)).toEqual(${responseVariable}.legalActions`);
}

type StaleResponseHelper = { file: string; line: number; name: string; text: string };

function staleResponseHelpers(): StaleResponseHelper[] {
  return fs.readdirSync(testRoot)
    .filter((file) => file.endsWith(".test.ts"))
    .filter((file) => file !== "coverage-inventory-guards.test.ts")
    .flatMap((file) => {
      const text = readTestFile(file);
      return [...text.matchAll(/function ((?:assert|expect)Stale\w*)\b/g)]
        .map((match) => {
          const start = match.index ?? 0;
          return {
            file,
            line: lineNumber(text, start),
            name: match[1]!,
            text: text.slice(start, functionBodyEnd(text, start)),
          };
        });
    });
}

function hasStrongStaleResponseHelper(helper: StaleResponseHelper): boolean {
  const fileText = readTestFile(helper.file);
  if (hasReturnedRawLegalActionProof(helper.text)
    && hasReturnedGroupedLegalActionProof(helper.text)
    && (hasReturnedLegalActionFlattenProof(helper.text) || hasStrongResultActionsMatchStateProof(helper.text, fileText))) {
    return true;
  }
  return /\b(?:assertRestoreLegalWindow|assertLegalWindow|assertLegalWindowMetadata|assertLuaRestoreLegalWindow)\(/.test(helper.text);
}

function hasStrongResultActionsMatchStateProof(text: string, fileText: string): boolean {
  if (!text.includes("expectResultActionsMatchResultState(")) return false;
  const helperStart = fileText.indexOf("function expectResultActionsMatchResultState");
  if (helperStart < 0) return false;
  const helperText = fileText.slice(helperStart, functionBodyEnd(fileText, helperStart));
  return helperText.includes("result.legalActionGroups.flatMap((group) => group.actions)")
    && helperText.includes("groupedActions).toHaveLength(result.legalActions.length)")
    && helperText.includes("groupedActions).toEqual(expect.arrayContaining(result.legalActions))");
}

type PublicRestoreMetadataHelper = { file: string; line: number; text: string };

function publicRestoreMetadataHelpers(): PublicRestoreMetadataHelper[] {
  return fs.readdirSync(testRoot)
    .filter((file) => file.endsWith(".ts"))
    .filter((file) => file !== "coverage-inventory-guards.test.ts")
    .flatMap((file) => {
      const text = readTestFile(file);
      return [...text.matchAll(/(?:export\s+)?function assertPublicRestoreMetadata\b/g)]
        .map((match) => {
          const start = match.index ?? 0;
          return {
            file,
            line: lineNumber(text, start),
            text: text.slice(start, functionBodyEnd(text, start)),
          };
        });
    });
}

function hasStrongPublicRestoreMetadataHelper(text: string): boolean {
  return text.includes("const publicState = queryPublicState(restored.session)")
    && /\b\w+\.state\.pendingTriggerBuckets/.test(text)
    && text.includes("publicState.pendingTriggerBuckets")
    && text.includes("\"triggerOrderPrompt\" in publicState")
    && text.includes(".state.triggerOrderPrompt")
    && text.includes("publicState.triggerOrderPrompt")
    && text.includes(".state).not.toHaveProperty(\"triggerOrderPrompt\")");
}

type CurrentWindowMetadataHelper = { file: string; line: number; text: string };

function currentWindowMetadataHelpers(): CurrentWindowMetadataHelper[] {
  return fs.readdirSync(testRoot)
    .filter((file) => file.endsWith(".ts"))
    .filter((file) => file !== "coverage-inventory-guards.test.ts")
    .flatMap((file) => {
      const text = readTestFile(file);
      return [...text.matchAll(/function expectCurrentWindowMetadata\b/g)]
        .map((match) => {
          const start = match.index ?? 0;
          return {
            file,
            line: lineNumber(text, start),
            text: text.slice(start, functionBodyEnd(text, start)),
          };
        });
    });
}

function hasStrongCurrentWindowMetadataHelper(text: string): boolean {
  return text.includes("for (const action of response.legalActions)")
    && text.includes("for (const group of response.legalActionGroups)")
    && text.includes("windowId: session.state.actionWindowId")
    && text.includes("windowKind: response.state.windowKind");
}

type FailedRestoreSurfaceHelper = { file: string; line: number; text: string };

function failedRestoreSurfaceHelpers(): FailedRestoreSurfaceHelper[] {
  return fs.readdirSync(testRoot)
    .filter((file) => file.endsWith(".ts"))
    .filter((file) => file !== "coverage-inventory-guards.test.ts")
    .flatMap((file) => {
      const text = readTestFile(file);
      return [...text.matchAll(/function assertFailedRestoreSurface\b/g)]
        .map((match) => {
          const start = match.index ?? 0;
          return {
            file,
            line: lineNumber(text, start),
            text: text.slice(start, functionBodyEnd(text, start)),
          };
        });
    });
}

function hasStrongFailedRestoreSurfaceHelper(text: string): boolean {
  return text.includes("const windowId = restored.session.state.actionWindowId")
    && text.includes("response.state.actionWindowId).toBe(windowId)")
    && text.includes("response.state.windowKind).toBe(\"open\")")
    && hasReturnedRawLegalActionProof(text)
    && hasReturnedGroupedLegalActionProof(text)
    && hasReturnedLegalActionFlattenProof(text)
    && text.includes("for (const action of response.legalActions)")
    && text.includes("for (const group of response.legalActionGroups)")
    && text.includes("windowKind: \"open\"");
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
