import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const statFixtureCount = 6;
const statKindCounts = {
  battleTargetAttackBoost: 1,
  fieldAttributeAttackUpdate: 2,
  setAttack: 1,
  setBaseAttack: 1,
  staticAttackAndExtraAttack: 1,
} satisfies Record<StatKind, number>;
const statSemanticVariantCounts = {
  bladeflyFieldAttributeAttackUpdate: 1,
  dForcePlasmaGraveyardCountAtkExtraAttack: 1,
  fortuneLadyPastCallbackSetAtkDef: 1,
  mirageKnightBattleTargetAtkEndPhaseBanish: 1,
  mysticPlasmaZoneTargetBoolFunctionAttributeStat: 1,
  shrinkTargetBaseAtkHalving: 1,
} satisfies Record<StatSemanticVariant, number>;

type StatKind = "battleTargetAttackBoost" | "fieldAttributeAttackUpdate" | "setAttack" | "setBaseAttack" | "staticAttackAndExtraAttack";
type StatSemanticVariant =
  | "bladeflyFieldAttributeAttackUpdate"
  | "dForcePlasmaGraveyardCountAtkExtraAttack"
  | "fortuneLadyPastCallbackSetAtkDef"
  | "mirageKnightBattleTargetAtkEndPhaseBanish"
  | "mysticPlasmaZoneTargetBoolFunctionAttributeStat"
  | "shrinkTargetBaseAtkHalving";

