import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const battleTimingFixtureCount = 44;
const battleTimingEventCodeFixtureCount = 44;
const battleTimingEventCodeExceptions: string[] = [];
const battleTimingKindCounts: Record<BattleTimingKind, number> = {
  afterDamageCalculation: 18,
  beforeDamageCalculation: 8,
  duringDamageCalculation: 5,
  endDamageStep: 8,
  startDamageStep: 5,
};
const battleTimingSemanticVariantCounts = {
  allyOfJusticeNullfierAfterDamageDisable: 1,
  aojOmniWeaponBattledLabelDrawSummon: 1,
  bigShieldGardnaEndDamageStepPosition: 1,
  blackwingArmorMasterEndDamageCounterStat: 1,
  chimeraIllusionBeastEndDamageDisable: 1,
  cipherSoldierBeforeDamageCalculationBoost: 1,
  ddAssailantAfterDamageBanishBoth: 1,
  ddWarriorWallMandatoryBattledSegoc: 1,
  darkRulerHaDesAfterDamageContinuousDisable: 1,
  desKangarooEndDamageDestroy: 1,
  dracoonLampChangeBattleStat: 1,
  drillroidBattleConfirmDestroy: 1,
  destructionPunchEndDamageTrapDestroy: 1,
  divineKnightIshzarkAfterDamageBanish: 1,
  ehrenBattleConfirmToDeck: 1,
  elementDoomAfterDamageAttributeDisable: 1,
  fabledAshenveilPreDamageBoost: 1,
  geminiSoldierAfterDamageDeckSummon: 1,
  getsuFuhmaEndDamageTargetDestroy: 1,
  gundariStartDamageSynchroBounce: 1,
  hayateAfterDamageDeckSend: 1,
  heraldicBeastBasiliskAfterDamageBattleTargetDestroy: 1,
  injectionFairyLilyBeforeDamageLpBoost: 1,
  insectPrincessBattledFlagAtk: 1,
  kuribohBeforeDamagePrevent: 1,
  kuribonBeforeDamageRecoverReturn: 1,
  madolcheWaltzAfterDamageFieldBurn: 1,
  mirageKnightDuringDamageAtkBanish: 1,
  nightmareMagicianEndDamageControl: 1,
  predaplantSarraceniantAfterDamageDestroy: 1,
  powerWallBeforeDamageDeckMillShield: 1,
  reflectBounderStartAndAfterDamageDestroy: 1,
  sasukeSamuraiStartDamageDestroy: 1,
  sangaBeforeDamageFinalAttack: 1,
  shadowSpellDuringDamagePersistentStat: 1,
  shinobirdCrowStartDamageStatBoost: 1,
  smokeMosquitoBeforeDamageHalfDamageSummon: 1,
  spearDragonEndDamagePiercePosition: 1,
  skyscraperDuringDamageFieldStatBoost: 1,
  steamroidDuringDamageBattleSwingStat: 1,
  topologicBomberAfterDamageBurn: 1,
  turboRocketAfterDamageGetAttackTargetBurn: 1,
  wallOfIllusionAfterDamageBounce: 1,
  zoneEaterAfterDamageDelayedDestroy: 1,
} satisfies Record<BattleTimingSemanticVariant, number>;

