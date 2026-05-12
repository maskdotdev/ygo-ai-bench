import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const testRoot = path.join(root, "test");
const battleKeywords = ["battle", "attack", "damage"];

describe("Lua real battle restore coverage", () => {
  it("requires real-script battle fixtures to assert Lua-aware complete restore", () => {
    const missing = realScriptBattleFixtureFiles()
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts") || !text.includes("restoreComplete");
      });

    expect(missing).toEqual([]);
  });
});

function realScriptBattleFixtureFiles(): string[] {
  return fs.readdirSync(testRoot)
    .filter((file) => file.startsWith("lua-real-script-") && file.endsWith(".test.ts"))
    .filter((file) => battleKeywords.some((keyword) => file.includes(keyword)))
    .map((file) => path.join("test", file))
    .sort();
}
