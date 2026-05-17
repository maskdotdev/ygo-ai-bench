import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const geminiFixtureCount = 17;
const geminiStatusFixtureCount = 14;
const geminiOperationFixtureCount = 10;
const geminiStateFixtureCount = 5;
const geminiKindCounts = {
  attackAllStatus: 1,
  battleTriggeredOperation: 3,
  delayedGeminiStatus: 2,
  discardRevive: 1,
  destructionOperation: 3,
  equipStatusOperation: 1,
  handSpecialSummon: 1,
  levelOrTypeStatus: 2,
  statusGrantRevive: 2,
  summonSuccessTriggerRevive: 1,
} satisfies Record<GeminiKind, number>;
const geminiSemanticVariantCounts = {
  blazewingButterflySelfTributeReviveStatus: 1,
  chemicritterHydronHawkDiscardDefenseRevive: 1,
  chemicritterOxyOxHandSummonLevelChange: 1,
  darkValkyriaCounterCostDestroy: 1,
  evocatorEvequeSecondSummonRevive: 1,
  futureSamuraiBanishCostDestroy: 1,
  gemKnightSardonyxBattleSearch: 1,
  geminiBoosterEquipDestroyStatusTrigger: 1,
  geminiSoldierBattledDeckSummon: 1,
  geminiSparkReleaseDestroyDraw: 1,
  grasschopperGeminiAttackAll: 1,
  herculeanPowerSpellTrapZoneHandSummon: 1,
  magicalReflectSlimeBattleDamageReflect: 1,
  superDoubleSummonEndPhaseReturn: 1,
  superviseEquipGrantedStatusRevive: 1,
  tunedMagicianGeminiTunerType: 1,
  unleashYourPowerEndPhaseDelayedSet: 1,
} satisfies Record<GeminiSemanticVariant, number>;