describe("Lua real battle timing restore coverage", () => {
  it("keeps battle timing fixture kinds explicit", () => {
    expect(countBattleTimingKinds(battleTimingFixtureFiles())).toEqual(battleTimingKindCounts);
  });

  it("keeps battle timing event-code assertions explicit", () => {
    const eventCodeFiles = battleTimingFixtureFiles()
      .filter(({ file }) => fs.readFileSync(path.join(root, file), "utf8").includes("eventCode:"))
      .map(({ file }) => file);
    const exceptions = battleTimingFixtureFiles()
      .filter(({ file }) => !fs.readFileSync(path.join(root, file), "utf8").includes("eventCode:"))
      .map(({ file }) => file)
      .sort();

    expect(eventCodeFiles).toHaveLength(battleTimingEventCodeFixtureCount);
    expect(exceptions).toEqual([...battleTimingEventCodeExceptions].sort());
  });

  it("requires battle timing fixtures to assert clean Lua restore and restored timing outcomes", () => {
    const files = battleTimingFixtureFiles();
    expect(files).toHaveLength(battleTimingFixtureCount);

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
          || (requiresActivatedTrigger(file) && !text.includes("applyLuaRestoreResponse"))
          || !text.includes("eventHistory")
          || !text.includes("eventCardUid")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps named battle timing semantic variants explicit", () => {
    expect(countBattleTimingSemanticVariants(battleTimingSemanticVariants())).toEqual(battleTimingSemanticVariantCounts);

    const weak = battleTimingSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

type BattleTimingKind = "afterDamageCalculation" | "beforeDamageCalculation" | "duringDamageCalculation" | "endDamageStep" | "startDamageStep";
type BattleTimingSemanticVariant =
  | "allyOfJusticeNullfierAfterDamageDisable"
  | "aojOmniWeaponBattledLabelDrawSummon"
  | "bigShieldGardnaEndDamageStepPosition"
  | "blackwingArmorMasterEndDamageCounterStat"
  | "chimeraIllusionBeastEndDamageDisable"
  | "cipherSoldierBeforeDamageCalculationBoost"
  | "ddAssailantAfterDamageBanishBoth"
  | "ddWarriorWallMandatoryBattledSegoc"
  | "darkRulerHaDesAfterDamageContinuousDisable"
  | "desKangarooEndDamageDestroy"
  | "dracoonLampChangeBattleStat"
  | "drillroidBattleConfirmDestroy"
  | "destructionPunchEndDamageTrapDestroy"
  | "divineKnightIshzarkAfterDamageBanish"
  | "ehrenBattleConfirmToDeck"
  | "elementDoomAfterDamageAttributeDisable"
  | "fabledAshenveilPreDamageBoost"
  | "geminiSoldierAfterDamageDeckSummon"
  | "getsuFuhmaEndDamageTargetDestroy"
  | "gundariStartDamageSynchroBounce"
  | "hayateAfterDamageDeckSend"
  | "heraldicBeastBasiliskAfterDamageBattleTargetDestroy"
  | "injectionFairyLilyBeforeDamageLpBoost"
  | "insectPrincessBattledFlagAtk"
  | "kuribohBeforeDamagePrevent"
  | "kuribonBeforeDamageRecoverReturn"
  | "madolcheWaltzAfterDamageFieldBurn"
  | "mirageKnightDuringDamageAtkBanish"
  | "nightmareMagicianEndDamageControl"
  | "predaplantSarraceniantAfterDamageDestroy"
  | "powerWallBeforeDamageDeckMillShield"
  | "reflectBounderStartAndAfterDamageDestroy"
  | "sasukeSamuraiStartDamageDestroy"
  | "sangaBeforeDamageFinalAttack"
  | "shadowSpellDuringDamagePersistentStat"
  | "shinobirdCrowStartDamageStatBoost"
  | "smokeMosquitoBeforeDamageHalfDamageSummon"
  | "spearDragonEndDamagePiercePosition"
  | "skyscraperDuringDamageFieldStatBoost"
  | "steamroidDuringDamageBattleSwingStat"
  | "topologicBomberAfterDamageBurn"
  | "turboRocketAfterDamageGetAttackTargetBurn"
  | "wallOfIllusionAfterDamageBounce"
  | "zoneEaterAfterDamageDelayedDestroy";

function battleTimingSemanticVariants(): Array<{
  file: string;
  kind: BattleTimingSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-ally-of-justice-nullfier-battled-disable.test.ts",
      kind: "allyOfJusticeNullfierAfterDamageDisable",
      required: [
        "restores its EVENT_BATTLED label-object trigger and disables the LIGHT battle target",
        "eventName: \"afterDamageCalculation\"",
        "eventName: \"battleDamageDealt\"",
        "eventReason: duelReason.battle",
        "eventReasonCardUid: nullfier!.uid",
        "eventReasonPlayer: 0",
        "target disabled true",
      ],
    },
    {
      file: "test/lua-real-script-aoj-omni-weapon-battled-label-draw-summon.test.ts",
      kind: "aojOmniWeaponBattledLabelDrawSummon",
      required: [
        "restores EVENT_BATTLED label state into the battle-destroyed draw and optional DARK Special Summon",
        "e2:SetLabelObject(e1)",
        "Duel.GetOperatedGroup():GetFirst()",
        "Duel.SelectYesNo(tp,aux.Stringid(id,1))",
        "eventName: \"battleDestroyed\"",
        "eventName: \"cardsDrawn\"",
        "eventName: \"specialSummoned\"",
      ],
    },
    {
      file: "test/lua-real-script-big-shield-gardna-damage-step-position.test.ts",
      kind: "bigShieldGardnaEndDamageStepPosition",
      required: [
        "restores its end Damage Step position change after being attacked in Defense Position",
        "e2:SetCode(EVENT_DAMAGE_STEP_END)",
        "Duel.ChangePosition(c,POS_FACEUP_ATTACK)",
        "eventName: \"damageStepEnded\"",
        "eventName: \"battleDamageDealt\"",
        "eventReason: duelReason.battle",
        "eventReasonCardUid: gardna!.uid",
        "eventReasonPlayer: 1",
        "eventName: \"positionChanged\"",
      ],
    },
    {
      file: "test/lua-real-script-blackwing-armor-master-counter-stat.test.ts",
      kind: "blackwingArmorMasterEndDamageCounterStat",
      required: [
        "restores battle immunity, end-Damage-Step Wedge Counter placement, and counter-cost final ATK/DEF zeroing",
        "EFFECT_INDESTRUCTABLE_BATTLE",
        "EFFECT_AVOID_BATTLE_DAMAGE",
        "e3:SetCode(EVENT_DAMAGE_STEP_END)",
        "eventName: \"damageStepEnded\"",
        "eventCode: 1141",
        "eventPlayer: 0",
        "eventTriggerTiming: \"when\"",
        "triggerBucket: \"turnOptional\"",
        "atg:AddCounter(0x1002,1)",
        "Duel.SetTargetCard(g)",
        "eventName: \"counterAdded\"",
        "currentAttack(restoredFinalStats.session.state.cards.find((card) => card.uid === target.uid), restoredFinalStats.session.state)).toBe(0)",
        "currentDefense(restoredFinalStats.session.state.cards.find((card) => card.uid === target.uid), restoredFinalStats.session.state)).toBe(0)",
      ],
    },
    {
      file: "test/lua-real-script-chimera-illusion-beast-damage-end-disable.test.ts",
      kind: "chimeraIllusionBeastEndDamageDisable",
      required: [
        "restores battle indestructible Damage Step End trigger into battle target ATK zero and negation",
        "Fusion.AddProcMixRep(c,true,true,aux.FilterBoolFunctionEx(Card.IsRace,RACE_ILLUSION),1,99,CARD_CHIMERA_MYTHICAL_BEAST)",
        "e3:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)",
        "e4:SetCode(EVENT_DAMAGE_STEP_END)",
        "battleWindow?.kind).toBe(\"endDamageStep\")",
        "eventName: \"damageStepEnded\"",
        "eventCode: 1141",
        "eventTriggerTiming: \"when\"",
        "triggerBucket: \"turnOptional\"",
        "eventName: \"battleDamageDealt\"",
        "currentAttack(disabledTarget, restoredTrigger.session.state)).toBe(0)",
        "isCardDisabled(restoredTrigger.session.state, disabledTarget",
      ],
    },
    {
      file: "test/lua-real-script-cipher-soldier-pre-damage-calculate.test.ts",
      kind: "cipherSoldierBeforeDamageCalculationBoost",
      required: [
        "restores its EVENT_PRE_DAMAGE_CALCULATE trigger and applies the Warrior battle stat boost",
        "eventCode: 1134",
        "currentAttack(restored.session.state.cards.find",
        "eventName: \"battleDamageDealt\"",
        "eventReasonCardUid: cipherSoldier!.uid",
      ],
    },
    {
      file: "test/lua-real-script-dd-assailant-battled-remove.test.ts",
      kind: "ddAssailantAfterDamageBanishBoth",
      required: [
        "restores D.D. Assailant after damage calculation and banishes both battle participants",
        "triggerBucket: \"opponentMandatory\"",
        "eventName: \"battleDamageDealt\"",
        "eventReason: duelReason.battle",
        "eventReasonCardUid: attacker!.uid",
        "eventReasonPlayer: 0",
        "eventName: \"banished\"",
      ],
    },
    {
      file: "test/lua-real-script-dd-warrior-wall-battled-segoc.test.ts",
      kind: "ddWarriorWallMandatoryBattledSegoc",
      required: [
        "restores simultaneous EVENT_BATTLED mandatory triggers and respects chain order battle relation",
        "triggerBucket: \"turnMandatory\"",
        "triggerBucket: \"opponentMandatory\"",
        "battleDamage).toEqual({ 0: 0, 1: 200 })",
        "eventName: \"battleDamageDealt\"",
        "eventValue: 200",
        "eventReason: duelReason.battle",
        "eventReasonCardUid: warrior!.uid",
        "eventReasonPlayer: 0",
      ],
    },
    {
      file: "test/lua-real-script-dark-ruler-ha-des-battled-disable.test.ts",
      kind: "darkRulerHaDesAfterDamageContinuousDisable",
      required: [
        "restores its EVENT_BATTLED continuous disable on a battle-destroyed monster in Graveyard",
        "ha des target disabled true",
        "eventName: \"battleDestroyed\"",
      ],
    },
    {
      file: "test/lua-real-script-des-kangaroo-damage-step-end.test.ts",
      kind: "desKangarooEndDamageDestroy",
      required: [
        "restores Des Kangaroo's end Damage Step trigger and destroys the lower-ATK attacker",
        "eventName: \"damageStepEnded\"",
        "eventName: \"battleDamageDealt\"",
        "eventReason: duelReason.battle",
        "eventReasonCardUid: kangaroo!.uid",
        "eventReasonPlayer: 1",
        "eventName: \"destroyed\"",
      ],
    },
    {
      file: "test/lua-real-script-dracoon-lamp-change-battle-stat.test.ts",
      kind: "dracoonLampChangeBattleStat",
      required: [
        "restores its pre-damage EFFECT_CHANGE_BATTLE_STAT callback into damage calculation",
        "e1:SetCode(EFFECT_CHANGE_BATTLE_STAT)",
        "stat:current-defense",
        "target:source-or-battle-target",
        "eventName: \"damageCalculating\"",
        "battleDamage).toEqual({ 0: 0, 1: 1600 })",
        "eventName: \"battleDamageDealt\"",
        "eventReason: duelReason.battle",
        "eventReasonCardUid: dracoon!.uid",
        "eventReasonPlayer: 0",
      ],
    },
    {
      file: "test/lua-real-script-destruction-punch-damage-step-end.test.ts",
      kind: "destructionPunchEndDamageTrapDestroy",
      required: [
        "restores its end-Damage-Step Trap activation and destroys the battle attacker",
        "eventName: \"damageStepEnded\"",
        "eventName: \"battleDamageDealt\"",
        "eventReason: duelReason.battle",
        "eventReasonCardUid: defender!.uid",
        "eventReasonPlayer: 0",
        "location: \"graveyard\"",
      ],
    },
    {
      file: "test/lua-real-script-divine-knight-ishzark-battled-remove.test.ts",
      kind: "divineKnightIshzarkAfterDamageBanish",
      required: [
        "restores Divine Knight Ishzark after damage calculation and banishes the battle-destroyed target",
        "triggerBucket: \"turnMandatory\"",
        "eventName === \"battleDamageDealt\")).toEqual([])",
        "eventName: \"banished\"",
      ],
    },
    {
      file: "test/lua-real-script-ehren-battle-confirm-to-deck.test.ts",
      kind: "ehrenBattleConfirmToDeck",
      required: ["restores battle-confirm target shuffling and ends the pending battle when the target leaves", "e1:SetCode(EVENT_BATTLE_CONFIRM)", "Duel.SendtoDeck(t,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)", "eventName: \"battleConfirmed\"", "eventName: \"sentToDeck\""],
    },
    {
      file: "test/lua-real-script-element-doom-chain-attack.test.ts",
      kind: "elementDoomAfterDamageAttributeDisable",
      required: [
        "restores its attribute-gated battled disable and reopens its attack with Duel.ChainAttack",
        "e1:SetCode(EVENT_BATTLED)",
        "bc:IsStatus(STATUS_BATTLE_DESTROYED)",
        "Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsAttribute,ATTRIBUTE_EARTH)",
        "isCardDisabled(restored.session.state, restoredDefeatedTarget!",
        "Duel.ChainAttack()",
      ],
    },
    {
      file: "test/lua-real-script-fabled-ashenveil-damage-step-boost.test.ts",
      kind: "fabledAshenveilPreDamageBoost",
      required: [
        "restores its hand cost and pre-damage calculation ATK boost",
        "battleWindow?.kind).toBe(\"beforeDamageCalculation\")",
        "eventReasonEffectId: 1",
        "eventName: \"battleDamageDealt\"",
        "eventReasonCardUid: ashenveil.uid",
      ],
    },
    {
      file: "test/lua-real-script-gemini-soldier-battled-deck-summon.test.ts",
      kind: "geminiSoldierAfterDamageDeckSummon",
      required: ["restores battled trigger, Deck Special Summon, and battle indestructible count", "triggerBucket: \"turnOptional\"", "eventName: \"specialSummoned\""],
    },
    {
      file: "test/lua-real-script-getsu-fuhma-damage-step-end.test.ts",
      kind: "getsuFuhmaEndDamageTargetDestroy",
      required: [
        "restores Getsu Fuhma's stored battle target and destroys it at the end of the Damage Step",
        "battleWindow?.kind).toBe(\"endDamageStep\")",
        "effectLabelObjectUid",
        "eventName: \"battleDamageDealt\"",
        "eventReason: duelReason.battle",
        "eventReasonCardUid: fiend!.uid",
        "eventReasonPlayer: 1",
      ],
    },
    {
      file: "test/lua-real-script-gundari-battle-start-synchro-bounce.test.ts",
      kind: "gundariStartDamageSynchroBounce",
      required: ["restores its battle-start trigger and returns both battling monsters to hand", "eventName: \"battleStarted\"", "eventName: \"sentToHand\""],
    },
    {
      file: "test/lua-real-script-hayate-battled-send.test.ts",
      kind: "hayateAfterDamageDeckSend",
      required: [
        "restores its direct-attack EVENT_BATTLED trigger and sends a Sky Striker card from Deck to Graveyard",
        "triggerBucket: \"turnOptional\"",
        "eventName: \"battleDamageDealt\"",
        "eventReason: duelReason.battle",
        "eventReasonCardUid: hayate!.uid",
        "eventReasonPlayer: 0",
        "eventReasonEffectId: 3",
      ],
    },
    {
      file: "test/lua-real-script-basilisk-battled-target-destroy.test.ts",
      kind: "heraldicBeastBasiliskAfterDamageBattleTargetDestroy",
      required: [
        "restores its GetBattleTarget EVENT_BATTLED trigger and destroys the battled monster",
        "return e:GetHandler():GetBattleTarget()~=nil",
        "Duel.SetTargetCard(tc)",
        "Duel.Destroy(tc,REASON_EFFECT)",
        "eventName: \"afterDamageCalculation\"",
        "eventName: \"battleDamageDealt\"",
        "eventReason: duelReason.battle",
        "eventReasonCardUid: battleTarget!.uid",
        "eventReasonPlayer: 1",
        "eventName: \"destroyed\"",
      ],
    },
    {
      file: "test/lua-real-script-injection-fairy-lily-pre-damage-lp-boost.test.ts",
      kind: "injectionFairyLilyBeforeDamageLpBoost",
      required: [
        "restores its LP cost, damage-calculation flag, temporary ATK boost, and battle damage",
        "battleWindow?.kind).toBe(\"beforeDamageCalculation\")",
        "eventName: \"beforeDamageCalculation\"",
        "eventCode: 1134",
        "Duel.PayLPCost(tp,2000)",
        "battleDamage).toEqual({ 0: 0, 1: 1400 })",
        "eventName: \"battleDamageDealt\"",
        "eventReasonCardUid: lily.uid",
      ],
    },
    {
      file: "test/lua-real-script-insect-princess-battled-flag-atk.test.ts",
      kind: "insectPrincessBattledFlagAtk",
      required: [
        "restores EVENT_BATTLED flag state into its battle-destroying ATK gain trigger",
        "RegisterFlagEffect(id,RESET_PHASE|PHASE_DAMAGE,0,1)",
        "e3:SetCode(EVENT_BATTLE_DESTROYING)",
        "eventName: \"battleDestroyed\"",
        "insect princess attack 2400",
        "insect princess battle flag 1",
      ],
    },
    {
      file: "test/lua-real-script-kuriboh-pre-damage-prevent.test.ts",
      kind: "kuribohBeforeDamagePrevent",
      required: ["restores its before-damage hand Quick Effect and prevents battle damage after self-discard cost", "triggerEvent: \"beforeDamageCalculation\"", "battleDamage).toEqual({ 0: 0, 1: 0 })"],
    },
    {
      file: "test/lua-real-script-kuribon-pre-damage-recover-return.test.ts",
      kind: "kuribonBeforeDamageRecoverReturn",
      required: [
        "restores its attacked-target pre-damage recovery, battle-damage prevention, and self return to hand",
        "Duel.GetAttackTarget()==e:GetHandler() and Duel.GetBattleDamage(tp)>0",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
        "eventName: \"beforeDamageCalculation\"",
        "eventName: \"recoveredLifePoints\"",
        "eventName: \"sentToHand\"",
      ],
    },
    {
      file: "test/lua-real-script-madolche-waltz-battled-field-damage.test.ts",
      kind: "madolcheWaltzAfterDamageFieldBurn",
      required: [
        "restores its Spell/Trap-zone EVENT_BATTLED field trigger into target-param effect damage",
        "e2:SetRange(LOCATION_SZONE)",
        "e2:SetCode(EVENT_BATTLED)",
        "c:IsSetCard(SET_MADOLCHE)",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
        "eventName: \"afterDamageCalculation\"",
        "battleDamage).toEqual({ 0: 0, 1: 500 })",
        "eventName: \"battleDamageDealt\"",
        "eventValue: 500",
        "eventReason: duelReason.battle",
        "eventReasonCardUid: attacker!.uid",
        "eventReasonPlayer: 0",
        "eventName: \"damageDealt\"",
      ],
    },
    {
      file: "test/lua-real-script-mirage-knight-battle-target-atk.test.ts",
      kind: "mirageKnightDuringDamageAtkBanish",
      required: ["restores GetBattleTarget damage-calculation ATK and End Phase self-banish after battle", "battleWindow?.kind).toBe(\"duringDamageCalculation\")", "eventName: \"banished\""],
    },
    {
      file: "test/lua-real-script-nightmare-magician-battle-control.test.ts",
      kind: "nightmareMagicianEndDamageControl",
      required: [
        "restores battle-target indestructibility and controls the battled monster at Damage Step end",
        "triggerBucket: \"turnOptional\"",
        "eventName: \"battleDamageDealt\"",
        "eventReason: duelReason.battle",
        "eventReasonCardUid: nightmare!.uid",
        "eventReasonPlayer: 0",
        "previousController: 1",
      ],
    },
    {
      file: "test/lua-real-script-predaplant-sarraceniant-battled-destroy.test.ts",
      kind: "predaplantSarraceniantAfterDamageDestroy",
      required: [
        "restores its EVENT_BATTLED trigger and destroys the monster it battled",
        "eventCode: 1138",
        "eventName: \"battleDamageDealt\"",
        "eventReason: duelReason.battle",
        "eventReasonCardUid: sarraceniant!.uid",
        "eventReasonPlayer: 0",
        "reasonEffectId: 2",
      ],
    },
    {
      file: "test/lua-real-script-power-wall-pre-damage-deck-mill-shield.test.ts",
      kind: "powerWallBeforeDamageDeckMillShield",
      required: ["restores pre-damage battle damage lookup, Deck discard, operated group, and damage prevention", "battleWindow?.kind).toBe(\"beforeDamageCalculation\")", "eventCode: 1134", "Duel.GetBattleDamage(tp)", "Duel.GetOperatedGroup()"],
    },
    {
      file: "test/lua-real-script-reflect-bounder-battle-confirm-destroy.test.ts",
      kind: "reflectBounderStartAndAfterDamageDestroy",
      required: ["restores battle-confirm damage into a later battled self-destruction trigger", "eventName: \"battleConfirmed\"", "eventName: \"afterDamageCalculation\""],
    },
    {
      file: "test/lua-real-script-zone-eater-delayed-battle-destroy.test.ts",
      kind: "zoneEaterAfterDamageDelayedDestroy",
      required: [
        "restores battled target markers and destroys the marked monster on the fifth End Phase",
        "eventName: \"afterDamageCalculation\"",
        "eventCode: 1138",
        "eventName: \"battleDamageDealt\"",
        "eventReason: duelReason.battle",
        "eventReasonCardUid: target.uid",
        "eventReasonPlayer: 1",
        "eventName: \"destroyed\"",
      ],
    },
    {
      file: "test/lua-real-script-drillroid-battle-confirm-destroy.test.ts",
      kind: "drillroidBattleConfirmDestroy",
      required: ["restores battle-confirm defense-target destruction and ends the pending battle", "Duel.GetAttackTarget()", "Duel.Destroy(t,REASON_EFFECT)", "eventName: \"battleConfirmed\"", "eventName: \"destroyed\""],
    },
    {
      file: "test/lua-real-script-sasuke-samurai-battle-start-destroy.test.ts",
      kind: "sasukeSamuraiStartDamageDestroy",
      required: ["restores its EVENT_BATTLE_START mandatory trigger and destroys the face-down Defense target", "battleWindow?.kind).toBe(\"startDamageStep\")", 'eventTriggerTiming: "when"', "eventName: \"destroyed\""],
    },
    {
      file: "test/lua-real-script-sanga-pre-damage-final-attack.test.ts",
      kind: "sangaBeforeDamageFinalAttack",
      required: [
        "restores optional pre-damage calculation final-ATK Quick Effect activation",
        "e1:SetCode(EFFECT_SET_ATTACK_FINAL)",
        "e1:SetValue(0)",
        "eventName: \"beforeDamageCalculation\"",
        "eventCode: 1134",
        "currentAttack(restoredFinalAttack.session.state.cards.find((card) => card.uid === attacker.uid), restoredFinalAttack.session.state)).toBe(0)",
        "battleDamage).toEqual({ 0: sanga.data.attack, 1: 0 })",
        "eventName: \"battleDamageDealt\"",
        "eventReasonCardUid: sanga.uid",
      ],
    },
    {
      file: "test/lua-real-script-shadow-spell-goat-damage-calculation-persistent.test.ts",
      kind: "shadowSpellDuringDamagePersistentStat",
      required: ["restores a damage-calculation persistent target into ATK loss before battle damage", "battleWindow?.kind).toBe(\"duringDamageCalculation\")", "shadow spell persistent true/true/1/1500"],
    },
    {
      file: "test/lua-real-script-shinobird-crow-damage-step-stat.test.ts",
      kind: "shinobirdCrowStartDamageStatBoost",
      required: ["restores its Damage Step discard label object and applies the ATK/DEF boost", "battleWindow?.kind).toBe(\"startDamageStep\")", "effectLabelObjectUid"],
    },
    {
      file: "test/lua-real-script-smoke-mosquito-pre-damage-half-battle-damage.test.ts",
      kind: "smokeMosquitoBeforeDamageHalfDamageSummon",
      required: ["restores pre-damage self Special Summon, temporary HALF_DAMAGE battle modifier, and battle skip", "battleWindow?.kind).not.toBe(\"replayDecision\")", "EFFECT_CHANGE_BATTLE_DAMAGE", "HALF_DAMAGE", "battleDamage).toEqual({ 0: 750, 1: 0 })"],
    },
    {
      file: "test/lua-real-script-spear-dragon-pierce-battle-end-position.test.ts",
      kind: "spearDragonEndDamagePiercePosition",
      required: ["restores piercing battle damage into its end Damage Step Defense Position change", "e1:SetCode(EVENT_DAMAGE_STEP_END)", "e2:SetCode(EFFECT_PIERCE)", "eventName: \"damageStepEnded\"", "eventName: \"battleDamageDealt\""],
    },
    {
      file: "test/lua-real-script-skyscraper-damage-calculation-stat.test.ts",
      kind: "skyscraperDuringDamageFieldStatBoost",
      required: [
        "restores PHASE_DAMAGE_CAL attacker-vs-target field ATK boost into battle damage",
        "eventCode: 1135",
        "stat:damage-calculation-attacker-lower-than-target:+1000",
      ],
    },
    {
      file: "test/lua-real-script-steamroid-battle-swing-stat.test.ts",
      kind: "steamroidDuringDamageBattleSwingStat",
      required: [
        "restores Damage Step attacker boost and defender loss callbacks into battle damage",
        "stat:battle-attacker-target-swing:500:-500",
        "eventName: \"damageCalculating\"",
        "eventCode: 1135",
        "eventUids: [attacking.steamroid.uid, attacking.opposing.uid]",
        "eventUids: [defending.opposing.uid, defending.steamroid.uid]",
      ],
    },
    {
      file: "test/lua-real-script-topologic-bomber-battled-damage.test.ts",
      kind: "topologicBomberAfterDamageBurn",
      required: [
        "restores its EVENT_BATTLED trigger and deals effect damage from the battle target's base ATK",
        "eventName: \"battleDamageDealt\"",
        "eventReason: duelReason.battle",
        "eventReasonCardUid: bomber!.uid",
        "eventReasonPlayer: 0",
        "eventName: \"damageDealt\"",
        "eventValue: 1200",
      ],
    },
    {
      file: "test/lua-real-script-turbo-rocket-battled-damage.test.ts",
      kind: "turboRocketAfterDamageGetAttackTargetBurn",
      required: [
        "restores its GetAttackTarget EVENT_BATTLED burn after battle damage with attacker battle indestructibility",
        "Duel.GetAttackTarget():GetAttack()/2",
        "e2:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)",
        "eventName: \"battleDamageDealt\"",
        "eventReason: duelReason.battle",
        "eventReasonCardUid: target!.uid",
        "eventReasonPlayer: 1",
        "eventName: \"damageDealt\"",
        "eventValue: 1000",
        "eventName === \"battleDestroyed\"",
      ],
    },
    {
      file: "test/lua-real-script-wall-of-illusion-battled.test.ts",
      kind: "wallOfIllusionAfterDamageBounce",
      required: ["restores Wall of Illusion after damage calculation and returns its attacker to hand", "triggerBucket: \"opponentMandatory\"", "eventName: \"sentToHand\""],
    },
  ] satisfies Array<{
    file: string;
    kind: BattleTimingSemanticVariant;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countBattleTimingSemanticVariants(
  fixtures: Array<{ kind: BattleTimingSemanticVariant }>,
): Record<BattleTimingSemanticVariant, number> {
  return fixtures.reduce<Record<BattleTimingSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      allyOfJusticeNullfierAfterDamageDisable: 0,
      aojOmniWeaponBattledLabelDrawSummon: 0,
      bigShieldGardnaEndDamageStepPosition: 0,
      blackwingArmorMasterEndDamageCounterStat: 0,
      chimeraIllusionBeastEndDamageDisable: 0,
      cipherSoldierBeforeDamageCalculationBoost: 0,
      ddAssailantAfterDamageBanishBoth: 0,
      ddWarriorWallMandatoryBattledSegoc: 0,
      darkRulerHaDesAfterDamageContinuousDisable: 0,
      desKangarooEndDamageDestroy: 0,
      destructionPunchEndDamageTrapDestroy: 0,
      divineKnightIshzarkAfterDamageBanish: 0,
      dracoonLampChangeBattleStat: 0,
      ehrenBattleConfirmToDeck: 0,
      elementDoomAfterDamageAttributeDisable: 0,
      drillroidBattleConfirmDestroy: 0,
      fabledAshenveilPreDamageBoost: 0,
      geminiSoldierAfterDamageDeckSummon: 0,
      getsuFuhmaEndDamageTargetDestroy: 0,
      gundariStartDamageSynchroBounce: 0,
      hayateAfterDamageDeckSend: 0,
      heraldicBeastBasiliskAfterDamageBattleTargetDestroy: 0,
      injectionFairyLilyBeforeDamageLpBoost: 0,
      insectPrincessBattledFlagAtk: 0,
      kuribohBeforeDamagePrevent: 0,
      kuribonBeforeDamageRecoverReturn: 0,
      madolcheWaltzAfterDamageFieldBurn: 0,
      mirageKnightDuringDamageAtkBanish: 0,
      nightmareMagicianEndDamageControl: 0,
      predaplantSarraceniantAfterDamageDestroy: 0,
      powerWallBeforeDamageDeckMillShield: 0,
      reflectBounderStartAndAfterDamageDestroy: 0,
      zoneEaterAfterDamageDelayedDestroy: 0,
      sasukeSamuraiStartDamageDestroy: 0,
      sangaBeforeDamageFinalAttack: 0,
      shadowSpellDuringDamagePersistentStat: 0,
      shinobirdCrowStartDamageStatBoost: 0,
      smokeMosquitoBeforeDamageHalfDamageSummon: 0,
      spearDragonEndDamagePiercePosition: 0,
      skyscraperDuringDamageFieldStatBoost: 0,
      steamroidDuringDamageBattleSwingStat: 0,
      topologicBomberAfterDamageBurn: 0,
      turboRocketAfterDamageGetAttackTargetBurn: 0,
      wallOfIllusionAfterDamageBounce: 0,
    },
  );
}

function countBattleTimingKinds(fixtures: Array<{ kind: BattleTimingKind }>): Record<BattleTimingKind, number> {
  return fixtures.reduce<Record<BattleTimingKind, number>>(
    (counts, { kind }) => ({ ...counts, [kind]: counts[kind] + 1 }),
    { afterDamageCalculation: 0, beforeDamageCalculation: 0, duringDamageCalculation: 0, endDamageStep: 0, startDamageStep: 0 },
  );
}

function battleTimingFixtureFiles(): Array<{ file: string; kind: BattleTimingKind; required: string[] }> {
  return ([
    {
      file: "test/lua-real-script-basilisk-battled-target-destroy.test.ts",
      kind: "afterDamageCalculation",
      required: [
        'battleWindow?.kind).toBe("afterDamageCalculation")',
        'eventName: "afterDamageCalculation"',
        "eventCode: 1138",
        'triggerBucket: "turnMandatory"',
        'eventName: "battleDamageDealt"',
        'eventName: "destroyed"',
        "eventReasonEffectId: 1",
      ],
    },
    {
      file: "test/lua-real-script-ally-of-justice-nullfier-battled-disable.test.ts",
      kind: "afterDamageCalculation",
      required: [
        'battleWindow?.kind).toBe("afterDamageCalculation")',
        'eventName: "afterDamageCalculation"',
        'triggerBucket: "turnMandatory"',
        'eventName: "battleDamageDealt"',
        "target disabled true",
        '"code": 2',
        '"code": 8',
      ],
    },
    {
      file: "test/lua-real-script-aoj-omni-weapon-battled-label-draw-summon.test.ts",
      kind: "afterDamageCalculation",
      required: [
        'eventName: "afterDamageCalculation"',
        "eventCode: 1138",
        'eventName: "battleDestroyed"',
        "eventCode: 1140",
        'eventName: "cardsDrawn"',
        'eventName: "specialSummoned"',
        "eventReasonEffectId: 2",
        "api: \"SelectYesNo\"",
      ],
    },
    {
      file: "test/lua-real-script-big-shield-gardna-damage-step-position.test.ts",
      kind: "endDamageStep",
      required: [
        'battleWindow?.kind).toBe("endDamageStep")',
        'eventName: "damageStepEnded"',
        "eventCode: 1141",
        'eventName: "battleDamageDealt"',
        'eventName: "positionChanged"',
        "eventCode: 1016",
        "eventReasonEffectId: 2",
        'position: "faceUpAttack"',
      ],
    },
    {
      file: "test/lua-real-script-blackwing-armor-master-counter-stat.test.ts",
      kind: "endDamageStep",
      required: [
        'battleWindow?.kind).toBe("endDamageStep")',
        'eventName: "damageStepEnded"',
        "eventCode: 1141",
        "eventPlayer: 0",
        'eventTriggerTiming: "when"',
        'triggerBucket: "turnOptional"',
        "eventName: \"counterAdded\"",
        "currentAttack(restoredFinalStats.session.state.cards.find((card) => card.uid === target.uid), restoredFinalStats.session.state)).toBe(0)",
        "currentDefense(restoredFinalStats.session.state.cards.find((card) => card.uid === target.uid), restoredFinalStats.session.state)).toBe(0)",
      ],
    },
    {
      file: "test/lua-real-script-chimera-illusion-beast-damage-end-disable.test.ts",
      kind: "endDamageStep",
      required: [
        'battleWindow?.kind).toBe("endDamageStep")',
        'eventName: "damageStepEnded"',
        "eventCode: 1141",
        'eventTriggerTiming: "when"',
        'triggerBucket: "turnOptional"',
        'eventName: "battleDamageDealt"',
        "currentAttack(disabledTarget, restoredTrigger.session.state)).toBe(0)",
        "isCardDisabled(restoredTrigger.session.state, disabledTarget",
      ],
    },
    {
      file: "test/lua-real-script-cipher-soldier-pre-damage-calculate.test.ts",
      kind: "beforeDamageCalculation",
      required: [
        'battleWindow?.kind).toBe("beforeDamageCalculation")',
        'eventName: "beforeDamageCalculation"',
        "eventCode: 1134",
        "currentAttack(restored.session.state.cards.find((card) => card.uid === cipherSoldier!.uid), restored.session.state)).toBe(3350)",
        'location: "monsterZone", controller: 1',
      ],
    },
    {
      file: "test/lua-real-script-dark-ruler-ha-des-battled-disable.test.ts",
      kind: "afterDamageCalculation",
      required: [
        'eventName: "afterDamageCalculation"',
        "eventCode: 1138",
        "ha des target disabled true",
        'eventName: "battleDestroyed"',
        "reasonCardUid: haDes!.uid",
      ],
    },
    {
      file: "test/lua-real-script-dd-warrior-wall-battled-segoc.test.ts",
      kind: "afterDamageCalculation",
      required: [
        'eventName: "afterDamageCalculation"',
        'eventName: "battleDamageDealt"',
        "triggerBucket: \"turnMandatory\"",
        "triggerBucket: \"opponentMandatory\"",
        'location: "hand", controller: 0',
        'location: "banished", controller: 1',
      ],
    },
    {
      file: "test/lua-real-script-dd-assailant-battled-remove.test.ts",
      kind: "afterDamageCalculation",
      required: [
        'battleWindow?.kind).toBe("afterDamageCalculation")',
        'eventName: "afterDamageCalculation"',
        'triggerBucket: "opponentMandatory"',
        'eventName: "banished"',
        'location: "banished"',
        'eventName === "battleDestroyed"',
      ],
    },
    {
      file: "test/lua-real-script-des-kangaroo-damage-step-end.test.ts",
      kind: "endDamageStep",
      required: [
        'battleWindow?.kind).toBe("endDamageStep")',
        'eventName: "damageStepEnded"',
        'eventName: "battleDamageDealt"',
        'eventName: "destroyed"',
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-destruction-punch-damage-step-end.test.ts",
      kind: "endDamageStep",
      required: [
        'battleWindow?.kind).toBe("endDamageStep")',
        'eventName: "damageStepEnded"',
        'eventName: "battleDamageDealt"',
        'eventName: "destroyed"',
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-divine-knight-ishzark-battled-remove.test.ts",
      kind: "afterDamageCalculation",
      required: [
        'battleWindow?.kind).toBe("afterDamageCalculation")',
        'eventName: "afterDamageCalculation"',
        'triggerBucket: "turnMandatory"',
        'eventName: "banished"',
        'location: "banished"',
        'eventName === "battleDestroyed"',
      ],
    },
    {
      file: "test/lua-real-script-ehren-battle-confirm-to-deck.test.ts",
      kind: "startDamageStep",
      required: ['battleWindow?.kind).toBe("startDamageStep")', 'eventName: "battleConfirmed"', "eventCode: 1133", 'eventName: "sentToDeck"', "eventCode: 1013", "pendingBattle).toBeUndefined()"],
    },
    {
      file: "test/lua-real-script-drillroid-battle-confirm-destroy.test.ts",
      kind: "startDamageStep",
      required: [
        "restores battle-confirm defense-target destruction and ends the pending battle",
        'battleWindow?.kind).toBe("startDamageStep")',
        'eventName: "battleConfirmed"',
        "eventCode: 1133",
        'eventName: "destroyed"',
        "eventCode: 1029",
        "pendingBattle).toBeUndefined()",
      ],
    },
    {
      file: "test/lua-real-script-element-doom-chain-attack.test.ts",
      kind: "afterDamageCalculation",
      required: [
        'eventName: "afterDamageCalculation"',
        "eventCode: 1138",
        '"code": 2',
        '"code": 8',
        "isCardDisabled(restored.session.state, restoredDefeatedTarget!",
        'eventName: "battleDestroyed"',
        "eventCode: 1140",
        'type: "declareAttack"',
      ],
    },
    {
      file: "test/lua-real-script-fabled-ashenveil-damage-step-boost.test.ts",
      kind: "beforeDamageCalculation",
      required: [
        'battleWindow?.kind).toBe("startDamageStep")',
        'battleWindow?.kind).toBe("beforeDamageCalculation")',
        'eventName: "sentToGraveyard"',
        "eventReasonEffectId: 1",
        "currentAttack(boostedAshenveil, restoredChain.session.state)).toBe((ashenveil.data.attack ?? 0) + 600)",
        "battleDamage[1]).toBe((ashenveil.data.attack ?? 0) + 600 - (defender.data.attack ?? 0))",
        'eventName: "battleDamageDealt"',
      ],
    },
    {
      file: "test/lua-real-script-injection-fairy-lily-pre-damage-lp-boost.test.ts",
      kind: "beforeDamageCalculation",
      required: [
        'battleWindow?.kind).toBe("beforeDamageCalculation")',
        'eventName: "beforeDamageCalculation"',
        "eventCode: 1134",
        "eventCardUid: lily.uid",
        "Duel.PayLPCost(tp,2000)",
        "currentAttack(boostedLily, restoredDamageStep.session.state)).toBe(3400)",
        "battleDamage).toEqual({ 0: 0, 1: 1400 })",
        'eventName: "battleDamageDealt"',
      ],
    },
    {
      file: "test/lua-real-script-insect-princess-battled-flag-atk.test.ts",
      kind: "afterDamageCalculation",
      required: [
        'eventName: "afterDamageCalculation"',
        "eventCode: 1138",
        'eventName: "battleDestroyed"',
        "eventCode: 1140",
        "eventReasonCardUid: insectPrincess!.uid",
        "insect princess attack 2400",
      ],
    },
    {
      file: "test/lua-real-script-madolche-waltz-battled-field-damage.test.ts",
      kind: "afterDamageCalculation",
      required: [
        'battleWindow?.kind).toBe("afterDamageCalculation")',
        'eventName: "afterDamageCalculation"',
        'eventName: "battleDamageDealt"',
        "eventCode: 1138",
        "eventCardUid: attacker!.uid",
        'eventName: "damageDealt"',
        "eventValue: 300",
      ],
    },
    {
      file: "test/lua-real-script-gundari-battle-start-synchro-bounce.test.ts",
      kind: "startDamageStep",
      required: [
        "restoredSetup.missingRegistryKeys).toEqual([])",
        "restoredSetup.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTrigger.missingRegistryKeys).toEqual([])",
        "restoredTrigger.missingChainLimitRegistryKeys).toEqual([])",
        'battleWindow?.kind).toBe("startDamageStep")',
        'eventName: "battleStarted"',
        'eventName: "sentToHand"',
        "pendingBattle).toBeUndefined()",
      ],
    },
    {
      file: "test/lua-real-script-sasuke-samurai-battle-start-destroy.test.ts",
      kind: "startDamageStep",
      required: [
        "restoredSetup.missingRegistryKeys).toEqual([])",
        "restoredSetup.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTrigger.missingRegistryKeys).toEqual([])",
        "restoredTrigger.missingChainLimitRegistryKeys).toEqual([])",
        'battleWindow?.kind).toBe("startDamageStep")',
        'eventName: "battleStarted"',
        'eventTriggerTiming: "when"',
        'eventPreviousState: {',
        'eventName: "destroyed"',
        "eventReasonEffectId: 1",
      ],
    },
    {
      file: "test/lua-real-script-getsu-fuhma-damage-step-end.test.ts",
      kind: "endDamageStep",
      required: [
        'battleWindow?.kind).toBe("endDamageStep")',
        'eventName: "damageStepEnded"',
        "effectLabelObjectUid",
        "battleDamage).toEqual({ 0: 300, 1: 0 })",
        'eventName: "battleDamageDealt"',
        'eventName: "destroyed"',
        "eventReasonEffectId: 1",
      ],
    },
    {
      file: "test/lua-real-script-gemini-soldier-battled-deck-summon.test.ts",
      kind: "afterDamageCalculation",
      required: [
        'battleWindow?.kind).toBe("afterDamageCalculation")',
        'eventName: "afterDamageCalculation"',
        'triggerBucket: "turnOptional"',
        "operationInfos",
        'eventName: "specialSummoned"',
        'eventName: "battleDamageDealt"',
      ],
    },
    {
      file: "test/lua-real-script-hayate-battled-send.test.ts",
      kind: "afterDamageCalculation",
      required: [
        'battleWindow?.kind).toBe("afterDamageCalculation")',
        'eventName: "afterDamageCalculation"',
        'triggerBucket: "turnOptional"',
        'eventName: "sentToGraveyard"',
        'location: "graveyard"',
        "eventReasonEffectId: 3",
      ],
    },
    {
      file: "test/lua-real-script-kuriboh-pre-damage-prevent.test.ts",
      kind: "beforeDamageCalculation",
      required: [
        'battleWindow?.kind).toBe("beforeDamageCalculation")',
        'triggerEvent: "beforeDamageCalculation"',
        "targetRange: [1, 0]",
        "battleDamage).toEqual({ 0: 0, 1: 0 })",
        'eventName: "battleDamageDealt", eventPlayer: 0',
        "pendingBattle).toBeUndefined()",
      ],
    },
    {
      file: "test/lua-real-script-kuribon-pre-damage-recover-return.test.ts",
      kind: "beforeDamageCalculation",
      required: [
        'battleWindow?.kind).toBe("beforeDamageCalculation")',
        'eventName: "beforeDamageCalculation"',
        "eventCode: 1134",
        "Duel.SetTargetPlayer(1-tp)",
        "Duel.SetTargetParam(val)",
        'eventName: "recoveredLifePoints"',
        'eventName: "sentToHand"',
        "battleDamage).toEqual({ 0: 0, 1: 0 })",
      ],
    },
    {
      file: "test/lua-real-script-power-wall-pre-damage-deck-mill-shield.test.ts",
      kind: "beforeDamageCalculation",
      required: [
        'battleWindow?.kind).toBe("beforeDamageCalculation")',
        'eventName: "beforeDamageCalculation"',
        "eventCode: 1134",
        "Duel.GetBattleDamage(tp)",
        "Duel.DiscardDeck(tp,val,REASON_EFFECT)",
        "Duel.GetOperatedGroup()",
        "battleDamage).toEqual({ 0: 0, 1: 0 })",
      ],
    },
    {
      file: "test/lua-real-script-sanga-pre-damage-final-attack.test.ts",
      kind: "beforeDamageCalculation",
      required: [
        'battleWindow?.kind).toBe("beforeDamageCalculation")',
        'eventName: "beforeDamageCalculation"',
        "eventCode: 1134",
        "eventCardUid: attacker.uid",
        "eventUids: [attacker.uid, sanga.uid]",
        "e1:SetCode(EFFECT_SET_ATTACK_FINAL)",
        "e1:SetValue(0)",
        "currentAttack(restoredActivation.session.state.cards.find((card) => card.uid === attacker.uid), restoredActivation.session.state)).toBe(0)",
        "battleDamage).toEqual({ 0: sanga.data.attack, 1: 0 })",
        'eventName: "battleDamageDealt"',
      ],
    },
    {
      file: "test/lua-real-script-smoke-mosquito-pre-damage-half-battle-damage.test.ts",
      kind: "beforeDamageCalculation",
      required: [
        'battleWindow?.kind).toBe("beforeDamageCalculation")',
        'eventName: "beforeDamageCalculation"',
        "eventCode: 1134",
        "EFFECT_CHANGE_BATTLE_DAMAGE",
        "HALF_DAMAGE",
        "battleDamage).toEqual({ 0: 750, 1: 0 })",
      ],
    },
    {
      file: "test/lua-real-script-mirage-knight-battle-target-atk.test.ts",
      kind: "duringDamageCalculation",
      required: [
        'battleWindow?.kind).toBe("duringDamageCalculation")',
        'eventName: "battleDamageDealt"',
        'eventName: "banished"',
      ],
    },
    {
      file: "test/lua-real-script-nightmare-magician-battle-control.test.ts",
      kind: "endDamageStep",
      required: [
        'battleWindow?.kind).toBe("endDamageStep")',
        'eventName: "damageStepEnded"',
        'triggerBucket: "turnOptional"',
        'luaTargetDescriptor: "target:source-or-battle-target"',
        'eventName: "battleDamageDealt"',
        "targetCardPredicate).toBeDefined()",
        "previousController: 1",
      ],
    },
    {
      file: "test/lua-real-script-spear-dragon-pierce-battle-end-position.test.ts",
      kind: "endDamageStep",
      required: ['battleWindow?.kind).toBe("endDamageStep")', 'eventName: "damageStepEnded"', 'eventCode: 1141', 'eventName: "battleDamageDealt"', "battleDamage).toEqual({ 0: 0, 1: 900 })"],
    },
    {
      file: "test/lua-real-script-shadow-spell-goat-damage-calculation-persistent.test.ts",
      kind: "duringDamageCalculation",
      required: [
        'battleWindow?.kind).toBe("duringDamageCalculation")',
        "getLuaRestoreLegalActionGroups(restoredDamageCalculation, 0)",
        "shadow spell persistent true/true/1/1500",
        "battleDamage[0]).toBe(500)",
        'location: "spellTrapZone"',
      ],
    },
    {
      file: "test/lua-real-script-dracoon-lamp-change-battle-stat.test.ts",
      kind: "duringDamageCalculation",
      required: [
        'battleWindow?.kind).toBe("duringDamageCalculation")',
        'eventName: "damageCalculating"',
        "eventCode: 1135",
        "EFFECT_CHANGE_BATTLE_STAT",
        "currentAttack(restoredDamageCalculation.session.state.cards.find((card) => card.uid === dracoon!.uid), restoredDamageCalculation.session.state)).toBe(2000)",
        "currentAttack(restoredDamageCalculation.session.state.cards.find((card) => card.uid === attacker!.uid), restoredDamageCalculation.session.state)).toBe(400)",
      ],
    },
    {
      file: "test/lua-real-script-skyscraper-damage-calculation-stat.test.ts",
      kind: "duringDamageCalculation",
      required: [
        'battleWindow?.kind).toBe("duringDamageCalculation")',
        'eventName: "damageCalculating"',
        "eventCode: 1135",
        "currentAttack(restoredHero, restoredDamageCalculation.session.state)).toBe(2600)",
        "battleDamage).toEqual({ 0: 0, 1: 700 })",
        "eventName: \"battleDamageDealt\"",
        "eventReason: duelReason.battle",
        "eventReasonCardUid: hero!.uid",
        "eventReasonPlayer: 0",
      ],
    },
    {
      file: "test/lua-real-script-steamroid-battle-swing-stat.test.ts",
      kind: "duringDamageCalculation",
      required: [
        'battleWindow?.kind).toBe("duringDamageCalculation")',
        'eventName: "damageCalculating"',
        "eventCode: 1135",
        "eventCardUid: attacking.steamroid.uid",
        "eventCardUid: defending.opposing.uid",
        "currentAttack(restoredAttackingSteamroid, restoredAttacking.session.state)).toBe((attacking.steamroid.data.attack ?? 0) + 500)",
        "currentAttack(restoredDefendingSteamroid, restoredDefending.session.state)).toBe((defending.steamroid.data.attack ?? 0) - 500)",
        "battleDamage).toEqual({ 0: 0, 1: 300 })",
        "battleDamage).toEqual({ 0: 500, 1: 0 })",
        "eventName: \"battleDamageDealt\"",
        "eventReason: duelReason.battle",
        "eventReasonCardUid: attacking.steamroid.uid",
        "eventReasonCardUid: defending.opposing.uid",
        "eventReasonPlayer: 0",
        "eventReasonPlayer: 1",
      ],
    },
    {
      file: "test/lua-real-script-shinobird-crow-damage-step-stat.test.ts",
      kind: "startDamageStep",
      required: [
        'battleWindow?.kind).toBe("startDamageStep")',
        'eventName: "discarded"',
        'eventName: "sentToGraveyard"',
        "effectLabelObjectUid",
        "currentAttack(restoredCrow, restoredChain.session.state)).toBe(700)",
        "battleDamage[1]).toBe(200)",
        'eventName: "battleDamageDealt"',
      ],
    },
    {
      file: "test/lua-real-script-predaplant-sarraceniant-battled-destroy.test.ts",
      kind: "afterDamageCalculation",
      required: [
        'battleWindow?.kind).toBe("afterDamageCalculation")',
        'eventName: "afterDamageCalculation"',
        "eventCode: 1138",
        'eventName: "battleDamageDealt"',
        'eventName: "destroyed"',
        "reasonEffectId: 2",
      ],
    },
    {
      file: "test/lua-real-script-zone-eater-delayed-battle-destroy.test.ts",
      kind: "afterDamageCalculation",
      required: [
        'eventName: "afterDamageCalculation"',
        "eventCode: 1138",
        "bc:RegisterEffect(e1)",
        "e3:SetCode(EVENT_PHASE+PHASE_END)",
        'eventName: "battleDamageDealt"',
        'eventName: "destroyed"',
      ],
    },
    {
      file: "test/lua-real-script-reflect-bounder-battle-confirm-destroy.test.ts",
      kind: "afterDamageCalculation",
      required: [
        'battleWindow?.kind).toBe("startDamageStep")',
        'eventName: "battleConfirmed"',
        "eventCode: 1133",
        'battleWindow?.kind).toBe("afterDamageCalculation")',
        'eventName: "afterDamageCalculation"',
        "eventCode: 1138",
      ],
    },
    {
      file: "test/lua-real-script-topologic-bomber-battled-damage.test.ts",
      kind: "afterDamageCalculation",
      required: [
        'battleWindow?.kind).toBe("afterDamageCalculation")',
        'eventName: "afterDamageCalculation"',
        'eventName: "battleDamageDealt"',
        "eventReason: duelReason.battle",
        "eventReasonCardUid: bomber!.uid",
        "eventReasonPlayer: 0",
        'eventName: "damageDealt"',
        "eventValue: 1200",
        "pendingBattle).toBeUndefined()",
      ],
    },
    {
      file: "test/lua-real-script-turbo-rocket-battled-damage.test.ts",
      kind: "afterDamageCalculation",
      required: [
        'battleWindow?.kind).toBe("afterDamageCalculation")',
        'eventName: "afterDamageCalculation"',
        "eventCode: 1138",
        'eventName: "battleDamageDealt"',
        "eventReason: duelReason.battle",
        "eventReasonCardUid: target!.uid",
        "eventReasonPlayer: 1",
        'eventName: "damageDealt"',
        "eventValue: 1000",
        "deferredBattleDestroyed ?? []).toEqual([])",
        "pendingBattle).toBeUndefined()",
      ],
    },
    {
      file: "test/lua-real-script-wall-of-illusion-battled.test.ts",
      kind: "afterDamageCalculation",
      required: [
        'battleWindow?.kind).toBe("afterDamageCalculation")',
        'eventName: "afterDamageCalculation"',
        'eventName: "battleDamageDealt"',
        "eventReason: duelReason.battle",
        "eventReasonCardUid: wall!.uid",
        "eventReasonPlayer: 1",
        'triggerBucket: "opponentMandatory"',
        'eventName: "sentToHand"',
        'location: "hand"',
        "eventReasonEffectId: 1",
      ],
    },
  ] satisfies Array<{ file: string; kind: BattleTimingKind; required: string[] }>).sort((a, b) => a.file.localeCompare(b.file));
}

function requiresActivatedTrigger(file: string): boolean {
  return ![
    "test/lua-real-script-big-shield-gardna-damage-step-position.test.ts",
    "test/lua-real-script-dark-ruler-ha-des-battled-disable.test.ts",
  ].includes(file);
}
