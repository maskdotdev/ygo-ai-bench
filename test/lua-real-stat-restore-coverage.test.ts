import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const statFixtureCount = 12;
const statKindCounts = {
  battleAttackerTargetSwing: 1,
  battleTargetAttackBoost: 2,
  fieldGroupCountStat: 1,
  fieldAttributeAttackUpdate: 2,
  fieldRaceAttackDefenseUpdate: 1,
  setAttack: 1,
  setBaseAttack: 1,
  staticAttackAndExtraAttack: 1,
  targetedDamageStepAttackUpdate: 1,
  targetedPreDamageFinalAttack: 1,
} satisfies Record<StatKind, number>;
const statSemanticVariantCounts = {
  bladeflyFieldAttributeAttackUpdate: 1,
  dForcePlasmaGraveyardCountAtkExtraAttack: 1,
  fortuneLadyPastCallbackSetAtkDef: 1,
  jurassicWorldTargetBoolFunctionRaceStat: 1,
  mirageKnightBattleTargetAtkEndPhaseBanish: 1,
  mukaMukaHandCountAttackDefense: 1,
  mysticPlasmaZoneTargetBoolFunctionAttributeStat: 1,
  rushRecklesslyTargetedDamageStepAttackUpdate: 1,
  sangaPreDamageFinalAttackZero: 1,
  shrinkTargetBaseAtkHalving: 1,
  skyscraperFieldDamageCalculationAttackBoost: 1,
  steamroidDamageStepBattleSwingStat: 1,
} satisfies Record<StatSemanticVariant, number>;

