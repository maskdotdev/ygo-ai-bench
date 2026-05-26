import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const battleDamageConversionFixtureCount = 11;
const battleDamageConversionKindCounts: Record<BattleDamageConversionKind, number> = {
  alsoBattleDamage: 1,
  battleDamageToEffect: 1,
  bothBattleDamage: 1,
  changeBattleDamage: 7,
  reflectBattleDamage: 1,
};
const battleDamageConversionSemanticVariantCounts: Record<BattleDamageConversionSemanticVariant, number> = {
  amazonessSwordsWomanReflectBattleDamage: 1,
  abyssSplashDetachFinalAttackHalfDamage: 1,
  dinowrestlerMartialAmpeloPreDamageHalfDamageSearch: 1,
  gravekeepersVassalBattleDamageToEffect: 1,
  lifeHackLpAttackDamageHalf: 1,
  majespecterSonicsFinalStatHalfDamage: 1,
  numberC96AlsoBattleDamage: 1,
  skullgiosBattleConfirmSwapPierceDamage: 1,
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
  | "abyssSplashDetachFinalAttackHalfDamage"
  | "dinowrestlerMartialAmpeloPreDamageHalfDamageSearch"
  | "gravekeepersVassalBattleDamageToEffect"
  | "lifeHackLpAttackDamageHalf"
  | "majespecterSonicsFinalStatHalfDamage"
  | "numberC96AlsoBattleDamage"
  | "skullgiosBattleConfirmSwapPierceDamage"
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
      abyssSplashDetachFinalAttackHalfDamage: 0,
      dinowrestlerMartialAmpeloPreDamageHalfDamageSearch: 0,
      gravekeepersVassalBattleDamageToEffect: 0,
      lifeHackLpAttackDamageHalf: 0,
      majespecterSonicsFinalStatHalfDamage: 0,
      numberC96AlsoBattleDamage: 0,
      skullgiosBattleConfirmSwapPierceDamage: 0,
      smokeMosquitoPreDamageHalfBattleDamage: 0,
      speedroidHexasaucerBothBattleDamage: 0,
      susaSoldierHalfBattleDamage: 0,
    },
  );
}

