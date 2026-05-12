import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const testRoot = path.join(root, "test");

describe("Lua chain-limit restore coverage", () => {
  it("requires real-script chain-limit fixtures to assert complete restored registry coverage", () => {
    const missing = realScriptChainLimitFixtureFiles()
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes("missingChainLimitRegistryKeys")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])");
      });

    expect(missing).toEqual([]);
  });
});

function realScriptChainLimitFixtureFiles(): string[] {
  return fs.readdirSync(testRoot)
    .filter((file) => /^lua-real-script-.*chain-limit.*\.test\.ts$/.test(file))
    .map((file) => path.join("test", file))
    .sort();
}
