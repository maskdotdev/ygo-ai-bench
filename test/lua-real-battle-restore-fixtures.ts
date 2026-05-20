import fs from "node:fs"; import path from "node:path";
export const root = process.cwd(); export const testRoot = path.join(root, "test"); export const battleKeywords = ["battle", "attack", "damage"];
export const realScriptBattleFixtureCount = 218; export const battleLegalActionFixtureCount = 4; export const attackDeclarationTrapFixtureCount = 6; export const battleRoutingFixtureCount = 7;
export const battleContinuousSemanticFixtureCount = 1; export const damageStepRestoreFixtureCount = 5; export const battleDamageSemanticFixtureCount = 12; export const battleTriggerSemanticFixtureCount = 37;
export const attackDeclarationTrapKindCounts = {
  attackBanish: 1,
  attackDestroy: 1,
  attackNegateSetAgain: 1,
  battlePhaseSkipNegate: 1,
  damageReflect: 1,
  lpRecoverNegate: 1,
} satisfies Record<AttackDeclarationTrapKind, number>;
export const battleRoutingKindCounts = {
  attackAllTargetFilter: 2,
  attackAnnouncementLock: 1,
  battleTargetSelectionLock: 1,
  extraMonsterAttack: 1,
  mustAttackTargetLock: 1,
  onlyAttackEquipped: 1,
} satisfies Record<BattleRoutingKind, number>;
export const battleContinuousSemanticKindCounts = {
  battledGraveDisable: 1,
} satisfies Record<BattleContinuousSemanticKind, number>;
export const damageStepRestoreKindCounts = {
  activatedDamageStepBoost: 2,
  honestDamageStepBoost: 1,
  persistentDamageCalculationStat: 1,
  persistentDamageStepStat: 1,
} satisfies Record<DamageStepRestoreKind, number>;
export const battleDamageSemanticKindCounts = {
  alsoBattleDamage: 1,
  battleDamagePrevention: 2,
  battleDamageToEffect: 1,
  battleRetargetDamage: 1,
  halfBattleDamage: 2,
  pierceBattleDamage: 2,
  reflectBattleDamage: 2,
  temporaryDamageCalcBoost: 1,
} satisfies Record<BattleDamageSemanticKind, number>;
export const battleTriggerSemanticKindCounts = {
  battleStartDestroy: 1,
  battleConfirmDestroy: 2,
  battleConfirmToDeck: 1,
  battleDamageTriggeredDelayedEffect: 6,
  battleDestroyedChainAttack: 2,
  battleDestroyingDecktopConfirm: 1,
  battleDestroyingFlagAtk: 1,
  battleDestroyingRecover: 1,
  battleDestroyedDestroy: 1,
  battleDestroyedGroupDestroy: 1,
  battleDestroyingDamage: 2,
  battleDestroyingSelectEffect: 1,
  battleSearch: 4,
  battleTargetGroupDestroy: 1,
  battledLabelDrawSummon: 1,
  battledBounce: 1,
  battledChainAttackTarget: 1,
  battledDeckSend: 1,
  battledDestroy: 1,
  battledDamage: 1,
  battledFieldDamage: 1,
  battledDelayedDestroy: 1,
  battledDisable: 1,
  endDamageControl: 1,
  endDamageDestroy: 1,
  mutualBattleDestroyedSegoc: 1,
} satisfies Record<BattleTriggerSemanticKind, number>;
export const battleSemanticVariantCounts = {
  alienHunterBattleDestroyedChainAttack: 1,
  alienOfJusticeNullfierBattledDisable: 1,
  airbellumBattleDamageHandDiscard: 1,
  amazonessSwordsWomanReflectDamage: 1,
  ancientGearGolemPiercingDamage: 1,
  aojOmniWeaponBattledLabelDrawSummon: 1,
  aojThousandArmsLightOnlyAttackAll: 1,
  battleDamagePreventionMachineLordUr: 1,
  blizzardWarriorBattleDestroyingDecktopConfirm: 1,
  blsSoldierChaosBattleDestroyingSelectEffect: 1,
  darkRulerHaDesBattledGraveDisable: 1,
  decoyroidBattleTargetSelectionLock: 1,
  dimensionalPrisonAttackBanish: 1,
  drainingShieldLpRecoverNegate: 1,
  dracoonLampChangeBattleStat: 1,
  drillroidBattleConfirmDestroy: 1,
  ehrenBattleConfirmToDeck: 1,
  elementDoomAttributeChainAttack: 1,
  fabledAshenveilDamageStepBoost: 1,
  gemKnightSardonyxBattleSearch: 1,
  getsuFuhmaEndDamageDestroy: 1,
  ghostBirdExtraMonsterAttack: 1,
  giantRatMutualBattleDestroyedSegoc: 1,
  grasschopperGeminiAttackAll: 1,
  guardianAngelJoanBattleDestroyingRecover: 1,
  gravekeepersVassalBattleDamageToEffect: 1,
  greatLongNoseBattleDamageBattleSkip: 1,
  hayateBattledDeckSend: 1,
  honestDamageStepBoost: 1,
  hinoKaguTsuchiBattleDamagePredrawDiscard: 1,
  injectionFairyLilyPreDamageLpBoost: 1,
  insectPrincessBattleDestroyingFlagAtk: 1,
  fushiNoToriBattleDamageRecover: 1,
  keyMouseBattleDestroyedSearch: 1,
  ka2DesScissorsBattleDestroyingLevelDamage: 1,
  magicCylinderDamageReflect: 1,
  madolcheWaltzBattledFieldDamage: 1,
  magicalArmShieldBattleRetargetDamage: 1,
  miniaturizePersistentDamageStepStat: 1,
  mirageKnightBattleTargetAtk: 1,
  mojaBattleDestroyedGraveToHand: 1,
  naturiaSpiderfangAttackAnnouncementLock: 1,
  negateAttackBattlePhaseSkipNegate: 1,
  nightmareMagicianEndDamageControl: 1,
  nitroWarriorBattledChainAttackTarget: 1,
  number13MustAttackReflectDamage: 1,
  numberC96AlsoBattleDamage: 1,
  oddEyesDragonBattleDestroyingDamage: 1,
  predaplantSarraceniantBattledDestroy: 1,
  powerWallPreDamageDeckMillShield: 1,
  radiantSpiritBattleDestroyedGroupDestroy: 1,
  reflectBounderBattleConfirmDestroy: 1,
  ringOfMagnetismOnlyAttackEquipped: 1,
  sakuretsuArmorAttackDestroy: 1,
  sasukeSamuraiBattleStartDestroy: 1,
  scrapIronScarecrowSetAgainNegate: 1,
  shadowSpellGoatDamageCalculationStat: 1,
  smokeMosquitoPreDamageHalfDamageSummon: 1,
  spearDragonPierceEndPosition: 1,
  susaSoldierHalfDamage: 1,
  topologicBomberBattledDamage: 1,
  wallOfIllusionBattledBounce: 1,
  wallOfThornsBattleTargetGroupDestroy: 1,
  yomiShipBattleDestroyedDestroy: 1,
  scarrMandatoryBattleDestroyedSearch: 1,
  yamataDragonBattleDamageDraw: 1,
  yataGarasuBattleDamageDrawSkip: 1,
  zoneEaterDelayedBattleDestroy: 1,
} satisfies Record<BattleSemanticVariant, number>;

export type AttackDeclarationTrapKind =
  | "attackBanish"
  | "attackDestroy"
  | "attackNegateSetAgain"
  | "battlePhaseSkipNegate"
  | "damageReflect"
  | "lpRecoverNegate";

export type BattleRoutingKind =
  | "attackAllTargetFilter"
  | "attackAnnouncementLock"
  | "battleTargetSelectionLock"
  | "extraMonsterAttack"
  | "mustAttackTargetLock"
  | "onlyAttackEquipped";

export type BattleContinuousSemanticKind = "battledGraveDisable";

export type DamageStepRestoreKind =
  | "activatedDamageStepBoost"
  | "honestDamageStepBoost"
  | "persistentDamageCalculationStat"
  | "persistentDamageStepStat";

export type BattleDamageSemanticKind =
  | "alsoBattleDamage"
  | "battleDamagePrevention"
  | "battleDamageToEffect"
  | "battleRetargetDamage"
  | "halfBattleDamage"
  | "pierceBattleDamage"
  | "reflectBattleDamage"
  | "temporaryDamageCalcBoost";

