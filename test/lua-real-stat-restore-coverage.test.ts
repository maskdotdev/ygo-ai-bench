import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const statFixtureCount = 28;
const statKindCounts = {
  battleAttackerTargetSwing: 1,
  battleTargetAttackBoost: 2,
  damageStepBattleTargetAttributeAttackBoost: 2,
  diceGroupAttackDefenseUpdate: 1,
  diceScaleUpdate: 1,
  fieldLevelOrRankAttackDefenseUpdate: 1,
  fieldGroupCountStat: 2,
  fieldMatchingFaceupRaceCountStat: 2,
  fieldAttributeAttackUpdate: 3,
  fieldRaceAttackDefenseUpdate: 2,
  fieldSetcodeAttackUpdate: 1,
  setAttack: 1,
  setBaseAttack: 1,
  setBaseAttackDefenseEndDestroy: 1,
  selfFinalAttackEndDestroy: 1,
  singleRangeSetcodeConditionAttackUpdate: 1,
  staticAttackAndExtraAttack: 1,
  targetedDamageStepAttackUpdate: 1,
  targetedDamageStepDefenseUpdate: 1,
  targetedQuickAttackDefenseUpdateChainLimit: 1,
  targetedPreDamageFinalAttack: 1,
} satisfies Record<StatKind, number>;
const statSemanticVariantCounts = {
  aForcesMatchingRaceCountStat: 1,
  alLumirajLevelOrRankFieldStat: 1,
  aojGaradholgDuelBattleTargetAttributeStat: 1,
  bladeflyFieldAttributeAttackUpdate: 1,
  bootUpSoldierGadgetConditionAttackUpdate: 1,
  borreloadChainLimitAttackDefenseDrop: 1,
  dForcePlasmaGraveyardCountAtkExtraAttack: 1,
  fortuneLadyPastCallbackSetAtkDef: 1,
  genexTurbineTargetBoolFunctionSetcodeStat: 1,
  jurassicWorldTargetBoolFunctionRaceStat: 1,
  luminousSoldierDamageStepTargetAttributeStat: 1,
  mirageKnightBattleTargetAtkEndPhaseBanish: 1,
  mildTurkeyDiceScaleUpdate: 1,
  mountainMultiRaceTargetBoolFunctionRaceStat: 1,
  mukaMukaHandCountAttackDefense: 1,
  neoFlamvellSabreGraveCountThresholdStat: 1,
  perfectMachineKingMatchingFaceupRaceCountStat: 1,
  mysticPlasmaZoneTargetBoolFunctionAttributeStat: 1,
  reliableGuardianTargetedDamageStepDefenseUpdate: 1,
  rushRecklesslyTargetedDamageStepAttackUpdate: 1,
  sangaPreDamageFinalAttackZero: 1,
  shrinkTargetBaseAtkHalving: 1,
  skyscraperFieldDamageCalculationAttackBoost: 1,
  steamroidDamageStepBattleSwingStat: 1,
  gracefulDiceDamageStepGroupStat: 1,
  trianglePowerBaseStatEndDestroy: 1,
  vylonChargerEquipCountAttributeStat: 1,
  plagueWolfFinalAttackEndDestroy: 1,
} satisfies Record<StatSemanticVariant, number>;

