import fs from "node:fs";
import path from "node:path";

export const root = process.cwd();
export const testRoot = path.join(root, "test");
export const battleKeywords = ["battle", "attack", "damage"];
export const realScriptBattleFixtureCount = 157;
export const battleLegalActionFixtureCount = 4;
export const attackDeclarationTrapFixtureCount = 6;
export const battleRoutingFixtureCount = 6;
export const battleContinuousSemanticFixtureCount = 1;
export const damageStepRestoreFixtureCount = 4;
export const battleDamageSemanticFixtureCount = 8;
export const battleTriggerSemanticFixtureCount = 16;
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
  onlyAttackEquipped: 1,
} satisfies Record<BattleRoutingKind, number>;
export const battleContinuousSemanticKindCounts = {
  battledGraveDisable: 1,
} satisfies Record<BattleContinuousSemanticKind, number>;
export const damageStepRestoreKindCounts = {
  activatedDamageStepBoost: 1,
  honestDamageStepBoost: 1,
  persistentDamageCalculationStat: 1,
  persistentDamageStepStat: 1,
} satisfies Record<DamageStepRestoreKind, number>;
export const battleDamageSemanticKindCounts = {
  alsoBattleDamage: 1,
  battleDamagePrevention: 1,
  battleDamageToEffect: 1,
  battleRetargetDamage: 1,
  halfBattleDamage: 1,
  pierceBattleDamage: 1,
  reflectBattleDamage: 1,
  temporaryDamageCalcBoost: 1,
} satisfies Record<BattleDamageSemanticKind, number>;
export const battleTriggerSemanticKindCounts = {
  battleStartDestroy: 1,
  battleConfirmDestroy: 1,
  battleDestroyingDecktopConfirm: 1,
  battleDestroyedDestroy: 1,
  battleDestroyedGroupDestroy: 1,
  battleDestroyingSelectEffect: 1,
  battleSearch: 2,
  battledBounce: 1,
  battledDeckSend: 1,
  battledDestroy: 1,
  battledDamage: 1,
  battledDisable: 1,
  endDamageControl: 1,
  endDamageDestroy: 1,
  mutualBattleDestroyedSegoc: 1,
} satisfies Record<BattleTriggerSemanticKind, number>;
export const battleSemanticVariantCounts = {
  alienOfJusticeNullfierBattledDisable: 1,
  amazonessSwordsWomanReflectDamage: 1,
  ancientGearGolemPiercingDamage: 1,
  aojThousandArmsLightOnlyAttackAll: 1,
  battleDamagePreventionMachineLordUr: 1,
  blizzardWarriorBattleDestroyingDecktopConfirm: 1,
  blsSoldierChaosBattleDestroyingSelectEffect: 1,
  darkRulerHaDesBattledGraveDisable: 1,
  decoyroidBattleTargetSelectionLock: 1,
  dimensionalPrisonAttackBanish: 1,
  drainingShieldLpRecoverNegate: 1,
  fabledAshenveilDamageStepBoost: 1,
  gemKnightSardonyxBattleSearch: 1,
  getsuFuhmaEndDamageDestroy: 1,
  ghostBirdExtraMonsterAttack: 1,
  giantRatMutualBattleDestroyedSegoc: 1,
  grasschopperGeminiAttackAll: 1,
  gravekeepersVassalBattleDamageToEffect: 1,
  hayateBattledDeckSend: 1,
  honestDamageStepBoost: 1,
  keyMouseBattleDestroyedSearch: 1,
  magicCylinderDamageReflect: 1,
  magicalArmShieldBattleRetargetDamage: 1,
  miniaturizePersistentDamageStepStat: 1,
  mirageKnightBattleTargetAtk: 1,
  naturiaSpiderfangAttackAnnouncementLock: 1,
  negateAttackBattlePhaseSkipNegate: 1,
  nightmareMagicianEndDamageControl: 1,
  numberC96AlsoBattleDamage: 1,
  predaplantSarraceniantBattledDestroy: 1,
  radiantSpiritBattleDestroyedGroupDestroy: 1,
  reflectBounderBattleConfirmDestroy: 1,
  ringOfMagnetismOnlyAttackEquipped: 1,
  sakuretsuArmorAttackDestroy: 1,
  sasukeSamuraiBattleStartDestroy: 1,
  scrapIronScarecrowSetAgainNegate: 1,
  shadowSpellGoatDamageCalculationStat: 1,
  susaSoldierHalfDamage: 1,
  topologicBomberBattledDamage: 1,
  wallOfIllusionBattledBounce: 1,
  yomiShipBattleDestroyedDestroy: 1,
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

export type BattleTriggerSemanticKind =
  | "battleStartDestroy"
  | "battleConfirmDestroy"
  | "battleDestroyingDecktopConfirm"
  | "battleDestroyedDestroy"
  | "battleDestroyedGroupDestroy"
  | "battleDestroyingSelectEffect"
  | "battleSearch"
  | "battledBounce"
  | "battledDeckSend"
  | "battledDestroy"
  | "battledDamage"
  | "battledDisable"
  | "endDamageControl"
  | "endDamageDestroy"
  | "mutualBattleDestroyedSegoc";
export type BattleSemanticVariant =
  | "alienOfJusticeNullfierBattledDisable"
  | "amazonessSwordsWomanReflectDamage"
  | "ancientGearGolemPiercingDamage"
  | "aojThousandArmsLightOnlyAttackAll"
  | "battleDamagePreventionMachineLordUr"
  | "blizzardWarriorBattleDestroyingDecktopConfirm"
  | "blsSoldierChaosBattleDestroyingSelectEffect"
  | "darkRulerHaDesBattledGraveDisable"
  | "decoyroidBattleTargetSelectionLock"
  | "dimensionalPrisonAttackBanish"
  | "drainingShieldLpRecoverNegate"
  | "fabledAshenveilDamageStepBoost"
  | "gemKnightSardonyxBattleSearch"
  | "getsuFuhmaEndDamageDestroy"
  | "ghostBirdExtraMonsterAttack"
  | "giantRatMutualBattleDestroyedSegoc"
  | "grasschopperGeminiAttackAll"
  | "gravekeepersVassalBattleDamageToEffect"
  | "hayateBattledDeckSend"
  | "honestDamageStepBoost"
  | "keyMouseBattleDestroyedSearch"
  | "magicCylinderDamageReflect"
  | "magicalArmShieldBattleRetargetDamage"
  | "miniaturizePersistentDamageStepStat"
  | "mirageKnightBattleTargetAtk"
  | "naturiaSpiderfangAttackAnnouncementLock"
  | "negateAttackBattlePhaseSkipNegate"
  | "nightmareMagicianEndDamageControl"
  | "numberC96AlsoBattleDamage"
  | "predaplantSarraceniantBattledDestroy"
  | "radiantSpiritBattleDestroyedGroupDestroy"
  | "reflectBounderBattleConfirmDestroy"
  | "ringOfMagnetismOnlyAttackEquipped"
  | "sakuretsuArmorAttackDestroy"
  | "sasukeSamuraiBattleStartDestroy"
  | "scrapIronScarecrowSetAgainNegate"
  | "shadowSpellGoatDamageCalculationStat"
  | "susaSoldierHalfDamage"
  | "topologicBomberBattledDamage"
  | "wallOfIllusionBattledBounce"
  | "yomiShipBattleDestroyedDestroy";

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

export function realScriptAttackDeclarationTrapFixtureFiles(): Array<{
  file: string;
  kind: AttackDeclarationTrapKind;
  required: string[];
}> {
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
  ] satisfies Array<{
    file: string;
    kind: AttackDeclarationTrapKind;
    required: string[];
  }>).map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }));
}