export type BattleTriggerSemanticKind = "battleStartDestroy" | "battleConfirmDestroy" | "battleConfirmToDeck" | "battleDamageTriggeredDelayedEffect" | "battleDestroyedChainAttack" | "battleDestroyingDecktopConfirm" | "battleDestroyingFlagAtk" | "battleDestroyingRecover" | "battleDestroyedDestroy" | "battleDestroyedGroupDestroy" | "battleDestroyingDamage" | "battleDestroyingSelectEffect" | "battleSearch" | "battleTargetGroupDestroy" | "battledLabelDrawSummon" | "battledBounce" | "battledChainAttackTarget" | "battledDeckSend" | "battledDestroy" | "battledDamage" | "battledFieldDamage" | "battledDelayedDestroy" | "battledDisable" | "endDamageControl" | "endDamageDestroy" | "mutualBattleDestroyedSegoc";
export type BattleSemanticVariant = "alienHunterBattleDestroyedChainAttack" | "alienOfJusticeNullfierBattledDisable" | "airbellumBattleDamageHandDiscard" | "amazonessSwordsWomanReflectDamage" | "ancientGearGolemPiercingDamage" | "aojOmniWeaponBattledLabelDrawSummon" | "aojThousandArmsLightOnlyAttackAll" | "battleDamagePreventionMachineLordUr" | "blizzardWarriorBattleDestroyingDecktopConfirm" | "blsSoldierChaosBattleDestroyingSelectEffect" | "darkRulerHaDesBattledGraveDisable" | "decoyroidBattleTargetSelectionLock" | "dimensionalPrisonAttackBanish" | "drainingShieldLpRecoverNegate" | "dracoonLampChangeBattleStat" | "drillroidBattleConfirmDestroy" | "ehrenBattleConfirmToDeck" | "elementDoomAttributeChainAttack" | "fabledAshenveilDamageStepBoost" | "fushiNoToriBattleDamageRecover" | "gemKnightSardonyxBattleSearch" | "getsuFuhmaEndDamageDestroy" | "ghostBirdExtraMonsterAttack" | "giantRatMutualBattleDestroyedSegoc" | "grasschopperGeminiAttackAll" | "guardianAngelJoanBattleDestroyingRecover" | "gravekeepersVassalBattleDamageToEffect" | "greatLongNoseBattleDamageBattleSkip" | "hayateBattledDeckSend" | "hinoKaguTsuchiBattleDamagePredrawDiscard" | "honestDamageStepBoost" | "injectionFairyLilyPreDamageLpBoost" | "insectPrincessBattleDestroyingFlagAtk" | "ka2DesScissorsBattleDestroyingLevelDamage" | "keyMouseBattleDestroyedSearch" | "magicCylinderDamageReflect" | "madolcheWaltzBattledFieldDamage" | "magicalArmShieldBattleRetargetDamage" | "miniaturizePersistentDamageStepStat" | "mirageKnightBattleTargetAtk" | "mojaBattleDestroyedGraveToHand" | "naturiaSpiderfangAttackAnnouncementLock" | "negateAttackBattlePhaseSkipNegate" | "nightmareMagicianEndDamageControl" | "nitroWarriorBattledChainAttackTarget" | "number13MustAttackReflectDamage" | "numberC96AlsoBattleDamage" | "oddEyesDragonBattleDestroyingDamage" | "predaplantSarraceniantBattledDestroy" | "powerWallPreDamageDeckMillShield" | "radiantSpiritBattleDestroyedGroupDestroy" | "reflectBounderBattleConfirmDestroy" | "ringOfMagnetismOnlyAttackEquipped" | "sakuretsuArmorAttackDestroy" | "sasukeSamuraiBattleStartDestroy" | "scarrMandatoryBattleDestroyedSearch" | "scrapIronScarecrowSetAgainNegate" | "shadowSpellGoatDamageCalculationStat" | "smokeMosquitoPreDamageHalfDamageSummon" | "spearDragonPierceEndPosition" | "susaSoldierHalfDamage" | "topologicBomberBattledDamage" | "wallOfIllusionBattledBounce" | "wallOfThornsBattleTargetGroupDestroy" | "yamataDragonBattleDamageDraw" | "yataGarasuBattleDamageDrawSkip" | "zoneEaterDelayedBattleDestroy" | "yomiShipBattleDestroyedDestroy";

type RequiredFixture<K extends string> = { file: string; kind: K; required: string[] };
type KindFixture<K extends string> = { file: string; kind: K };

export function realScriptBattleFixtureFiles(): string[] {
  return fs.readdirSync(testRoot)
    .filter((file) => file.startsWith("lua-real-script-") && file.endsWith(".test.ts"))
    .filter((file) => battleKeywords.some((keyword) => file.includes(keyword)))
    .map((file) => path.join("test", file))
    .sort();
}

export function realScriptBattleLegalActionFixtureFiles(): string[] {
  return [
    "lua-real-script-battle-protection.test.ts",
    "lua-real-script-command-knight-battle-target-lock.test.ts",
    "lua-real-script-dd-borderline-battle-phase-lock.test.ts",
    "lua-real-script-mirror-force-battle-window.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

export function realScriptAttackDeclarationTrapFixtureFiles(): Array<RequiredFixture<AttackDeclarationTrapKind>> {
  return ([
    {
      file: "lua-real-script-magic-cylinder-battle-window.test.ts",
      kind: "damageReflect",
      required: [
        "targetUids: [attacker!.uid]",
        "attackCanceledUids).toEqual([attacker!.uid])",
        "lifePoints).toBe(6200)",
      ],
    },
    {
      file: "lua-real-script-dimensional-prison-battle-window.test.ts",
      kind: "attackBanish",
      required: [
        "targetUids: [attacker!.uid]",
        'location: "banished"',
        "lifePoints).toBe(8000)",
      ],
    },
    {
      file: "lua-real-script-draining-shield-battle-window.test.ts",
      kind: "lpRecoverNegate",
      required: [
        "attackCanceledUids).toEqual([attacker!.uid])",
        "players[1].lifePoints).toBe(9800)",
      ],
    },
    {
      file: "lua-real-script-sakuretsu-armor-battle-window.test.ts",
      kind: "attackDestroy",
      required: [
        'location: "graveyard"',
        "players[1].lifePoints).toBe(8000)",
      ],
    },
    {
      file: "lua-real-script-scrap-iron-scarecrow-battle-window.test.ts",
      kind: "attackNegateSetAgain",
      required: [
        "attackCanceledUids).toEqual([attacker!.uid])",
        'location: "spellTrapZone", position: "faceDown", faceUp: false',
      ],
    },
    {
      file: "lua-real-script-negate-attack-battle-window.test.ts",
      kind: "battlePhaseSkipNegate",
      required: [
        "attackCanceledUids).toEqual([firstAttacker!.uid])",
        "skippedPhases).toEqual([{ player: 0, phase: \"battle\", remaining: 1 }])",
      ],
    },
  ] satisfies Array<RequiredFixture<AttackDeclarationTrapKind>>).map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }));
}

