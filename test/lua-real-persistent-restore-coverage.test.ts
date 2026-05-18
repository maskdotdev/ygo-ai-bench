import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const PERSISTENT_FIXTURE_COUNT = 17;
const TARGETED_PERSISTENT_FIXTURE_COUNT = 13;
const REVIVE_DESTROY_PERSISTENT_FIXTURE_COUNT = 2;
const SPIRITS_INVITATION_PERSISTENT_FIXTURE_COUNT = 1;
const ATTACK_LOCK_PERSISTENT_FIXTURE_COUNT = 9;
const persistentKindCounts = {
  chainSolvingNegate: 1,
  fieldAttackOrPositionLock: 4,
  persistentDamage: 3,
  protection: 1,
  ritualOverlay: 1,
  specialSummonLock: 1,
  statModifier: 3,
  targetedDisableOrLock: 3,
} satisfies Record<PersistentKind, number>;
const persistentSemanticVariantCounts = {
  callOfTheHauntedReviveDestroyRelation: 1,
  dimensionSphinxBattleStepDamageActivation: 1,
  dragonsBindBothPlayerSpecialSummonRestriction: 1,
  fiendishChainPersistentDisableCleanup: 1,
  gravityBindLevelAttackRestriction: 1,
  levelLimitAreaBLevelPositionSetting: 1,
  maskOfTheAccursedEquipLockStandbyDamage: 1,
  messengerPeaceAtkThresholdMaintenanceLock: 1,
  miniaturizeDamageStepStatLevelUpdate: 1,
  moonDanceRitualEndPhaseOverlayMove: 1,
  nightmareWheelStandbyDamageRelation: 1,
  phantomKnightsFogBladeDisableAttackTargetLock: 1,
  prematureBurialEquipReviveDestroyRelation: 1,
  rareMetalmorphTargetBoostSpellNegateWatcher: 1,
  safeZoneProtectionTargetabilityCleanup: 1,
  shadowSpellDamageCalculationAtkLoss: 1,
  shatteredAxeStandbyFlagAtkLoss: 1,
  spellbindingCircleTrapTargetLocksCleanup: 1,
  spiritsInvitationReturnBounceMaintenance: 1,
  swordsRevealingLightRemainAttackLock: 1,
} satisfies Record<PersistentSemanticVariant, number>;

type PersistentKind =
  | "chainSolvingNegate"
  | "fieldAttackOrPositionLock"
  | "persistentDamage"
  | "protection"
  | "ritualOverlay"
  | "specialSummonLock"
  | "statModifier"
  | "targetedDisableOrLock";
type PersistentSemanticVariant =
  | "callOfTheHauntedReviveDestroyRelation"
  | "dimensionSphinxBattleStepDamageActivation"
  | "dragonsBindBothPlayerSpecialSummonRestriction"
  | "fiendishChainPersistentDisableCleanup"
  | "gravityBindLevelAttackRestriction"
  | "levelLimitAreaBLevelPositionSetting"
  | "maskOfTheAccursedEquipLockStandbyDamage"
  | "messengerPeaceAtkThresholdMaintenanceLock"
  | "miniaturizeDamageStepStatLevelUpdate"
  | "moonDanceRitualEndPhaseOverlayMove"
  | "nightmareWheelStandbyDamageRelation"
  | "phantomKnightsFogBladeDisableAttackTargetLock"
  | "prematureBurialEquipReviveDestroyRelation"
  | "rareMetalmorphTargetBoostSpellNegateWatcher"
  | "safeZoneProtectionTargetabilityCleanup"
  | "shadowSpellDamageCalculationAtkLoss"
  | "shatteredAxeStandbyFlagAtkLoss"
  | "spellbindingCircleTrapTargetLocksCleanup"
  | "spiritsInvitationReturnBounceMaintenance"
  | "swordsRevealingLightRemainAttackLock";