export function realScriptBattleRoutingFixtureFiles(): Array<{
  file: string;
  kind: BattleRoutingKind;
  required: string[];
}> {
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
      file: "lua-real-script-ring-of-magnetism-only-attack.test.ts",
      kind: "onlyAttackEquipped",
      required: [
        "hasAttack(actions, attacker.uid, equippedTarget.uid)).toBe(true)",
        "hasAttack(actions, attacker.uid, sideTarget.uid)).toBe(false)",
        "directAttack)).toBe(false)",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: BattleRoutingKind;
    required: string[];
  }>)
    .map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

export function realScriptBattleContinuousSemanticFixtureFiles(): Array<{
  file: string;
  kind: BattleContinuousSemanticKind;
  required: string[];
}> {
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
  ] satisfies Array<{
    file: string;
    kind: BattleContinuousSemanticKind;
    required: string[];
  }>).map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }));
}

export function realScriptDamageStepRestoreFixtureFiles(): string[] {
  return realScriptDamageStepRestoreFixtures().map(({ file }) => file);
}

export function realScriptDamageStepRestoreFixtures(): Array<{ file: string; kind: DamageStepRestoreKind }> {
  return ([
    {
      file: "lua-real-script-fabled-ashenveil-damage-step-boost.test.ts",
      kind: "activatedDamageStepBoost",
    },
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
  ] satisfies Array<{ file: string; kind: DamageStepRestoreKind }>)
    .map(({ file, kind }) => ({ file: path.join("test", file), kind }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

export function realScriptBattleDamageSemanticFixtureFiles(): Array<{
  file: string;
  kind: BattleDamageSemanticKind;
  required: string[];
}> {
  return ([
    {
      file: "lua-real-script-ancient-gear-golem-pierce-battle-damage.test.ts",
      kind: "pierceBattleDamage",
      required: [
        "expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 1500 })",
        "eventValue: 1500",
      ],
    },
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
      file: "lua-real-script-battle-damage-prevention.test.ts",
      kind: "battleDamagePrevention",
      required: [
        "expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 })",
        'expect.objectContaining({ action: "battleDamage", player: 1, detail: "0" })',
      ],
    },
    {
      file: "lua-real-script-gravekeepers-vassal-battle-damage-to-effect.test.ts",
      kind: "battleDamageToEffect",
      required: [
        "expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 700 })",
        'expect.objectContaining({ action: "effectDamage", player: 1, detail: "700" })',
        "eventReason: 64",
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
  ] satisfies Array<{
    file: string;
    kind: BattleDamageSemanticKind;
    required: string[];
  }>).map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }));
}

export function realScriptBattleTriggerSemanticFixtureFiles(): Array<{
  file: string;
  kind: BattleTriggerSemanticKind;
  required: string[];
}> {
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
  ] satisfies Array<{
    file: string;
    kind: BattleTriggerSemanticKind;
    required: string[];
  }>).map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }));
}