export function realScriptBattleRoutingFixtureFiles(): Array<RequiredFixture<BattleRoutingKind>> {
  return ([
    {
      file: "lua-real-script-aoj-thousand-arms-attack-all-light.test.ts",
      kind: "attackAllTargetFilter",
      required: [
        "hasAttack(actions, thousandArms.uid, lightTarget.uid)).toBe(true)",
        "hasAttack(actions, thousandArms.uid, darkTarget.uid)).toBe(false)",
        "hasDirectAttack(actions, thousandArms.uid)).toBe(false)",
      ],
    },
    {
      file: "lua-real-script-decoyroid-battle-target-selection-lock.test.ts",
      kind: "battleTargetSelectionLock",
      required: [
        "hasAttack(actions, attacker.uid, decoyroid.uid)).toBe(true)",
        "hasAttack(actions, attacker.uid, protectedTarget.uid)).toBe(false)",
      ],
    },
    {
      file: "lua-real-script-ghost-bird-extra-monster-attack.test.ts",
      kind: "extraMonsterAttack",
      required: [
        "hasAttack(actions, ghostBird.uid, target.uid)).toBe(true)",
        "hasDirectAttack(actions, ghostBird.uid)).toBe(false)",
        "hasDirectAttack(noTargetActions, ghostBird.uid)).toBe(false)",
      ],
    },
    {
      file: "lua-real-script-grasschopper-gemini-attack-all.test.ts",
      kind: "attackAllTargetFilter",
      required: [
        "hasAttack(firstActions, grasschopper.uid, firstTarget.uid)).toBe(true)",
        "hasAttack(secondActions, grasschopper.uid, secondTarget.uid)).toBe(true)",
        "hasDirectAttack(secondActions, grasschopper.uid)).toBe(false)",
      ],
    },
    {
      file: "lua-real-script-naturia-spiderfang-attack-announce-lock.test.ts",
      kind: "attackAnnouncementLock",
      required: [
        "hasAttack(actions, spiderfang.uid, target.uid)).toBe(false)",
        "hasAttack(actions, ordinary.uid, target.uid)).toBe(true)",
      ],
    },
    {
      file: "lua-real-script-number-13-must-attack-reflect.test.ts",
      kind: "mustAttackTargetLock",
      required: [
        "EFFECT_MUST_ATTACK_MONSTER",
        "e2:SetLabel(fid)",
        "hasAttack(battleActions, forcedAttacker.uid, crime.uid)).toBe(true)",
        "hasAttack(battleActions, forcedAttacker.uid, punishment.uid)).toBe(false)",
      ],
    },
    {
      file: "lua-real-script-ring-of-magnetism-only-attack.test.ts",
      kind: "onlyAttackEquipped",
      required: [
        "hasAttack(actions, attacker.uid, equippedTarget.uid)).toBe(true)",
        "hasAttack(actions, attacker.uid, sideTarget.uid)).toBe(false)",
        "directAttack)).toBe(false)",
      ],
    },
  ] satisfies Array<RequiredFixture<BattleRoutingKind>>)
    .map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

export function realScriptBattleContinuousSemanticFixtureFiles(): Array<RequiredFixture<BattleContinuousSemanticKind>> {
  return ([
    {
      file: "lua-real-script-dark-ruler-ha-des-battled-disable.test.ts",
      kind: "battledGraveDisable",
      required: [
        'eventName: "afterDamageCalculation"',
        "eventCode: 1138",
        'eventName: "battleDestroyed"',
        'location: "graveyard"',
        "ha des target disabled true",
      ],
    },
  ] satisfies Array<RequiredFixture<BattleContinuousSemanticKind>>).map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }));
}

export function realScriptDamageStepRestoreFixtureFiles(): string[] {
  return realScriptDamageStepRestoreFixtures().map(({ file }) => file);
}
export function realScriptDamageStepRestoreFixtures(): Array<KindFixture<DamageStepRestoreKind>> {
  return ([
    {
      file: "lua-real-script-fabled-ashenveil-damage-step-boost.test.ts",
      kind: "activatedDamageStepBoost",
    },
    { file: "lua-real-script-gamil-damage-step-self-cost-boost.test.ts", kind: "activatedDamageStepBoost" },
    {
      file: "lua-real-script-honest-damage-step.test.ts",
      kind: "honestDamageStepBoost",
    },
    {
      file: "lua-real-script-miniaturize-persistent-damage-step-stat.test.ts",
      kind: "persistentDamageStepStat",
    },
    {
      file: "lua-real-script-shadow-spell-goat-damage-calculation-persistent.test.ts",
      kind: "persistentDamageCalculationStat",
    },
  ] satisfies Array<KindFixture<DamageStepRestoreKind>>)
    .map(({ file, kind }) => ({ file: path.join("test", file), kind }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

export function realScriptBattleDamageSemanticFixtureFiles(): Array<RequiredFixture<BattleDamageSemanticKind>> {
  return ([
    {
      file: "lua-real-script-ancient-gear-golem-pierce-battle-damage.test.ts",
      kind: "pierceBattleDamage",
      required: [
        "expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 1500 })",
        "eventValue: 1500",
      ],
    },
    { file: "lua-real-script-spear-dragon-pierce-battle-end-position.test.ts", kind: "pierceBattleDamage", required: ["restores piercing battle damage into its end Damage Step Defense Position change", "battleDamage).toEqual({ 0: 0, 1: 900 })", "eventValue: 900"] },
    {
      file: "lua-real-script-amazoness-swords-woman-reflect-battle-damage.test.ts",
      kind: "reflectBattleDamage",
      required: [
        "expect(restored.session.state.battleDamage).toEqual({ 0: 500, 1: 0 })",
        "eventPlayer: 0",
        "eventValue: 500",
      ],
    },
    {
      file: "lua-real-script-number-13-must-attack-reflect.test.ts",
      kind: "reflectBattleDamage",
      required: [
        "EFFECT_REFLECT_BATTLE_DAMAGE",
        "Duel.GetAttackTarget()==e:GetHandler()",
        "expect(restoredChain.session.state.battleDamage).toEqual({ 0: 0, 1: 1000 })",
        "eventPlayer: 1",
        "eventValue: 1000",
      ],
    },
    {
      file: "lua-real-script-battle-damage-prevention.test.ts",
      kind: "battleDamagePrevention",
      required: [
        "expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 })",
        'expect.objectContaining({ action: "battleDamage", player: 1, detail: "0" })',
      ],
    },
    {
      file: "lua-real-script-power-wall-pre-damage-deck-mill-shield.test.ts",
      kind: "battleDamagePrevention",
      required: [
        "restores pre-damage battle damage lookup, Deck discard, operated group, and damage prevention",
        "math.ceil(Duel.GetBattleDamage(tp)/500)",
        "Duel.DiscardDeck(tp,val,REASON_EFFECT)",
        "Duel.GetOperatedGroup()",
        "expect(restoredDamagePrevention.session.state.battleDamage).toEqual({ 0: 0, 1: 0 })",
      ],
    },
    {
      file: "lua-real-script-gravekeepers-vassal-battle-damage-to-effect.test.ts",
      kind: "battleDamageToEffect",
      required: [
        "expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 700 })",
        'expect.objectContaining({ action: "effectDamage", player: 1, detail: "700" })',
        "eventReason: 64",
        "eventReasonEffectId: 1",
      ],
    },
    {
      file: "lua-real-script-magical-arm-shield-calculate-damage.test.ts",
      kind: "battleRetargetDamage",
      required: [
        'battleWindow?.kind).toBe("attackNegationResponse")',
        "action.uid === shield!.uid",
        "expect(restored.session.state.battleDamage).toEqual({ 0: 1500, 1: 0 })",
        'eventName: "controlChanged"',
        'eventName: "battleDamageDealt"',
      ],
    },
    {
      file: "lua-real-script-mirage-knight-battle-target-atk.test.ts",
      kind: "temporaryDamageCalcBoost",
      required: [
        'battleWindow?.kind).toBe("duringDamageCalculation")',
        "expect(restoredDamageCalc.session.state.battleDamage).toEqual({ 0: 0, 1: 2800 })",
        'eventName: "battleDamageDealt"',
        'location: "banished"',
      ],
    },
    {
      file: "lua-real-script-number-c96-also-battle-damage.test.ts",
      kind: "alsoBattleDamage",
      required: [
        "expect(restored.session.state.battleDamage).toEqual({ 0: 800, 1: 800 })",
        "eventPlayer: 0",
        "eventPlayer: 1",
      ],
    },
    {
      file: "lua-real-script-susa-soldier-half-damage.test.ts",
      kind: "halfBattleDamage",
      required: [
        "expect(restored.session.state.battleDamage[1]).toBe(500)",
        "eventValue: 500",
      ],
    },
    {
      file: "lua-real-script-smoke-mosquito-pre-damage-half-battle-damage.test.ts",
      kind: "halfBattleDamage",
      required: [
        "EFFECT_CHANGE_BATTLE_DAMAGE",
        "HALF_DAMAGE",
        "code: 208",
        "battleDamage).toEqual({ 0: 750, 1: 0 })",
        "eventValue: 750",
      ],
    },
  ] satisfies Array<RequiredFixture<BattleDamageSemanticKind>>).map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }));
}

