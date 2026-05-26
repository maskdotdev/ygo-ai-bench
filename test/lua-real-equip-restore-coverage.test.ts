import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const equipFixtureCount = 26, equipRelationFixtureCount = 30, equipProbeFixtureCount = 22, equipOperationInfoFixtureCount = 20, equipCleanupFixtureCount = 14, equipInventoryFixtureCount = 33;
const equipKindCounts = {
  equipControl: 3,
  equipCost: 1,
  equipDamageLock: 1,
  equipGeminiStatus: 2,
  equipPierce: 2,
  equipProcedure: 16,
  equipReturn: 3,
  equipReviveBanish: 1,
  equipReviveDestroy: 2,
  equipSelfDestroy: 1,
  equipStatLock: 1,
} satisfies Record<EquipKind, number>;
const equipSemanticVariantCounts = {
  axeProcedureStat: 1,
  assaultSpiritsDamageStepEquipStat: 1,
  ancientGearTankDestroyDamage: 1,
  battleArchfiendShieldSetcode: 1,
  bigBangShotPierceBanish: 1,
  blackPendantSentDamage: 1,
  blastWithChainDestroyed: 1,
  butterflyDaggerReturn: 1,
  cestusBattleRecovery: 1,
  dragonTreasureRaceStat: 1,
  doomzCommandAdrasteiaGraveEquipDamage: 1,
  fairyMeteorCrushPierce: 1,
  fallingDownEquipStandbyDamage: 1,
  fulfillmentContractRitualReviveBanish: 1,
  gagagarevengeGraveEquipReviveStat: 1,
  gergonnesEndLinkedDestroyBurn: 1,
  geminiBoosterStatus: 1,
  gravityAxePositionLock: 1,
  graydleEagleBattleDestroyStealEquip: 1,
  guardianGrarlProcedure: 1,
  heartClearWaterSelfDestroy: 1,
  herculesBattleDraw: 1,
  herculesBattleLocks: 1,
  herculesGraveToDeck: 1,
  hornUnicornTopDeck: 1,
  inzektorEarwigEquipLeaveStat: 1,
  magePowerDynamicStats: 1,
  magnumExcaliburDetachEquipToDeck: 1,
  maskAccursedDamageLock: 1,
  megamorphLpAttack: 1,
  mordschlagImmunityPrecalcStat: 1,
  nuzzlerTopDeck: 1,
  orbYasakaSpiritReturn: 1,
  prematureBurialDestroy: 1,
  powerUpAdapterCustomEquipStat: 1,
  riderPierce: 1,
  robotBusterEquipActivationLockStat: 1,
  riderSubstitute: 1,
  salamandraFireAttack: 1,
  shootingStarBowDirect: 1,
  smokeGrenadeDiscard: 1,
  snatchStealControl: 1,
  soulbangCannonSuperheavyEquipDefense: 1,
  spiritIllusionEquipAttackAnnounceStat: 1,
  steelShellAttributeStat: 1,
  superviseGeminiRevive: 1,
  trainConnectionCost: 1,
  tryceExtraAttack: 1,
  unitedWeStandDynamicStats: 1,
  zwSylphidWingEquipSummonStat: 1,
} satisfies Record<EquipSemanticVariant, number>;

type EquipKind =
  | "equipControl"
  | "equipCost"
  | "equipDamageLock"
  | "equipGeminiStatus"
  | "equipPierce"
  | "equipProcedure"
  | "equipReturn"
  | "equipReviveBanish"
  | "equipReviveDestroy"
  | "equipSelfDestroy"
  | "equipStatLock";
type EquipSemanticVariant =
  | "axeProcedureStat"
  | "assaultSpiritsDamageStepEquipStat"
  | "ancientGearTankDestroyDamage"
  | "battleArchfiendShieldSetcode"
  | "bigBangShotPierceBanish"
  | "blackPendantSentDamage"
  | "blastWithChainDestroyed"
  | "butterflyDaggerReturn"
  | "cestusBattleRecovery"
  | "dragonTreasureRaceStat"
  | "doomzCommandAdrasteiaGraveEquipDamage"
  | "fairyMeteorCrushPierce"
  | "fallingDownEquipStandbyDamage"
  | "fulfillmentContractRitualReviveBanish"
  | "gagagarevengeGraveEquipReviveStat"
  | "gergonnesEndLinkedDestroyBurn"
  | "geminiBoosterStatus"
  | "gravityAxePositionLock"
  | "graydleEagleBattleDestroyStealEquip"
  | "guardianGrarlProcedure"
  | "heartClearWaterSelfDestroy"
  | "herculesBattleDraw"
  | "herculesBattleLocks"
  | "herculesGraveToDeck"
  | "hornUnicornTopDeck"
  | "inzektorEarwigEquipLeaveStat"
  | "magePowerDynamicStats"
  | "magnumExcaliburDetachEquipToDeck"
  | "maskAccursedDamageLock"
  | "megamorphLpAttack"
  | "mordschlagImmunityPrecalcStat"
  | "nuzzlerTopDeck"
  | "orbYasakaSpiritReturn"
  | "prematureBurialDestroy"
  | "powerUpAdapterCustomEquipStat"
  | "riderPierce"
  | "robotBusterEquipActivationLockStat"
  | "riderSubstitute"
  | "salamandraFireAttack"
  | "shootingStarBowDirect"
  | "smokeGrenadeDiscard"
  | "snatchStealControl"
  | "soulbangCannonSuperheavyEquipDefense"
  | "spiritIllusionEquipAttackAnnounceStat"
  | "steelShellAttributeStat"
  | "superviseGeminiRevive"
  | "trainConnectionCost"
  | "tryceExtraAttack"
  | "unitedWeStandDynamicStats"
  | "zwSylphidWingEquipSummonStat";