export function realScriptBattleSemanticVariants(): Array<{
  file: string;
  kind: BattleSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "lua-real-script-ally-of-justice-nullfier-battled-disable.test.ts",
      kind: "alienOfJusticeNullfierBattledDisable",
      required: ["restores its EVENT_BATTLED label-object trigger and disables the LIGHT battle target", "eventCode: 1138", "code: 8"],
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
    {
      file: "lua-real-script-fabled-ashenveil-damage-step-boost.test.ts",
      kind: "fabledAshenveilDamageStepBoost",
      required: ["restores its hand cost and pre-damage calculation ATK boost", "battleWindow?.kind).toBe(\"beforeDamageCalculation\")", "currentAttack(boostedAshenveil"],
    },
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
      file: "lua-real-script-gravekeepers-vassal-battle-damage-to-effect.test.ts",
      kind: "gravekeepersVassalBattleDamageToEffect",
      required: ["restores Gravekeeper's Vassal and treats its battle damage as effect damage", "action: \"effectDamage\"", "eventReason: 64"],
    },
    {
      file: "lua-real-script-hayate-battled-send.test.ts",
      kind: "hayateBattledDeckSend",
      required: ["restores its direct-attack EVENT_BATTLED trigger and sends a Sky Striker card from Deck to Graveyard", "directAttack === true", "reasonEffectId: 3"],
    },
    {
      file: "lua-real-script-honest-damage-step.test.ts",
      kind: "honestDamageStepBoost",
      required: ["restores Honest's damage-step hand effect and battle ATK update", "chainResponderScript", "host.messages).not.toContain"],
    },
    {
      file: "lua-real-script-key-mouse-battle-destroyed-search.test.ts",
      kind: "keyMouseBattleDestroyedSearch",
      required: ["restores EVENT_BATTLE_DESTROYED Deck search-to-hand and confirmation", "reasonCardUid: opponent!.uid", "eventName: \"sentToHandConfirmed\""],
    },
    {
      file: "lua-real-script-magic-cylinder-battle-window.test.ts",
      kind: "magicCylinderDamageReflect",
      required: ["restores Magic Cylinder's attack-declaration target and resolves effect damage", "targetUids: [attacker!.uid]", "lifePoints).toBe(6200)"],
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
      file: "lua-real-script-number-c96-also-battle-damage.test.ts",
      kind: "numberC96AlsoBattleDamage",
      required: ["restores Number C96 and applies also battle damage to the opponent", "battleDamage).toEqual({ 0: 800, 1: 800 })", "eventPlayer: 1"],
    },
    {
      file: "lua-real-script-predaplant-sarraceniant-battled-destroy.test.ts",
      kind: "predaplantSarraceniantBattledDestroy",
      required: ["restores its EVENT_BATTLED trigger and destroys the monster it battled", "eventCode: 1138", "reasonEffectId: 2"],
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
      file: "lua-real-script-yomi-ship-battle-destroyed.test.ts",
      kind: "yomiShipBattleDestroyedDestroy",
      required: ["restores Yomi Ship's battle-destroyed trigger and destroys the monster that destroyed it", "eventCode: 1140", "reasonCardUid: attacker!.uid"],
    },
  ] satisfies Array<{
    file: string;
    kind: BattleSemanticVariant;
    required: string[];
  }>)
    .map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