export function realScriptBattleTriggerSemanticFixtureFiles(): Array<RequiredFixture<BattleTriggerSemanticKind>> {
  return ([
    {
      file: "lua-real-script-ally-of-justice-nullfier-battled-disable.test.ts",
      kind: "battledDisable",
      required: [
        'battleWindow?.kind).toBe("afterDamageCalculation")',
        'eventName: "afterDamageCalculation"',
        "eventCode: 1138",
        "code: 2",
        "code: 8",
      ],
    },
    {
      file: "lua-real-script-aoj-omni-weapon-battled-label-draw-summon.test.ts",
      kind: "battledLabelDrawSummon",
      required: ["restores EVENT_BATTLED label state into the battle-destroyed draw and optional DARK Special Summon", 'eventName: "afterDamageCalculation"', "eventCode: 1138", 'eventName: "battleDestroyed"', "eventCode: 1140", 'eventName: "cardsDrawn"', 'eventName: "specialSummoned"', "api: \"SelectYesNo\""],
    },
    {
      file: "lua-real-script-alien-hunter-chain-attack.test.ts",
      kind: "battleDestroyedChainAttack",
      required: ["restores Alien Hunter's battle-destroying trigger and reopens its attack with Duel.ChainAttack", 'eventName: "battleDestroyed"', "eventCode: 1140", "attacksDeclared).not.toContain(alienHunter!.uid)", 'type: "declareAttack", attackerUid: alienHunter!.uid, targetUid: followupTarget!.uid'],
    },
    {
      file: "lua-real-script-element-doom-chain-attack.test.ts",
      kind: "battleDestroyedChainAttack",
      required: ["restores its attribute-gated battled trigger and reopens its attack with Duel.ChainAttack", 'eventName: "battleDestroyed"', "eventCode: 1140", "attacksDeclared).not.toContain(elementDoom!.uid)", 'type: "declareAttack", attackerUid: elementDoom!.uid, targetUid: followupTarget!.uid'],
    },
    {
      file: "lua-real-script-nitro-warrior-chain-attack-target.test.ts",
      kind: "battledChainAttackTarget",
      required: ["restores its battled trigger and chain-attacks the selected position-changed monster", 'eventName: "afterDamageCalculation"', "eventCode: 1138", "currentAttack).toMatchObject({ attackerUid: nitro!.uid, targetUid: followupTarget!.uid })", "battleDamage).toMatchObject({ 1: 1800 })"],
    },
    {
      file: "lua-real-script-wall-of-illusion-battled.test.ts",
      kind: "battledBounce",
      required: [
        'battleWindow?.kind).toBe("afterDamageCalculation")',
        'eventName: "afterDamageCalculation"',
        "eventCode: 1138",
        'eventName: "sentToHand"',
        'location: "hand"',
      ],
    },
    {
      file: "lua-real-script-hayate-battled-send.test.ts",
      kind: "battledDeckSend",
      required: ["directAttack === true", 'battleWindow?.kind).toBe("afterDamageCalculation")', 'eventName: "afterDamageCalculation"', "eventCode: 1138", 'eventName: "sentToGraveyard"', 'location: "graveyard"', "reasonEffectId: 3"],
    },
    {
      file: "lua-real-script-predaplant-sarraceniant-battled-destroy.test.ts",
      kind: "battledDestroy",
      required: ['battleWindow?.kind).toBe("afterDamageCalculation")', 'eventName: "afterDamageCalculation"', "eventCode: 1138", 'eventName: "destroyed"', 'location: "graveyard"', "reasonEffectId: 2"],
    },
    {
      file: "lua-real-script-topologic-bomber-battled-damage.test.ts",
      kind: "battledDamage",
      required: ['battleWindow?.kind).toBe("afterDamageCalculation")', 'eventName: "afterDamageCalculation"', "eventCode: 1138", 'eventName: "damageDealt"', "eventValue: 1200", "players[1].lifePoints).toBe(5000)"],
    },
    {
      file: "lua-real-script-madolche-waltz-battled-field-damage.test.ts",
      kind: "battledFieldDamage",
      required: ["restores its Spell/Trap-zone EVENT_BATTLED field trigger into target-param effect damage", "e2:SetRange(LOCATION_SZONE)", "e2:SetCode(EVENT_BATTLED)", "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)", "eventCode: 1138", "eventValue: 300"],
    },
    {
      file: "lua-real-script-zone-eater-delayed-battle-destroy.test.ts",
      kind: "battledDelayedDestroy",
      required: ["restores battled target markers and destroys the marked monster on the fifth End Phase", "e1:SetCode(EVENT_BATTLED)", "bc:RegisterEffect(e1)", "e3:SetCode(EVENT_PHASE+PHASE_END)", "Duel.Destroy(tc,REASON_EFFECT)", 'eventName: "destroyed"'],
    },
    {
      file: "lua-real-script-reflect-bounder-battle-confirm-destroy.test.ts",
      kind: "battleConfirmDestroy",
      required: [
        'battleWindow?.kind).toBe("startDamageStep")',
        'eventName: "battleConfirmed"',
        'eventName: "damageDealt"',
        "eventValue: 1700",
        'battleWindow?.kind).toBe("afterDamageCalculation")',
        'eventName: "destroyed"',
        'location: "graveyard"',
      ],
    },
    {
      file: "lua-real-script-drillroid-battle-confirm-destroy.test.ts",
      kind: "battleConfirmDestroy",
      required: [
        "restores battle-confirm defense-target destruction and ends the pending battle",
        "e1:SetCode(EVENT_BATTLE_CONFIRM)",
        "Duel.GetAttackTarget()",
        "Duel.Destroy(t,REASON_EFFECT)",
        'eventName: "battleConfirmed"',
        'eventName: "destroyed"',
        "pendingBattle).toBeUndefined()",
      ],
    },
    { file: "lua-real-script-ehren-battle-confirm-to-deck.test.ts", kind: "battleConfirmToDeck", required: ["restores battle-confirm target shuffling and ends the pending battle when the target leaves", "e1:SetCode(EVENT_BATTLE_CONFIRM)", "Duel.SendtoDeck(t,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)", 'eventName: "sentToDeck"', "pendingBattle).toBeUndefined()"] },
    { file: "lua-real-script-airbellum-direct-damage-hand-discard.test.ts", kind: "battleDamageTriggeredDelayedEffect", required: ["restores its direct battle-damage trigger into random opponent hand discard", 'eventName: "battleDamageDealt"', "Duel.SetOperationInfo(0,CATEGORY_HANDES,0,0,1-tp,1)", 'eventName: "discarded"'] },
    { file: "lua-real-script-fushi-no-tori-battle-recover.test.ts", kind: "battleDamageTriggeredDelayedEffect", required: ["restores its battle-damage trigger into CHAININFO target-param LP recovery", 'eventName: "battleDamageDealt"', 'eventName: "recoveredLifePoints"', "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)"] },
    { file: "lua-real-script-great-long-nose-skip-battle.test.ts", kind: "battleDamageTriggeredDelayedEffect", required: ["restores its battle-damage trigger into an opponent Battle Phase skip", 'eventName: "battleDamageDealt"', "EFFECT_SKIP_BP", "phase: \"battle\", remaining: 1"] },
    { file: "lua-real-script-hino-kagu-tsuchi-predraw-discard.test.ts", kind: "battleDamageTriggeredDelayedEffect", required: ["restores its battle-damage trigger into the opponent's next Draw Phase hand discard", 'eventName: "battleDamageDealt"', 'eventName: "preDraw"', 'eventName: "discarded"'] },
    { file: "lua-real-script-yamata-dragon-battle-damage-draw.test.ts", kind: "battleDamageTriggeredDelayedEffect", required: ["restores its battle-damage trigger and draws until 5 from CHAININFO_TARGET_PLAYER", 'eventName: "battleDamageDealt"', '"eventName": "cardsDrawn"', "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER)"] },
    { file: "lua-real-script-yata-garasu-skip-draw.test.ts", kind: "battleDamageTriggeredDelayedEffect", required: ["restores its battle-damage trigger into the opponent's next Draw Phase skip", 'eventName: "battleDamageDealt"', "EFFECT_SKIP_DP", "phase: \"draw\", remaining: 1"] },
    {
      file: "lua-real-script-sasuke-samurai-battle-start-destroy.test.ts",
      kind: "battleStartDestroy",
      required: ['eventName: "battleStarted"', "eventCode: 1132", 'triggerBucket: "turnMandatory"', 'eventName: "destroyed"', 'location: "graveyard"', "eventReasonEffectId: 1"],
    },
    {
      file: "lua-real-script-blizzard-warrior-battle-destroying-decktop.test.ts",
      kind: "battleDestroyingDecktopConfirm",
      required: ['eventName: "battleDestroyed"', "eventCode: 1140", "api: \"SelectOption\"", "confirmed 0:", 'eventName: "confirmed"'],
    },
    {
      file: "lua-real-script-insect-princess-battled-flag-atk.test.ts",
      kind: "battleDestroyingFlagAtk",
      required: ["restores EVENT_BATTLED flag state into its battle-destroying ATK gain trigger", "RegisterFlagEffect(id,RESET_PHASE|PHASE_DAMAGE,0,1)", "eventCode: 1140", "insect princess attack 2400"],
    },
    {
      file: "lua-real-script-guardian-angel-joan-battle-recover.test.ts",
      kind: "battleDestroyingRecover",
      required: [
        "restores battle-destroying recovery from the destroyed target's base ATK through CHAININFO",
        "e1:SetCode(EVENT_BATTLE_DESTROYING)",
        "Duel.SetOperationInfo(0,CATEGORY_RECOVER,nil,0,tp,rec)",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
        'eventName: "recoveredLifePoints"',
      ],
    },
    {
      file: "lua-real-script-yomi-ship-battle-destroyed.test.ts",
      kind: "battleDestroyedDestroy",
      required: ['eventName: "battleDestroyed"', "eventCode: 1140", "reasonCardUid: attacker!.uid", 'eventName: "destroyed"', 'location: "graveyard"'],
    },
    {
      file: "lua-real-script-radiant-spirit-battle-destroyed-group-destroy.test.ts",
      kind: "battleDestroyedGroupDestroy",
      required: ['eventName: "battleDestroyed"', "eventCode: 1140", "targetUids: [darkTarget.uid, attacker.uid, facedownTarget.uid]", 'eventName: "destroyed"', 'location: "graveyard"'],
    },
    {
      file: "lua-real-script-giant-rat-mutual-battle-destroyed-segoc.test.ts",
      kind: "mutualBattleDestroyedSegoc",
      required: ['triggerBucket: "turnOptional"', 'triggerBucket: "opponentOptional"', "pendingTriggerBuckets", 'event.eventName === "specialSummoned"', 'position: "faceUpAttack"'],
    },
    {
      file: "lua-real-script-odd-eyes-dragon-battle-destroying-damage.test.ts",
      kind: "battleDestroyingDamage",
      required: [
        'eventName: "battleDestroyed"',
        "eventCode: 1140",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
        'eventName: "damageDealt"',
        "eventValue: 800",
        "players[1].lifePoints).toBe(6300)",
      ],
    },
    {
      file: "lua-real-script-ka2-des-scissors-battle-destroying-level-damage.test.ts",
      kind: "battleDestroyingDamage",
      required: [
        'eventName: "battleDestroyed"',
        "eventCode: 1140",
        "local dam=bc:GetLevel()*500",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
        'eventName: "damageDealt"',
        "eventValue: 3000",
        "players[1].lifePoints).toBe(4800)",
      ],
    },
    {
      file: "lua-real-script-bls-soldier-chaos-battle-destroying-select-effect.test.ts",
      kind: "battleDestroyingSelectEffect",
      required: [
        'eventName: "battleDestroyed"',
        "eventCode: 1140",
        "api: \"SelectEffect\"",
        "returned: 1",
        "currentAttack(restoredBls, restored.session.state)).toBe((bls!.data.attack ?? 0) + 1500)",
      ],
    },
    {
      file: "lua-real-script-gem-knight-sardonyx-battle-search.test.ts",
      kind: "battleSearch",
      required: [
        'eventName: "battleDestroyed"',
        "eventCode: 1140",
        "reasonCardUid: sardonyx!.uid",
        'eventName: "sentToHand"',
        'eventName: "sentToHandConfirmed"',
      ],
    },
    {
      file: "lua-real-script-key-mouse-battle-destroyed-search.test.ts",
      kind: "battleSearch",
      required: [
        'eventName: "battleDestroyed"',
        "eventCode: 1140",
        "reasonCardUid: opponent!.uid",
        'eventName: "sentToHand"',
        'eventName: "sentToHandConfirmed"',
      ],
    },
    {
      file: "lua-real-script-scarr-battle-destroyed-mandatory-search.test.ts",
      kind: "battleSearch",
      required: [
        'eventName: "battleDestroyed"',
        "eventCode: 1140",
        "triggerBucket: \"opponentMandatory\"",
        "reasonCardUid: opponent.uid",
        'eventName: "sentToHand"',
        'eventName: "sentToHandConfirmed"',
      ],
    },
    {
      file: "lua-real-script-wall-thorns-battle-target-group-destroy.test.ts",
      kind: "battleTargetGroupDestroy",
      required: [
        "restores its Plant battle-target Trap trigger and destroys opponent attack-position monsters as a group",
        "e1:SetCode(EVENT_BE_BATTLE_TARGET)",
        "Duel.GetMatchingGroup(s.filter,tp,0,LOCATION_MZONE,nil)",
        'eventName: "battleTargeted"',
        "eventUids: destroyedUids",
      ],
    },
    { file: "lua-real-script-moja-battle-destroyed-grave-to-hand.test.ts", kind: "battleSearch", required: ['eventName: "battleDestroyed"', "eventCode: 1140", "reasonCardUid: attacker!.uid", 'eventName: "sentToHand"', 'eventName: "sentToHandConfirmed"', 'location: "graveyard"'] },
    {
      file: "lua-real-script-getsu-fuhma-damage-step-end.test.ts",
      kind: "endDamageDestroy",
      required: [
        'battleWindow?.kind).toBe("endDamageStep")',
        'eventName: "damageStepEnded"',
        "eventCode: 1141",
        'eventName: "destroyed"',
        'location: "graveyard"',
      ],
    },
    {
      file: "lua-real-script-nightmare-magician-battle-control.test.ts",
      kind: "endDamageControl",
      required: [
        'luaTargetDescriptor: "target:source-or-battle-target"',
        'battleWindow?.kind).toBe("endDamageStep")',
        'triggerBucket: "turnOptional"',
        'eventName: "damageStepEnded"',
        "previousController: 1",
      ],
    },
  ] satisfies Array<RequiredFixture<BattleTriggerSemanticKind>>).map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }));
}

