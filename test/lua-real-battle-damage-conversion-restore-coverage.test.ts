import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const battleDamageConversionFixtureCount = 4;

describe("Lua real battle damage conversion restore coverage", () => {
  it("requires battle damage conversion fixtures to assert clean Lua registry restore and final battle outcomes", () => {
    const files = battleDamageConversionFixtureFiles();
    expect(files).toHaveLength(battleDamageConversionFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("eventHistory")
          || !text.includes("lifePoints")
          || !text.includes("battleDamage")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires UI-facing legal-action parity where restored battle damage conversion exposes actions", () => {
    const files = battleDamageConversionFixtureFiles();
    expect(files).toHaveLength(battleDamageConversionFixtureCount);

    const missing = files
      .filter(({ file }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("getLuaRestoreLegalActions");
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function battleDamageConversionFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "lua-real-script-amazoness-swords-woman-reflect-battle-damage.test.ts",
      required: [
        "Amazoness Swords Woman reflect battle damage",
        "code: 202",
        "battleDamage).toEqual({ 0: 500, 1: 0 })",
        "players[0].lifePoints).toBe(7500)",
        "players[1].lifePoints).toBe(8000)",
        "eventName: \"battleDamageDealt\"",
        "eventPlayer: 0",
        "eventValue: 500",
      ],
    },
    {
      file: "lua-real-script-number-c96-also-battle-damage.test.ts",
      required: [
        "Number C96 also battle damage",
        "code: 207",
        "battleDamage).toEqual({ 0: 800, 1: 800 })",
        "players[0].lifePoints).toBe(7200)",
        "players[1].lifePoints).toBe(7200)",
        "eventName: \"battleDamageDealt\"",
        "eventPlayer: 0",
        "eventPlayer: 1",
        "eventValue: 800",
      ],
    },
    {
      file: "lua-real-script-speedroid-hexasaucer-both-battle-damage.test.ts",
      required: [
        "Speedroid Hexasaucer both battle damage",
        "code: 206",
        "code: 208",
        "value: 0x80000001",
        "battleDamage).toEqual({ 0: 950, 1: 950 })",
        "players[0].lifePoints).toBe(7050)",
        "players[1].lifePoints).toBe(7050)",
        "eventName: \"battleDamageDealt\"",
        "eventPlayer: 0",
        "eventPlayer: 1",
        "eventValue: 950",
      ],
    },
    {
      file: "lua-real-script-susa-soldier-half-damage.test.ts",
      required: [
        "Susa Soldier half battle damage",
        "code: 208",
        "battleDamage[1]).toBe(500)",
        "players[0].lifePoints).toBe(8000)",
        "players[1].lifePoints).toBe(7500)",
        "eventName: \"battleDamageDealt\"",
        "eventValue: 500",
      ],
    },
  ]
    .map(({ file, required }) => ({ file: path.join("test", file), required }))
    .sort((a, b) => a.file.localeCompare(b.file));
}
