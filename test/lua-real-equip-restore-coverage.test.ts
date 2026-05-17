import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const equipFixtureCount = 8;
const equipRelationFixtureCount = 12;
const equipProbeFixtureCount = 8;
const equipOperationInfoFixtureCount = 9;
const equipCleanupFixtureCount = 7;
const equipInventoryFixtureCount = 15;
const equipKindCounts = {
  equipControl: 1,
  equipCost: 1,
  equipDamageLock: 1,
  equipGeminiStatus: 2,
  equipPierce: 2,
  equipProcedure: 2,
  equipReturn: 3,
  equipReviveDestroy: 1,
  equipSelfDestroy: 1,
  equipStatLock: 1,
} satisfies Record<EquipKind, number>;
const equipSemanticVariantCounts = {
  axeProcedureStat: 1,
  battleArchfiendShieldSetcode: 1,
  bigBangShotPierceBanish: 1,
  blackPendantSentDamage: 1,
  blastWithChainDestroyed: 1,
  butterflyDaggerReturn: 1,
  cestusBattleRecovery: 1,
  dragonTreasureRaceStat: 1,
  fairyMeteorCrushPierce: 1,
  geminiBoosterStatus: 1,
  gravityAxePositionLock: 1,
  guardianGrarlProcedure: 1,
  heartClearWaterSelfDestroy: 1,
  herculesBattleDraw: 1,
  herculesBattleLocks: 1,
  herculesGraveToDeck: 1,
  hornUnicornTopDeck: 1,
  magePowerDynamicStats: 1,
  maskAccursedDamageLock: 1,
  megamorphLpAttack: 1,
  nuzzlerTopDeck: 1,
  orbYasakaSpiritReturn: 1,
  prematureBurialDestroy: 1,
  riderPierce: 1,
  riderSubstitute: 1,
  shootingStarBowDirect: 1,
  smokeGrenadeDiscard: 1,
  snatchStealControl: 1,
  superviseGeminiRevive: 1,
  trainConnectionCost: 1,
  tryceExtraAttack: 1,
  unitedWeStandDynamicStats: 1,
} satisfies Record<EquipSemanticVariant, number>;

type EquipKind =
  | "equipControl"
  | "equipCost"
  | "equipDamageLock"
  | "equipGeminiStatus"
  | "equipPierce"
  | "equipProcedure"
  | "equipReturn"
  | "equipReviveDestroy"
  | "equipSelfDestroy"
  | "equipStatLock";