export function realScriptBattleSemanticVariants(): Array<RequiredFixture<BattleSemanticVariant>> {
  return ([
    {
      file: "lua-real-script-alien-hunter-chain-attack.test.ts",
      kind: "alienHunterBattleDestroyedChainAttack",
      required: ["restores Alien Hunter's battle-destroying trigger and reopens its attack with Duel.ChainAttack", "eventCode: 1140", "attacksDeclared).not.toContain(alienHunter!.uid)"],
    },
    {
      file: "lua-real-script-ally-of-justice-nullfier-battled-disable.test.ts",
      kind: "alienOfJusticeNullfierBattledDisable",
      required: ["restores its EVENT_BATTLED label-object trigger and disables the LIGHT battle target", "eventCode: 1138", "code: 8"],
    },
    {
      file: "lua-real-script-airbellum-direct-damage-hand-discard.test.ts",
      kind: "airbellumBattleDamageHandDiscard",
      required: ["restores its direct battle-damage trigger into random opponent hand discard", "CATEGORY_HANDES", "Duel.GetFieldGroup(ep,LOCATION_HAND,0,nil)", "RandomSelect", 'eventName: "discarded"'],
    },
    {
      file: "lua-real-script-aoj-omni-weapon-battled-label-draw-summon.test.ts",
      kind: "aojOmniWeaponBattledLabelDrawSummon",
      required: ["restores EVENT_BATTLED label state into the battle-destroyed draw and optional DARK Special Summon", "e2:SetLabelObject(e1)", "Duel.GetOperatedGroup():GetFirst()", "eventName: \"cardsDrawn\"", "eventName: \"specialSummoned\""],
    },
    {
      file: "lua-real-script-amazoness-swords-woman-reflect-battle-damage.test.ts",
      kind: "amazonessSwordsWomanReflectDamage",
      required: ["restores Amazoness Swords Woman and reflects battle damage to the attacker", "battleDamage).toEqual({ 0: 500, 1: 0 })", "eventValue: 500"],
    },
    {
      file: "lua-real-script-ancient-gear-golem-pierce-battle-damage.test.ts",
      kind: "ancientGearGolemPiercingDamage",
      required: ["restores Ancient Gear Golem and applies piercing battle damage", "battleDamage).toEqual({ 0: 0, 1: 1500 })", "eventValue: 1500"],
    },
    { file: "lua-real-script-spear-dragon-pierce-battle-end-position.test.ts", kind: "spearDragonPierceEndPosition", required: ["restores piercing battle damage into its end Damage Step Defense Position change", "e1:SetCode(EVENT_DAMAGE_STEP_END)", "e2:SetCode(EFFECT_PIERCE)", "battleDamage).toEqual({ 0: 0, 1: 900 })"] },
    {
      file: "lua-real-script-aoj-thousand-arms-attack-all-light.test.ts",
      kind: "aojThousandArmsLightOnlyAttackAll",
      required: ["restores its target-filtered attack-all effect for spent attackers", "lightTarget.uid)).toBe(true)", "darkTarget.uid)).toBe(false)"],
    },
    {
      file: "lua-real-script-battle-damage-prevention.test.ts",
      kind: "battleDamagePreventionMachineLordUr",
      required: ["restores Machine Lord Ur and prevents opponent battle damage from its attack", "battleDamage).toEqual({ 0: 0, 1: 0 })", "detail: \"0\""],
    },
    {
      file: "lua-real-script-blizzard-warrior-battle-destroying-decktop.test.ts",
      kind: "blizzardWarriorBattleDestroyingDecktopConfirm",
      required: ["restores its battle-destroying trigger through Deck-top confirmation and SelectOption", "api: \"SelectOption\"", "eventName: \"confirmed\""],
    },
    {
      file: "lua-real-script-bls-soldier-chaos-battle-destroying-select-effect.test.ts",
      kind: "blsSoldierChaosBattleDestroyingSelectEffect",
      required: ["restores its battle-destroying trigger prompt and applies the selected ATK boost", "api: \"SelectEffect\"", "returned: 1"],
    },
    {
      file: "lua-real-script-dark-ruler-ha-des-battled-disable.test.ts",
      kind: "darkRulerHaDesBattledGraveDisable",
      required: ["restores its EVENT_BATTLED continuous disable on a battle-destroyed monster in Graveyard", "ha des target disabled true", "eventCode: 1138"],
    },
    {
      file: "lua-real-script-decoyroid-battle-target-selection-lock.test.ts",
      kind: "decoyroidBattleTargetSelectionLock",
      required: ["restores its non-Decoyroid battle target selection lock", "decoyroid.uid)).toBe(true)", "protectedTarget.uid)).toBe(false)"],
    },
    {
      file: "lua-real-script-dimensional-prison-battle-window.test.ts",
      kind: "dimensionalPrisonAttackBanish",
      required: ["restores Dimensional Prison's attack-declaration target and banishes the active attacker", "targetUids: [attacker!.uid]", "location: \"banished\""],
    },
    {
      file: "lua-real-script-draining-shield-battle-window.test.ts",
      kind: "drainingShieldLpRecoverNegate",
      required: ["restores Draining Shield's attack-declaration target and recovers LP after negating the attack", "attackCanceledUids).toEqual([attacker!.uid])", "players[1].lifePoints).toBe(9800)"],
    },
    { file: "lua-real-script-dracoon-lamp-change-battle-stat.test.ts", kind: "dracoonLampChangeBattleStat", required: ["restores its pre-damage EFFECT_CHANGE_BATTLE_STAT callback into damage calculation", "EFFECT_CHANGE_BATTLE_STAT", "stat:current-defense", "target:source-or-battle-target", "battleDamage).toEqual({ 0: 0, 1: 1600 })"] },
    { file: "lua-real-script-ehren-battle-confirm-to-deck.test.ts", kind: "ehrenBattleConfirmToDeck", required: ["restores battle-confirm target shuffling and ends the pending battle when the target leaves", "e1:SetCode(EVENT_BATTLE_CONFIRM)", "Duel.GetAttackTarget()", "eventName: \"sentToDeck\""] },
    {
      file: "lua-real-script-element-doom-chain-attack.test.ts",
      kind: "elementDoomAttributeChainAttack",
      required: ["restores its attribute-gated battled trigger and reopens its attack with Duel.ChainAttack", "eventCode: 1140", "attacksDeclared).not.toContain(elementDoom!.uid)"],
    },
    {
      file: "lua-real-script-fabled-ashenveil-damage-step-boost.test.ts",
      kind: "fabledAshenveilDamageStepBoost",
      required: ["restores its hand cost and pre-damage calculation ATK boost", "battleWindow?.kind).toBe(\"beforeDamageCalculation\")", "currentAttack(boostedAshenveil"],
    },
    { file: "lua-real-script-fushi-no-tori-battle-recover.test.ts", kind: "fushiNoToriBattleDamageRecover", required: ["restores its battle-damage trigger into CHAININFO target-param LP recovery", "Duel.Recover(p,d,REASON_EFFECT)", "eventName: \"recoveredLifePoints\""] },
    {
      file: "lua-real-script-gem-knight-sardonyx-battle-search.test.ts",
      kind: "gemKnightSardonyxBattleSearch",
      required: ["restores Gemini-status battle-destroyed reason-card search", "reasonCardUid: sardonyx!.uid", "eventName: \"sentToHandConfirmed\""],
    },
    {
      file: "lua-real-script-getsu-fuhma-damage-step-end.test.ts",
      kind: "getsuFuhmaEndDamageDestroy",
      required: ["restores Getsu Fuhma's stored battle target and destroys it at the end of the Damage Step", "battleWindow?.kind).toBe(\"endDamageStep\")", "eventName: \"damageStepEnded\""],
    },
    {
      file: "lua-real-script-ghost-bird-extra-monster-attack.test.ts",
      kind: "ghostBirdExtraMonsterAttack",
      required: ["restores sequence-gated monster-only extra attacks without allowing direct attacks", "hasAttack(actions, ghostBird.uid, target.uid)).toBe(true)", "hasDirectAttack(noTargetActions, ghostBird.uid)).toBe(false)"],
    },
    {
      file: "lua-real-script-giant-rat-mutual-battle-destroyed-segoc.test.ts",
      kind: "giantRatMutualBattleDestroyedSegoc",
      required: ["restores simultaneous optional EVENT_BATTLE_DESTROYED recruiters as one chain", "triggerBucket: \"turnOptional\"", "triggerBucket: \"opponentOptional\""],
    },
    {
      file: "lua-real-script-grasschopper-gemini-attack-all.test.ts",
      kind: "grasschopperGeminiAttackAll",
      required: ["restores Gemini status into repeat monster attacks without reopening direct attacks", "firstTarget.uid)).toBe(true)", "secondTarget.uid)).toBe(true)"],
    },
    {
      file: "lua-real-script-guardian-angel-joan-battle-recover.test.ts",
      kind: "guardianAngelJoanBattleDestroyingRecover",
      required: [
        "restores battle-destroying recovery from the destroyed target's base ATK through CHAININFO",
        "local rec=bc:GetBaseAttack()",
        "Duel.Recover(p,d,REASON_EFFECT)",
        "eventValue: 1700",
      ],
    },
    {
      file: "lua-real-script-gravekeepers-vassal-battle-damage-to-effect.test.ts",
      kind: "gravekeepersVassalBattleDamageToEffect",
      required: ["restores Gravekeeper's Vassal and treats its battle damage as effect damage", "action: \"effectDamage\"", "eventReason: 64", "eventReasonEffectId: 1"],
    },
    { file: "lua-real-script-great-long-nose-skip-battle.test.ts", kind: "greatLongNoseBattleDamageBattleSkip", required: ["restores its battle-damage trigger into an opponent Battle Phase skip", "EFFECT_SKIP_BP", "phase: \"battle\", remaining: 1"] },
    {
      file: "lua-real-script-hayate-battled-send.test.ts",
      kind: "hayateBattledDeckSend",
      required: ["restores its direct-attack EVENT_BATTLED trigger and sends a Sky Striker card from Deck to Graveyard", "directAttack === true", "reasonEffectId: 3"],
    },
    { file: "lua-real-script-hino-kagu-tsuchi-predraw-discard.test.ts", kind: "hinoKaguTsuchiBattleDamagePredrawDiscard", required: ["restores its battle-damage trigger into the opponent's next Draw Phase hand discard", "eventName: \"preDraw\"", "eventName: \"discarded\""] },
    {
      file: "lua-real-script-honest-damage-step.test.ts",
      kind: "honestDamageStepBoost",
      required: ["restores Honest's damage-step hand effect and battle ATK update", "chainResponderScript", "host.messages).not.toContain"],
    },
    {
      file: "lua-real-script-injection-fairy-lily-pre-damage-lp-boost.test.ts",
      kind: "injectionFairyLilyPreDamageLpBoost",
      required: [
        "restores its LP cost, damage-calculation flag, temporary ATK boost, and battle damage",
        "Duel.PayLPCost(tp,2000)",
        "RegisterFlagEffect(id,RESET_PHASE|PHASE_DAMAGE_CAL,0,1)",
        "battleDamage).toEqual({ 0: 0, 1: 1400 })",
      ],
    },
    {
      file: "lua-real-script-insect-princess-battled-flag-atk.test.ts",
      kind: "insectPrincessBattleDestroyingFlagAtk",
      required: ["restores EVENT_BATTLED flag state into its battle-destroying ATK gain trigger", "e2:SetCode(EVENT_BATTLED)", "e3:SetCode(EVENT_BATTLE_DESTROYING)", "insect princess attack 2400"],
    },
    {
      file: "lua-real-script-key-mouse-battle-destroyed-search.test.ts",
      kind: "keyMouseBattleDestroyedSearch",
      required: ["restores EVENT_BATTLE_DESTROYED Deck search-to-hand and confirmation", "reasonCardUid: opponent!.uid", "eventName: \"sentToHandConfirmed\""],
    },
    {
      file: "lua-real-script-scarr-battle-destroyed-mandatory-search.test.ts",
      kind: "scarrMandatoryBattleDestroyedSearch",
      required: ["forced EVENT_BATTLE_DESTROYED Graveyard condition", "triggerBucket: \"opponentMandatory\"", "eventName: \"sentToHandConfirmed\""],
    },
    {
      file: "lua-real-script-ka2-des-scissors-battle-destroying-level-damage.test.ts",
      kind: "ka2DesScissorsBattleDestroyingLevelDamage",
      required: [
        "restores KA-2 Des Scissors' battle-destroying Level-scaled damage without player-target property",
        "expect(script).not.toContain(\"e1:SetProperty(EFFECT_FLAG_PLAYER_TARGET)\")",
        "local dam=bc:GetLevel()*500",
        "eventValue: 3000",
      ],
    },
    {
      file: "lua-real-script-magic-cylinder-battle-window.test.ts",
      kind: "magicCylinderDamageReflect",
      required: ["restores Magic Cylinder's attack-declaration target and resolves effect damage", "targetUids: [attacker!.uid]", "lifePoints).toBe(6200)"],
    },
    {
      file: "lua-real-script-madolche-waltz-battled-field-damage.test.ts",
      kind: "madolcheWaltzBattledFieldDamage",
      required: [
        "restores its Spell/Trap-zone EVENT_BATTLED field trigger into target-param effect damage",
        "c:IsSetCard(SET_MADOLCHE)",
        "eventName: \"afterDamageCalculation\"",
        "eventName: \"damageDealt\"",
      ],
    },
    {
      file: "lua-real-script-magical-arm-shield-calculate-damage.test.ts",
      kind: "magicalArmShieldBattleRetargetDamage",
      required: ["restores temporary control of an opponent monster and resolves CalculateDamage against it", "battleWindow?.kind).toBe(\"attackNegationResponse\")", "eventName: \"controlChanged\""],
    },
    {
      file: "lua-real-script-miniaturize-persistent-damage-step-stat.test.ts",
      kind: "miniaturizePersistentDamageStepStat",
      required: ["restores official persistent target into Damage Step ATK and Level updates", "miniaturize persistent true/true/1/800/3", "battleDamage[0]).toBe(100)"],
    },
    {
      file: "lua-real-script-mirage-knight-battle-target-atk.test.ts",
      kind: "mirageKnightBattleTargetAtk",
      required: ["restores GetBattleTarget damage-calculation ATK and End Phase self-banish after battle", "battleWindow?.kind).toBe(\"duringDamageCalculation\")", "location: \"banished\""],
    },
    { file: "lua-real-script-moja-battle-destroyed-grave-to-hand.test.ts", kind: "mojaBattleDestroyedGraveToHand", required: ["restores EVENT_BATTLE_DESTROYED targeting a Level 4 Beast in Graveyard and returns it to hand", "Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil)", "Duel.SendtoHand(tc,nil,REASON_EFFECT)", "eventName: \"sentToHandConfirmed\""] },
    {
      file: "lua-real-script-naturia-spiderfang-attack-announce-lock.test.ts",
      kind: "naturiaSpiderfangAttackAnnouncementLock",
      required: ["restores its custom-activity conditioned attack-announcement lock", "spiderfang.uid, target.uid)).toBe(false)", "ordinary.uid, target.uid)).toBe(true)"],
    },
    {
      file: "lua-real-script-negate-attack-battle-window.test.ts",
      kind: "negateAttackBattlePhaseSkipNegate",
      required: ["restores and resolves Negate Attack from the Project Ignis attack-declaration script", "attackCanceledUids).toEqual([firstAttacker!.uid])", "skippedPhases).toEqual([{ player: 0, phase: \"battle\", remaining: 1 }])"],
    },
    {
      file: "lua-real-script-nightmare-magician-battle-control.test.ts",
      kind: "nightmareMagicianEndDamageControl",
      required: ["restores battle-target indestructibility and controls the battled monster at Damage Step end", "luaTargetDescriptor: \"target:source-or-battle-target\"", "previousController: 1"],
    },
    {
      file: "lua-real-script-nitro-warrior-chain-attack-target.test.ts",
      kind: "nitroWarriorBattledChainAttackTarget",
      required: ["restores its battled trigger and chain-attacks the selected position-changed monster", "eventCode: 1138", "currentAttack).toMatchObject({ attackerUid: nitro!.uid, targetUid: followupTarget!.uid })"],
    },
    {
      file: "lua-real-script-number-13-must-attack-reflect.test.ts",
      kind: "number13MustAttackReflectDamage",
      required: [
        "restores detach-cost group position change, temporary must-attack target locks, and GetAttackTarget reflect damage",
        "e1:SetCost(Cost.DetachFromSelf(1))",
        "EFFECT_INDESTRUCTABLE_BATTLE",
        "EFFECT_MUST_ATTACK_MONSTER",
        "EFFECT_REFLECT_BATTLE_DAMAGE",
        "battleDamage).toEqual({ 0: 0, 1: 1000 })",
      ],
    },
    {
      file: "lua-real-script-number-c96-also-battle-damage.test.ts",
      kind: "numberC96AlsoBattleDamage",
      required: ["restores Number C96 and applies also battle damage to the opponent", "battleDamage).toEqual({ 0: 800, 1: 800 })", "eventPlayer: 1"],
    },
    {
      file: "lua-real-script-odd-eyes-dragon-battle-destroying-damage.test.ts",
      kind: "oddEyesDragonBattleDestroyingDamage",
      required: [
        "restores Odd-Eyes Dragon's battle-destroying trigger into target-player damage from CHAININFO",
        "Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,dam)",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
        "eventValue: 800",
      ],
    },
    {
      file: "lua-real-script-predaplant-sarraceniant-battled-destroy.test.ts",
      kind: "predaplantSarraceniantBattledDestroy",
      required: ["restores its EVENT_BATTLED trigger and destroys the monster it battled", "eventCode: 1138", "reasonEffectId: 2"],
    },
    {
      file: "lua-real-script-power-wall-pre-damage-deck-mill-shield.test.ts",
      kind: "powerWallPreDamageDeckMillShield",
      required: ["restores pre-damage battle damage lookup, Deck discard, operated group, and damage prevention", "eventCode: 1134", "Duel.GetOperatedGroup()", "eventName === \"discarded\"", "eventName === \"battleDamageDealt\")).toEqual([])"],
    },
    {
      file: "lua-real-script-radiant-spirit-battle-destroyed-group-destroy.test.ts",
      kind: "radiantSpiritBattleDestroyedGroupDestroy",
      required: ["restores mandatory battle-destroyed GetMatchingGroup destruction from a real script", "eventCode: 1140", "targetUids: [darkTarget.uid, attacker.uid, facedownTarget.uid]"],
    },
    {
      file: "lua-real-script-reflect-bounder-battle-confirm-destroy.test.ts",
      kind: "reflectBounderBattleConfirmDestroy",
      required: ["restores battle-confirm damage into a later battled self-destruction trigger", "eventName: \"battleConfirmed\"", "eventValue: 1700"],
    },
    {
      file: "lua-real-script-drillroid-battle-confirm-destroy.test.ts",
      kind: "drillroidBattleConfirmDestroy",
      required: ["restores battle-confirm defense-target destruction and ends the pending battle", "Duel.GetAttackTarget()", "Duel.Destroy(t,REASON_EFFECT)", "eventName: \"destroyed\"", "eventReasonEffectId: 1"],
    },
    {
      file: "lua-real-script-ring-of-magnetism-only-attack.test.ts",
      kind: "ringOfMagnetismOnlyAttackEquipped",
      required: ["restores its equipped-monster-only attack surface", "equippedTarget.uid)).toBe(true)", "sideTarget.uid)).toBe(false)"],
    },
    {
      file: "lua-real-script-sakuretsu-armor-battle-window.test.ts",
      kind: "sakuretsuArmorAttackDestroy",
      required: ["restores Sakuretsu Armor's attack-declaration target and destroys the active attacker", "location: \"graveyard\"", "players[1].lifePoints).toBe(8000)"],
    },
    {
      file: "lua-real-script-sasuke-samurai-battle-start-destroy.test.ts",
      kind: "sasukeSamuraiBattleStartDestroy",
      required: ["restores its EVENT_BATTLE_START mandatory trigger and destroys the face-down Defense target", "eventCode: 1132", "eventReasonEffectId: 1"],
    },
    {
      file: "lua-real-script-scrap-iron-scarecrow-battle-window.test.ts",
      kind: "scrapIronScarecrowSetAgainNegate",
      required: ["restores Scrap-Iron Scarecrow and keeps it set after negating the attack", "attackCanceledUids).toEqual([attacker!.uid])", "position: \"faceDown\", faceUp: false"],
    },
    {
      file: "lua-real-script-shadow-spell-goat-damage-calculation-persistent.test.ts",
      kind: "shadowSpellGoatDamageCalculationStat",
      required: ["restores a damage-calculation persistent target into ATK loss before battle damage", "battleWindow?.kind).toBe(\"duringDamageCalculation\")", "chainResponderScript"],
    },
    {
      file: "lua-real-script-smoke-mosquito-pre-damage-half-battle-damage.test.ts",
      kind: "smokeMosquitoPreDamageHalfDamageSummon",
      required: ["restores pre-damage self Special Summon, temporary HALF_DAMAGE battle modifier, and battle skip", "battleWindow?.kind).not.toBe(\"replayDecision\")", "battleDamage).toEqual({ 0: 750, 1: 0 })"],
    },
    {
      file: "lua-real-script-susa-soldier-half-damage.test.ts",
      kind: "susaSoldierHalfDamage",
      required: ["restores aux.ChangeBattleDamage HALF_DAMAGE and halves battle damage it inflicts", "battleDamage[1]).toBe(500)", "eventValue: 500"],
    },
    {
      file: "lua-real-script-topologic-bomber-battled-damage.test.ts",
      kind: "topologicBomberBattledDamage",
      required: ["restores its EVENT_BATTLED trigger and deals effect damage from the battle target's base ATK", "eventName: \"damageDealt\"", "eventValue: 1200"],
    },
    {
      file: "lua-real-script-wall-of-illusion-battled.test.ts",
      kind: "wallOfIllusionBattledBounce",
      required: ["restores Wall of Illusion after damage calculation and returns its attacker to hand", "eventCode: 1138", "eventName: \"sentToHand\""],
    },
    {
      file: "lua-real-script-wall-thorns-battle-target-group-destroy.test.ts",
      kind: "wallOfThornsBattleTargetGroupDestroy",
      required: [
        'const wallCode = "2779999"',
        "restores its Plant battle-target Trap trigger and destroys opponent attack-position monsters as a group",
        "tc:IsControler(tp) and tc:IsFaceup() and tc:IsRace(RACE_PLANT)",
        "{ category: 0x1, targetUids: destroyedUids, count: 2, player: 0, parameter: 0 }",
      ],
    },
    { file: "lua-real-script-yamata-dragon-battle-damage-draw.test.ts", kind: "yamataDragonBattleDamageDraw", required: ["restores its battle-damage trigger and draws until 5 from CHAININFO_TARGET_PLAYER", "Duel.Draw(p,5-ht,REASON_EFFECT)", "\"eventName\": \"cardsDrawn\""] },
    { file: "lua-real-script-yata-garasu-skip-draw.test.ts", kind: "yataGarasuBattleDamageDrawSkip", required: ["restores its battle-damage trigger into the opponent's next Draw Phase skip", "EFFECT_SKIP_DP", "phase: \"draw\", remaining: 1"] },
    {
      file: "lua-real-script-zone-eater-delayed-battle-destroy.test.ts",
      kind: "zoneEaterDelayedBattleDestroy",
      required: ["restores battled target markers and destroys the marked monster on the fifth End Phase", "bc:RegisterEffect(e1)", "Duel.HintSelection(sg)", "Duel.Destroy(tc,REASON_EFFECT)", "reasonCardUid: zoneEater.uid"],
    },
    {
      file: "lua-real-script-yomi-ship-battle-destroyed.test.ts",
      kind: "yomiShipBattleDestroyedDestroy",
      required: ["restores Yomi Ship's battle-destroyed trigger and destroys the monster that destroyed it", "eventCode: 1140", "reasonCardUid: attacker!.uid"],
    },
  ] satisfies Array<RequiredFixture<BattleSemanticVariant>>)
    .map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

export function countBattleSemanticVariants(fixtures: Array<{ kind: BattleSemanticVariant }>): Record<BattleSemanticVariant, number> {
  return fixtures.reduce<Record<BattleSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    zeroBattleSemanticVariantCounts(),
  );
}