type StatKind = "battleAttackerTargetSwing" | "battleTargetAttackBoost" | "fieldAttributeAttackUpdate" | "fieldGroupCountStat" | "fieldRaceAttackDefenseUpdate" | "setAttack" | "setBaseAttack" | "staticAttackAndExtraAttack" | "targetedDamageStepAttackUpdate" | "targetedPreDamageFinalAttack";
type StatSemanticVariant =
  | "bladeflyFieldAttributeAttackUpdate"
  | "dForcePlasmaGraveyardCountAtkExtraAttack"
  | "fortuneLadyPastCallbackSetAtkDef"
  | "jurassicWorldTargetBoolFunctionRaceStat"
  | "mirageKnightBattleTargetAtkEndPhaseBanish"
  | "mukaMukaHandCountAttackDefense"
  | "mysticPlasmaZoneTargetBoolFunctionAttributeStat"
  | "rushRecklesslyTargetedDamageStepAttackUpdate"
  | "sangaPreDamageFinalAttackZero"
  | "shrinkTargetBaseAtkHalving"
  | "skyscraperFieldDamageCalculationAttackBoost"
  | "steamroidDamageStepBattleSwingStat";

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
      file: "test/lua-real-script-jurassic-world-race-field-stat.test.ts",
      kind: "fieldRaceAttackDefenseUpdate",
      required: [
        "aux.TargetBoolFunction Card.IsRace ATK and DEF field updates",
        "luaTargetDescriptor",
        "target:race:65536",
        "currentAttack(restoredDinosaurAttacker, restored.session.state)).toBe(1300)",
        "currentDefense(restoredDinosaurDefender, restored.session.state)).toBe(1900)",
        "battleDamage[1]).toBe(100)",
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
      file: "test/lua-real-script-muka-muka-hand-count-stat.test.ts",
      kind: "fieldGroupCountStat",
      required: [
        "Duel.GetFieldGroupCount(c:GetControler(),LOCATION_HAND,0)*300",
        "stat:controller-field-group-count:2:0:x300",
        "currentAttack(restoredMuka, restored.session.state)).toBe((muka!.data.attack ?? 0) + 900)",
        "currentDefense(restoredMuka, restored.session.state)).toBe((muka!.data.defense ?? 0) + 600)",
        "battleDamage[1]",
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
    {
      file: "test/lua-real-script-rush-recklessly-stat-change-damage-step.test.ts",
      kind: "targetedDamageStepAttackUpdate",
      required: [
        "e1:SetCondition(aux.StatChangeDamageStepCondition)",
        "Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)",
        "local tc=Duel.GetFirstTarget()",
        "e1:SetCode(EFFECT_UPDATE_ATTACK)",
        "e1:SetValue(700)",
        "currentAttack(restoredAttacker, restoredBoost.session.state)).toBe(2200)",
        "battleDamage).toEqual({ 0: 0, 1: 200 })",
      ],
    },
    {
      file: "test/lua-real-script-sanga-pre-damage-final-attack.test.ts",
      kind: "targetedPreDamageFinalAttack",
      required: [
        "e1:SetType(EFFECT_TYPE_QUICK_O)",
        "e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)",
        "Duel.SetTargetCard(Duel.GetAttacker())",
        "local tc=Duel.GetFirstTarget()",
        "e1:SetCode(EFFECT_SET_ATTACK_FINAL)",
        "e1:SetValue(0)",
        "currentAttack(restoredFinalAttack.session.state.cards.find((card) => card.uid === attacker.uid), restoredFinalAttack.session.state)).toBe(0)",
        "battleDamage).toEqual({ 0: sanga.data.attack, 1: 0 })",
      ],
    },
    {
      file: "test/lua-real-script-skyscraper-damage-calculation-stat.test.ts",
      kind: "battleTargetAttackBoost",
      required: [
        "e2:SetCode(EFFECT_UPDATE_ATTACK)",
        "Duel.IsPhase(PHASE_DAMAGE_CAL) and Duel.GetAttackTarget()",
        "c==Duel.GetAttacker() and c:IsSetCard(SET_ELEMENTAL_HERO)",
        'battleWindow?.kind).toBe("duringDamageCalculation")',
        "currentAttack(restoredHero, restoredDamageCalculation.session.state)).toBe(2600)",
        "battleDamage).toEqual({ 0: 0, 1: 700 })",
      ],
    },
    {
      file: "test/lua-real-script-steamroid-battle-swing-stat.test.ts",
      kind: "battleAttackerTargetSwing",
      required: [
        "return ph==PHASE_DAMAGE or ph==PHASE_DAMAGE_CAL",
        "stat:battle-attacker-target-swing:500:-500",
        "condition:damage-or-damage-calculation",
        "currentAttack(restoredAttackingSteamroid, restoredAttacking.session.state)).toBe((attacking.steamroid.data.attack ?? 0) + 500)",
        "currentAttack(restoredDefendingSteamroid, restoredDefending.session.state)).toBe((defending.steamroid.data.attack ?? 0) - 500)",
        "battleDamage).toEqual({ 0: 500, 1: 0 })",
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
      battleAttackerTargetSwing: 0,
      battleTargetAttackBoost: 0,
      fieldAttributeAttackUpdate: 0,
      fieldGroupCountStat: 0,
      fieldRaceAttackDefenseUpdate: 0,
      setAttack: 0,
      setBaseAttack: 0,
      staticAttackAndExtraAttack: 0,
      targetedDamageStepAttackUpdate: 0,
      targetedPreDamageFinalAttack: 0,
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
      file: "test/lua-real-script-jurassic-world-race-field-stat.test.ts",
      kind: "jurassicWorldTargetBoolFunctionRaceStat",
      required: [
        'const jurassicWorldCode = "10080320"',
        "restores aux.TargetBoolFunction Card.IsRace ATK and DEF field updates into battle damage",
        "target:race:65536",
        "e2:SetTarget(aux.TargetBoolFunction(Card.IsRace,RACE_DINOSAUR))",
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
      file: "test/lua-real-script-muka-muka-hand-count-stat.test.ts",
      kind: "mukaMukaHandCountAttackDefense",
      required: [
        'const mukaCode = "46657337"',
        "restores GetFieldGroupCount hand-size ATK/DEF callbacks and recalculates battle damage",
        "stat:controller-field-group-count:2:0:x300",
        "currentAttack(restoredMuka, restored.session.state)).toBe((muka!.data.attack ?? 0) + 600)",
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
      file: "test/lua-real-script-rush-recklessly-stat-change-damage-step.test.ts",
      kind: "rushRecklesslyTargetedDamageStepAttackUpdate",
      required: [
        'const rushCode = "70046172"',
        "restores targeted Damage Step ATK update activation and battle damage",
        "e1:SetCondition(aux.StatChangeDamageStepCondition)",
        "currentAttack(restoredAttacker, restoredBoost.session.state)).toBe(2200)",
        "players[1].lifePoints).toBe(7800)",
      ],
    },
    {
      file: "test/lua-real-script-sanga-pre-damage-final-attack.test.ts",
      kind: "sangaPreDamageFinalAttackZero",
      required: [
        'const sangaCode = "25955164"',
        "restores optional pre-damage calculation final-ATK Quick Effect activation",
        "Duel.SetTargetCard(Duel.GetAttacker())",
        '"registryKey": "lua:25955164:lua-2-102"',
        "players[0].lifePoints).toBe(8000 - (sanga.data.attack ?? 0))",
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
    {
      file: "test/lua-real-script-skyscraper-damage-calculation-stat.test.ts",
      kind: "skyscraperFieldDamageCalculationAttackBoost",
      required: [
        'const skyscraperCode = "63035430"',
        "restores PHASE_DAMAGE_CAL attacker-vs-target field ATK boost into battle damage",
        "stat:damage-calculation-attacker-lower-than-target:+1000",
        "currentAttack(restoredHero, restoredDamageCalculation.session.state)).toBe(2600)",
      ],
    },
    {
      file: "test/lua-real-script-steamroid-battle-swing-stat.test.ts",
      kind: "steamroidDamageStepBattleSwingStat",
      required: [
        'const steamroidCode = "44729197"',
        "restores Damage Step attacker boost and defender loss callbacks into battle damage",
        "stat:battle-attacker-target-swing:500:-500",
        "players[0].lifePoints).toBe(7500)",
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
      jurassicWorldTargetBoolFunctionRaceStat: 0,
      mirageKnightBattleTargetAtkEndPhaseBanish: 0,
      mukaMukaHandCountAttackDefense: 0,
      mysticPlasmaZoneTargetBoolFunctionAttributeStat: 0,
      rushRecklesslyTargetedDamageStepAttackUpdate: 0,
      sangaPreDamageFinalAttackZero: 0,
      shrinkTargetBaseAtkHalving: 0,
      skyscraperFieldDamageCalculationAttackBoost: 0,
      steamroidDamageStepBattleSwingStat: 0,
    },
  );
}