type StatKind = "battleAttackerTargetSwing" | "battleTargetAttackBoost" | "damageStepBattleTargetAttributeAttackBoost" | "diceGroupAttackDefenseUpdate" | "diceScaleUpdate" | "fieldAttributeAttackUpdate" | "fieldGroupCountStat" | "fieldMatchingFaceupRaceCountStat" | "fieldLevelOrRankAttackDefenseUpdate" | "fieldRaceAttackDefenseUpdate" | "fieldSetcodeAttackUpdate" | "setAttack" | "setBaseAttack" | "setBaseAttackDefenseEndDestroy" | "selfFinalAttackEndDestroy" | "singleRangeSetcodeConditionAttackUpdate" | "staticAttackAndExtraAttack" | "targetedDamageStepAttackUpdate" | "targetedDamageStepDefenseUpdate" | "targetedPreDamageFinalAttack" | "targetedQuickAttackDefenseUpdateChainLimit";
type StatSemanticVariant =
  | "aForcesMatchingRaceCountStat"
  | "alLumirajLevelOrRankFieldStat"
  | "aojGaradholgDuelBattleTargetAttributeStat"
  | "bladeflyFieldAttributeAttackUpdate"
  | "bootUpSoldierGadgetConditionAttackUpdate"
  | "borreloadChainLimitAttackDefenseDrop"
  | "dForcePlasmaGraveyardCountAtkExtraAttack"
  | "fortuneLadyPastCallbackSetAtkDef"
  | "genexTurbineTargetBoolFunctionSetcodeStat"
  | "gracefulDiceDamageStepGroupStat"
  | "jurassicWorldTargetBoolFunctionRaceStat"
  | "luminousSoldierDamageStepTargetAttributeStat"
  | "mirageKnightBattleTargetAtkEndPhaseBanish"
  | "mildTurkeyDiceScaleUpdate"
  | "mountainMultiRaceTargetBoolFunctionRaceStat"
  | "mukaMukaHandCountAttackDefense"
  | "neoFlamvellSabreGraveCountThresholdStat"
  | "perfectMachineKingMatchingFaceupRaceCountStat"
  | "plagueWolfFinalAttackEndDestroy"
  | "mysticPlasmaZoneTargetBoolFunctionAttributeStat"
  | "reliableGuardianTargetedDamageStepDefenseUpdate"
  | "rushRecklesslyTargetedDamageStepAttackUpdate"
  | "sangaPreDamageFinalAttackZero"
  | "shrinkTargetBaseAtkHalving"
  | "skyscraperFieldDamageCalculationAttackBoost"
  | "steamroidDamageStepBattleSwingStat"
  | "trianglePowerBaseStatEndDestroy"
  | "vylonChargerEquipCountAttributeStat";

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
      file: "test/lua-real-script-a-forces-matching-race-count-stat.test.ts",
      kind: "fieldMatchingFaceupRaceCountStat",
      required: [
        "Duel.GetMatchingGroupCount(s.filter,c:GetControler(),LOCATION_MZONE,0,nil)*200",
        "stat:matching-faceup-race-count:controller:4:0:include-handler:3:x200",
        "currentAttack(restoredWarriorAttacker, restored.session.state)).toBe(1400)",
        "currentAttack(restoredSpellcasterAlly, restored.session.state)).toBe(900)",
        "battleDamage[1]).toBe(400)",
      ],
    },
    {
      file: "test/lua-real-script-aoj-garadholg-battle-light-stat.test.ts",
      kind: "damageStepBattleTargetAttributeAttackBoost",
      required: [
        "local a=Duel.GetAttacker()",
        "local d=Duel.GetAttackTarget()",
        "d:IsFaceup() and d:IsAttribute(ATTRIBUTE_LIGHT)",
        "condition:damage-source-relate-battle-target-faceup-attribute:16",
        "currentAttack(restoredAttacking.session.state.cards.find((card) => card.uid === attacking.garadholg.uid), restoredAttacking.session.state)).toBe((attacking.garadholg.data.attack ?? 0) + 200)",
        "battleDamage).toEqual({ 0: 0, 1: 300 })",
      ],
    },
    {
      file: "test/lua-real-script-al-lumiraj-level-rank-field-stat.test.ts",
      kind: "fieldLevelOrRankAttackDefenseUpdate",
      required: [
        "if c:IsType(TYPE_XYZ) then return c:GetRank()*-300",
        "stat:level-or-rank:x-300",
        "currentAttack(restoredLevelAttacker, restored.session.state)).toBe(1300)",
        "currentDefense(restoredRankTarget, restored.session.state)).toBe(1300)",
        "battleDamage[1]).toBe(300)",
      ],
    },
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
      file: "test/lua-real-script-vylon-charger-equip-count-attribute-stat.test.ts",
      kind: "fieldAttributeAttackUpdate",
      required: [
        "return e:GetHandler():GetEquipCount()*300",
        "stat:handler-equip-count:x300",
        "target:attribute:16",
        "currentAttack(restoredLightAttacker, restored.session.state)).toBe(1800)",
        "battleDamage[1]).toBe(300)",
      ],
    },
    {
      file: "test/lua-real-script-genex-turbine-setcode-field-stat.test.ts",
      kind: "fieldSetcodeAttackUpdate",
      required: [
        "aux.TargetBoolFunction(Card.IsSetCard,SET_GENEX)",
        "target:setcode:2",
        "setGenexAlly",
        "currentAttack(restoredGenexAllyAttacker, restored.session.state)).toBe(1500)",
        "currentAttack(restoredOpponentGenex, restored.session.state)).toBe(1200)",
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
      file: "test/lua-real-script-mountain-multi-race-field-stat.test.ts",
      kind: "fieldRaceAttackDefenseUpdate",
      required: [
        "multi-race aux.TargetBoolFunction Card.IsRace ATK and DEF field updates",
        "RACE_DRAGON|RACE_WINGEDBEAST|RACE_THUNDER",
        "target:race:12800",
        "currentAttack(restoredDragonAttacker, restored.session.state)).toBe(1200)",
        "currentDefense(restoredWingedBeastAlly, restored.session.state)).toBe(1800)",
        "battleDamage[1]).toBe(200)",
      ],
    },
    {
      file: "test/lua-real-script-luminous-soldier-phase-attribute-stat.test.ts",
      kind: "damageStepBattleTargetAttributeAttackBoost",
      required: [
        "local ph=Duel.GetCurrentPhase()",
        "e:GetHandler():IsRelateToBattle()",
        "bc:IsFaceup() and bc:IsAttribute(ATTRIBUTE_DARK)",
        "condition:damage-source-relate-battle-target-faceup-attribute:32",
        "currentAttack(restoredBoostedSoldier, restoredBoosted.session.state)).toBe((boosted.luminousSoldier.data.attack ?? 0) + 500)",
        "battleDamage).toEqual({ 0: 0, 1: expectedBoostedDamage })",
      ],
    },
    {
      file: "test/lua-real-script-boot-up-soldier-gadget-attack.test.ts",
      kind: "singleRangeSetcodeConditionAttackUpdate",
      required: [
        "restores aux.FaceupFilter SetCard conditional single-range ATK updates into battle damage",
        "return Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsSetCard,SET_GADGET),e:GetHandlerPlayer(),LOCATION_MZONE,0,1,nil)",
        "condition:controller-has-faceup-setcode:81",
        "currentAttack(restoredBootUpSoldier, restored.session.state)).toBe((bootUpSoldier!.data.attack ?? 0) + 2000)",
        "currentAttack(restoredBootUpSoldier, restored.session.state)).toBe(bootUpSoldier!.data.attack ?? 0)",
        "battleDamage).toEqual({ 0: 0, 1: 500 })",
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
      file: "test/lua-real-script-neo-flamvell-sabre-grave-count-stat.test.ts",
      kind: "fieldGroupCountStat",
      required: [
        "local gct=Duel.GetFieldGroupCount(e:GetHandler():GetControler(),0,LOCATION_GRAVE)",
        "if gct<=4 then return 600",
        "elseif gct>=8 then return -300",
        "stat:controller-field-group-count-threshold:0:16:lte4:600:gte8:-300:else0",
        "currentAttack(restoredLowSabre, restoredLow.session.state)).toBe((low.sabre.data.attack ?? 0) + 600)",
        "battleDamage).toEqual({ 0: 0, 1: 200 })",
      ],
    },
    {
      file: "test/lua-real-script-perfect-machine-king-race-count-stat.test.ts",
      kind: "fieldMatchingFaceupRaceCountStat",
      required: [
        "Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsRace,RACE_MACHINE),c:GetControler(),LOCATION_MZONE,LOCATION_MZONE,e:GetHandler())*500",
        "stat:matching-faceup-race-count:controller:4:4:exclude-handler:32:x500",
        "currentAttack(perfectKing, session.state)).toBe((perfectKing.data.attack ?? 0) + 1000)",
        "currentAttack(perfectKing, session.state)).toBe((perfectKing.data.attack ?? 0) + 1500)",
        "battleDamage).toEqual({ 0: 0, 1: 700 })",
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
      file: "test/lua-real-script-reliable-guardian-defense-damage-step.test.ts",
      kind: "targetedDamageStepDefenseUpdate",
      required: [
        "e1:SetCategory(CATEGORY_DEFCHANGE)",
        "e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)",
        "e1:SetCondition(aux.StatChangeDamageStepCondition)",
        "Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)",
        "local tc=Duel.GetFirstTarget()",
        "tc:IsRelateToEffect(e) and tc:IsFaceup()",
        "e1:SetCode(EFFECT_UPDATE_DEFENSE)",
        "e1:SetValue(700)",
        "currentDefense(restoredDefender, restoredBoost.session.state)).toBe(1700)",
        "battleDamage).toEqual({ 0: 0, 1: 100 })",
      ],
    },
    {
      file: "test/lua-real-script-borreload-chain-limit-atk-def.test.ts",
      kind: "targetedQuickAttackDefenseUpdateChainLimit",
      required: [
        'const borreloadCode = "31833038"',
        "restores Borreload Dragon's target stat drop and response-matches-chain-player chain limit",
        "Duel.SetChainLimit(function(_e,_ep,_tp) return _tp==_ep end)",
        "registryKey: `lua-chain-limit:${borreloadCode}:0:link:known:closure:response-matches-chain-player`",
        "currentAttack(restoredTarget, restoredResponse.session.state)).toBe(1000)",
        "currentDefense(restoredTarget, restoredResponse.session.state)).toBe(1000)",
        "battleDamage[1]).toBe(2000)",
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
      file: "test/lua-real-script-plague-wolf-final-attack-end-destroy.test.ts",
      kind: "selfFinalAttackEndDestroy",
      required: [
        'const plagueWolfCode = "55696885"',
        "e1:SetCode(EFFECT_SET_ATTACK_FINAL)",
        "e1:SetValue(c:GetBaseAttack()*2)",
        "e2:SetCode(EVENT_PHASE+PHASE_END)",
        "Duel.Destroy(c,REASON_EFFECT)",
        "currentAttack(plagueWolf, session.state)).toBe(1000)",
        "assertBoostedPlagueWolf",
        "battleDamage).toEqual({ 0: 0, 1: 500 })",
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
    {
      file: "test/lua-real-script-triangle-power-base-stat-end-destroy.test.ts",
      kind: "setBaseAttackDefenseEndDestroy",
      required: [
        'const trianglePowerCode = "32298781"',
        "e1:SetCode(EFFECT_SET_BASE_ATTACK)",
        "e1:SetValue(tc:GetBaseAttack()+2000)",
        "e2:SetCode(EFFECT_SET_BASE_DEFENSE)",
        "e2:SetValue(tc:GetBaseDefense()+2000)",
        "Duel.Destroy(g,REASON_EFFECT)",
        "currentAttack(boostedAttacker, state)).toBe(2500)",
        "currentDefense(boostedAlly, state)).toBe(2200)",
        "battleDamage).toEqual({ 0: 0, 1: 1500 })",
      ],
    },
    {
      file: "test/lua-real-script-graceful-dice-damage-step-stat.test.ts",
      kind: "diceGroupAttackDefenseUpdate",
      required: [
        'const gracefulDiceCode = "74137509"',
        "e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)",
        "Duel.IsDamageCalculated()",
        "local val=Duel.TossDice(tp,1)*100",
        "e1:SetCode(EFFECT_UPDATE_ATTACK)",
        "e2:SetCode(EFFECT_UPDATE_DEFENSE)",
        "currentAttack(restoredActivation.session.state.cards.find((card) => card.uid === attacker.uid), restoredActivation.session.state)).toBe(1500 + update)",
        "currentDefense(restoredActivation.session.state.cards.find((card) => card.uid === ally.uid), restoredActivation.session.state)).toBe(1600 + update)",
        "battleDamage).toEqual({ 0: 0, 1: Math.max(0, 1500 + update - 1700) })",
      ],
    },
    {
      file: "test/lua-real-script-mild-turkey-dice-scale.test.ts",
      kind: "diceScaleUpdate",
      required: [
        'const mildTurkeyCode = "47558785"',
        "restores a Pendulum-zone dice roll into temporary left and right scale reductions",
        "Duel.SetOperationInfo(0,CATEGORY_DICE,nil,0,tp,1)",
        "local dc=Duel.TossDice(tp,1)",
        "e1:SetCode(EFFECT_UPDATE_LSCALE)",
        "e2:SetCode(EFFECT_UPDATE_RSCALE)",
        "currentLeftScale(restoredActivation.session.state.cards.find((card) => card.uid === mildTurkey.uid), restoredActivation.session.state)).toBe(7 - scaleReduction)",
        "currentRightScale(restoredScale.session.state.cards.find((card) => card.uid === mildTurkey.uid), restoredScale.session.state)).toBe(7 - scaleReduction)",
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
      damageStepBattleTargetAttributeAttackBoost: 0,
      diceGroupAttackDefenseUpdate: 0,
      diceScaleUpdate: 0,
      fieldAttributeAttackUpdate: 0,
      fieldGroupCountStat: 0,
      fieldMatchingFaceupRaceCountStat: 0,
      fieldLevelOrRankAttackDefenseUpdate: 0,
      fieldRaceAttackDefenseUpdate: 0,
      fieldSetcodeAttackUpdate: 0,
      setAttack: 0,
      setBaseAttack: 0,
      setBaseAttackDefenseEndDestroy: 0,
      selfFinalAttackEndDestroy: 0,
      singleRangeSetcodeConditionAttackUpdate: 0,
      staticAttackAndExtraAttack: 0,
      targetedDamageStepAttackUpdate: 0,
      targetedDamageStepDefenseUpdate: 0,
      targetedPreDamageFinalAttack: 0,
      targetedQuickAttackDefenseUpdateChainLimit: 0,
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
      file: "test/lua-real-script-a-forces-matching-race-count-stat.test.ts",
      kind: "aForcesMatchingRaceCountStat",
      required: [
        'const aForcesCode = "403847"',
        "restores Warrior-only ATK updates from a face-up Warrior or Spellcaster count callback into battle damage",
        "return c:IsFaceup() and c:IsRace(RACE_WARRIOR|RACE_SPELLCASTER)",
        "stat:matching-faceup-race-count:controller:4:0:include-handler:3:x200",
      ],
    },
    {
      file: "test/lua-real-script-aoj-garadholg-battle-light-stat.test.ts",
      kind: "aojGaradholgDuelBattleTargetAttributeStat",
      required: [
        'const garadholgCode = "25771826"',
        "restores its damage-step ATK boost when battling a LIGHT monster as attacker or defender",
        "condition:damage-source-relate-battle-target-faceup-attribute:16",
        "players[1].lifePoints).toBe(7700)",
      ],
    },
    {
      file: "test/lua-real-script-al-lumiraj-level-rank-field-stat.test.ts",
      kind: "alLumirajLevelOrRankFieldStat",
      required: [
        'const alLumirajCode = "25795273"',
        "restores callback-valued Level or Rank ATK/DEF loss into battle damage",
        "stat:level-or-rank:x-300",
        "currentAttack(restoredRankTarget, restored.session.state)).toBe(1300)",
      ],
    },
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
      file: "test/lua-real-script-boot-up-soldier-gadget-attack.test.ts",
      kind: "bootUpSoldierGadgetConditionAttackUpdate",
      required: [
        'const bootUpSoldierCode = "13316346"',
        "restores aux.FaceupFilter SetCard conditional single-range ATK updates into battle damage",
        "condition:controller-has-faceup-setcode:81",
        "players[1].lifePoints).toBe(7500)",
      ],
    },
    {
      file: "test/lua-real-script-borreload-chain-limit-atk-def.test.ts",
      kind: "borreloadChainLimitAttackDefenseDrop",
      required: [
        'const borreloadCode = "31833038"',
        "EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP",
        "Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)",
        "Duel.SetChainLimit(function(_e,_ep,_tp) return _tp==_ep end)",
        "host.messages).not.toContain(\"borreload opponent responder resolved\")",
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
      file: "test/lua-real-script-genex-turbine-setcode-field-stat.test.ts",
      kind: "genexTurbineTargetBoolFunctionSetcodeStat",
      required: [
        'const genexTurbineCode = "52222372"',
        "restores aux.TargetBoolFunction Card.IsSetCard field ATK updates into battle damage",
        "target:setcode:2",
        "currentAttack(restoredGenexAllyAttacker, restored.session.state)).toBe(1500)",
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
      file: "test/lua-real-script-mountain-multi-race-field-stat.test.ts",
      kind: "mountainMultiRaceTargetBoolFunctionRaceStat",
      required: [
        'const mountainCode = "50913601"',
        "restores multi-race aux.TargetBoolFunction Card.IsRace ATK and DEF field updates into battle damage",
        "target:race:12800",
        "RACE_DRAGON|RACE_WINGEDBEAST|RACE_THUNDER",
      ],
    },
    {
      file: "test/lua-real-script-luminous-soldier-phase-attribute-stat.test.ts",
      kind: "luminousSoldierDamageStepTargetAttributeStat",
      required: [
        'const luminousSoldierCode = "57482479"',
        "restores Damage Step DARK battle-target ATK update into battle damage",
        "condition:damage-source-relate-battle-target-faceup-attribute:32",
        "players[1].lifePoints).toBe(8000 - expectedBoostedDamage)",
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
      file: "test/lua-real-script-neo-flamvell-sabre-grave-count-stat.test.ts",
      kind: "neoFlamvellSabreGraveCountThresholdStat",
      required: [
        'const sabreCode = "91554542"',
        "restores thresholded GetFieldGroupCount opponent Graveyard ATK callback into battle damage",
        "stat:controller-field-group-count-threshold:0:16:lte4:600:gte8:-300:else0",
        "currentAttack(restoredHigh.session.state.cards.find((card) => card.uid === high.sabre.uid)!, restoredHigh.session.state)).toBe((high.sabre.data.attack ?? 0) - 300)",
      ],
    },
    {
      file: "test/lua-real-script-perfect-machine-king-race-count-stat.test.ts",
      kind: "perfectMachineKingMatchingFaceupRaceCountStat",
      required: [
        'const perfectKingCode = "18891691"',
        "restores face-up Machine GetMatchingGroupCount ATK callback with handler exclusion into battle damage",
        "stat:matching-faceup-race-count:controller:4:4:exclude-handler:32:x500",
        "players[1].lifePoints).toBe(7300)",
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
      file: "test/lua-real-script-vylon-charger-equip-count-attribute-stat.test.ts",
      kind: "vylonChargerEquipCountAttributeStat",
      required: [
        'const chargerCode = "13220032"',
        "restores LIGHT field ATK updates with GetEquipCount callback value into battle damage",
        "e1:SetTarget(aux.TargetBoolFunction(Card.IsAttribute,ATTRIBUTE_LIGHT))",
        "stat:handler-equip-count:x300",
        "currentAttack(restoredCharger, restored.session.state)).toBe(1600)",
      ],
    },
    {
      file: "test/lua-real-script-plague-wolf-final-attack-end-destroy.test.ts",
      kind: "plagueWolfFinalAttackEndDestroy",
      required: [
        'const plagueWolfCode = "55696885"',
        "restores final ATK doubling through battle damage and the delayed self-destroy trigger",
        "`lua:${plagueWolfCode}:lua-3-4608`",
        'eventName: "phaseEnd"',
        "eventReasonEffectId: 3",
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
      file: "test/lua-real-script-reliable-guardian-defense-damage-step.test.ts",
      kind: "reliableGuardianTargetedDamageStepDefenseUpdate",
      required: [
        'const reliableGuardianCode = "16430187"',
        "restores targeted Damage Step DEF update activation and preserves the boosted defense through battle",
        "e1:SetCategory(CATEGORY_DEFCHANGE)",
        "currentDefense(restoredDefender, restoredBoost.session.state)).toBe(1700)",
        "players[1].lifePoints).toBe(7900)",
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
    {
      file: "test/lua-real-script-triangle-power-base-stat-end-destroy.test.ts",
      kind: "trianglePowerBaseStatEndDestroy",
      required: [
        'const trianglePowerCode = "32298781"',
        "restores base ATK/DEF boosts for Level 1 Normal monsters and destroys them at End Phase",
        "de:SetCode(EVENT_PHASE+PHASE_END)",
        "players[1].lifePoints).toBe(6500)",
        'eventName: "phaseEnd"',
      ],
    },
    {
      file: "test/lua-real-script-graceful-dice-damage-step-stat.test.ts",
      kind: "gracefulDiceDamageStepGroupStat",
      required: [
        'const gracefulDiceCode = "74137509"',
        "restores a Damage Step dice roll into group ATK/DEF updates and battle damage",
        "local val=Duel.TossDice(tp,1)*100",
        'battleWindow).toMatchObject({ kind: "startDamageStep", step: "damage", responsePlayer: 0 })',
        'eventName: "diceTossed"',
      ],
    },
    {
      file: "test/lua-real-script-mild-turkey-dice-scale.test.ts",
      kind: "mildTurkeyDiceScaleUpdate",
      required: [
        'const mildTurkeyCode = "47558785"',
        "restores a Pendulum-zone dice roll into temporary left and right scale reductions",
        "EFFECT_UPDATE_LSCALE",
        "EFFECT_UPDATE_RSCALE",
        'eventName: "diceTossed"',
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
      aForcesMatchingRaceCountStat: 0,
      alLumirajLevelOrRankFieldStat: 0,
      aojGaradholgDuelBattleTargetAttributeStat: 0,
      bladeflyFieldAttributeAttackUpdate: 0,
      bootUpSoldierGadgetConditionAttackUpdate: 0,
      borreloadChainLimitAttackDefenseDrop: 0,
      dForcePlasmaGraveyardCountAtkExtraAttack: 0,
      fortuneLadyPastCallbackSetAtkDef: 0,
      genexTurbineTargetBoolFunctionSetcodeStat: 0,
      gracefulDiceDamageStepGroupStat: 0,
      jurassicWorldTargetBoolFunctionRaceStat: 0,
      luminousSoldierDamageStepTargetAttributeStat: 0,
      mirageKnightBattleTargetAtkEndPhaseBanish: 0,
      mildTurkeyDiceScaleUpdate: 0,
      mountainMultiRaceTargetBoolFunctionRaceStat: 0,
      mukaMukaHandCountAttackDefense: 0,
      neoFlamvellSabreGraveCountThresholdStat: 0,
      perfectMachineKingMatchingFaceupRaceCountStat: 0,
      plagueWolfFinalAttackEndDestroy: 0,
      mysticPlasmaZoneTargetBoolFunctionAttributeStat: 0,
      reliableGuardianTargetedDamageStepDefenseUpdate: 0,
      rushRecklesslyTargetedDamageStepAttackUpdate: 0,
      sangaPreDamageFinalAttackZero: 0,
      shrinkTargetBaseAtkHalving: 0,
      skyscraperFieldDamageCalculationAttackBoost: 0,
      steamroidDamageStepBattleSwingStat: 0,
      trianglePowerBaseStatEndDestroy: 0,
      vylonChargerEquipCountAttributeStat: 0,
    },
  );
}