export function countBattleSemanticVariants(fixtures: Array<{ kind: BattleSemanticVariant }>): Record<BattleSemanticVariant, number> {
  return fixtures.reduce<Record<BattleSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      alienOfJusticeNullfierBattledDisable: 0,
      amazonessSwordsWomanReflectDamage: 0,
      ancientGearGolemPiercingDamage: 0,
      aojThousandArmsLightOnlyAttackAll: 0,
      battleDamagePreventionMachineLordUr: 0,
      blizzardWarriorBattleDestroyingDecktopConfirm: 0,
      blsSoldierChaosBattleDestroyingSelectEffect: 0,
      darkRulerHaDesBattledGraveDisable: 0,
      decoyroidBattleTargetSelectionLock: 0,
      dimensionalPrisonAttackBanish: 0,
      drainingShieldLpRecoverNegate: 0,
      fabledAshenveilDamageStepBoost: 0,
      gemKnightSardonyxBattleSearch: 0,
      getsuFuhmaEndDamageDestroy: 0,
      ghostBirdExtraMonsterAttack: 0,
      giantRatMutualBattleDestroyedSegoc: 0,
      grasschopperGeminiAttackAll: 0,
      gravekeepersVassalBattleDamageToEffect: 0,
      hayateBattledDeckSend: 0,
      honestDamageStepBoost: 0,
      keyMouseBattleDestroyedSearch: 0,
      magicCylinderDamageReflect: 0,
      magicalArmShieldBattleRetargetDamage: 0,
      miniaturizePersistentDamageStepStat: 0,
      mirageKnightBattleTargetAtk: 0,
      naturiaSpiderfangAttackAnnouncementLock: 0,
      negateAttackBattlePhaseSkipNegate: 0,
      nightmareMagicianEndDamageControl: 0,
      numberC96AlsoBattleDamage: 0,
      predaplantSarraceniantBattledDestroy: 0,
      radiantSpiritBattleDestroyedGroupDestroy: 0,
      reflectBounderBattleConfirmDestroy: 0,
      ringOfMagnetismOnlyAttackEquipped: 0,
      sakuretsuArmorAttackDestroy: 0,
      sasukeSamuraiBattleStartDestroy: 0,
      scrapIronScarecrowSetAgainNegate: 0,
      shadowSpellGoatDamageCalculationStat: 0,
      susaSoldierHalfDamage: 0,
      topologicBomberBattledDamage: 0,
      wallOfIllusionBattledBounce: 0,
      yomiShipBattleDestroyedDestroy: 0,
    },
  );
}

export function countAttackDeclarationTrapKinds(
  fixtures: Array<{ kind: AttackDeclarationTrapKind }>,
): Record<AttackDeclarationTrapKind, number> {
  return fixtures.reduce<Record<AttackDeclarationTrapKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      attackBanish: 0,
      attackDestroy: 0,
      attackNegateSetAgain: 0,
      battlePhaseSkipNegate: 0,
      damageReflect: 0,
      lpRecoverNegate: 0,
    },
  );
}

export function countBattleRoutingKinds(fixtures: Array<{ kind: BattleRoutingKind }>): Record<BattleRoutingKind, number> {
  return fixtures.reduce<Record<BattleRoutingKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      attackAllTargetFilter: 0,
      attackAnnouncementLock: 0,
      battleTargetSelectionLock: 0,
      extraMonsterAttack: 0,
      onlyAttackEquipped: 0,
    },
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
    {
      battledGraveDisable: 0,
    },
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
    {
      activatedDamageStepBoost: 0,
      honestDamageStepBoost: 0,
      persistentDamageCalculationStat: 0,
      persistentDamageStepStat: 0,
    },
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
    {
      alsoBattleDamage: 0,
      battleDamagePrevention: 0,
      battleDamageToEffect: 0,
      battleRetargetDamage: 0,
      halfBattleDamage: 0,
      pierceBattleDamage: 0,
      reflectBattleDamage: 0,
      temporaryDamageCalcBoost: 0,
    },
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
    {
      battleStartDestroy: 0,
      battleConfirmDestroy: 0,
      battleDestroyingDecktopConfirm: 0,
      battleDestroyedDestroy: 0,
      battleDestroyedGroupDestroy: 0,
      battleDestroyingSelectEffect: 0,
      battleSearch: 0,
      battledBounce: 0,
      battledDeckSend: 0,
      battledDestroy: 0,
      battledDamage: 0,
      battledDisable: 0,
      endDamageControl: 0,
      endDamageDestroy: 0,
      mutualBattleDestroyedSegoc: 0,
    },
  );
}