describe("Lua real equip restore coverage", () => {
  it("keeps the combined equip restore fixture inventory explicit", () => {
    expect(combinedRealScriptEquipFixtureFiles()).toHaveLength(equipInventoryFixtureCount);
    expect(combinedRealScriptEquipFixtureFiles()).toEqual(realScriptEquipInventoryFiles());
  });

  it("keeps equip fixture kinds explicit", () => {
    expect(countEquipKinds(realScriptEquipInventoryFixtures())).toEqual(equipKindCounts);
  });

  it("keeps named Equip semantic variants explicit", () => {
    expect(countEquipSemanticVariants(realScriptEquipSemanticVariants())).toEqual(equipSemanticVariantCounts);

    const weak = realScriptEquipSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });

  it("requires representative equip fixtures to assert grouped legal actions and clean Lua registry restore", () => {
    const files = realScriptEquipFixtureFiles();
    expect(files).toHaveLength(equipFixtureCount);

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

  it("requires representative equip fixtures to prove restored equip relation and response suppression", () => {
    const files = realScriptEquipRelationFixtureFiles();
    expect(files).toHaveLength(equipRelationFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !/location:\s*["']spellTrapZone["']/.test(text)
          || !text.includes("equippedToUid")
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !/host\.messages\)\.not\.toContain/.test(text);
      });

    expect(missing).toEqual([]);
  });

  it("requires representative equip activation fixtures to pin operation info metadata", () => {
    const files = realScriptEquipOperationInfoFixtureFiles();
    expect(files).toHaveLength(equipOperationInfoFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("operationInfos")
          || !/(?:category|"category"):\s*(?:262144|0x40000)/.test(text);
      });

    expect(missing).toEqual([]);
  });

  it("requires equip probe fixtures to prove restored Lua equip APIs and stat/control effects", () => {
    const files = realScriptEquipProbeFixtureFiles();
    expect(files).toHaveLength(equipProbeFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !/host\.messages\)\.toContain/.test(text)
          || !/probe/.test(text)
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !/GetEquipTarget|GetFirstCardTarget|IsHasEffect|GetAttack|GetControler/.test(text);
      });

    expect(missing).toEqual([]);
  });

  it("requires equip cleanup fixtures to prove leave-field cleanup and triggered follow-up state", () => {
    const files = realScriptEquipCleanupFixtureFiles();
    expect(files).toHaveLength(equipCleanupFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !/previousEquippedToUid/.test(text)
          || !/location:\s*["'](?:graveyard|banished)["']/.test(text)
          || !/eventCode:\s*1011|eventCode:\s*1014|eventCode:\s*1029|"eventCode":\s*1011|"eventCode":\s*1014|"eventCode":\s*1029/.test(text)
          || !/eventCardUid/.test(text)
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !/eventName:\s*["']sentToGraveyard["']|eventName:\s*["']destroyed["']|eventName:\s*["']banished["']|previousController/.test(text);
      });

    expect(missing).toEqual([]);
  });

  it("keeps split equip continuation fixtures under restore coverage ownership", () => {
    const files = realScriptEquipContinuationFixtureFiles();
    expect(files).toHaveLength(2);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("restoreComplete")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("operationInfos");
      });

    expect(missing).toEqual([]);
  });
});

function combinedRealScriptEquipFixtureFiles(): string[] {
  return [
    ...realScriptEquipFixtureFiles(),
    ...realScriptEquipRelationFixtureFiles(),
    ...realScriptEquipProbeFixtureFiles(),
    ...realScriptEquipOperationInfoFixtureFiles(),
    ...realScriptEquipCleanupFixtureFiles(),
    ...realScriptEquipContinuationFixtureFiles(),
  ].filter((file, index, files) => files.indexOf(file) === index).sort();
}

function realScriptEquipInventoryFiles(): string[] {
  return realScriptEquipInventoryFixtures().map(({ file }) => file);
}

