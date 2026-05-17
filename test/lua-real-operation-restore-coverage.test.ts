import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";
import {
  countOperationKinds,
  operationFixtureCount,
  operationFixtureFiles,
  operationKindCounts,
} from "./lua-real-operation-restore-fixtures.js";
import {
  chainNegationOperationVariantCounts,
  chainNegationOperationVariants,
  countChainNegationOperationVariants,
  countGroupDestroyOperationVariants,
  countPotAndSearchOperationVariants,
  groupDestroyOperationVariantCounts,
  groupDestroyOperationVariants,
  potAndSearchOperationVariantCounts,
  potAndSearchOperationVariants,
} from "./lua-real-operation-restore-variants.js";

const root = process.cwd();

describe("Lua real operation restore coverage", () => {
  it("requires representative simple spell operations to assert clean Lua registry restore and restored operation metadata", () => {
    const files = operationFixtureFiles();
    expect(files).toHaveLength(operationFixtureCount);

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
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("eventHistory")
          || !text.includes("operationInfos")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps simple operation fixture kinds explicit", () => {
    expect(countOperationKinds(operationFixtureFiles())).toEqual(operationKindCounts);
  });

  it("keeps group-destroy operation semantic variants explicit", () => {
    expect(countGroupDestroyOperationVariants(groupDestroyOperationVariants())).toEqual(groupDestroyOperationVariantCounts);

    const weak = groupDestroyOperationVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });

  it("keeps Pot and search operation semantic variants explicit", () => {
    expect(countPotAndSearchOperationVariants(potAndSearchOperationVariants())).toEqual(potAndSearchOperationVariantCounts);

    const weak = potAndSearchOperationVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });

  it("keeps chain-negation operation semantic variants explicit", () => {
    expect(countChainNegationOperationVariants(chainNegationOperationVariants())).toEqual(chainNegationOperationVariantCounts);

    const weak = chainNegationOperationVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});