function zeroBattleSemanticVariantCounts(): Record<BattleSemanticVariant, number> {
  return Object.fromEntries(Object.keys(battleSemanticVariantCounts).map((kind) => [kind, 0])) as Record<BattleSemanticVariant, number>;
}

export function countAttackDeclarationTrapKinds(
  fixtures: Array<{ kind: AttackDeclarationTrapKind }>,
): Record<AttackDeclarationTrapKind, number> {
  return fixtures.reduce<Record<AttackDeclarationTrapKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    Object.fromEntries(Object.keys(attackDeclarationTrapKindCounts).map((kind) => [kind, 0])) as Record<AttackDeclarationTrapKind, number>,
  );
}

export function countBattleRoutingKinds(fixtures: Array<{ kind: BattleRoutingKind }>): Record<BattleRoutingKind, number> {
  return fixtures.reduce<Record<BattleRoutingKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    Object.fromEntries(Object.keys(battleRoutingKindCounts).map((kind) => [kind, 0])) as Record<BattleRoutingKind, number>,
  );
}

export function countBattleContinuousSemanticKinds(
  fixtures: Array<{ kind: BattleContinuousSemanticKind }>,
): Record<BattleContinuousSemanticKind, number> {
  return fixtures.reduce<Record<BattleContinuousSemanticKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    Object.fromEntries(Object.keys(battleContinuousSemanticKindCounts).map((kind) => [kind, 0])) as Record<BattleContinuousSemanticKind, number>,
  );
}

