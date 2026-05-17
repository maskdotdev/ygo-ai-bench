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
const damageConversionSemanticVariantCounts: Record<DamageConversionSemanticVariant, number> = {
  badReactionReverseRecover: 1,
  dddLeonidasTemporaryReverseDamage: 1,
  desWombatNoEffectDamage: 1,
  naturesReflectionReflectDamage: 1,
  primeMaterialDragonReverseDamage: 1,
  totemPoleDoubleEffectDamage: 1,
};

describe("Lua real damage conversion restore coverage", () => {
  it("keeps effect damage conversion fixture kinds explicit", () => {
    expect(countDamageConversionKinds(damageConversionFixtureFiles())).toEqual(damageConversionKindCounts);
  });

  it("keeps named effect damage conversion semantic variants explicit", () => {
    expect(countDamageConversionSemanticVariants(damageConversionSemanticVariants())).toEqual(damageConversionSemanticVariantCounts);

    const weak = damageConversionSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
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

type DamageConversionSemanticVariant =
  | "badReactionReverseRecover"
  | "dddLeonidasTemporaryReverseDamage"
  | "desWombatNoEffectDamage"
  | "naturesReflectionReflectDamage"
  | "primeMaterialDragonReverseDamage"
  | "totemPoleDoubleEffectDamage";

function countDamageConversionKinds(fixtures: Array<{ kind: DamageConversionKind }>): Record<DamageConversionKind, number> {
  return fixtures.reduce<Record<DamageConversionKind, number>>(
    (counts, { kind }) => ({ ...counts, [kind]: counts[kind] + 1 }),
    { changeDamage: 0, noEffectDamage: 0, reflectDamage: 0, reverseDamage: 0, reverseRecover: 0 },
  );
}

function countDamageConversionSemanticVariants(
  fixtures: Array<{ kind: DamageConversionSemanticVariant }>,
): Record<DamageConversionSemanticVariant, number> {
  return fixtures.reduce<Record<DamageConversionSemanticVariant, number>>(
    (counts, { kind }) => ({ ...counts, [kind]: counts[kind] + 1 }),
    {
      badReactionReverseRecover: 0,
      dddLeonidasTemporaryReverseDamage: 0,
      desWombatNoEffectDamage: 0,
      naturesReflectionReflectDamage: 0,
      primeMaterialDragonReverseDamage: 0,
      totemPoleDoubleEffectDamage: 0,
    },
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

function damageConversionSemanticVariants(): Array<{
  file: string;
  kind: DamageConversionSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "lua-real-script-bad-reaction-reverse-recover.test.ts",
      kind: "badReactionReverseRecover",
      required: [
        'const badReactionCode = "40633297"',
        "restores Bad Reaction to Simochi and converts Upstart Goblin recovery into damage",
        "targetRange: [0, 1]",
        "eventName: \"cardsDrawn\"",
        "eventName: \"damageDealt\"",
        "players[1].lifePoints).toBe(7000)",
      ],
    },
    {
      file: "lua-real-script-ddd-rebel-king-leonidas-reverse-damage.test.ts",
      kind: "dddLeonidasTemporaryReverseDamage",
      required: [
        'const leonidasCode = "92536468"',
        "restores temporary effect-damage reversal from the Project Ignis script",
        "description: 1480583490",
        "targetRange: [1, 1]",
        "players[0].lifePoints).toBe(8000)",
        "players[1].lifePoints).toBe(8000)",
      ],
    },
    {
      file: "lua-real-script-des-wombat-no-effect-damage.test.ts",
      kind: "desWombatNoEffectDamage",
      required: [
        'const desWombatCode = "9637706"',
        "restores Des Wombat and prevents real effect damage after snapshot restore",
        "change-damage:effect-zero",
        "targetRange: [1, 0]",
        "event.eventName === \"damageDealt\" && event.eventPlayer === 0)).toEqual([])",
      ],
    },
    {
      file: "lua-real-script-natures-reflection-reflect-damage.test.ts",
      kind: "naturesReflectionReflectDamage",
      required: [
        'const naturesReflectionCode = "83467607"',
        "restores Nature's Reflection and reflects real effect damage after snapshot restore",
        "reflect-damage:opponent-non-continuous",
        "nature reflection starter resolved",
        "players[0].lifePoints).toBe(6500)",
        "players[1].lifePoints).toBe(8000)",
      ],
    },
    {
      file: "lua-real-script-prime-material-dragon-reverse-damage.test.ts",
      kind: "primeMaterialDragonReverseDamage",
      required: [
        'const primeMaterialCode = "12298909"',
        "restores Prime Material Dragon and converts real effect damage into recovery",
        "registryKey: \"lua:12298909:lua-2-80\"",
        "targetRange: [1, 1]",
        "players[0].lifePoints).toBe(8500)",
        "players[1].lifePoints).toBe(9000)",
      ],
    },
    {
      file: "lua-real-script-totem-pole-change-damage.test.ts",
      kind: "totemPoleDoubleEffectDamage",
      required: [
        'const totemPoleCode = "47873397"',
        "restores Totem Pole and doubles real effect damage after snapshot restore",
        "change-damage:effect-double",
        "location: \"banished\", controller: 0",
        "players[1].lifePoints).toBe(6000)",
        "eventValue: 2000",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: DamageConversionSemanticVariant;
    required: string[];
  }>)
    .map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }))
    .sort((a, b) => a.file.localeCompare(b.file));
}
