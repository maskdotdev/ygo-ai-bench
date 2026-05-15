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
    expect(exactCount).toBe(620);
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
    expect(exactCount).toBe(1254);
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

function hasInventoryGuard(text: string): boolean {
  return text.includes("toHaveLength(")
    || /expect\([^\n]+\.size\)\.toBe\(/.test(text)
    || /expect\([^\n]+\)\.toEqual\(\[\.\.\./.test(text);
}

function lineNumber(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}