function battleDamageConversionFixtureFiles(): Array<{ file: string; kind: BattleDamageConversionKind; required: string[] }> {
  return ([
    {
      file: "lua-real-script-abyss-splash-detach-final-attack-half-damage.test.ts",
      kind: "changeBattleDamage",
      required: [
        'const abyssCode = "36076683"',
        "Number 73: Abyss Splash",
        "restores Damage Step detach into doubled final ATK and half battle damage",
        "e1:SetCost(Cost.DetachFromSelf(1))",
        "e1:SetCode(EFFECT_SET_ATTACK_FINAL)",
        "e1:SetValue(c:GetAttack()*2)",
        "e2:SetCode(EFFECT_CHANGE_BATTLE_DAMAGE)",
        "HALF_DAMAGE",
        "reasonEffectId: 2",
        "currentAttack(restored.session.state.cards.find((card) => card.uid === abyss.uid), restored.session.state)).toBe(4800)",
        "battleDamage[1]).toBe(1650)",
        "players[1].lifePoints).toBe(6350)",
        "eventName: \"detachedMaterial\"",
      ],
    },
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
      file: "lua-real-script-dinowrestler-martial-ampelo-pre-damage-half-damage-search.test.ts",
      kind: "changeBattleDamage",
      required: [
        "Dinowrestler Martial Ampelo",
        "Cost.SelfToGrave",
        "EFFECT_INDESTRUCTABLE_BATTLE",
        "EFFECT_CHANGE_BATTLE_DAMAGE",
        "HALF_DAMAGE",
        "resetEventStandardPhaseDamage",
        "battleDamage).toEqual({ 0: 250, 1: 0 })",
        "players[0].lifePoints).toBe(7750)",
        "eventName: \"battleDamageDealt\"",
        "eventValue: 250",
        "eventName: \"sentToHandConfirmed\"",
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
      file: "lua-real-script-majespecter-sonics-final-stat-half-damage.test.ts",
      kind: "changeBattleDamage",
      required: [
        "Majespecter Sonics final stat half damage",
        "EFFECT_SET_ATTACK_FINAL",
        "EFFECT_SET_DEFENSE_FINAL",
        "EFFECT_CHANGE_BATTLE_DAMAGE",
        "HALF_DAMAGE",
        'registryKey: "lua:13611090:lua-4-208"',
        "battleDamage).toEqual({ 0: 0, 1: 250 })",
        "players[1]!.lifePoints).toBe(7750)",
        "eventName: \"battleDamageDealt\"",
        "eventValue: 250",
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
    {
      file: "lua-real-script-skullgios-battle-confirm-swap-pierce.test.ts",
      kind: "changeBattleDamage",
      required: [
        "Fossil Dragon Skullgios battle-confirm swap pierce",
        "EFFECT_CHANGE_BATTLE_DAMAGE",
        "DOUBLE_DAMAGE",
        "code: 208",
        "battleDamage).toEqual({ 0: 0, 1: 5000 })",
        "players[1].lifePoints).toBe(3000)",
        "eventName: \"battleDamageDealt\"",
        "eventValue: 5000",
      ],
    },
    {
      file: "lua-real-script-life-hack-lp-attack-damage-half.test.ts",
      kind: "changeBattleDamage",
      required: [
        'const lifeHackCode = "83589191"',
        "restores hand activation into opponent-LP final ATK and halved battle damage",
        "restores grave SelfBanish ignition into own-LP final ATK",
        "e1:SetCode(EFFECT_SET_ATTACK_FINAL)",
        "e2:SetCode(EFFECT_CHANGE_DAMAGE)",
        "e2:SetValue(function(e,re,val,r,rp,rc) return val//2 end)",
        "currentAttack(findCard(restoredOpen.session, attacker.uid), restoredOpen.session.state)).toBe(6000)",
        "battleDamage).toEqual({ 0: 0, 1: 3000 })",
        "players[1].lifePoints).toBe(3000)",
        "eventName: \"battleDamageDealt\"",
        "eventValue: 3000",
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
      file: "lua-real-script-abyss-splash-detach-final-attack-half-damage.test.ts",
      kind: "abyssSplashDetachFinalAttackHalfDamage",
      required: [
        'const abyssCode = "36076683"',
        "Xyz.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsAttribute,ATTRIBUTE_WATER),5,2)",
        "e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)",
        "e1:SetCondition(aux.StatChangeDamageStepCondition)",
        "e1:SetCost(Cost.DetachFromSelf(1))",
        "e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END|RESET_OPPO_TURN)",
        "e2:SetValue(aux.ChangeBattleDamage(1,HALF_DAMAGE))",
        "eventName: \"detachedMaterial\"",
        "battleDamage[1]).toBe(1650)",
      ],
    },
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
      file: "lua-real-script-skullgios-battle-confirm-swap-pierce.test.ts",
      kind: "skullgiosBattleConfirmSwapPierceDamage",
      required: [
        'const skullgiosCode = "21225115"',
        "restores battle-confirm final ATK/DEF swap into piercing doubled battle damage",
        "EFFECT_SWAP_ATTACK_FINAL",
        "EFFECT_SWAP_DEFENSE_FINAL",
        "EFFECT_CHANGE_BATTLE_DAMAGE",
        "eventValue: 5000",
      ],
    },
    {
      file: "lua-real-script-dinowrestler-martial-ampelo-pre-damage-half-damage-search.test.ts",
      kind: "dinowrestlerMartialAmpeloPreDamageHalfDamageSearch",
      required: [
        'const ampeloCode = "54446813"',
        "restores SelfToGrave battle protection, HALF_DAMAGE, and grave self-banish Dinowrestler search",
        "e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)",
        "e1:SetCost(Cost.SelfToGrave)",
        "EFFECT_INDESTRUCTABLE_BATTLE",
        "EFFECT_CHANGE_BATTLE_DAMAGE",
        "Cost.SelfBanish",
        "Duel.SelectMatchingCard(tp,s.thfilter,tp,LOCATION_DECK,0,1,1,nil)",
        "battleDamage).toEqual({ 0: 250, 1: 0 })",
        "eventValue: 250",
        "eventName: \"sentToHandConfirmed\"",
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
      file: "lua-real-script-majespecter-sonics-final-stat-half-damage.test.ts",
      kind: "majespecterSonicsFinalStatHalfDamage",
      required: [
        'const sonicsCode = "13611090"',
        "restores final ATK/DEF doubling plus target-scoped HALF_DAMAGE battle modifier",
        "e3:SetValue(aux.ChangeBattleDamage(1,HALF_DAMAGE))",
        'registryKey: "lua:13611090:lua-4-208"',
        "currentAttack(boostedAttacker, restoredBoost.session.state)).toBe(2000)",
        "battleDamage).toEqual({ 0: 0, 1: 250 })",
        "eventValue: 250",
      ],
    },
    {
      file: "lua-real-script-life-hack-lp-attack-damage-half.test.ts",
      kind: "lifeHackLpAttackDamageHalf",
      required: [
        'const lifeHackCode = "83589191"',
        "restores hand activation into opponent-LP final ATK and halved battle damage",
        "EFFECT_SET_ATTACK_FINAL",
        "EFFECT_CHANGE_DAMAGE",
        "currentAttack(findCard(restoredOpen.session, attacker.uid), restoredOpen.session.state)).toBe(6000)",
        "battleDamage).toEqual({ 0: 0, 1: 3000 })",
        "eventValue: 3000",
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
