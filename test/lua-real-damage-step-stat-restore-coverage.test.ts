import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const damageStepStatFixtureCount = 14;
const damageStepStatKindCounts = {
  activatedDamageStepBaseAttackZero: 1,
  activatedDamageStepBoost: 7,
  activatedDamageStepLpFinalAttackDamageHalf: 1,
  labelObjectCostBoost: 1,
  mandatoryPreDamageBoost: 3,
  persistentDamageStepDebuff: 1,
} satisfies Record<DamageStepStatKind, number>;
const damageStepStatSemanticVariantCounts = {
  alchemyCycleBaseAttackBattleDraw: 1,
  adhilsaberHandDiscardDamageStepStat: 1,
  appliancerCeltopusColinkPreDamageBoost: 1,
  cipherSoldierMandatoryPreDamageBoost: 1,
  fabledAshenveilDamageStepHandCostBoost: 1,
  gamilDefenderBranchSelfToGraveBoost: 1,
  injectionFairyLilyPreDamageLpBoost: 1,
  lifeHackLpFinalAttackDamageHalf: 1,
  miniaturizePersistentDamageStepDebuff: 1,
  reliableGuardianTargetedDamageStepDefenseUpdate: 1,
  rushRecklesslyTargetedDamageStepBoost: 1,
  shinobirdCrowLabelObjectCostBoost: 1,
  soulUnionDamageStepHeroStat: 1,
  sevenWeaponsAnnounceRacePreDamageBoost: 1,
} satisfies Record<DamageStepStatSemanticVariant, number>;

type DamageStepStatKind =
  | "activatedDamageStepBaseAttackZero"
  | "activatedDamageStepBoost"
  | "activatedDamageStepLpFinalAttackDamageHalf"
  | "labelObjectCostBoost"
  | "mandatoryPreDamageBoost"
  | "persistentDamageStepDebuff";
type DamageStepStatSemanticVariant =
  | "alchemyCycleBaseAttackBattleDraw"
  | "adhilsaberHandDiscardDamageStepStat"
  | "appliancerCeltopusColinkPreDamageBoost"
  | "cipherSoldierMandatoryPreDamageBoost"
  | "fabledAshenveilDamageStepHandCostBoost"
  | "gamilDefenderBranchSelfToGraveBoost"
  | "injectionFairyLilyPreDamageLpBoost"
  | "lifeHackLpFinalAttackDamageHalf"
  | "miniaturizePersistentDamageStepDebuff"
  | "reliableGuardianTargetedDamageStepDefenseUpdate"
  | "rushRecklesslyTargetedDamageStepBoost"
  | "shinobirdCrowLabelObjectCostBoost"
  | "soulUnionDamageStepHeroStat"
  | "sevenWeaponsAnnounceRacePreDamageBoost";