type EquipSemanticVariant =
  | "axeProcedureStat"
  | "battleArchfiendShieldSetcode"
  | "bigBangShotPierceBanish"
  | "blackPendantSentDamage"
  | "blastWithChainDestroyed"
  | "butterflyDaggerReturn"
  | "cestusBattleRecovery"
  | "dragonTreasureRaceStat"
  | "fairyMeteorCrushPierce"
  | "geminiBoosterStatus"
  | "gravityAxePositionLock"
  | "guardianGrarlProcedure"
  | "heartClearWaterSelfDestroy"
  | "herculesBattleDraw"
  | "herculesBattleLocks"
  | "herculesGraveToDeck"
  | "hornUnicornTopDeck"
  | "magePowerDynamicStats"
  | "maskAccursedDamageLock"
  | "megamorphLpAttack"
  | "nuzzlerTopDeck"
  | "orbYasakaSpiritReturn"
  | "prematureBurialDestroy"
  | "riderPierce"
  | "riderSubstitute"
  | "shootingStarBowDirect"
  | "smokeGrenadeDiscard"
  | "snatchStealControl"
  | "superviseGeminiRevive"
  | "trainConnectionCost"
  | "tryceExtraAttack"
  | "unitedWeStandDynamicStats";

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
          || !/"category":\s*262144/.test(text);
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
          || !/location:\s*["']graveyard["']/.test(text)
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !/eventName:\s*["']sentToGraveyard["']|eventName:\s*["']destroyed["']|previousController/.test(text);
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
    "lua-real-script-equip-procedure-actions.test.ts",
    "lua-real-script-fairy-meteor-crush-equip-pierce.test.ts",
    "lua-real-script-gemini-booster-equip-destroy-status.test.ts",
    "lua-real-script-heart-clear-water-equip-self-destroy.test.ts",
    "lua-real-script-mask-accursed-equip-lock-damage.test.ts",
    "lua-real-script-premature-burial-revive-destroy.test.ts",
    "lua-real-script-snatch-steal-equip-control.test.ts",
    "lua-real-script-train-connection-equip-cost.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptEquipRelationFixtureFiles(): string[] {
  return [
    "lua-real-script-equip-procedure-actions.test.ts",
    "lua-real-script-equip-return-actions.test.ts",
    "lua-real-script-equip-stat-lock-actions.test.ts",
    "lua-real-script-fairy-meteor-crush-equip-pierce.test.ts",
    "lua-real-script-gemini-booster-equip-destroy-status.test.ts",
    "lua-real-script-heart-clear-water-equip-self-destroy.test.ts",
    "lua-real-script-mask-accursed-equip-lock-damage.test.ts",
    "lua-real-script-orb-yasaka-spirit-equip-return.test.ts",
    "lua-real-script-rider-storm-winds-equip-pierce.test.ts",
    "lua-real-script-snatch-steal-equip-control.test.ts",
    "lua-real-script-supervise-gemini-equip-revive.test.ts",
    "lua-real-script-train-connection-equip-cost.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptEquipProbeFixtureFiles(): string[] {
  return [
    "lua-real-script-equip-procedure-actions.test.ts",
    "lua-real-script-equip-return-actions.test.ts",
    "lua-real-script-equip-stat-lock-actions.test.ts",
    "lua-real-script-orb-yasaka-spirit-equip-return.test.ts",
    "lua-real-script-premature-burial-revive-destroy.test.ts",
    "lua-real-script-rider-storm-winds-equip-pierce.test.ts",
    "lua-real-script-snatch-steal-equip-control.test.ts",
    "lua-real-script-train-connection-equip-cost.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptEquipOperationInfoFixtureFiles(): string[] {
  return [
    "lua-real-script-equip-procedure-actions.test.ts",
    "lua-real-script-equip-return-actions.test.ts",
    "lua-real-script-equip-stat-lock-actions.test.ts",
    "lua-real-script-fairy-meteor-crush-equip-pierce.test.ts",
    "lua-real-script-gemini-booster-equip-destroy-status.test.ts",
    "lua-real-script-mask-accursed-equip-lock-damage.test.ts",
    "lua-real-script-snatch-steal-equip-control.test.ts",
    "lua-real-script-supervise-gemini-equip-revive.test.ts",
    "lua-real-script-train-connection-equip-cost.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptEquipCleanupFixtureFiles(): string[] {
  return [
    "lua-real-script-equip-procedure-actions.test.ts",
    "lua-real-script-equip-return-actions.test.ts",
    "lua-real-script-heart-clear-water-equip-self-destroy.test.ts",
    "lua-real-script-premature-burial-revive-destroy.test.ts",
    "lua-real-script-orb-yasaka-spirit-equip-return.test.ts",
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
      file: "lua-real-script-fairy-meteor-crush-equip-pierce.test.ts",
      kind: "equipPierce",
    },
    {
      file: "lua-real-script-gemini-booster-equip-destroy-status.test.ts",
      kind: "equipGeminiStatus",
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
      file: "lua-real-script-orb-yasaka-spirit-equip-return.test.ts",
      kind: "equipReturn",
    },
    {
      file: "lua-real-script-premature-burial-revive-destroy.test.ts",
      kind: "equipReviveDestroy",
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
      file: "lua-real-script-equip-procedure-actions.test.ts",
      kind: "axeProcedureStat",
      required: [
        "restores Axe of Despair equip procedure target and stat effect",
        "const axeCode = \"40619825\"",
        "Equip Procedure Target",
      ],
    },
    {
      file: "lua-real-script-equip-procedure-actions-part2.test.ts",
      kind: "battleArchfiendShieldSetcode",
      required: [
        "restores Battle Archfiend Shield equip procedure setcode target filtering",
        "const shieldCode = \"8730435\"",
        "Shield Gladiator Target",
      ],
    },
    {
      file: "lua-real-script-equip-stat-lock-actions.test.ts",
      kind: "bigBangShotPierceBanish",
      required: [
        "restores Big Bang Shot equip stat, piercing, and leave-field banish cleanup",
        "const bigBangCode = \"61127349\"",
        "Big Bang Shot Defense Target",
      ],
    },
    {
      file: "lua-real-script-equip-procedure-actions.test.ts",
      kind: "blackPendantSentDamage",
      required: [
        "restores Black Pendant equip stat and sent-from-field damage trigger",
        "const pendantCode = \"65169794\"",
        "Black Pendant Chain Responder",
      ],
    },
    {
      file: "lua-real-script-equip-return-actions-part2.test.ts",
      kind: "blastWithChainDestroyed",
      required: [
        "restores Blast with Chain remain-field Trap equip and destroyed trigger",
        "const blastCode = \"98239899\"",
        "Blast with Chain Target",
      ],
    },
    {
      file: "lua-real-script-equip-return-actions.test.ts",
      kind: "butterflyDaggerReturn",
      required: [
        "restores Butterfly Dagger leave-field return trigger with previous equip target",
        "const daggerCode = \"69243953\"",
        "Butterfly Dagger Target",
      ],
    },
    {
      file: "lua-real-script-equip-procedure-actions-part2.test.ts",
      kind: "cestusBattleRecovery",
      required: [
        "restores Cestus of Dagla equip Fairy filtering, attack boost, and battle-damage recovery",
        "const cestusCode = \"28106077\"",
        "Cestus Fairy Target",
      ],
    },
    {
      file: "lua-real-script-equip-procedure-actions.test.ts",
      kind: "dragonTreasureRaceStat",
      required: [
        "restores Dragon Treasure race-filtered equip target and attack/defense boosts",
        "const dragonTreasureCode = \"1435851\"",
        "Dragon Treasure Dragon Target",
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
    {
      file: "lua-real-script-equip-procedure-actions.test.ts",
      kind: "magePowerDynamicStats",
      required: [
        "restores Mage Power dynamic Spell/Trap-count equip stat callbacks",
        "const magePowerCode = \"83746708\"",
        "Mage Power Extra Backrow",
      ],
    },
    {
      file: "lua-real-script-mask-accursed-equip-lock-damage.test.ts",
      kind: "maskAccursedDamageLock",
      required: [
        "restores equip target attack lock and Standby damage to the equipped monster controller",
        "Mask of the Accursed",
        "Standby damage",
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
      battleArchfiendShieldSetcode: 0,
      bigBangShotPierceBanish: 0,
      blackPendantSentDamage: 0,
      blastWithChainDestroyed: 0,
      butterflyDaggerReturn: 0,
      cestusBattleRecovery: 0,
      dragonTreasureRaceStat: 0,
      fairyMeteorCrushPierce: 0,
      geminiBoosterStatus: 0,
      gravityAxePositionLock: 0,
      guardianGrarlProcedure: 0,
      heartClearWaterSelfDestroy: 0,
      herculesBattleDraw: 0,
      herculesBattleLocks: 0,
      herculesGraveToDeck: 0,
      hornUnicornTopDeck: 0,
      magePowerDynamicStats: 0,
      maskAccursedDamageLock: 0,
      megamorphLpAttack: 0,
      nuzzlerTopDeck: 0,
      orbYasakaSpiritReturn: 0,
      prematureBurialDestroy: 0,
      riderPierce: 0,
      riderSubstitute: 0,
      shootingStarBowDirect: 0,
      smokeGrenadeDiscard: 0,
      snatchStealControl: 0,
      superviseGeminiRevive: 0,
      trainConnectionCost: 0,
      tryceExtraAttack: 0,
      unitedWeStandDynamicStats: 0,
    },
  );
}