describe("Lua real persistent restore coverage", () => {
  it("requires representative persistent/remaining-field fixtures to assert grouped legal actions and clean Lua registry restore", () => {
    const files = realScriptPersistentFixtureFiles();
    expect(files).toHaveLength(PERSISTENT_FIXTURE_COUNT);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])");
      });

    expect(missing).toEqual([]);
  });

  it("keeps persistent fixture kinds explicit", () => {
    expect(countPersistentKinds(realScriptPersistentFixtures())).toEqual(persistentKindCounts);
  });

  it("requires representative persistent/remaining-field fixtures to prove restored field state and response suppression", () => {
    const files = realScriptPersistentFixtureFiles();
    expect(files).toHaveLength(PERSISTENT_FIXTURE_COUNT);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !/location:\s*["']spellTrapZone["']/.test(text)
          || !text.includes("host.messages).not.toContain")
          || !text.includes("host.messages).toContain");
      });

    expect(missing).toEqual([]);
  });

  it("requires targeted persistent fixtures to prove card target relations survive restore", () => {
    const files = realScriptTargetedPersistentFixtureFiles();
    expect(files).toHaveLength(TARGETED_PERSISTENT_FIXTURE_COUNT);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("cardTargetUids");
      });

    expect(missing).toEqual([]);
  });

  it("requires revive-destroy persistent fixtures to prove restored relation cleanup and clean Lua registry restore", () => {
    const fixtures = realScriptReviveDestroyPersistentFixtureFiles();
    expect(fixtures).toHaveLength(REVIVE_DESTROY_PERSISTENT_FIXTURE_COUNT);

    const missing = fixtures
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires Spirit's Invitation to prove restored previous-state bounce and maintenance branches", () => {
    const fixtures = spiritsInvitationPersistentFixtureFiles();
    expect(fixtures).toHaveLength(SPIRITS_INVITATION_PERSISTENT_FIXTURE_COUNT);

    const missing = fixtures
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires attack-lock persistent fixtures to prove restored illegal attacks stay hidden", () => {
    const files = realScriptAttackLockPersistentFixtureFiles();
    expect(files).toHaveLength(ATTACK_LOCK_PERSISTENT_FIXTURE_COUNT);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes('type === "declareAttack"')
          || !text.includes("toBe(false)");
      });

    expect(missing).toEqual([]);
  });

  it("keeps named persistent semantic variants explicit", () => {
    expect(countPersistentSemanticVariants(persistentSemanticVariants())).toEqual(persistentSemanticVariantCounts);

    const weak = persistentSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function realScriptPersistentFixtureFiles(): string[] {
  return realScriptPersistentFixtures().map(({ file }) => file);
}

function realScriptTargetedPersistentFixtureFiles(): string[] {
  return realScriptPersistentFixtureFiles()
    .filter((file) =>
      !file.includes("gravity-bind")
      && !file.includes("level-limit")
      && !file.includes("messenger-peace")
      && !file.includes("swords-revealing-light")
    );
}

function realScriptReviveDestroyPersistentFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-call-of-the-haunted-revive-destroy.test.ts",
      required: [
        "cardTargetUids: [target!.uid]",
        "expectLuaCallProbe(restoredRevive, targetCode, callCode, \"call probe 0/612701/1\")",
        "destroyDuelCard(restoredRevive.session.state, call!.uid, 0, duelReason.effect | duelReason.destroy, 0)",
        "destroyDuelCard(restoredTargetDestroy.session.state, target!.uid, 0, duelReason.effect | duelReason.destroy, 0)",
        'eventName === "destroyed" && event.eventCardUid === target!.uid',
        'eventName === "destroyed" && event.eventCardUid === call!.uid',
        "expect(restoredChain.host.messages).not.toContain(\"call responder resolved\")",
      ],
    },
    {
      file: "test/lua-real-script-premature-burial-revive-destroy.test.ts",
      required: [
        "cardTargetUids: [target!.uid]",
        "expectLuaPrematureProbe(restoredEquipped, targetCode, prematureCode, \"premature probe 0/612601/612601/1\")",
        "destroyDuelCard(restoredEquipped.session.state, premature!.uid, 0, duelReason.effect | duelReason.destroy, 0)",
        "previousEquippedToUid: target!.uid",
        "previousLocation: \"monsterZone\"",
        'eventName === "destroyed" && event.eventCardUid === premature!.uid',
        'eventName === "destroyed" && event.eventCardUid === target!.uid',
        "expect(restoredChain.host.messages).not.toContain(\"premature responder resolved\")",
      ],
    },
  ];
}

function spiritsInvitationPersistentFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-spirits-invitation-return-bounce.test.ts",
      required: [
        "Spirit's Invitation return bounce",
        "eventName: \"sentToHand\"",
        "eventCardUid: susa!.uid",
        "eventCardUid: opponentMonster!.uid",
        "eventName: \"lifePointCostPaid\"",
        "eventName: \"destroyed\"",
        "eventReason: duelReason.destroy | duelReason.cost",
        "host.messages).not.toContain(\"invitation responder resolved\")",
      ],
    },
  ];
}

function realScriptAttackLockPersistentFixtureFiles(): string[] {
  return [
    "lua-real-script-fiendish-chain-persistent-disable.test.ts",
    "lua-real-script-gravity-bind-persistent-attack-lock.test.ts",
    "lua-real-script-level-limit-area-b-position-lock.test.ts",
    "lua-real-script-mask-accursed-equip-lock-damage.test.ts",
    "lua-real-script-messenger-peace-maintenance-attack-lock.test.ts",
    "lua-real-script-phantom-knights-fog-blade-persistent-battle-target.test.ts",
    "lua-real-script-safe-zone-persistent-protection.test.ts",
    "lua-real-script-spellbinding-circle-persistent-lock.test.ts",
    "lua-real-script-swords-revealing-light-remain-lock.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptPersistentFixtures(): Array<{ file: string; kind: PersistentKind }> {
  return ([
    {
      file: "lua-real-script-dimension-sphinx-persistent-battle-damage.test.ts",
      kind: "persistentDamage",
    },
    {
      file: "lua-real-script-fiendish-chain-persistent-disable.test.ts",
      kind: "targetedDisableOrLock",
    },
    {
      file: "lua-real-script-dragons-bind-persistent-special-lock.test.ts",
      kind: "specialSummonLock",
    },
    {
      file: "lua-real-script-gravity-bind-persistent-attack-lock.test.ts",
      kind: "fieldAttackOrPositionLock",
    },
    {
      file: "lua-real-script-level-limit-area-b-position-lock.test.ts",
      kind: "fieldAttackOrPositionLock",
    },
    {
      file: "lua-real-script-mask-accursed-equip-lock-damage.test.ts",
      kind: "persistentDamage",
    },
    {
      file: "lua-real-script-messenger-peace-maintenance-attack-lock.test.ts",
      kind: "fieldAttackOrPositionLock",
    },
    {
      file: "lua-real-script-miniaturize-persistent-damage-step-stat.test.ts",
      kind: "statModifier",
    },
    {
      file: "lua-real-script-moon-dance-ritual-persistent-overlay.test.ts",
      kind: "ritualOverlay",
    },
    {
      file: "lua-real-script-nightmare-wheel-persistent-damage.test.ts",
      kind: "persistentDamage",
    },
    {
      file: "lua-real-script-phantom-knights-fog-blade-persistent-battle-target.test.ts",
      kind: "targetedDisableOrLock",
    },
    {
      file: "lua-real-script-rare-metalmorph-persistent-chain-solving-negate.test.ts",
      kind: "chainSolvingNegate",
    },
    {
      file: "lua-real-script-safe-zone-persistent-protection.test.ts",
      kind: "protection",
    },
    {
      file: "lua-real-script-shadow-spell-goat-damage-calculation-persistent.test.ts",
      kind: "statModifier",
    },
    {
      file: "lua-real-script-shattered-axe-persistent-standby-atk.test.ts",
      kind: "statModifier",
    },
    {
      file: "lua-real-script-spellbinding-circle-persistent-lock.test.ts",
      kind: "targetedDisableOrLock",
    },
    {
      file: "lua-real-script-swords-revealing-light-remain-lock.test.ts",
      kind: "fieldAttackOrPositionLock",
    },
  ] satisfies Array<{ file: string; kind: PersistentKind }>)
    .map(({ file, kind }) => ({ file: path.join("test", file), kind }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function persistentSemanticVariants(): Array<{
  file: string;
  kind: PersistentSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "lua-real-script-call-of-the-haunted-revive-destroy.test.ts",
      kind: "callOfTheHauntedReviveDestroyRelation",
      required: [
        'const callCode = "97077563"',
        "restores Call of the Haunted's Continuous Trap revive and mutual destruction",
        "cardTargetUids: [target!.uid]",
        'eventName === "destroyed" && event.eventCardUid === target!.uid',
        'eventName === "destroyed" && event.eventCardUid === call!.uid',
      ],
    },
    {
      file: "lua-real-script-dimension-sphinx-persistent-battle-damage.test.ts",
      kind: "dimensionSphinxBattleStepDamageActivation",
      required: [
        'const dimensionSphinxCode = "17787975"',
        "restores official persistent target into Battle Step damage activation",
        "cardTargetUids",
      ],
    },
    {
      file: "lua-real-script-dragons-bind-persistent-special-lock.test.ts",
      kind: "dragonsBindBothPlayerSpecialSummonRestriction",
      required: [
        'const bindCode = "16278116"',
        "restores official persistent target into both-player Special Summon restrictions",
        "cardTargetUids",
      ],
    },
    {
      file: "lua-real-script-fiendish-chain-persistent-disable.test.ts",
      kind: "fiendishChainPersistentDisableCleanup",
      required: [
        'const fiendishCode = "50078509"',
        "restores official persistent disable and destroy-only target cleanup",
        "cardTargetUids",
        'eventName === "destroyed" && event.eventCardUid === fiendish!.uid',
      ],
    },
    {
      file: "lua-real-script-gravity-bind-persistent-attack-lock.test.ts",
      kind: "gravityBindLevelAttackRestriction",
      required: [
        'const gravityBindCode = "85742772"',
        "restores official field attack restriction by Level",
        'type === "declareAttack"',
      ],
    },
    {
      file: "lua-real-script-level-limit-area-b-position-lock.test.ts",
      kind: "levelLimitAreaBLevelPositionSetting",
      required: [
        'const levelLimitCode = "3136426"',
        "restores official field position setting by Level",
        'type === "declareAttack"',
      ],
    },
    {
      file: "lua-real-script-mask-accursed-equip-lock-damage.test.ts",
      kind: "maskOfTheAccursedEquipLockStandbyDamage",
      required: [
        'const maskCode = "56948373"',
        "restores equip target attack lock and Standby damage to the equipped monster controller",
        "cardTargetUids",
      ],
    },
    {
      file: "lua-real-script-messenger-peace-maintenance-attack-lock.test.ts",
      kind: "messengerPeaceAtkThresholdMaintenanceLock",
      required: [
        'const messengerCode = "44656491"',
        "restores official ATK-threshold attack restriction and Standby maintenance cost",
        'type === "declareAttack"',
      ],
    },
    {
      file: "lua-real-script-miniaturize-persistent-damage-step-stat.test.ts",
      kind: "miniaturizeDamageStepStatLevelUpdate",
      required: [
        'const miniaturizeCode = "34815282"',
        "restores official persistent target into Damage Step ATK and Level updates",
        "cardTargetUids",
      ],
    },
    {
      file: "lua-real-script-moon-dance-ritual-persistent-overlay.test.ts",
      kind: "moonDanceRitualEndPhaseOverlayMove",
      required: [
        'const ritualCode = "14005031"',
        "restores official persistent target operation into End Phase overlay material movement",
        "cardTargetUids",
      ],
    },
    {
      file: "lua-real-script-nightmare-wheel-persistent-damage.test.ts",
      kind: "nightmareWheelStandbyDamageRelation",
      required: [
        'const wheelCode = "54704216"',
        "restores official persistent trap target relation into Standby Phase damage",
        "cardTargetUids",
      ],
    },
    {
      file: "lua-real-script-phantom-knights-fog-blade-persistent-battle-target.test.ts",
      kind: "phantomKnightsFogBladeDisableAttackTargetLock",
      required: [
        'const fogBladeCode = "25542642"',
        "restores official persistent disable, attack lock, and battle-target selection lock",
        "cardTargetUids",
      ],
    },
    {
      file: "lua-real-script-premature-burial-revive-destroy.test.ts",
      kind: "prematureBurialEquipReviveDestroyRelation",
      required: [
        'const prematureCode = "70828912"',
        "restores Premature Burial's LP cost, equip target relation, and leave-field destroy",
        "previousEquippedToUid: target!.uid",
        'eventName === "destroyed" && event.eventCardUid === premature!.uid',
        'eventName === "destroyed" && event.eventCardUid === target!.uid',
      ],
    },
    {
      file: "lua-real-script-rare-metalmorph-persistent-chain-solving-negate.test.ts",
      kind: "rareMetalmorphTargetBoostSpellNegateWatcher",
      required: [
        'const rareMetalmorphCode = "12503902"',
        "restores official persistent target boost and targeted Spell negation watcher",
        "cardTargetUids",
      ],
    },
    {
      file: "lua-real-script-safe-zone-persistent-protection.test.ts",
      kind: "safeZoneProtectionTargetabilityCleanup",
      required: [
        'const safeZoneCode = "38296564"',
        "restores official persistent protection, targetability, direct-attack lock, and handler-leaves cleanup",
        "cardTargetUids",
        'eventName: "destroyed"',
        "eventCode: 1029",
        "eventCardUid: safeZone!.uid",
        "eventCardUid: target!.uid",
      ],
    },
    {
      file: "lua-real-script-shadow-spell-goat-damage-calculation-persistent.test.ts",
      kind: "shadowSpellDamageCalculationAtkLoss",
      required: [
        'const shadowSpellCode = "504700050"',
        "restores a damage-calculation persistent target into ATK loss before battle damage",
        "cardTargetUids",
      ],
    },
    {
      file: "lua-real-script-shattered-axe-persistent-standby-atk.test.ts",
      kind: "shatteredAxeStandbyFlagAtkLoss",
      required: [
        'const shatteredAxeCode = "12117532"',
        "restores official persistent target relation into Standby flag-based ATK loss",
        "cardTargetUids",
      ],
    },
    {
      file: "lua-real-script-spellbinding-circle-persistent-lock.test.ts",
      kind: "spellbindingCircleTrapTargetLocksCleanup",
      required: [
        'const circleCode = "18807108"',
        "restores official persistent trap target locks and target-destroy cleanup",
        "cardTargetUids",
        'eventName: "destroyed"',
        "eventCode: 1029",
        "eventCardUid: circle!.uid",
      ],
    },
    {
      file: "lua-real-script-spirits-invitation-return-bounce.test.ts",
      kind: "spiritsInvitationReturnBounceMaintenance",
      required: [
        'const invitationCode = "92394653"',
        "restores its sent-to-hand Spirit trigger and opponent-selected monster return",
        "restores its Standby maintenance cost pay and destroy branches",
      ],
    },
    {
      file: "lua-real-script-swords-revealing-light-remain-lock.test.ts",
      kind: "swordsRevealingLightRemainAttackLock",
      required: [
        'const swordsCode = "72302403"',
        "restores position reveal, remain-field state, and opponent attack restriction",
        'type === "declareAttack"',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: PersistentSemanticVariant;
    required: string[];
  }>)
    .map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function countPersistentKinds(fixtures: Array<{ kind: PersistentKind }>): Record<PersistentKind, number> {
  return fixtures.reduce<Record<PersistentKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      chainSolvingNegate: 0,
      fieldAttackOrPositionLock: 0,
      persistentDamage: 0,
      protection: 0,
      ritualOverlay: 0,
      specialSummonLock: 0,
      statModifier: 0,
      targetedDisableOrLock: 0,
    },
  );
}

function countPersistentSemanticVariants(
  fixtures: Array<{ kind: PersistentSemanticVariant }>,
): Record<PersistentSemanticVariant, number> {
  return fixtures.reduce<Record<PersistentSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      callOfTheHauntedReviveDestroyRelation: 0,
      dimensionSphinxBattleStepDamageActivation: 0,
      dragonsBindBothPlayerSpecialSummonRestriction: 0,
      fiendishChainPersistentDisableCleanup: 0,
      gravityBindLevelAttackRestriction: 0,
      levelLimitAreaBLevelPositionSetting: 0,
      maskOfTheAccursedEquipLockStandbyDamage: 0,
      messengerPeaceAtkThresholdMaintenanceLock: 0,
      miniaturizeDamageStepStatLevelUpdate: 0,
      moonDanceRitualEndPhaseOverlayMove: 0,
      nightmareWheelStandbyDamageRelation: 0,
      phantomKnightsFogBladeDisableAttackTargetLock: 0,
      prematureBurialEquipReviveDestroyRelation: 0,
      rareMetalmorphTargetBoostSpellNegateWatcher: 0,
      safeZoneProtectionTargetabilityCleanup: 0,
      shadowSpellDamageCalculationAtkLoss: 0,
      shatteredAxeStandbyFlagAtkLoss: 0,
      spellbindingCircleTrapTargetLocksCleanup: 0,
      spiritsInvitationReturnBounceMaintenance: 0,
      swordsRevealingLightRemainAttackLock: 0,
    },
  );
}
