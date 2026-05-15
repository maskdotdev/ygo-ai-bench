import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const upstreamOfficialRoot = path.join(root, ".upstream/ignis/script/official");

describe("Lua real SelectOption restore coverage", () => {
  it("tracks official scripts that use the leading-boolean SelectOption shape", () => {
    const files = officialScriptsWithLeadingBooleanSelectOption();

    expect(files).toHaveLength(2);
    expect(files).toEqual(["c51510279.lua", "c62767644.lua"]);
    expect(officialLeadingBooleanSelectOptionShapes()).toEqual([
      { file: "c51510279.lua", shape: "table-unpack" },
      { file: "c62767644.lua", shape: "literal-options" },
    ]);
  });

  it("requires representative restore fixtures for leading-boolean SelectOption scripts", () => {
    const missing = leadingBooleanSelectOptionFixtures()
      .filter(({ file, required }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires representative restore fixtures for table-unpacked SelectOption scripts", () => {
    const missing = tableUnpackedSelectOptionFixtures()
      .filter(({ file, required }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function officialScriptsWithLeadingBooleanSelectOption(): string[] {
  return fs.readdirSync(upstreamOfficialRoot)
    .filter((file) => file.endsWith(".lua"))
    .filter((file) => fs.readFileSync(path.join(upstreamOfficialRoot, file), "utf8").includes("SelectOption(tp,false"))
    .sort((a, b) => a.localeCompare(b));
}

function officialLeadingBooleanSelectOptionShapes(): Array<{ file: string; shape: "literal-options" | "table-unpack" }> {
  return officialScriptsWithLeadingBooleanSelectOption().map((file) => {
    const text = fs.readFileSync(path.join(upstreamOfficialRoot, file), "utf8");
    const shape = /SelectOption\(tp,false,table\.unpack\(/.test(text) ? "table-unpack" : "literal-options";
    return { file, shape };
  });
}

function leadingBooleanSelectOptionFixtures(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-inferno-ashened-field-zone-option.test.ts",
      required: [
        "restores a leading-false SelectOption branch that places Obsidim in the opponent Field Zone",
        'controller: 1',
        'location: "spellTrapZone"',
        'expect(restored.host.messages).not.toContain("inferno ashened responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-magikey-duo-defense-ritual.test.ts",
      required: [
        "restores a target-returning Ritual.Operation branch with sumpos face-up Defense",
        'position: "faceUpDefense"',
        'summonType: "ritual"',
        'expect(restored.host.messages).not.toContain("magikey duo responder resolved")',
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}

function tableUnpackedSelectOptionFixtures(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-pyro-clock-select-option-table-unpack.test.ts",
      required: [
        "restores table-unpacked SelectOption into the selected turn-count effect operation",
        'api: "SelectOption"',
        "options: [0, 1]",
        "descriptions: [801, 802]",
        "returned: 0",
        'expect(restored.host.messages).toContain("pyro clock selected first turn effect")',
      ],
    },
  ];
}