export function countDamageStepRestoreKinds(
  fixtures: Array<{ kind: DamageStepRestoreKind }>,
): Record<DamageStepRestoreKind, number> {
  return fixtures.reduce<Record<DamageStepRestoreKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    Object.fromEntries(Object.keys(damageStepRestoreKindCounts).map((kind) => [kind, 0])) as Record<DamageStepRestoreKind, number>,
  );
}

export function countBattleDamageSemanticKinds(
  fixtures: Array<{ kind: BattleDamageSemanticKind }>,
): Record<BattleDamageSemanticKind, number> {
  return fixtures.reduce<Record<BattleDamageSemanticKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    Object.fromEntries(Object.keys(battleDamageSemanticKindCounts).map((kind) => [kind, 0])) as Record<BattleDamageSemanticKind, number>,
  );
}

export function countBattleTriggerSemanticKinds(
  fixtures: Array<{ kind: BattleTriggerSemanticKind }>,
): Record<BattleTriggerSemanticKind, number> {
  return fixtures.reduce<Record<BattleTriggerSemanticKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    zeroBattleTriggerSemanticKindCounts(),
  );
}

function zeroBattleTriggerSemanticKindCounts(): Record<BattleTriggerSemanticKind, number> {
  return Object.fromEntries(Object.keys(battleTriggerSemanticKindCounts).map((kind) => [kind, 0])) as Record<BattleTriggerSemanticKind, number>;
}
