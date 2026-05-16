import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const damageConversionFixtureCount = 6;
const damageConversionKindCounts: Record<DamageConversionKind, number> = {
  changeDamage: 1,
  noEffectDamage: 1,
  reflectDamage: 1,
  reverseDamage: 2,
  reverseRecover: 1,
};

describe("Lua real damage conversion restore coverage", () => {
  it("keeps effect damage conversion fixture kinds explicit", () => {
    expect(countDamageConversionKinds(damageConversionFixtureFiles())).toEqual(damageConversionKindCounts);
  });

  it("requires effect damage conversion fixtures to assert clean Lua registry restore and final LP/event outcomes", () => {
    const files = damageConversionFixtureFiles();
    expect(files).toHaveLength(damageConversionFixtureCount);

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
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires UI-facing legal-action parity where restored conversion chains expose actions", () => {
    const files = damageConversionFixtureFiles();
    expect(files).toHaveLength(damageConversionFixtureCount);

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

type DamageConversionKind = "changeDamage" | "noEffectDamage" | "reflectDamage" | "reverseDamage" | "reverseRecover";

function countDamageConversionKinds(fixtures: Array<{ kind: DamageConversionKind }>): Record<DamageConversionKind, number> {
  return fixtures.reduce<Record<DamageConversionKind, number>>(
    (counts, { kind }) => ({ ...counts, [kind]: counts[kind] + 1 }),
    { changeDamage: 0, noEffectDamage: 0, reflectDamage: 0, reverseDamage: 0, reverseRecover: 0 },
  );
}

function damageConversionFixtureFiles(): Array<{ file: string; kind: DamageConversionKind; required: string[] }> {
  return ([
    {
      file: "lua-real-script-bad-reaction-reverse-recover.test.ts",
      kind: "reverseRecover",
      required: [
        "Bad Reaction reverse recover",
        "code: 81",
        "cardsDrawn",
        "players[1].lifePoints).toBe(7000)",
        "damageDealt",
      ],
    },
    {
      file: "lua-real-script-ddd-rebel-king-leonidas-reverse-damage.test.ts",
      kind: "reverseDamage",
      required: [
        "D/D/D Rebel King Leonidas reverse damage",
        "code: 80",
        "value-predicate:effect-reason",
        "players[0].lifePoints).toBe(8000)",
        "recoveredLifePoints",
      ],
    },
    {
      file: "lua-real-script-des-wombat-no-effect-damage.test.ts",
      kind: "noEffectDamage",
      required: [
        "Des Wombat no effect damage",
        "code: 335",
        "players[0].lifePoints).toBe(8000)",
        "players[1].lifePoints).toBe(7000)",
        "event.eventName === \"damageDealt\" && event.eventPlayer === 0)).toEqual([])",
      ],
    },
    {
      file: "lua-real-script-natures-reflection-reflect-damage.test.ts",
      kind: "reflectDamage",
      required: [
        "Nature's Reflection reflect damage",
        "code: 83",
        "reflect-damage:opponent-non-continuous",
        "players[0].lifePoints).toBe(6500)",
        "players[1].lifePoints).toBe(8000)",
        "eventValue: 500",
      ],
    },
    {
      file: "lua-real-script-prime-material-dragon-reverse-damage.test.ts",
      kind: "reverseDamage",
      required: [
        "Prime Material Dragon reverse damage",
        "code: 80",
        "players[0].lifePoints).toBe(8500)",
        "players[1].lifePoints).toBe(9000)",
        "recoveredLifePoints",
      ],
    },
    {
      file: "lua-real-script-totem-pole-change-damage.test.ts",
      kind: "changeDamage",
      required: [
        "Totem Pole change damage",
        "change-damage:effect-double",
        "players[0].lifePoints).toBe(7500)",
        "players[1].lifePoints).toBe(6000)",
        "eventValue: 2000",
      ],
    },
  ] satisfies Array<{ file: string; kind: DamageConversionKind; required: string[] }>)
    .map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }))
    .sort((a, b) => a.file.localeCompare(b.file));
}
