import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
// Restore ownership: "test/lua-real-script-triple-tactics-talent-select-branch.test.ts"
const upstreamOfficialRoot = path.join(root, ".upstream/ignis/script/official");
const selectOptionKindCounts = {
  leadingBooleanLiteralOptions: 1,
  regularTargetLevelUpdateOptions: 1,
  leadingBooleanTableUnpack: 1,
  tableUnpackedOptions: 1,
} satisfies Record<SelectOptionKind, number>;
const selectOptionSemanticVariantCounts = {
  infernoAshenedOpponentFieldZoneOption: 1,
  magikeyDuoDefenseRitualOption: 1,
  pyroClockTableUnpackTurnEffectOption: 1,
  starChangerTargetLevelUpdateOption: 1,
} satisfies Record<SelectOptionSemanticVariant, number>;

type SelectOptionKind = "leadingBooleanLiteralOptions" | "regularTargetLevelUpdateOptions" | "leadingBooleanTableUnpack" | "tableUnpackedOptions";

type SelectOptionSemanticVariant =
  | "infernoAshenedOpponentFieldZoneOption"
  | "magikeyDuoDefenseRitualOption"
  | "pyroClockTableUnpackTurnEffectOption"
  | "starChangerTargetLevelUpdateOption";

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
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires representative restore fixtures for table-unpacked SelectOption scripts", () => {
    const missing = tableUnpackedSelectOptionFixtures()
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
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps SelectOption fixture kinds explicit", () => {
    expect(countSelectOptionKinds([
      ...leadingBooleanSelectOptionFixtures(),
      ...tableUnpackedSelectOptionFixtures(),
    ])).toEqual(selectOptionKindCounts);
  });

  it("keeps named SelectOption semantic variants explicit", () => {
    expect(countSelectOptionSemanticVariants(selectOptionSemanticVariants())).toEqual(selectOptionSemanticVariantCounts);

    const weak = selectOptionSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });

  it("keeps SelectOption fixtures script-gated and database-independent", () => {
    const weak = selectOptionSemanticVariants()
      .filter(({ file }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return text.includes("readDatabaseCards")
          || text.includes("hasUpstreamDatabase")
          || !text.includes("workspace.readScript")
          || !text.includes("describe.skipIf(!hasUpstreamScripts || !has");
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
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
    const text = coverageText(fs.readFileSync(path.join(upstreamOfficialRoot, file), "utf8"));
    const shape = /SelectOption\(tp,false,table\.unpack\(/.test(text) ? "table-unpack" : "literal-options";
    return { file, shape };
  });
}

function leadingBooleanSelectOptionFixtures(): Array<{
  file: string;
  kind: SelectOptionKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-inferno-ashened-field-zone-option.test.ts",
      kind: "leadingBooleanLiteralOptions",
      required: [
        "restores a leading-false SelectOption branch that places Obsidim in the opponent Field Zone",
        'controller: 1',
        'location: "spellTrapZone"',
        'expect(restored.host.messages).not.toContain("inferno ashened responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-magikey-duo-defense-ritual.test.ts",
      kind: "leadingBooleanTableUnpack",
      required: [
        "restores a target-returning Ritual.Operation branch with sumpos face-up Defense",
        'position: "faceUpDefense"',
        'summonType: "ritual"',
        'expect(restored.host.messages).not.toContain("magikey duo responder resolved")',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: SelectOptionKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function tableUnpackedSelectOptionFixtures(): Array<{
  file: string;
  kind: SelectOptionKind;
  required: string[];
}> {
  return [
    {
      file: "test/lua-real-script-pyro-clock-select-option-table-unpack.test.ts",
      kind: "tableUnpackedOptions",
      required: [
        "restores table-unpacked SelectOption into the selected turn-count effect operation",
        'api: "SelectOption"',
        "options: [0, 1]",
        "descriptions: [801, 802]",
        "returned: 0",
        'expect(restored.host.messages).toContain("pyro clock selected first turn effect")',
      ],
    },
    {
      file: "test/lua-real-script-star-changer-target-select-option-level-update.test.ts",
      kind: "regularTargetLevelUpdateOptions",
      required: [
        "restores target-time SelectOption into a temporary targeted EFFECT_UPDATE_LEVEL increase",
        "Duel.SelectOption(tp,aux.Stringid(id,0),aux.Stringid(id,1))",
        "e1:SetCode(EFFECT_UPDATE_LEVEL)",
        "value: 1",
        "currentLevel(restoredTarget, restoredOpen.session.state)).toBe(5)",
        'eventName === "levelChanged"',
      ],
    },
  ];
}

function countSelectOptionKinds(fixtures: Array<{ kind: SelectOptionKind }>): Record<SelectOptionKind, number> {
  return fixtures.reduce<Record<SelectOptionKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      leadingBooleanLiteralOptions: 0,
      regularTargetLevelUpdateOptions: 0,
      leadingBooleanTableUnpack: 0,
      tableUnpackedOptions: 0,
    },
  );
}

function selectOptionSemanticVariants(): Array<{
  file: string;
  kind: SelectOptionSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-inferno-ashened-field-zone-option.test.ts",
      kind: "infernoAshenedOpponentFieldZoneOption",
      required: [
        'const infernoCode = "62767644"',
        "restores a leading-false SelectOption branch that places Obsidim in the opponent Field Zone",
        "descriptions: [fieldZoneOptionDescription, opponentFieldZoneOptionDescription]",
        "returned: 1",
        "controller: 1",
        "inferno ashened responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-magikey-duo-defense-ritual.test.ts",
      kind: "magikeyDuoDefenseRitualOption",
      required: [
        'const magikeyDuoCode = "51510279"',
        "restores a target-returning Ritual.Operation branch with sumpos face-up Defense",
        "descriptions: [returnOptionDescription, ritualOptionDescription]",
        "returned: 1",
        "summonType: \"ritual\"",
        "eventName: \"specialSummoned\"",
      ],
    },
    {
      file: "test/lua-real-script-pyro-clock-select-option-table-unpack.test.ts",
      kind: "pyroClockTableUnpackTurnEffectOption",
      required: [
        'const pyroClockCode = "1082946"',
        "restores table-unpacked SelectOption into the selected turn-count effect operation",
        "options: [0, 1]",
        "descriptions: [801, 802]",
        "returned: 0",
        "pyro clock selected first turn effect",
      ],
    },
    {
      file: "test/lua-real-script-star-changer-target-select-option-level-update.test.ts",
      kind: "starChangerTargetLevelUpdateOption",
      required: [
        'const starChangerCode = "63485233"',
        "restores target-time SelectOption into a temporary targeted EFFECT_UPDATE_LEVEL increase",
        "Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)",
        "Duel.SelectOption(tp,aux.Stringid(id,0),aux.Stringid(id,1))",
        "registryKey: \"lua:63485233:lua-2-130\"",
        "currentLevel(restoredLevel.session.state.cards.find((card) => card.uid === target.uid), restoredLevel.session.state)).toBe(5)",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: SelectOptionSemanticVariant;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countSelectOptionSemanticVariants(fixtures: Array<{ kind: SelectOptionSemanticVariant }>): Record<SelectOptionSemanticVariant, number> {
  return fixtures.reduce<Record<SelectOptionSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      infernoAshenedOpponentFieldZoneOption: 0,
      magikeyDuoDefenseRitualOption: 0,
      pyroClockTableUnpackTurnEffectOption: 0,
      starChangerTargetLevelUpdateOption: 0,
    },
  );
}