function realScriptEquipFixtureFiles(): string[] {
  return [
    "lua-real-script-ancient-gear-tank-equip-destroy-damage.test.ts",
    "lua-real-script-assault-spirits-damage-step-equip-stat.test.ts",
    "lua-real-script-doomz-command-adrasteia-grave-equip-damage.test.ts",
    "lua-real-script-equip-procedure-actions.test.ts",
    "lua-real-script-fairy-meteor-crush-equip-pierce.test.ts",
    "lua-real-script-falling-down-equip-standby-damage.test.ts",
    "lua-real-script-fulfillment-contract-ritual-revive-banish.test.ts",
    "lua-real-script-gagagarevenge-grave-equip-revive-stat.test.ts",
    "lua-real-script-gergonnes-end-equip-linked-destroy-burn.test.ts",
    "lua-real-script-gemini-booster-equip-destroy-status.test.ts",
    "lua-real-script-graydle-eagle-battle-destroy-steal-equip.test.ts",
    "lua-real-script-heart-clear-water-equip-self-destroy.test.ts",
    "lua-real-script-inzektor-earwig-equip-leave-stat.test.ts",
    "lua-real-script-magnum-excalibur-detach-equip-todeck.test.ts",
    "lua-real-script-mask-accursed-equip-lock-damage.test.ts",
    "lua-real-script-mordschlag-equip-immunity-precalc-stat.test.ts",
    "lua-real-script-premature-burial-revive-destroy.test.ts",
    "lua-real-script-power-up-adapter-custom-equip-stat.test.ts",
    "lua-real-script-robot-buster-equip-activation-lock-stat.test.ts",
    "lua-real-script-salamandra-equip-fire-attack.test.ts",
    "lua-real-script-snatch-steal-equip-control.test.ts",
    "lua-real-script-soulbang-cannon-equip-defense.test.ts",
    "lua-real-script-spirit-illusion-equip-attack-announce-stat.test.ts",
    "lua-real-script-steel-shell-equip-attribute-stat.test.ts",
    "lua-real-script-train-connection-equip-cost.test.ts",
    "lua-real-script-zw-sylphid-wing-equip-spsummon-stat.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptEquipRelationFixtureFiles(): string[] {
  return [
    "lua-real-script-ancient-gear-tank-equip-destroy-damage.test.ts",
    "lua-real-script-assault-spirits-damage-step-equip-stat.test.ts",
    "lua-real-script-doomz-command-adrasteia-grave-equip-damage.test.ts",
    "lua-real-script-equip-procedure-actions.test.ts",
    "lua-real-script-equip-return-actions.test.ts",
    "lua-real-script-equip-stat-lock-actions.test.ts",
    "lua-real-script-fairy-meteor-crush-equip-pierce.test.ts",
    "lua-real-script-falling-down-equip-standby-damage.test.ts",
    "lua-real-script-fulfillment-contract-ritual-revive-banish.test.ts",
    "lua-real-script-gagagarevenge-grave-equip-revive-stat.test.ts",
    "lua-real-script-gergonnes-end-equip-linked-destroy-burn.test.ts",
    "lua-real-script-gemini-booster-equip-destroy-status.test.ts",
    "lua-real-script-graydle-eagle-battle-destroy-steal-equip.test.ts",
    "lua-real-script-heart-clear-water-equip-self-destroy.test.ts",
    "lua-real-script-inzektor-earwig-equip-leave-stat.test.ts",
    "lua-real-script-magnum-excalibur-detach-equip-todeck.test.ts",
    "lua-real-script-mask-accursed-equip-lock-damage.test.ts",
    "lua-real-script-mordschlag-equip-immunity-precalc-stat.test.ts",
    "lua-real-script-orb-yasaka-spirit-equip-return.test.ts",
    "lua-real-script-power-up-adapter-custom-equip-stat.test.ts",
    "lua-real-script-rider-storm-winds-equip-pierce.test.ts",
    "lua-real-script-robot-buster-equip-activation-lock-stat.test.ts",
    "lua-real-script-salamandra-equip-fire-attack.test.ts",
    "lua-real-script-snatch-steal-equip-control.test.ts",
    "lua-real-script-soulbang-cannon-equip-defense.test.ts",
    "lua-real-script-spirit-illusion-equip-attack-announce-stat.test.ts",
    "lua-real-script-steel-shell-equip-attribute-stat.test.ts",
    "lua-real-script-supervise-gemini-equip-revive.test.ts",
    "lua-real-script-train-connection-equip-cost.test.ts",
    "lua-real-script-zw-sylphid-wing-equip-spsummon-stat.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptEquipProbeFixtureFiles(): string[] {
  return [
    "lua-real-script-equip-procedure-actions.test.ts",
    "lua-real-script-equip-return-actions.test.ts",
    "lua-real-script-equip-stat-lock-actions.test.ts",
    "lua-real-script-assault-spirits-damage-step-equip-stat.test.ts",
    "lua-real-script-doomz-command-adrasteia-grave-equip-damage.test.ts",
    "lua-real-script-fulfillment-contract-ritual-revive-banish.test.ts",
    "lua-real-script-gagagarevenge-grave-equip-revive-stat.test.ts",
    "lua-real-script-inzektor-earwig-equip-leave-stat.test.ts",
    "lua-real-script-magnum-excalibur-detach-equip-todeck.test.ts",
    "lua-real-script-orb-yasaka-spirit-equip-return.test.ts",
    "lua-real-script-premature-burial-revive-destroy.test.ts",
    "lua-real-script-power-up-adapter-custom-equip-stat.test.ts",
    "lua-real-script-robot-buster-equip-activation-lock-stat.test.ts",
    "lua-real-script-graydle-eagle-battle-destroy-steal-equip.test.ts",
    "lua-real-script-mordschlag-equip-immunity-precalc-stat.test.ts",
    "lua-real-script-rider-storm-winds-equip-pierce.test.ts",
    "lua-real-script-salamandra-equip-fire-attack.test.ts",
    "lua-real-script-snatch-steal-equip-control.test.ts",
    "lua-real-script-soulbang-cannon-equip-defense.test.ts",
    "lua-real-script-steel-shell-equip-attribute-stat.test.ts",
    "lua-real-script-train-connection-equip-cost.test.ts",
    "lua-real-script-zw-sylphid-wing-equip-spsummon-stat.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptEquipOperationInfoFixtureFiles(): string[] {
  return [
    "lua-real-script-ancient-gear-tank-equip-destroy-damage.test.ts",
    "lua-real-script-assault-spirits-damage-step-equip-stat.test.ts",
    "lua-real-script-doomz-command-adrasteia-grave-equip-damage.test.ts",
    "lua-real-script-equip-procedure-actions.test.ts",
    "lua-real-script-equip-return-actions.test.ts",
    "lua-real-script-equip-stat-lock-actions.test.ts",
    "lua-real-script-fairy-meteor-crush-equip-pierce.test.ts",
    "lua-real-script-falling-down-equip-standby-damage.test.ts",
    "lua-real-script-fulfillment-contract-ritual-revive-banish.test.ts",
    "lua-real-script-gagagarevenge-grave-equip-revive-stat.test.ts",
    "lua-real-script-gemini-booster-equip-destroy-status.test.ts",
    "lua-real-script-graydle-eagle-battle-destroy-steal-equip.test.ts",
    "lua-real-script-inzektor-earwig-equip-leave-stat.test.ts",
    "lua-real-script-mask-accursed-equip-lock-damage.test.ts",
    "lua-real-script-power-up-adapter-custom-equip-stat.test.ts",
    "lua-real-script-salamandra-equip-fire-attack.test.ts",
    "lua-real-script-snatch-steal-equip-control.test.ts",
    "lua-real-script-steel-shell-equip-attribute-stat.test.ts",
    "lua-real-script-supervise-gemini-equip-revive.test.ts",
    "lua-real-script-train-connection-equip-cost.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptEquipCleanupFixtureFiles(): string[] {
  return [
    "lua-real-script-ancient-gear-tank-equip-destroy-damage.test.ts",
    "lua-real-script-equip-procedure-actions.test.ts",
    "lua-real-script-equip-return-actions.test.ts",
    "lua-real-script-fulfillment-contract-ritual-revive-banish.test.ts",
    "lua-real-script-gagagarevenge-grave-equip-revive-stat.test.ts",
    "lua-real-script-gergonnes-end-equip-linked-destroy-burn.test.ts",
    "lua-real-script-graydle-eagle-battle-destroy-steal-equip.test.ts",
    "lua-real-script-heart-clear-water-equip-self-destroy.test.ts",
    "lua-real-script-inzektor-earwig-equip-leave-stat.test.ts",
    "lua-real-script-premature-burial-revive-destroy.test.ts",
    "lua-real-script-orb-yasaka-spirit-equip-return.test.ts",
    "lua-real-script-robot-buster-equip-activation-lock-stat.test.ts",
    "lua-real-script-snatch-steal-equip-control.test.ts",
    "lua-real-script-supervise-gemini-equip-revive.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptEquipContinuationFixtureFiles(): string[] {
  return [
    "lua-real-script-equip-procedure-actions-part2.test.ts",
    "lua-real-script-equip-return-actions-part2.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptEquipInventoryFixtures(): Array<{ file: string; kind: EquipKind }> {
  return ([
    {
      file: "lua-real-script-ancient-gear-tank-equip-destroy-damage.test.ts",
      kind: "equipProcedure",
    },
    {
      file: "lua-real-script-assault-spirits-damage-step-equip-stat.test.ts",
      kind: "equipProcedure",
    },
    {
      file: "lua-real-script-doomz-command-adrasteia-grave-equip-damage.test.ts",
      kind: "equipProcedure",
    },
    {
      file: "lua-real-script-equip-procedure-actions-part2.test.ts",
      kind: "equipProcedure",
    },
    {
      file: "lua-real-script-equip-procedure-actions.test.ts",
      kind: "equipProcedure",
    },
    {
      file: "lua-real-script-equip-return-actions-part2.test.ts",
      kind: "equipReturn",
    },
    {
      file: "lua-real-script-equip-return-actions.test.ts",
      kind: "equipReturn",
    },
    {
      file: "lua-real-script-equip-stat-lock-actions.test.ts",
      kind: "equipStatLock",
    },
    {
      file: "lua-real-script-steel-shell-equip-attribute-stat.test.ts",
      kind: "equipProcedure",
    },
    {
      file: "lua-real-script-falling-down-equip-standby-damage.test.ts",
      kind: "equipControl",
    },
    {
      file: "lua-real-script-fairy-meteor-crush-equip-pierce.test.ts",
      kind: "equipPierce",
    },
    {
      file: "lua-real-script-fulfillment-contract-ritual-revive-banish.test.ts",
      kind: "equipReviveBanish",
    },
    {
      file: "lua-real-script-gagagarevenge-grave-equip-revive-stat.test.ts",
      kind: "equipReviveDestroy",
    },
    {
      file: "lua-real-script-gergonnes-end-equip-linked-destroy-burn.test.ts",
      kind: "equipProcedure",
    },
    {
      file: "lua-real-script-magnum-excalibur-detach-equip-todeck.test.ts",
      kind: "equipProcedure",
    },
    {
      file: "lua-real-script-gemini-booster-equip-destroy-status.test.ts",
      kind: "equipGeminiStatus",
    },
    {
      file: "lua-real-script-graydle-eagle-battle-destroy-steal-equip.test.ts",
      kind: "equipControl",
    },
    {
      file: "lua-real-script-heart-clear-water-equip-self-destroy.test.ts",
      kind: "equipSelfDestroy",
    },
    {
      file: "lua-real-script-mask-accursed-equip-lock-damage.test.ts",
      kind: "equipDamageLock",
    },
    {
      file: "lua-real-script-mordschlag-equip-immunity-precalc-stat.test.ts",
      kind: "equipProcedure",
    },
    {
      file: "lua-real-script-orb-yasaka-spirit-equip-return.test.ts",
      kind: "equipReturn",
    },
    {
      file: "lua-real-script-premature-burial-revive-destroy.test.ts",
      kind: "equipReviveDestroy",
    },
    { file: "lua-real-script-power-up-adapter-custom-equip-stat.test.ts", kind: "equipProcedure" },
    { file: "lua-real-script-inzektor-earwig-equip-leave-stat.test.ts", kind: "equipProcedure" },
    { file: "lua-real-script-robot-buster-equip-activation-lock-stat.test.ts", kind: "equipProcedure" },
    { file: "lua-real-script-spirit-illusion-equip-attack-announce-stat.test.ts", kind: "equipProcedure" },
    { file: "lua-real-script-zw-sylphid-wing-equip-spsummon-stat.test.ts", kind: "equipProcedure" },
    {
      file: "lua-real-script-salamandra-equip-fire-attack.test.ts",
      kind: "equipProcedure",
    },
    {
      file: "lua-real-script-rider-storm-winds-equip-pierce.test.ts",
      kind: "equipPierce",
    },
    {
      file: "lua-real-script-snatch-steal-equip-control.test.ts",
      kind: "equipControl",
    },
    {
      file: "lua-real-script-soulbang-cannon-equip-defense.test.ts",
      kind: "equipProcedure",
    },
    {
      file: "lua-real-script-supervise-gemini-equip-revive.test.ts",
      kind: "equipGeminiStatus",
    },
    {
      file: "lua-real-script-train-connection-equip-cost.test.ts",
      kind: "equipCost",
    },
  ] satisfies Array<{ file: string; kind: EquipKind }>)
    .map(({ file, kind }) => ({ file: path.join("test", file), kind }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function realScriptEquipSemanticVariants(): Array<{ file: string; kind: EquipSemanticVariant; required: string[] }> {
  return ([
    {
      file: "lua-real-script-ancient-gear-tank-equip-destroy-damage.test.ts",
      kind: "ancientGearTankDestroyDamage",
      required: [
        "restores Ancient Gear Tank's setcode equip filter, stat boost, and destroyed Equip damage trigger",
        "const tankCode = \"37457534\"",
        "Ancient Gear Tank Chain Responder",
      ],
    },
    { file: "lua-real-script-assault-spirits-damage-step-equip-stat.test.ts", kind: "assaultSpiritsDamageStepEquipStat", required: ["restores RemainFieldCost equip into Damage Step hand-cost attack gain", 'const assaultCode = "87043568"', "e1:SetCost(aux.RemainFieldCost)", "e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP)", "e:SetLabel(g:GetFirst():GetAttack())", "Duel.SendtoGrave(g,REASON_COST)", "Duel.SetOperationInfo(0,CATEGORY_EQUIP,e:GetHandler(),1,0,0)", "assault spirits probe 87043568/870435680/true/1500"] },
    { file: "lua-real-script-zw-sylphid-wing-equip-spsummon-stat.test.ts", kind: "zwSylphidWingEquipSummonStat", required: ["restores ZW self-equip, overlay replacement metadata, and opponent Special Summon ATK gain trigger", 'const sylphidCode = "95886782"', "aux.AddZWEquipLimit", "aux.EquipAndLimitRegister(c,e,tp,tc)", "e3:SetCode(EFFECT_OVERLAY_REMOVE_REPLACE)", "eg:IsExists(Card.IsSummonPlayer,1,nil,1-tp)", "ec:UpdateAttack(1600,nil,c)", "sylphid wing probe 95886782/958867820/true/3300"] },
    { file: "lua-real-script-equip-procedure-actions.test.ts", kind: "axeProcedureStat", required: ["restores Axe of Despair equip procedure target and stat effect", "const axeCode = \"40619825\"", "Equip Procedure Target"] },
    { file: "lua-real-script-equip-procedure-actions-part2.test.ts", kind: "battleArchfiendShieldSetcode", required: ["restores Battle Archfiend Shield equip procedure setcode target filtering", "const shieldCode = \"8730435\"", "Shield Gladiator Target"] },
    { file: "lua-real-script-equip-stat-lock-actions.test.ts", kind: "bigBangShotPierceBanish", required: ["restores Big Bang Shot equip stat, piercing, and leave-field banish cleanup", "const bigBangCode = \"61127349\"", "Big Bang Shot Defense Target"] },
    { file: "lua-real-script-equip-procedure-actions.test.ts", kind: "blackPendantSentDamage", required: ["restores Black Pendant equip stat and sent-from-field damage trigger", "const pendantCode = \"65169794\"", "Black Pendant Chain Responder"] },
    { file: "lua-real-script-equip-return-actions-part2.test.ts", kind: "blastWithChainDestroyed", required: ["restores Blast with Chain remain-field Trap equip and destroyed trigger", "const blastCode = \"98239899\"", "Blast with Chain Target"] },
    { file: "lua-real-script-equip-return-actions.test.ts", kind: "butterflyDaggerReturn", required: ["restores Butterfly Dagger leave-field return trigger with previous equip target", "const daggerCode = \"69243953\"", "Butterfly Dagger Target"] },
    { file: "lua-real-script-equip-procedure-actions-part2.test.ts", kind: "cestusBattleRecovery", required: ["restores Cestus of Dagla equip Fairy filtering, attack boost, and battle-damage recovery", "const cestusCode = \"28106077\"", "Cestus Fairy Target"] },
    { file: "lua-real-script-equip-procedure-actions.test.ts", kind: "dragonTreasureRaceStat", required: ["restores Dragon Treasure race-filtered equip target and attack/defense boosts", "const dragonTreasureCode = \"1435851\"", "Dragon Treasure Dragon Target"] },
    {
      file: "lua-real-script-doomz-command-adrasteia-grave-equip-damage.test.ts",
      kind: "doomzCommandAdrasteiaGraveEquipDamage",
      required: [
        "restores grave equip targeting, equip indestructible count, and level-scaled self damage",
        'const adrasteiaCode = "84054556"',
        '--DoomZ Command "A.D.R.A.S.T.E.I.A."',
        "aux.AddEquipProcedure(c)",
        "e1:SetCode(EFFECT_INDESTRUCTABLE_COUNT)",
        "return (r&REASON_BATTLE)>0",
        "e3:SetCategory(CATEGORY_EQUIP+CATEGORY_DAMAGE)",
        "e3:SetRange(LOCATION_GRAVE)",
        "Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,0,1,1,nil)",
        "Duel.SetOperationInfo(0,CATEGORY_EQUIP,e:GetHandler(),1,tp,0)",
        "Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,tp,lv_rnk*100)",
        "Duel.Equip(tp,c,tc)",
        "Duel.BreakEffect()",
        "Duel.Damage(tp,lv_rnk*100,REASON_EFFECT)",
        "equippedToUid: target.uid",
        "eventName: \"damageDealt\"",
        "adrasteia probe 84054556/840545560/true/4",
      ],
    },
    {
      file: "lua-real-script-falling-down-equip-standby-damage.test.ts",
      kind: "fallingDownEquipStandbyDamage",
      required: [
        "restores steal equip control and opponent Standby CHAININFO damage",
        "--Falling Down",
        "aux.AddEquipProcedure(c,1,aux.CheckStealEquip,s.eqlimit,nil,s.target)",
        "Duel.SetOperationInfo(0,CATEGORY_CONTROL,tc,1,0,0)",
        "Duel.SetTargetPlayer(tp)",
        "Duel.SetTargetParam(800)",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
        "Duel.Damage(p,d,REASON_EFFECT)",
        "e5:SetCode(EFFECT_SET_CONTROL)",
        'equippedToUid: stealTarget.uid',
        'eventName: "controlChanged"',
        'eventName: "damageDealt"',
      ],
    },
    {
      file: "lua-real-script-fairy-meteor-crush-equip-pierce.test.ts",
      kind: "fairyMeteorCrushPierce",
      required: [
        "restores equip-sourced piercing damage only for the equipped monster",
        "Fairy Meteor Crush",
        "equip-sourced piercing",
      ],
    },
    {
      file: "lua-real-script-fulfillment-contract-ritual-revive-banish.test.ts",
      kind: "fulfillmentContractRitualReviveBanish",
      required: [
        "restores LP-cost Ritual revival into equip relation and destroyed-equip banish cleanup",
        'const contractCode = "48206762"',
        "Duel.CheckLPCost(tp,800)",
        "Duel.PayLPCost(tp,800)",
        "Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)",
        "Duel.Equip(tp,c,tc)",
        "Duel.Remove(tc,POS_FACEUP,REASON_EFFECT)",
        "fulfillment probe 48206762/482067620/true",
      ],
    },
    {
      file: "lua-real-script-gagagarevenge-grave-equip-revive-stat.test.ts",
      kind: "gagagarevengeGraveEquipReviveStat",
      required: [
        "restores Gagaga grave revival into equip relation, leave-field destroy, and lost-target Xyz attack gain",
        'const revengeCode = "90673413"',
        "Duel.SpecialSummon(tc,0,tp,tp,false,false,POS_FACEUP)",
        "Duel.Equip(tp,c,tc)",
        "Duel.Destroy(tc,REASON_EFFECT)",
        "gagagarevenge probe 90673413/906734130/true",
        "c:IsReason(REASON_LOST_TARGET) and c:IsReason(REASON_DESTROY) and tc:IsLocation(LOCATION_OVERLAY)",
      ],
    },
    {
      file: "lua-real-script-gergonnes-end-equip-linked-destroy-burn.test.ts",
      kind: "gergonnesEndLinkedDestroyBurn",
      required: [
        "restores remain-field equip into linked-group destruction and equipped target attack damage",
        'const gergonneCode = "59490397"',
        "--Gergonne's End",
        "e1:SetCode(EFFECT_REMAIN_FIELD)",
        "return tc and tc:GetLinkedGroupCount()==tc:GetLink()",
        "Duel.Destroy(lg,REASON_EFFECT)",
        "Duel.Damage(1-tp,atk,REASON_EFFECT)",
        "previousEquippedToUid: tindangle.uid",
        "eventName: \"damageDealt\"",
      ],
    },
    {
      file: "lua-real-script-gemini-booster-equip-destroy-status.test.ts",
      kind: "geminiBoosterStatus",
      required: [
        "restores remain-field Trap equip, destruction, and Gemini-status trigger",
        "Gemini Booster",
        "Gemini-status trigger",
      ],
    },
    {
      file: "lua-real-script-equip-stat-lock-actions.test.ts",
      kind: "gravityAxePositionLock",
      required: [
        "restores Gravity Axe equip stat and opponent position-change lock",
        "const gravityAxeCode = \"32022366\"",
        "Gravity Axe Opponent Monster",
      ],
    },
    {
      file: "lua-real-script-graydle-eagle-battle-destroy-steal-equip.test.ts",
      kind: "graydleEagleBattleDestroyStealEquip",
      required: [
        "restores its destroyed-to-Grave target prompt into equip control and leave-field return",
        'const graydleCode = "29834183"',
        "Duel.SelectTarget(tp,aux.CheckStealEquip,tp,0,LOCATION_MZONE,1,1,nil,e,tp)",
        "expect(restoredOpen.session.state.pendingTriggers).toEqual",
        'effectId: "lua-1-1014"',
        "eventCode: eventToGrave",
        'eventTriggerTiming: "if"',
        "EFFECT_SET_CONTROL",
        "EVENT_LEAVE_FIELD_P",
        "EVENT_LEAVE_FIELD",
        "graydle probe 0/29834183/298341830/true",
      ],
    },
    {
      file: "lua-real-script-equip-stat-lock-actions.test.ts",
      kind: "guardianGrarlProcedure",
      required: [
        "restores Guardian Grarl summon procedure gated by face-up Gravity Axe",
        "const guardianCode = \"47150851\"",
        "const gravityAxeCode = \"32022366\"",
      ],
    },
    {
      file: "lua-real-script-heart-clear-water-equip-self-destroy.test.ts",
      kind: "heartClearWaterSelfDestroy",
      required: [
        "restores battle indestructible equip protection and self-destroys when the equipped monster reaches 1300 ATK",
        "Heart of Clear Water",
        "self-destroys",
      ],
    },
    {
      file: "lua-real-script-equip-procedure-actions-part2.test.ts",
      kind: "herculesBattleDraw",
      required: [
        "restores Hercules Base battle-destroying draw trigger",
        "const baseCode = \"97616504\"",
        "Hercules Base Draw Card",
      ],
    },
    {
      file: "lua-real-script-equip-procedure-actions-part2.test.ts",
      kind: "herculesBattleLocks",
      required: [
        "restores Hercules Base equip procedure condition and battle locks",
        "const baseCode = \"97616504\"",
        "Hercules Base Opponent Target",
      ],
    },
    {
      file: "lua-real-script-equip-procedure-actions-part2.test.ts",
      kind: "herculesGraveToDeck",
      required: [
        "restores Hercules Base graveyard trigger target and to-Deck operation",
        "const baseCode = \"97616504\"",
        "Hercules Base Sky Striker Target",
      ],
    },
    {
      file: "lua-real-script-equip-return-actions.test.ts",
      kind: "hornUnicornTopDeck",
      required: [
        "restores Horn of the Unicorn sent-from-field top-of-Deck trigger",
        "const hornCode = \"64047146\"",
        "Horn of the Unicorn Target",
      ],
    },
    { file: "lua-real-script-inzektor-earwig-equip-leave-stat.test.ts", kind: "inzektorEarwigEquipLeaveStat", required: ["restores AddEREquipLimit ignition equip, equip ATK/DEF, and leave-field target ATK gain", 'const earwigCode = "38450736"', "aux.AddEREquipLimit(c,nil,s.eqval,s.equipop,e1)", "c:EquipByEffectAndLimitRegister(e,tp,tc,nil,true)", "e3:SetCode(EVENT_LEAVE_FIELD)", "Duel.SetTargetCard(ec)", "inzektor earwig probe 38450736/384507361/38450736/false/2000/2000"] },
    { file: "lua-real-script-equip-procedure-actions.test.ts", kind: "magePowerDynamicStats", required: ["restores Mage Power dynamic Spell/Trap-count equip stat callbacks", "const magePowerCode = \"83746708\"", "Mage Power Extra Backrow"] },
    {
      file: "lua-real-script-magnum-excalibur-detach-equip-todeck.test.ts",
      kind: "magnumExcaliburDetachEquipToDeck",
      required: [
        "restores Xyz material detach into damage-calculation final ATK doubling",
        "restores Main Phase Quick equip into equip limit and +2000 ATK/DEF",
        "restores grave Cost.SelfBanish into selecting three Warriors and shuffling them into the Deck",
        'const magnumCode = "14301396"',
        "Cost.DetachFromSelf(2)",
        "Duel.Equip(tp,c,tc)",
        "e0:SetCode(EFFECT_EQUIP_LIMIT)",
        "Duel.SendtoDeck(g,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)",
        "magnum equip probe 14301396/143013962/true/3800/3200",
      ],
    },
    {
      file: "lua-real-script-mask-accursed-equip-lock-damage.test.ts",
      kind: "maskAccursedDamageLock",
      required: [
        "restores equip target attack lock and Standby damage to the equipped monster controller",
        "Mask of the Accursed",
        "Standby damage",
        "eventName: \"damageDealt\"",
        "eventValue: 500",
        "eventReason: duelReason.effect",
        "eventReasonCardUid: mask!.uid",
        "eventReasonEffectId: 4",
      ],
    },
    {
      file: "lua-real-script-equip-stat-lock-actions.test.ts",
      kind: "megamorphLpAttack",
      required: [
        "restores Megamorph LP-conditional set-attack equip callbacks",
        "const megamorphCode = \"22046459\"",
        "Megamorph Target",
      ],
    },
    {
      file: "lua-real-script-mordschlag-equip-immunity-precalc-stat.test.ts",
      kind: "mordschlagImmunityPrecalcStat",
      required: [
        "restores Normal Summoned equip filtering, equipped monster immunity, and pre-damage Special Summoned target stat loss",
        "const mordschlagCode = \"12760674\"",
        "te:GetOwnerPlayer()~=e:GetHandlerPlayer() and te:IsMonsterEffect() and te:IsActivated() and te:GetHandler():IsSpecialSummoned()",
        "mordschlag destroy result 0",
        "mordschlag probe 12760674/127606740/true",
        "eventName: \"battleDamageDealt\"",
        "eventReasonCardUid: normalTarget.uid",
      ],
    },
    {
      file: "lua-real-script-equip-return-actions.test.ts",
      kind: "nuzzlerTopDeck",
      required: [
        "restores Malevolent Nuzzler equip stat and paid top-of-Deck trigger",
        "const nuzzlerCode = \"99597615\"",
        "Malevolent Nuzzler Chain Responder",
      ],
    },
    {
      file: "lua-real-script-orb-yasaka-spirit-equip-return.test.ts",
      kind: "orbYasakaSpiritReturn",
      required: [
        "restores its Spirit-only equip recovery and lost-target return trigger",
        "Orb of Yasaka",
        "lost-target return trigger",
      ],
    },
    {
      file: "lua-real-script-premature-burial-revive-destroy.test.ts",
      kind: "prematureBurialDestroy",
      required: [
        "restores Premature Burial's LP cost, equip target relation, and leave-field destroy",
        "Premature Burial",
        "leave-field destroy",
      ],
    },
    {
      file: "lua-real-script-power-up-adapter-custom-equip-stat.test.ts",
      kind: "powerUpAdapterCustomEquipStat",
      required: [
        "restores RemainFieldCost equip into custom-event target ATK gain and attack lock",
        'const adapterCode = "78586116"',
        "e1:SetCost(aux.RemainFieldCost)",
        "Duel.RaiseSingleEvent(c,EVENT_CUSTOM+id,e,0,0,0,0,0)",
        "e2:SetCode(EVENT_CUSTOM+id)",
        "e1:SetCode(EFFECT_CANNOT_ATTACK)",
        "e1:SetCode(EFFECT_UPDATE_ATTACK)",
        "power-up adapter probe 78586116/785861160/true/2800",
      ],
    },
    {
      file: "lua-real-script-robot-buster-equip-activation-lock-stat.test.ts",
      kind: "robotBusterEquipActivationLockStat",
      required: [
        "restores self-equip, opponent Spell/Trap activation lock, and grave cost ATK gain",
        'const robotCode = "38601126"',
        'const busterBladerCode = "78193831"',
        "Duel.Equip(tp,c,tc,true)",
        "e2:SetCode(EFFECT_CANNOT_ACTIVATE)",
        "Duel.SetTargetCard(tc)",
        "Duel.SendtoGrave(e:GetHandler(),REASON_COST)",
        "robot buster probe 38601126/78193831/true/2600",
      ],
    },
    {
      file: "lua-real-script-rider-storm-winds-equip-pierce.test.ts",
      kind: "riderPierce",
      required: [
        "restores self-equip limit and equip-sourced piercing damage",
        "Rider of the Storm Winds",
        "equip-sourced piercing",
      ],
    },
    {
      file: "lua-real-script-rider-storm-winds-equip-pierce.test.ts",
      kind: "riderSubstitute",
      required: [
        "restores its self-equip destroy substitute for the equipped monster",
        "Rider of the Storm Winds",
        "destroy substitute",
      ],
    },
    {
      file: "lua-real-script-salamandra-equip-fire-attack.test.ts",
      kind: "salamandraFireAttack",
      required: [
        "restores AddEquipProcedure Card.IsAttribute FIRE target filtering and equip-only ATK update",
        "const salamandraCode = \"32268901\"",
        "Salamandra FIRE Target",
        "battleDamage[1]).toBe(200)",
        "eventName: \"battleDamageDealt\"",
        "eventReason: duelReason.battle",
        "eventReasonCardUid: restoredFireTarget.uid",
        "eventReasonPlayer: 0",
      ],
    },
    {
      file: "lua-real-script-equip-procedure-actions-part2.test.ts",
      kind: "shootingStarBowDirect",
      required: [
        "restores Shooting Star Bow equip attack loss and direct attack permission",
        "const bowCode = \"95638658\"",
        "Shooting Star Bow Battle Target",
      ],
    },
    {
      file: "lua-real-script-equip-return-actions-part2.test.ts",
      kind: "smokeGrenadeDiscard",
      required: [
        "restores Smoke Grenade of the Thief destroyed equip hand discard trigger",
        "const smokeCode = \"63789924\"",
        "Smoke Grenade Discard A",
      ],
    },
    {
      file: "lua-real-script-snatch-steal-equip-control.test.ts",
      kind: "snatchStealControl",
      required: [
        "restores Snatch Steal's equip control and returns control when the equip leaves",
        "Snatch Steal",
        "returns control",
      ],
    },
    {
      file: "lua-real-script-soulbang-cannon-equip-defense.test.ts",
      kind: "soulbangCannonSuperheavyEquipDefense",
      required: [
        "restores hand equip targeting a Superheavy Samurai and grants the equipped monster 1000 DEF",
        'const soulbangCode = "3064425"',
        "--Superheavy Samurai Soulbang Cannon",
        "e1:SetCategory(CATEGORY_EQUIP)",
        "e1:SetRange(LOCATION_HAND|LOCATION_MZONE)",
        "Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,e:GetHandler())",
        "Duel.Equip(tp,c,tc,true)",
        "e1:SetCode(EFFECT_EQUIP_LIMIT)",
        "e2:SetCode(EFFECT_UPDATE_DEFENSE)",
        "e2:SetValue(1000)",
        "equippedToUid: target.uid",
        "soulbang probe 3064425/30644250/true/3000",
      ],
    },
    { file: "lua-real-script-spirit-illusion-equip-attack-announce-stat.test.ts", kind: "spiritIllusionEquipAttackAnnounceStat", required: ["restores equipped attack-announcement target into opponent ATK loss", 'const spiritCode = "71939275"', "aux.AddEquipProcedure(c,nil,s.eqfilter)", "local ec=e:GetHandler():GetEquipTarget()", "Duel.SetTargetCard(bt)", "e1:SetCode(EFFECT_UPDATE_ATTACK)", "equippedToUid", "host.messages).not.toContain"] },
    {
      file: "lua-real-script-steel-shell-equip-attribute-stat.test.ts",
      kind: "steelShellAttributeStat",
      required: [
        "restores AddEquipProcedure Card.IsAttribute target filtering and equip ATK/DEF updates into battle damage",
        "const steelShellCode = \"2370081\"",
        "Steel Shell WATER Target",
        "battleDamage[1]).toBe(100)",
        "eventName: \"battleDamageDealt\"",
        "eventReason: duelReason.battle",
        "eventReasonCardUid: restoredWaterTarget.uid",
        "eventReasonPlayer: 0",
      ],
    },
    {
      file: "lua-real-script-supervise-gemini-equip-revive.test.ts",
      kind: "superviseGeminiRevive",
      required: [
        "restores Equip-granted Gemini status and its sent-to-Graveyard Special Summon trigger",
        "Supervise",
        "sent-to-Graveyard Special Summon trigger",
      ],
    },
    {
      file: "lua-real-script-train-connection-equip-cost.test.ts",
      kind: "trainConnectionCost",
      required: [
        "restores AddEquipProcedure cost banish, target selection, and equip stat effect",
        "Train Connection",
        "cost banish",
      ],
    },
    {
      file: "lua-real-script-equip-stat-lock-actions.test.ts",
      kind: "tryceExtraAttack",
      required: [
        "restores Twin Swords discard-cost equip, attack loss, and extra attack",
        "const tryceCode = \"21900719\"",
        "Twin Swords Discard Cost",
      ],
    },
    {
      file: "lua-real-script-equip-procedure-actions.test.ts",
      kind: "unitedWeStandDynamicStats",
      required: [
        "restores United We Stand dynamic equip stat callbacks",
        "const unitedCode = \"56747793\"",
        "United We Stand Face-up Ally",
      ],
    },
  ] satisfies Array<{ file: string; kind: EquipSemanticVariant; required: string[] }>)
    .map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }))
    .sort((a, b) => a.kind.localeCompare(b.kind));
}

function countEquipKinds(fixtures: Array<{ kind: EquipKind }>): Record<EquipKind, number> {
  return fixtures.reduce<Record<EquipKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      equipControl: 0,
      equipCost: 0,
      equipDamageLock: 0,
      equipGeminiStatus: 0,
      equipPierce: 0,
      equipProcedure: 0,
      equipReturn: 0,
      equipReviveBanish: 0,
      equipReviveDestroy: 0,
      equipSelfDestroy: 0,
      equipStatLock: 0,
    },
  );
}

function countEquipSemanticVariants(fixtures: Array<{ kind: EquipSemanticVariant }>): Record<EquipSemanticVariant, number> {
  return fixtures.reduce<Record<EquipSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      axeProcedureStat: 0,
      assaultSpiritsDamageStepEquipStat: 0,
      ancientGearTankDestroyDamage: 0,
      battleArchfiendShieldSetcode: 0,
      bigBangShotPierceBanish: 0,
      blackPendantSentDamage: 0,
      blastWithChainDestroyed: 0,
      butterflyDaggerReturn: 0,
      cestusBattleRecovery: 0,
      dragonTreasureRaceStat: 0,
      doomzCommandAdrasteiaGraveEquipDamage: 0,
      fairyMeteorCrushPierce: 0,
      fallingDownEquipStandbyDamage: 0,
      fulfillmentContractRitualReviveBanish: 0,
      gagagarevengeGraveEquipReviveStat: 0,
      gergonnesEndLinkedDestroyBurn: 0,
      geminiBoosterStatus: 0,
      gravityAxePositionLock: 0,
      graydleEagleBattleDestroyStealEquip: 0,
      guardianGrarlProcedure: 0,
      heartClearWaterSelfDestroy: 0,
      herculesBattleDraw: 0,
      herculesBattleLocks: 0,
      herculesGraveToDeck: 0,
      hornUnicornTopDeck: 0,
      inzektorEarwigEquipLeaveStat: 0,
      magePowerDynamicStats: 0,
      magnumExcaliburDetachEquipToDeck: 0,
      maskAccursedDamageLock: 0,
      megamorphLpAttack: 0,
      mordschlagImmunityPrecalcStat: 0,
      nuzzlerTopDeck: 0,
      orbYasakaSpiritReturn: 0,
      prematureBurialDestroy: 0,
      powerUpAdapterCustomEquipStat: 0,
      riderPierce: 0,
      robotBusterEquipActivationLockStat: 0,
      riderSubstitute: 0,
      salamandraFireAttack: 0,
      shootingStarBowDirect: 0,
      smokeGrenadeDiscard: 0,
      snatchStealControl: 0,
      soulbangCannonSuperheavyEquipDefense: 0,
      spiritIllusionEquipAttackAnnounceStat: 0,
      steelShellAttributeStat: 0,
      superviseGeminiRevive: 0,
      trainConnectionCost: 0,
      tryceExtraAttack: 0,
      unitedWeStandDynamicStats: 0,
      zwSylphidWingEquipSummonStat: 0,
    },
  );
}
