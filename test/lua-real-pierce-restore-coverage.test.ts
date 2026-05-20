import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const PIERCING_FIXTURE_COUNT = 5;
const piercingKindCounts = {
  equipPierce: 1,
  fieldPierce: 1,
  raceTargetedFieldPierce: 2,
  singleMonsterPierce: 1,
} satisfies Record<PiercingKind, number>;
const piercingSemanticVariantCounts = {
  ancientGearGolemFieldPierce: 1,
  enragedBattleOxRaceTargetedPierce: 1,
  fairyMeteorCrushEquipPierce: 1,
  lancerDragonuteSingleMonsterPierce: 1,
  lionAlligatorFaceupReptilePierce: 1,
} satisfies Record<PiercingSemanticVariant, number>;

type PiercingKind = "equipPierce" | "fieldPierce" | "raceTargetedFieldPierce" | "singleMonsterPierce";

type PiercingSemanticVariant =
  | "ancientGearGolemFieldPierce"
  | "enragedBattleOxRaceTargetedPierce"
  | "fairyMeteorCrushEquipPierce"
  | "lancerDragonuteSingleMonsterPierce"
  | "lionAlligatorFaceupReptilePierce";

describe("Lua real piercing damage restore coverage", () => {
  it("requires piercing damage fixtures to assert clean Lua registry restore and restored damage semantics", () => {
    const files = piercingFixtureFiles();
    expect(files).toHaveLength(PIERCING_FIXTURE_COUNT);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("battleDamage")
          || !text.includes("lifePoints")
          || !text.includes('eventName: "battleDamageDealt"')
          || !text.includes("eventHistory")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps piercing fixture kinds explicit", () => {
    expect(countPiercingKinds(piercingFixtureFiles())).toEqual(piercingKindCounts);
  });

  it("keeps named piercing semantic variants explicit", () => {
    expect(countPiercingSemanticVariants(piercingSemanticVariants())).toEqual(piercingSemanticVariantCounts);

    const weak = piercingSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function piercingFixtureFiles(): Array<{
  file: string;
  kind: PiercingKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-ancient-gear-golem-pierce-battle-damage.test.ts",
      kind: "fieldPierce",
      required: [
        "code: 203",
        '"range": [',
        '"monsterZone"',
        "battleDamage).toEqual({ 0: 0, 1: 1500 })",
        "players[1].lifePoints).toBe(6500)",
        'eventName: "battleDamageDealt"',
        "eventReason: duelReason.battle",
      ],
    },
    {
      file: "test/lua-real-script-enraged-battle-ox-pierce.test.ts",
      kind: "raceTargetedFieldPierce",
      required: [
        "code: 203",
        "targetRange: [4, 0]",
        "battleDamage[1]).toBe(700)",
        "players[1].lifePoints).toBe(7300)",
        "battleDamage[1]).toBe(0)",
      ],
    },
    {
      file: "test/lua-real-script-fairy-meteor-crush-equip-pierce.test.ts",
      kind: "equipPierce",
      required: [
        "operationInfos: [{ category: 0x40000",
        "equippedToUid: equippedAttacker!.uid",
        "battleDamage).toEqual({ 0: 0, 1: 800 })",
        "players[1].lifePoints).toBe(7200)",
        'eventName === "battleDamageDealt" && event.eventPlayer === 1)).toEqual([])',
      ],
    },
    {
      file: "test/lua-real-script-lancer-dragonute-pierce.test.ts",
      kind: "singleMonsterPierce",
      required: [
        "code: 203",
        'registryKey: "lua:11125718:lua-1-203"',
        "battleDamage).toEqual({ 0: 0, 1: 500 })",
        "players[1].lifePoints).toBe(7500)",
        'eventName: "battleDamageDealt"',
        "eventReason: duelReason.battle",
      ],
    },
    {
      file: "test/lua-real-script-lion-alligator-faceup-reptile-pierce.test.ts",
      kind: "raceTargetedFieldPierce",
      required: [
        "restores condition-gated Reptile piercing for matching Reptile attackers",
        "Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsRace,RACE_REPTILE)",
        "return c:IsRace(RACE_REPTILE)",
        "battleDamage[1]).toBe(600)",
        "players[1].lifePoints).toBe(7400)",
        "battleDamage[1]).toBe(0)",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: PiercingKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countPiercingKinds(fixtures: Array<{ kind: PiercingKind }>): Record<PiercingKind, number> {
  return fixtures.reduce<Record<PiercingKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      equipPierce: 0,
      fieldPierce: 0,
      raceTargetedFieldPierce: 0,
      singleMonsterPierce: 0,
    },
  );
}

function piercingSemanticVariants(): Array<{
  file: string;
  kind: PiercingSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-ancient-gear-golem-pierce-battle-damage.test.ts",
      kind: "ancientGearGolemFieldPierce",
      required: [
        'const golemCode = "83104731"',
        "restores Ancient Gear Golem and applies piercing battle damage",
        'registryKey: "lua:83104731:lua-2-203"',
        "battleDamage).toEqual({ 0: 0, 1: 1500 })",
        "players[1].lifePoints).toBe(6500)",
        "eventReason: duelReason.battle",
      ],
    },
    {
      file: "test/lua-real-script-enraged-battle-ox-pierce.test.ts",
      kind: "enragedBattleOxRaceTargetedPierce",
      required: [
        'const oxCode = "76909279"',
        "restores Enraged Battle Ox's field piercing effect and applies it only to matching attackers",
        'registryKey: "lua:76909279:lua-1-203"',
        "targetRange: [4, 0]",
        "battleDamage[1]).toBe(700)",
        "battleDamage[1]).toBe(0)",
      ],
    },
    {
      file: "test/lua-real-script-fairy-meteor-crush-equip-pierce.test.ts",
      kind: "fairyMeteorCrushEquipPierce",
      required: [
        'const equipCode = "97687912"',
        "restores equip-sourced piercing damage only for the equipped monster",
        "operationInfos: [{ category: 0x40000",
        "equippedToUid: equippedAttacker!.uid",
        "eventName === \"battleDamageDealt\" && event.eventPlayer === 1)).toEqual([])",
        "battleDamage).toEqual({ 0: 0, 1: 800 })",
      ],
    },
    {
      file: "test/lua-real-script-lancer-dragonute-pierce.test.ts",
      kind: "lancerDragonuteSingleMonsterPierce",
      required: [
        'const lancerCode = "11125718"',
        "restores pure single-monster piercing battle damage",
        'registryKey: "lua:11125718:lua-1-203"',
        "battleDamage).toEqual({ 0: 0, 1: 500 })",
        "players[1].lifePoints).toBe(7500)",
        "eventReason: duelReason.battle",
      ],
    },
    {
      file: "test/lua-real-script-lion-alligator-faceup-reptile-pierce.test.ts",
      kind: "lionAlligatorFaceupReptilePierce",
      required: [
        'const lionAlligatorCode = "4611269"',
        "restores condition-gated Reptile piercing for matching Reptile attackers",
        "aux.FaceupFilter(Card.IsRace,RACE_REPTILE)",
        "battleDamage[1]).toBe(600)",
        "battleDamage[1]).toBe(0)",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: PiercingSemanticVariant;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countPiercingSemanticVariants(fixtures: Array<{ kind: PiercingSemanticVariant }>): Record<PiercingSemanticVariant, number> {
  return fixtures.reduce<Record<PiercingSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      ancientGearGolemFieldPierce: 0,
      enragedBattleOxRaceTargetedPierce: 0,
      fairyMeteorCrushEquipPierce: 0,
      lancerDragonuteSingleMonsterPierce: 0,
      lionAlligatorFaceupReptilePierce: 0,
    },
  );
}