describe("Lua real Gemini restore coverage", () => {
  it("keeps representative Gemini fixture kinds explicit", () => {
    expect(countGeminiKinds(geminiFixtures())).toEqual(geminiKindCounts);
  });

  it("requires representative Gemini fixtures to assert clean Lua registry restore", () => {
    const files = geminiFixtureFiles();
    expect(files).toHaveLength(geminiFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])");
      });

    expect(missing).toEqual([]);
  });

  it("requires representative Gemini fixtures to prove grouped restored legal-action parity", () => {
    const files = geminiFixtureFiles();
    expect(files).toHaveLength(geminiFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("getDuelLegalActions")
          || !text.includes("applyLuaRestoreResponse");
      });

    expect(missing).toEqual([]);
  });

  it("requires Gemini status fixtures to probe restored IsGeminiStatus behavior", () => {
    const files = geminiStatusFixtureFiles();
    expect(files).toHaveLength(geminiStatusFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("IsGeminiStatus")
          || !/status .*true|status true|gemini status true/.test(text)
          || !/status .*false|status false|gemini status false/.test(text);
      });

    expect(missing).toEqual([]);
  });

  it("requires Gemini operation fixtures to pin operation info and final event history", () => {
    const files = geminiOperationFixtureFiles();
    expect(files).toHaveLength(geminiOperationFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("operationInfos")
          || !text.includes("eventHistory")
          || !/eventName:\s*["'](released|counterAdded|sentToGraveyard|banished|destroyed|specialSummoned|cardsDrawn)["']/.test(text);
      });

    expect(missing).toEqual([]);
  });

  it("requires Gemini state fixtures to pin restored delayed, equip, and battle outcomes", () => {
    const files = geminiStateFixtureFiles();
    expect(files).toHaveLength(geminiStateFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      });

    expect(missing).toEqual([]);
  });

  it("keeps named Gemini semantic variants explicit", () => {
    expect(countGeminiSemanticVariants(geminiSemanticVariants())).toEqual(geminiSemanticVariantCounts);

    const weak = geminiSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

type GeminiKind =
  | "attackAllStatus"
  | "battleTriggeredOperation"
  | "delayedGeminiStatus"
  | "discardRevive"
  | "destructionOperation"
  | "equipStatusOperation"
  | "handSpecialSummon"
  | "levelOrTypeStatus"
  | "statusGrantRevive"
  | "summonSuccessTriggerRevive";
type GeminiSemanticVariant =
  | "blazewingButterflySelfTributeReviveStatus"
  | "chemicritterHydronHawkDiscardDefenseRevive"
  | "chemicritterOxyOxHandSummonLevelChange"
  | "darkValkyriaCounterCostDestroy"
  | "evocatorEvequeSecondSummonRevive"
  | "futureSamuraiBanishCostDestroy"
  | "gemKnightSardonyxBattleSearch"
  | "geminiBoosterEquipDestroyStatusTrigger"
  | "geminiSoldierBattledDeckSummon"
  | "geminiSparkReleaseDestroyDraw"
  | "grasschopperGeminiAttackAll"
  | "herculeanPowerSpellTrapZoneHandSummon"
  | "magicalReflectSlimeBattleDamageReflect"
  | "superDoubleSummonEndPhaseReturn"
  | "superviseEquipGrantedStatusRevive"
  | "tunedMagicianGeminiTunerType"
  | "unleashYourPowerEndPhaseDelayedSet";

function countGeminiKinds(fixtures: Array<{ kind: GeminiKind }>): Record<GeminiKind, number> {
  return fixtures.reduce<Record<GeminiKind, number>>(
    (counts, { kind }) => ({ ...counts, [kind]: counts[kind] + 1 }),
    {
      attackAllStatus: 0,
      battleTriggeredOperation: 0,
      delayedGeminiStatus: 0,
      discardRevive: 0,
      destructionOperation: 0,
      equipStatusOperation: 0,
      handSpecialSummon: 0,
      levelOrTypeStatus: 0,
      statusGrantRevive: 0,
      summonSuccessTriggerRevive: 0,
    },
  );
}

function countGeminiSemanticVariants(fixtures: Array<{ kind: GeminiSemanticVariant }>): Record<GeminiSemanticVariant, number> {
  return fixtures.reduce<Record<GeminiSemanticVariant, number>>(
    (counts, { kind }) => ({ ...counts, [kind]: counts[kind] + 1 }),
    {
      blazewingButterflySelfTributeReviveStatus: 0,
      chemicritterHydronHawkDiscardDefenseRevive: 0,
      chemicritterOxyOxHandSummonLevelChange: 0,
      darkValkyriaCounterCostDestroy: 0,
      evocatorEvequeSecondSummonRevive: 0,
      futureSamuraiBanishCostDestroy: 0,
      gemKnightSardonyxBattleSearch: 0,
      geminiBoosterEquipDestroyStatusTrigger: 0,
      geminiSoldierBattledDeckSummon: 0,
      geminiSparkReleaseDestroyDraw: 0,
      grasschopperGeminiAttackAll: 0,
      herculeanPowerSpellTrapZoneHandSummon: 0,
      magicalReflectSlimeBattleDamageReflect: 0,
      superDoubleSummonEndPhaseReturn: 0,
      superviseEquipGrantedStatusRevive: 0,
      tunedMagicianGeminiTunerType: 0,
      unleashYourPowerEndPhaseDelayedSet: 0,
    },
  );
}

function geminiFixtureFiles(): string[] {
  return geminiFixtures().map(({ file }) => file);
}

function geminiFixtures(): Array<{ file: string; kind: GeminiKind }> {
  return ([
    { file: "lua-real-script-blazewing-butterfly-gemini-revive-status.test.ts", kind: "statusGrantRevive" },
    { file: "lua-real-script-chemicritter-hydron-hawk-discard-revive.test.ts", kind: "discardRevive" },
    { file: "lua-real-script-chemicritter-oxy-ox-gemini-level-change.test.ts", kind: "levelOrTypeStatus" },
    { file: "lua-real-script-dark-valkyria-gemini-counter-destroy.test.ts", kind: "destructionOperation" },
    { file: "lua-real-script-evocator-eveque-gemini-trigger.test.ts", kind: "summonSuccessTriggerRevive" },
    { file: "lua-real-script-future-samurai-gemini-banish-destroy.test.ts", kind: "destructionOperation" },
    { file: "lua-real-script-gem-knight-sardonyx-battle-search.test.ts", kind: "battleTriggeredOperation" },
    { file: "lua-real-script-gemini-booster-equip-destroy-status.test.ts", kind: "equipStatusOperation" },
    { file: "lua-real-script-gemini-soldier-battled-deck-summon.test.ts", kind: "battleTriggeredOperation" },
    { file: "lua-real-script-gemini-spark-release-destroy-draw.test.ts", kind: "destructionOperation" },
    { file: "lua-real-script-grasschopper-gemini-attack-all.test.ts", kind: "attackAllStatus" },
    { file: "lua-real-script-herculean-power-gemini-hand-summon.test.ts", kind: "handSpecialSummon" },
    { file: "lua-real-script-magical-reflect-slime-gemini-battle-damage.test.ts", kind: "battleTriggeredOperation" },
    { file: "lua-real-script-super-double-summon-gemini-return.test.ts", kind: "delayedGeminiStatus" },
    { file: "lua-real-script-supervise-gemini-equip-revive.test.ts", kind: "statusGrantRevive" },
    { file: "lua-real-script-tuned-magician-gemini-tuner-type.test.ts", kind: "levelOrTypeStatus" },
    { file: "lua-real-script-unleash-your-power-gemini-delayed-set.test.ts", kind: "delayedGeminiStatus" },
  ] satisfies Array<{ file: string; kind: GeminiKind }>)
    .map(({ file, kind }) => ({ file: path.join("test", file), kind }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function geminiSemanticVariants(): Array<{
  file: string;
  kind: GeminiSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "lua-real-script-blazewing-butterfly-gemini-revive-status.test.ts",
      kind: "blazewingButterflySelfTributeReviveStatus",
      required: [
        'const blazewingCode = "16984449"',
        "restores Gemini self-tribute revive and status grant",
        "blazewing gemini status",
      ],
    },
    {
      file: "lua-real-script-chemicritter-hydron-hawk-discard-revive.test.ts",
      kind: "chemicritterHydronHawkDiscardDefenseRevive",
      required: [
        'const hydronHawkCode = "55100740"',
        "restores Gemini discard cost and targeted Defense Position revive",
        'eventName: "specialSummoned"',
      ],
    },
    {
      file: "lua-real-script-chemicritter-oxy-ox-gemini-level-change.test.ts",
      kind: "chemicritterOxyOxHandSummonLevelChange",
      required: [
        'const oxyOxCode = "18993198"',
        "restores Gemini hand summon and final Level change",
        "oxy ox gemini status",
      ],
    },
    {
      file: "lua-real-script-dark-valkyria-gemini-counter-destroy.test.ts",
      kind: "darkValkyriaCounterCostDestroy",
      required: [
        'const valkyriaCode = "83269557"',
        "restores Gemini Spell Counter placement, dynamic ATK, counter cost, and destruction",
        'eventName: "counterAdded"',
      ],
    },
    {
      file: "lua-real-script-evocator-eveque-gemini-trigger.test.ts",
      kind: "evocatorEvequeSecondSummonRevive",
      required: [
        'const evequeCode = "16146511"',
        "restores targeting and resolution after a second Normal Summon",
        'eventName: "specialSummoned"',
      ],
    },
    {
      file: "lua-real-script-future-samurai-gemini-banish-destroy.test.ts",
      kind: "futureSamuraiBanishCostDestroy",
      required: [
        'const samuraiCode = "90642597"',
        "restores Gemini banish cost and targeted face-up monster destruction",
        'eventName: "banished"',
      ],
    },
    {
      file: "lua-real-script-gem-knight-sardonyx-battle-search.test.ts",
      kind: "gemKnightSardonyxBattleSearch",
      required: [
        'const sardonyxCode = "43114901"',
        "restores Gemini-status battle-destroyed reason-card search",
        "sardonyx gemini status",
      ],
    },
    {
      file: "lua-real-script-gemini-booster-equip-destroy-status.test.ts",
      kind: "geminiBoosterEquipDestroyStatusTrigger",
      required: [
        'const boosterCode = "18096222"',
        "restores remain-field Trap equip, destruction, and Gemini-status trigger",
        "gemini booster status",
      ],
    },
    {
      file: "lua-real-script-gemini-soldier-battled-deck-summon.test.ts",
      kind: "geminiSoldierBattledDeckSummon",
      required: [
        'const soldierCode = "68366996"',
        "restores battled trigger, Deck Special Summon, and battle indestructible count",
        "soldier gemini status",
      ],
    },
    {
      file: "lua-real-script-gemini-spark-release-destroy-draw.test.ts",
      kind: "geminiSparkReleaseDestroyDraw",
      required: [
        'const sparkCode = "33846209"',
        "restores its Gemini release cost, target destruction, and draw",
        'eventName: "cardsDrawn"',
      ],
    },
    {
      file: "lua-real-script-grasschopper-gemini-attack-all.test.ts",
      kind: "grasschopperGeminiAttackAll",
      required: [
        'const grasschopperCode = "95166228"',
        "restores Gemini status into repeat monster attacks without reopening direct attacks",
        "hasDirectAttack(secondActions, grasschopper!.uid)).toBe(false)",
      ],
    },
    {
      file: "lua-real-script-herculean-power-gemini-hand-summon.test.ts",
      kind: "herculeanPowerSpellTrapZoneHandSummon",
      required: [
        'const powerCode = "57441100"',
        "restores Spell/Trap-zone Gemini hand summon ignition",
        'eventName: "specialSummoned"',
      ],
    },
    {
      file: "lua-real-script-magical-reflect-slime-gemini-battle-damage.test.ts",
      kind: "magicalReflectSlimeBattleDamageReflect",
      required: [
        'const slimeCode = "3918345"',
        "restores Gemini status and reflects battle damage after a second Normal Summon",
        "magical reflect slime gemini status",
      ],
    },
    {
      file: "lua-real-script-super-double-summon-gemini-return.test.ts",
      kind: "superDoubleSummonEndPhaseReturn",
      required: [
        'const spellCode = "26120084"',
        "restores temporary Gemini status and its End Phase return",
        "super double gemini status",
      ],
    },
    {
      file: "lua-real-script-supervise-gemini-equip-revive.test.ts",
      kind: "superviseEquipGrantedStatusRevive",
      required: [
        'const superviseCode = "95750695"',
        "restores Equip-granted Gemini status and its sent-to-Graveyard Special Summon trigger",
        "supervise gemini status",
      ],
    },
    {
      file: "lua-real-script-tuned-magician-gemini-tuner-type.test.ts",
      kind: "tunedMagicianGeminiTunerType",
      required: [
        'const tunedMagicianCode = "47459126"',
        "restores Gemini status gating for official EFFECT_ADD_TYPE tuner checks",
        "tuned magician gemini status",
      ],
    },
    {
      file: "lua-real-script-unleash-your-power-gemini-delayed-set.test.ts",
      kind: "unleashYourPowerEndPhaseDelayedSet",
      required: [
        'const unleashCode = "73567374"',
        "restores group-wide Gemini status and delayed End Phase position change",
        "unleash gemini status",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: GeminiSemanticVariant;
    required: string[];
  }>)
    .map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function geminiStatusFixtureFiles(): string[] {
  return [
    "lua-real-script-blazewing-butterfly-gemini-revive-status.test.ts",
    "lua-real-script-chemicritter-hydron-hawk-discard-revive.test.ts",
    "lua-real-script-chemicritter-oxy-ox-gemini-level-change.test.ts",
    "lua-real-script-dark-valkyria-gemini-counter-destroy.test.ts",
    "lua-real-script-future-samurai-gemini-banish-destroy.test.ts",
    "lua-real-script-gem-knight-sardonyx-battle-search.test.ts",
    "lua-real-script-gemini-booster-equip-destroy-status.test.ts",
    "lua-real-script-gemini-soldier-battled-deck-summon.test.ts",
    "lua-real-script-grasschopper-gemini-attack-all.test.ts",
    "lua-real-script-magical-reflect-slime-gemini-battle-damage.test.ts",
    "lua-real-script-super-double-summon-gemini-return.test.ts",
    "lua-real-script-supervise-gemini-equip-revive.test.ts",
    "lua-real-script-tuned-magician-gemini-tuner-type.test.ts",
    "lua-real-script-unleash-your-power-gemini-delayed-set.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function geminiOperationFixtureFiles(): string[] {
  return [
    "lua-real-script-blazewing-butterfly-gemini-revive-status.test.ts",
    "lua-real-script-chemicritter-hydron-hawk-discard-revive.test.ts",
    "lua-real-script-chemicritter-oxy-ox-gemini-level-change.test.ts",
    "lua-real-script-dark-valkyria-gemini-counter-destroy.test.ts",
    "lua-real-script-evocator-eveque-gemini-trigger.test.ts",
    "lua-real-script-future-samurai-gemini-banish-destroy.test.ts",
    "lua-real-script-gemini-spark-release-destroy-draw.test.ts",
    "lua-real-script-gemini-soldier-battled-deck-summon.test.ts",
    "lua-real-script-herculean-power-gemini-hand-summon.test.ts",
    "lua-real-script-supervise-gemini-equip-revive.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function geminiStateFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-gemini-booster-equip-destroy-status.test.ts",
      required: [
        "operationInfos",
        'eventName: "leftField"',
        "equippedToUid: slime!.uid",
        "gemini booster status",
      ],
    },
    {
      file: "test/lua-real-script-magical-reflect-slime-gemini-battle-damage.test.ts",
      required: [
        'eventName: "battleDamageDealt"',
        "battleDamage).toEqual({ 0: 0, 1: 1300 })",
        "magical reflect slime gemini status",
      ],
    },
    {
      file: "test/lua-real-script-super-double-summon-gemini-return.test.ts",
      required: [
        'eventName: "phaseEnd"',
        'eventName: "sentToHand"',
        "super double gemini status",
      ],
    },
    {
      file: "test/lua-real-script-supervise-gemini-equip-revive.test.ts",
      required: [
        "previousEquippedToUid: gemini!.uid",
        'eventName: "sentToGraveyard"',
        'eventName: "specialSummoned"',
        "supervise gemini status",
      ],
    },
    {
      file: "test/lua-real-script-unleash-your-power-gemini-delayed-set.test.ts",
      required: [
        'eventName: "positionChanged"',
        "unleash gemini status",
        "position: \"faceDownDefense\"",
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
