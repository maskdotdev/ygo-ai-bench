import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const battleDamageConversionFixtureCount = 6;
const battleDamageConversionKindCounts: Record<BattleDamageConversionKind, number> = {
  alsoBattleDamage: 1,
  battleDamageToEffect: 1,
  bothBattleDamage: 1,
  changeBattleDamage: 2,
  reflectBattleDamage: 1,
};
const battleDamageConversionSemanticVariantCounts: Record<BattleDamageConversionSemanticVariant, number> = {
  amazonessSwordsWomanReflectBattleDamage: 1,
  gravekeepersVassalBattleDamageToEffect: 1,
  numberC96AlsoBattleDamage: 1,
  smokeMosquitoPreDamageHalfBattleDamage: 1,
  speedroidHexasaucerBothBattleDamage: 1,
  susaSoldierHalfBattleDamage: 1,
};

describe("Lua real battle damage conversion restore coverage", () => {
  it("keeps battle damage conversion fixture kinds explicit", () => {
    expect(countBattleDamageConversionKinds(battleDamageConversionFixtureFiles())).toEqual(battleDamageConversionKindCounts);
  });

  it("keeps named battle damage conversion semantic variants explicit", () => {
    expect(countBattleDamageConversionSemanticVariants(battleDamageConversionSemanticVariants())).toEqual(battleDamageConversionSemanticVariantCounts);

    const weak = battleDamageConversionSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });

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

type BattleDamageConversionKind = "alsoBattleDamage" | "battleDamageToEffect" | "bothBattleDamage" | "changeBattleDamage" | "reflectBattleDamage";

type BattleDamageConversionSemanticVariant =
  | "amazonessSwordsWomanReflectBattleDamage"
  | "gravekeepersVassalBattleDamageToEffect"
  | "numberC96AlsoBattleDamage"
  | "smokeMosquitoPreDamageHalfBattleDamage"
  | "speedroidHexasaucerBothBattleDamage"
  | "susaSoldierHalfBattleDamage";

function countBattleDamageConversionKinds(fixtures: Array<{ kind: BattleDamageConversionKind }>): Record<BattleDamageConversionKind, number> {
  return fixtures.reduce<Record<BattleDamageConversionKind, number>>(
    (counts, { kind }) => ({ ...counts, [kind]: counts[kind] + 1 }),
    { alsoBattleDamage: 0, battleDamageToEffect: 0, bothBattleDamage: 0, changeBattleDamage: 0, reflectBattleDamage: 0 },
  );
}

function countBattleDamageConversionSemanticVariants(
  fixtures: Array<{ kind: BattleDamageConversionSemanticVariant }>,
): Record<BattleDamageConversionSemanticVariant, number> {
  return fixtures.reduce<Record<BattleDamageConversionSemanticVariant, number>>(
    (counts, { kind }) => ({ ...counts, [kind]: counts[kind] + 1 }),
    {
      amazonessSwordsWomanReflectBattleDamage: 0,
      gravekeepersVassalBattleDamageToEffect: 0,
      numberC96AlsoBattleDamage: 0,
      smokeMosquitoPreDamageHalfBattleDamage: 0,
      speedroidHexasaucerBothBattleDamage: 0,
      susaSoldierHalfBattleDamage: 0,
    },
  );
}

function battleDamageConversionFixtureFiles(): Array<{ file: string; kind: BattleDamageConversionKind; required: string[] }> {
  return ([
    {
      file: "lua-real-script-amazoness-swords-woman-reflect-battle-damage.test.ts",
      kind: "reflectBattleDamage",
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
      file: "lua-real-script-gravekeepers-vassal-battle-damage-to-effect.test.ts",
      kind: "battleDamageToEffect",
      required: [
        "Gravekeeper's Vassal battle damage to effect",
        "code: 205",
        "battleDamage).toEqual({ 0: 0, 1: 700 })",
        "players[0].lifePoints).toBe(8000)",
        "players[1].lifePoints).toBe(7300)",
        "effectDamage",
        "eventName: \"battleDamageDealt\"",
        "eventReason: 64",
        "eventReasonEffectId: 1",
        "eventValue: 700",
      ],
    },
    {
      file: "lua-real-script-number-c96-also-battle-damage.test.ts",
      kind: "alsoBattleDamage",
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
      kind: "bothBattleDamage",
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
      kind: "changeBattleDamage",
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
    {
      file: "lua-real-script-smoke-mosquito-pre-damage-half-battle-damage.test.ts",
      kind: "changeBattleDamage",
      required: [
        "Smoke Mosquito pre-damage battle damage halving",
        "EFFECT_CHANGE_BATTLE_DAMAGE",
        "HALF_DAMAGE",
        "code: 208",
        "battleDamage).toEqual({ 0: 750, 1: 0 })",
        "players[0].lifePoints).toBe(7250)",
        "eventName: \"battleDamageDealt\"",
        "eventValue: 750",
      ],
    },
  ] satisfies Array<{ file: string; kind: BattleDamageConversionKind; required: string[] }>)
    .map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function battleDamageConversionSemanticVariants(): Array<{
  file: string;
  kind: BattleDamageConversionSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "lua-real-script-amazoness-swords-woman-reflect-battle-damage.test.ts",
      kind: "amazonessSwordsWomanReflectBattleDamage",
      required: [
        'const swordsWomanCode = "94004268"',
        "restores Amazoness Swords Woman and reflects battle damage to the attacker",
        'registryKey: "lua:94004268:lua-1-202"',
        "battleDamage).toEqual({ 0: 500, 1: 0 })",
        "eventPlayer: 0",
        "location: \"graveyard\"",
      ],
    },
    {
      file: "lua-real-script-gravekeepers-vassal-battle-damage-to-effect.test.ts",
      kind: "gravekeepersVassalBattleDamageToEffect",
      required: [
        'const vassalCode = "99690140"',
        "restores Gravekeeper's Vassal and treats its battle damage as effect damage",
        'registryKey: "lua:99690140:lua-1-205"',
        'action: "effectDamage", player: 1, detail: "700"',
        "eventReason: duelReason.effect",
        "eventReasonEffectId: 1",
        "battleDamage).toEqual({ 0: 0, 1: 700 })",
      ],
    },
    {
      file: "lua-real-script-number-c96-also-battle-damage.test.ts",
      kind: "numberC96AlsoBattleDamage",
      required: [
        'const darkStormCode = "77205367"',
        "restores Number C96 and applies also battle damage to the opponent",
        'registryKey: "lua:77205367:lua-3-207"',
        "battleDamage).toEqual({ 0: 800, 1: 800 })",
        "eventCardUid: target!.uid",
        "eventCardUid: darkStorm!.uid",
      ],
    },
    {
      file: "lua-real-script-speedroid-hexasaucer-both-battle-damage.test.ts",
      kind: "speedroidHexasaucerBothBattleDamage",
      required: [
        'const hexasaucerCode = "23792058"',
        "restores Hexasaucer and halves shared battle damage once for both players",
        'registryKey: "lua:23792058:lua-4-206"',
        'registryKey: "lua:23792058:lua-5-208"',
        "value: 2147483649",
        "battleDamage).toEqual({ 0: 950, 1: 950 })",
      ],
    },
    {
      file: "lua-real-script-smoke-mosquito-pre-damage-half-battle-damage.test.ts",
      kind: "smokeMosquitoPreDamageHalfBattleDamage",
      required: [
        'const smokeMosquitoCode = "28427869"',
        "restores pre-damage self Special Summon, temporary HALF_DAMAGE battle modifier, and battle skip",
        "EFFECT_CHANGE_BATTLE_DAMAGE",
        "HALF_DAMAGE",
        "battleDamage).toEqual({ 0: 750, 1: 0 })",
      ],
    },
    {
      file: "lua-real-script-susa-soldier-half-damage.test.ts",
      kind: "susaSoldierHalfBattleDamage",
      required: [
        'const susaCode = "40473581"',
        "restores aux.ChangeBattleDamage HALF_DAMAGE and halves battle damage it inflicts",
        'registryKey: "lua:40473581:lua-7-208"',
        "battleDamage[1]).toBe(500)",
        "eventValue: 500",
        "location: \"monsterZone\", controller: 0",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: BattleDamageConversionSemanticVariant;
    required: string[];
  }>)
    .map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }))
    .sort((a, b) => a.file.localeCompare(b.file));
}