describe("Lua real stat restore coverage", () => {
  it("requires stat-changing fixtures to assert clean Lua registry restore and restored battle outcomes", () => {
    const files = statFixtureFiles();
    expect(files).toHaveLength(statFixtureCount);

    const missing = files
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
          || !text.includes("battleDamage")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps stat fixture kinds explicit", () => {
    expect(countStatKinds(statFixtureFiles())).toEqual(statKindCounts);
  });

  it("keeps named stat semantic variants explicit", () => {
    expect(countStatSemanticVariants(statSemanticVariants())).toEqual(statSemanticVariantCounts);

    const weak = statSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function statFixtureFiles(): Array<{
  file: string;
  kind: StatKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-bladefly-field-attribute-stat.test.ts",
      kind: "fieldAttributeAttackUpdate",
      required: [
        "luaTargetDescriptor",
        "target:attribute:8",
        "target:attribute:1",
        "currentAttack(restoredBladefly, restored.session.state)).toBe((bladefly!.data.attack ?? 0) + 500)",
        "currentAttack(restoredEarthTarget, restored.session.state)).toBe(1200)",
        "battleDamage[1]).toBe(300)",
      ],
    },
    {
      file: "test/lua-real-script-mystic-plasma-zone-attribute-stat.test.ts",
      kind: "fieldAttributeAttackUpdate",
      required: [
        "aux.TargetBoolFunction Card.IsAttribute ATK and DEF field updates",
        "luaTargetDescriptor",
        "target:attribute:32",
        "currentAttack(restoredDarkAttacker, restored.session.state)).toBe(1500)",
        "currentDefense(restoredDarkDefender, restored.session.state)).toBe(1200)",
        "battleDamage[1]).toBe(300)",
      ],
    },
    {
      file: "test/lua-real-script-d-force-plasma-stat-extra-attack.test.ts",
      kind: "staticAttackAndExtraAttack",
      required: [
        "code ?? -1",
        "d force plasma attack 2200",
        "expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 1200 })",
        "players[1].lifePoints).toBe(6800)",
        "hasAttack(secondActions, plasma!.uid, secondTarget!.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-fortune-lady-past-set-attack.test.ts",
      kind: "setAttack",
      required: [
        "code: 101",
        "code: 105",
        'type === "declareAttack"',
        "lifePoints).toBe(7700)",
      ],
    },
    {
      file: "test/lua-real-script-mirage-knight-battle-target-atk.test.ts",
      kind: "battleTargetAttackBoost",
      required: [
        'battleWindow?.kind).toBe("duringDamageCalculation")',
        "currentAttack(restoredDamageCalc.session.state.cards.find((card) => card.uid === mirage!.uid)!, restoredDamageCalc.session.state)).toBe(4700)",
        "expect(restoredDamageCalc.session.state.battleDamage).toEqual({ 0: 0, 1: 2800 })",
        'eventName: "battleDamageDealt"',
        'location: "banished"',
      ],
    },
    {
      file: "test/lua-real-script-shrink-set-base-attack.test.ts",
      kind: "setBaseAttack",
      required: [
        "restoredChain.missingRegistryKeys).toEqual([])",
        "restoredChain.missingChainLimitRegistryKeys).toEqual([])",
        "restoredBattle.missingRegistryKeys).toEqual([])",
        "restoredBattle.missingChainLimitRegistryKeys).toEqual([])",
        "code: 103",
        "value: 1000",
        'type === "passChain"',
        'type === "declareAttack"',
        "host.messages).not.toContain",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: StatKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countStatKinds(fixtures: Array<{ kind: StatKind }>): Record<StatKind, number> {
  return fixtures.reduce<Record<StatKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      battleTargetAttackBoost: 0,
      fieldAttributeAttackUpdate: 0,
      setAttack: 0,
      setBaseAttack: 0,
      staticAttackAndExtraAttack: 0,
    },
  );
}

function statSemanticVariants(): Array<{
  file: string;
  kind: StatSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-bladefly-field-attribute-stat.test.ts",
      kind: "bladeflyFieldAttributeAttackUpdate",
      required: [
        'const bladeflyCode = "28470714"',
        "restores cloned field ATK updates for WIND boost and EARTH loss into battle damage",
        "target:attribute:8",
        "target:attribute:1",
      ],
    },
    {
      file: "test/lua-real-script-d-force-plasma-stat-extra-attack.test.ts",
      kind: "dForcePlasmaGraveyardCountAtkExtraAttack",
      required: [
        'const dForceCode = "6186304"',
        "restores official graveyard-count ATK update and extra attack grant for Plasma",
        "d force plasma attack 2200",
      ],
    },
    {
      file: "test/lua-real-script-fortune-lady-past-set-attack.test.ts",
      kind: "fortuneLadyPastCallbackSetAtkDef",
      required: [
        'const pastCode = "57869175"',
        "restores callback-valued set ATK/DEF effects and uses them for battle calculation",
        "lifePoints).toBe(7700)",
      ],
    },
    {
      file: "test/lua-real-script-mirage-knight-battle-target-atk.test.ts",
      kind: "mirageKnightBattleTargetAtkEndPhaseBanish",
      required: [
        'const mirageCode = "49217579"',
        "restores GetBattleTarget damage-calculation ATK and End Phase self-banish after battle",
        'eventName: "battleDamageDealt"',
      ],
    },
    {
      file: "test/lua-real-script-mystic-plasma-zone-attribute-stat.test.ts",
      kind: "mysticPlasmaZoneTargetBoolFunctionAttributeStat",
      required: [
        'const zoneCode = "18161786"',
        "restores aux.TargetBoolFunction Card.IsAttribute ATK and DEF field updates into battle damage",
        "target:attribute:32",
        "currentDefense(restoredDarkAttacker, restored.session.state)).toBe(600)",
      ],
    },
    {
      file: "test/lua-real-script-shrink-set-base-attack.test.ts",
      kind: "shrinkTargetBaseAtkHalving",
      required: [
        'const shrinkCode = "55713623"',
        "restores Shrink's target and applies base ATK halving to battle calculation",
        "value: 1000",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: StatSemanticVariant;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countStatSemanticVariants(fixtures: Array<{ kind: StatSemanticVariant }>): Record<StatSemanticVariant, number> {
  return fixtures.reduce<Record<StatSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      bladeflyFieldAttributeAttackUpdate: 0,
      dForcePlasmaGraveyardCountAtkExtraAttack: 0,
      fortuneLadyPastCallbackSetAtkDef: 0,
      mirageKnightBattleTargetAtkEndPhaseBanish: 0,
      mysticPlasmaZoneTargetBoolFunctionAttributeStat: 0,
      shrinkTargetBaseAtkHalving: 0,
    },
  );
}