describe("Lua real damage-step stat restore coverage", () => {
  it("requires damage-step stat fixtures to assert clean restore and restored battle outcome", () => {
    const files = damageStepStatFixtureFiles();
    expect(files).toHaveLength(damageStepStatFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("eventHistory")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps damage-step stat fixture kinds explicit", () => {
    expect(countDamageStepStatKinds(damageStepStatFixtureFiles())).toEqual(damageStepStatKindCounts);
  });

  it("keeps named damage-step stat semantic variants explicit", () => {
    expect(countDamageStepStatSemanticVariants(damageStepStatSemanticVariants())).toEqual(damageStepStatSemanticVariantCounts);

    const weak = damageStepStatSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });

  it("keeps damage-step stat fixtures script-gated and database-independent", () => {
    const weak = damageStepStatSemanticVariants()
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

function damageStepStatFixtureFiles(): Array<{
  file: string;
  kind: DamageStepStatKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-alchemy-cycle-base-attack-battle-draw.test.ts",
      kind: "activatedDamageStepBaseAttackZero",
      required: [
        "aux.StatChangeDamageStepCondition",
        "Duel.GetMatchingGroup(s.filter,tp,LOCATION_MZONE,0,nil)",
        "e1:SetCode(EFFECT_SET_BASE_ATTACK)",
        "tc:RegisterFlagEffect(id,RESET_EVENT|RESETS_STANDARD_EXC_GRAVE|RESET_PHASE|PHASE_END,0,1,fid)",
        "currentAttack(zeroedTarget",
        "eventName: \"battleDestroyed\"",
        "eventName: \"cardsDrawn\"",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
      ],
    },
    {
      file: "test/lua-real-script-fabled-ashenveil-damage-step-boost.test.ts",
      kind: "activatedDamageStepBoost",
      required: [
        "expectCleanRestore(restoredSetup)",
        "expectCleanRestore(restoredDamageStep)",
        "expectCleanRestore(restoredChain)",
        "expectCleanRestore(restoredBattle)",
        "currentAttack(boostedAshenveil",
        "battleDamage[1]).toBe",
        "eventName: \"battleDamageDealt\"",
        "eventReason: duelReason.battle",
        "eventReasonCardUid: ashenveil.uid",
        "eventReasonPlayer: 0",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-gamil-damage-step-self-cost-boost.test.ts",
      kind: "activatedDamageStepBoost",
      required: [
        "expectCleanRestore(restoredChain)",
        "expectCleanRestore(restoredBoost)",
        "Cost.SelfToGrave",
        "Duel.GetAttackTarget()",
        "Duel.IsTurnPlayer(1-tp)",
        "currentAttack(restoredChain.session.state.cards.find",
        "battleDamage).toEqual({ 0: 0, 1: 100 })",
        "eventName: \"battleDamageDealt\"",
        "eventValue: 100",
        "eventReason: duelReason.battle",
        "eventReasonCardUid: defender.uid",
        "eventReasonPlayer: 0",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-injection-fairy-lily-pre-damage-lp-boost.test.ts",
      kind: "activatedDamageStepBoost",
      required: [
        "expectCleanRestore(restoredSetup)",
        "expectCleanRestore(restoredDamageStep)",
        "expectCleanRestore(restoredBoost)",
        "Duel.PayLPCost(tp,2000)",
        "RegisterFlagEffect(id,RESET_PHASE|PHASE_DAMAGE_CAL,0,1)",
        "currentAttack(boostedLily",
        "battleDamage).toEqual({ 0: 0, 1: 1400 })",
        "eventName: \"battleDamageDealt\"",
        "eventReason: duelReason.battle",
        "eventReasonCardUid: lily.uid",
        "eventReasonPlayer: 0",
        "flagEffects).toEqual([])",
      ],
    },
    {
      file: "test/lua-real-script-rush-recklessly-stat-change-damage-step.test.ts",
      kind: "activatedDamageStepBoost",
      required: [
        "expectCleanRestore(restoredActivation)",
        "expectCleanRestore(restoredBoost)",
        "aux.StatChangeDamageStepCondition",
        "Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)",
        "currentAttack(restoredAttacker",
        "battleDamage).toEqual({ 0: 0, 1: 200 })",
        "eventHistory.filter((event) => event.eventName === \"battleDamageDealt\")",
      ],
    },
    {
      file: "test/lua-real-script-reliable-guardian-defense-damage-step.test.ts",
      kind: "activatedDamageStepBoost",
      required: [
        "expectCleanRestore(restoredActivation)",
        "expectCleanRestore(restoredBoost)",
        "aux.StatChangeDamageStepCondition",
        "Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)",
        "currentDefense(restoredDefender",
        "battleDamage).toEqual({ 0: 0, 1: 100 })",
        "eventHistory.filter((event) => event.eventName === \"battleDamageDealt\")",
      ],
    },
    {
      file: "test/lua-real-script-shinobird-crow-damage-step-stat.test.ts",
      kind: "labelObjectCostBoost",
      required: [
        "restoredSetup.missingRegistryKeys).toEqual([])",
        "restoredSetup.missingChainLimitRegistryKeys).toEqual([])",
        "restoredDamageStep.missingRegistryKeys).toEqual([])",
        "restoredDamageStep.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChain.missingRegistryKeys).toEqual([])",
        "restoredChain.missingChainLimitRegistryKeys).toEqual([])",
        "restoredBattle.missingRegistryKeys).toEqual([])",
        "restoredBattle.missingChainLimitRegistryKeys).toEqual([])",
        "property: 0x4000",
        "effectLabelObjectUid: costSpirit!.uid",
        "currentAttack(restoredCrow",
        "battleDamage[1]).toBe(200)",
        "eventName: \"battleDamageDealt\"",
        "eventReason: duelReason.battle",
        "eventReasonCardUid: crow!.uid",
        "eventReasonPlayer: 0",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-miniaturize-persistent-damage-step-stat.test.ts",
      kind: "persistentDamageStepDebuff",
      required: [
        "expectCleanRestore(restoredSetup)",
        "expectCleanRestore(restoredDamageStep)",
        "expectCleanRestore(restoredChain)",
        "expectCleanRestore(restoredBattle)",
        "property: 0x4000",
        "miniaturize persistent true/true/1/800/3",
        "battleDamage[0]).toBe(100)",
        "eventHistory.filter((event) => event.eventName === \"battleDamageDealt\")",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-adhilsaber-hand-discard-damage-step-stat.test.ts",
      kind: "activatedDamageStepBoost",
      required: [
        "expectCleanRestore(restoredActivation)",
        "expectCleanRestore(restoredBoost)",
        "Duel.IsBattlePhase() and aux.StatChangeDamageStepCondition()",
        "e1:SetCost(Cost.SelfDiscard)",
        "Duel.SelectTarget(tp,aux.FaceupFilter(Card.IsSetCard,SET_SKY_STRIKER),tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)",
        "currentAttack(restoredActivation.session.state.cards.find",
        "battleDamage).toEqual({ 0: 400, 1: 0 })",
        "eventHistory.filter((event) => event.eventName === \"battleDamageDealt\")",
      ],
    },
    {
      file: "test/lua-real-script-soul-union-damage-step-hero-stat.test.ts",
      kind: "activatedDamageStepBoost",
      required: [
        "expectCleanRestore(restoredOpen)",
        "expectCleanRestore(restoredChain)",
        "expectCleanRestore(restoredBoost)",
        "aux.StatChangeDamageStepCondition",
        "Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil):GetFirst()",
        "Duel.SelectTarget(tp,s.atkfilter,tp,LOCATION_GRAVE,0,1,1,nil)",
        "Duel.SetPossibleOperationInfo(0,CATEGORY_FUSION_SUMMON,nil,1,tp,LOCATION_EXTRA)",
        "effectLabelObjectUid: attacker.uid",
        "currentAttack(restoredChain.session.state.cards.find",
        "battleDamage).toEqual({ 0: 0, 1: 300 })",
        "eventHistory.filter((event) => event.eventName === \"battleDamageDealt\")",
      ],
    },
    {
      file: "test/lua-real-script-life-hack-lp-attack-damage-half.test.ts",
      kind: "activatedDamageStepLpFinalAttackDamageHalf",
      required: [
        "expectCleanRestore(restoredOpen)",
        "expectCleanRestore(restoredBattle)",
        "expectCleanRestore(restoredResolved)",
        "aux.StatChangeDamageStepCondition",
        "Duel.GetLP(p)",
        "EFFECT_SET_ATTACK_FINAL",
        "EFFECT_CHANGE_DAMAGE",
        "battleDamage).toEqual({ 0: 0, 1: 3000 })",
        "eventHistory.filter((event) => event.eventName === \"battleDamageDealt\")",
      ],
    },
    {
      file: "test/lua-real-script-cipher-soldier-pre-damage-calculate.test.ts",
      kind: "mandatoryPreDamageBoost",
      required: [
        "triggerEvent: \"beforeDamageCalculation\"",
        "eventName: \"beforeDamageCalculation\"",
        "currentAttack(restored.session.state.cards.find((card) => card.uid === cipherSoldier!.uid)",
        "battleDamage[1]).toBe(1350)",
        "eventName: \"battleDamageDealt\"",
        "eventReason: duelReason.battle",
        "eventReasonCardUid: cipherSoldier!.uid",
        "eventReasonPlayer: 0",
        "value: 2000",
        "finishBattle(restored.session)",
      ],
    },
    {
      file: "test/lua-real-script-hunter-7-weapons-announce-race-battle-stat.test.ts",
      kind: "mandatoryPreDamageBoost",
      required: [
        "Duel.AnnounceRace(tp,1,RACE_ALL)",
        "e:GetHandler():SetHint(CHINT_RACE,rc)",
        "e1:SetCode(EVENT_PRE_DAMAGE_CALCULATE)",
        "return bc and bc:IsRace(e:GetLabel())",
        "e1:SetCode(EFFECT_UPDATE_ATTACK)",
        "triggerEvent: \"beforeDamageCalculation\"",
        "currentAttack(restoredPreDamage.session.state.cards.find",
        "eventName: \"beforeDamageCalculation\"",
        "value: 1000",
      ],
    },
    {
      file: "test/lua-real-script-appliancer-celtopus-colink-battle-stat-draw.test.ts",
      kind: "mandatoryPreDamageBoost",
      required: [
        "e1:SetCode(EFFECT_CANNOT_BE_BATTLE_TARGET)",
        "e2:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)",
        "e3:SetCode(EVENT_PRE_DAMAGE_CALCULATE)",
        "local mg=a:GetMutualLinkedGroup()",
        "local octg=e:GetHandler():GetMutualLinkedGroup()",
        "e1:SetCode(EFFECT_UPDATE_ATTACK)",
        "trigger = getLuaRestoreLegalActions(restoredPreDamage",
        "currentAttack(restoredPreDamage.session.state.cards.find",
        "eventName: \"beforeDamageCalculation\"",
        "value: 1000",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: DamageStepStatKind;
    required: string[];
  }>);
}

function countDamageStepStatKinds(
  fixtures: Array<{ kind: DamageStepStatKind }>,
): Record<DamageStepStatKind, number> {
  return fixtures.reduce<Record<DamageStepStatKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      activatedDamageStepBaseAttackZero: 0,
      activatedDamageStepBoost: 0,
      activatedDamageStepLpFinalAttackDamageHalf: 0,
      labelObjectCostBoost: 0,
      mandatoryPreDamageBoost: 0,
      persistentDamageStepDebuff: 0,
    },
  );
}

function damageStepStatSemanticVariants(): Array<{
  file: string;
  kind: DamageStepStatSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-alchemy-cycle-base-attack-battle-draw.test.ts",
      kind: "alchemyCycleBaseAttackBattleDraw",
      required: [
        'const alchemyCycleCode = "65384019"',
        "restores its SetBaseAttack flag handoff into battle-destroyed CHAININFO draw",
        "e1:SetCode(EFFECT_SET_BASE_ATTACK)",
        "e2:SetCode(EVENT_BATTLE_DESTROYED)",
        "eg:IsExists(s.drfilter,1,nil,e:GetLabel())",
        "currentAttack(zeroedTarget",
        "triggerBucket: \"opponentMandatory\"",
        "eventReasonEffectId: 3",
      ],
    },
    {
      file: "test/lua-real-script-adhilsaber-hand-discard-damage-step-stat.test.ts",
      kind: "adhilsaberHandDiscardDamageStepStat",
      required: [
        'const adhilsaberCode = "61151074"',
        "restores the hand discard cost, target info, and Damage Step ATK update",
        "e1:SetCost(Cost.SelfDiscard)",
        'eventName: "sentToGraveyard"',
        "currentAttack(restoredBoost.session.state.cards.find",
        "battleDamage).toEqual({ 0: 400, 1: 0 })",
        'eventName: "battleDamageDealt"',
        "eventReasonCardUid: defender.uid",
      ],
    },
    {
      file: "test/lua-real-script-fabled-ashenveil-damage-step-boost.test.ts",
      kind: "fabledAshenveilDamageStepHandCostBoost",
      required: [
        'const ashenveilCode = "12235475"',
        "restores its hand cost and pre-damage calculation ATK boost",
        "battleWindow?.kind).toBe(\"beforeDamageCalculation\")",
        "eventName: \"sentToGraveyard\"",
        "currentAttack(boostedAshenveil",
        "ashenveil responder resolved",
        "eventName: \"battleDamageDealt\"",
      ],
    },
    {
      file: "test/lua-real-script-injection-fairy-lily-pre-damage-lp-boost.test.ts",
      kind: "injectionFairyLilyPreDamageLpBoost",
      required: [
        'const lilyCode = "79575620"',
        "restores its LP cost, damage-calculation flag, temporary ATK boost, and battle damage",
        "Duel.PayLPCost(tp,2000)",
        "RegisterFlagEffect(id,RESET_PHASE|PHASE_DAMAGE_CAL,0,1)",
        "battleWindow?.kind).toBe(\"beforeDamageCalculation\")",
        'eventName: "lifePointCostPaid"',
        "currentAttack(boostedLily",
        "battleDamage).toEqual({ 0: 0, 1: 1400 })",
        "eventName: \"battleDamageDealt\"",
      ],
    },
    {
      file: "test/lua-real-script-life-hack-lp-attack-damage-half.test.ts",
      kind: "lifeHackLpFinalAttackDamageHalf",
      required: [
        'const lifeHackCode = "83589191"',
        "restores hand activation into opponent-LP final ATK and halved battle damage",
        "restores grave SelfBanish ignition into own-LP final ATK",
        "e1:SetProperty(EFFECT_FLAG_CARD_TARGET+EFFECT_FLAG_DAMAGE_STEP)",
        "e2:SetCost(Cost.SelfBanish)",
        "e2:SetValue(function(e,re,val,r,rp,rc) return val//2 end)",
        "valueKind: \"battleDamageValue\"",
        "battleDamage).toEqual({ 0: 0, 1: 3000 })",
        'eventName: "battleDamageDealt"',
      ],
    },
    {
      file: "test/lua-real-script-gamil-damage-step-self-cost-boost.test.ts",
      kind: "gamilDefenderBranchSelfToGraveBoost",
      required: [
        'const gamilCode = "25727454"',
        "restores the defender-branch Damage Step hand cost and temporary ATK boost",
        "e1:SetCost(Cost.SelfToGrave)",
        "if Duel.IsTurnPlayer(1-tp) then a=Duel.GetAttackTarget() end",
        "eventName: \"sentToGraveyard\"",
        "currentAttack(restoredChain.session.state.cards.find",
        "battleDamage).toEqual({ 0: 0, 1: 100 })",
        "eventName: \"battleDamageDealt\"",
        "eventReasonCardUid: defender.uid",
      ],
    },
    {
      file: "test/lua-real-script-shinobird-crow-damage-step-stat.test.ts",
      kind: "shinobirdCrowLabelObjectCostBoost",
      required: [
        'const crowCode = "39817919"',
        "restores its Damage Step discard label object and applies the ATK/DEF boost",
        "property: 0x4000",
        "effectLabelObjectUid: costSpirit!.uid",
        "eventName: \"discarded\"",
        "battleDamage[1]).toBe(200)",
        "eventName: \"battleDamageDealt\"",
      ],
    },
    {
      file: "test/lua-real-script-soul-union-damage-step-hero-stat.test.ts",
      kind: "soulUnionDamageStepHeroStat",
      required: [
        'const soulUnionCode = "69389481"',
        "restores Damage Step target pair selection into Elemental HERO grave ATK gain",
        "e1:SetCategory(CATEGORY_ATKCHANGE+CATEGORY_REMOVE+CATEGORY_SPECIAL_SUMMON+CATEGORY_FUSION_SUMMON)",
        "e1:SetCondition(aux.StatChangeDamageStepCondition)",
        "effectLabelObjectUid: attacker.uid",
        "possibleOperationInfos",
        "currentAttack(restoredBoost.session.state.cards.find",
        "battleDamage).toEqual({ 0: 0, 1: 300 })",
        'eventName: "battleDamageDealt"',
      ],
    },
    {
      file: "test/lua-real-script-miniaturize-persistent-damage-step-stat.test.ts",
      kind: "miniaturizePersistentDamageStepDebuff",
      required: [
        'const miniaturizeCode = "34815282"',
        "restores official persistent target into Damage Step ATK and Level updates",
        "property: 0x4000",
        "miniaturize persistent true/true/1/800/3",
        "battleDamage[0]).toBe(100)",
        "eventName: \"battleDamageDealt\"",
      ],
    },
    {
      file: "test/lua-real-script-rush-recklessly-stat-change-damage-step.test.ts",
      kind: "rushRecklesslyTargetedDamageStepBoost",
      required: [
        'const rushCode = "70046172"',
        "restores targeted Damage Step ATK update activation and battle damage",
        "e1:SetCondition(aux.StatChangeDamageStepCondition)",
        "property: 0x4010",
        "e1:SetValue(700)",
        "currentAttack(restoredAttacker",
        "battleDamage).toEqual({ 0: 0, 1: 200 })",
      ],
    },
    {
      file: "test/lua-real-script-reliable-guardian-defense-damage-step.test.ts",
      kind: "reliableGuardianTargetedDamageStepDefenseUpdate",
      required: [
        'const reliableGuardianCode = "16430187"',
        "restores targeted Damage Step DEF update activation and preserves the boosted defense through battle",
        "e1:SetCategory(CATEGORY_DEFCHANGE)",
        "property: 0x4010",
        "e1:SetValue(700)",
        "currentDefense(restoredDefender",
        "battleDamage).toEqual({ 0: 0, 1: 100 })",
      ],
    },
    {
      file: "test/lua-real-script-cipher-soldier-pre-damage-calculate.test.ts",
      kind: "cipherSoldierMandatoryPreDamageBoost",
      required: [
        'const cipherSoldierCode = "79853073"',
        "restores its EVENT_PRE_DAMAGE_CALCULATE trigger and applies the Warrior battle stat boost",
        "registryKey: \"lua:79853073:lua-1-1134\"",
        "triggerEvent: \"beforeDamageCalculation\"",
        "currentAttack(restored.session.state.cards.find((card) => card.uid === cipherSoldier!.uid)",
        "battleDamage[1]).toBe(1350)",
        "eventName: \"battleDamageDealt\"",
      ],
    },
    {
      file: "test/lua-real-script-hunter-7-weapons-announce-race-battle-stat.test.ts",
      kind: "sevenWeaponsAnnounceRacePreDamageBoost",
      required: [
        'const hunterCode = "1525329"',
        "restores summon AnnounceRace into race-gated pre-damage ATK boost",
        "Duel.AnnounceRace(tp,1,RACE_ALL)",
        "e:GetHandler():SetHint(CHINT_RACE,rc)",
        "triggerEvent: \"beforeDamageCalculation\"",
        "currentAttack(restoredPreDamage.session.state.cards.find",
        "value: 1000",
      ],
    },
    {
      file: "test/lua-real-script-appliancer-celtopus-colink-battle-stat-draw.test.ts",
      kind: "appliancerCeltopusColinkPreDamageBoost",
      required: [
        'const celtopusCode = "78225596"',
        "restores co-linked pre-damage Appliancer ATK boost and target locks",
        "e1:SetValue(aux.imval1)",
        "e2:SetValue(aux.tgoval)",
        "local mg=a:GetMutualLinkedGroup()",
        "local octg=e:GetHandler():GetMutualLinkedGroup()",
        "e4:SetCode(EVENT_LEAVE_FIELD_P)",
        "e5:SetCode(EVENT_DESTROYED)",
        "currentAttack(restoredPreDamage.session.state.cards.find",
        "value: 1000",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: DamageStepStatSemanticVariant;
    required: string[];
  }>);
}

function countDamageStepStatSemanticVariants(
  fixtures: Array<{ kind: DamageStepStatSemanticVariant }>,
): Record<DamageStepStatSemanticVariant, number> {
  return fixtures.reduce<Record<DamageStepStatSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      alchemyCycleBaseAttackBattleDraw: 0,
      adhilsaberHandDiscardDamageStepStat: 0,
      appliancerCeltopusColinkPreDamageBoost: 0,
      cipherSoldierMandatoryPreDamageBoost: 0,
      fabledAshenveilDamageStepHandCostBoost: 0,
      gamilDefenderBranchSelfToGraveBoost: 0,
      injectionFairyLilyPreDamageLpBoost: 0,
      lifeHackLpFinalAttackDamageHalf: 0,
      miniaturizePersistentDamageStepDebuff: 0,
      reliableGuardianTargetedDamageStepDefenseUpdate: 0,
      rushRecklesslyTargetedDamageStepBoost: 0,
      shinobirdCrowLabelObjectCostBoost: 0,
      soulUnionDamageStepHeroStat: 0,
      sevenWeaponsAnnounceRacePreDamageBoost: 0,
    },
  );
}
