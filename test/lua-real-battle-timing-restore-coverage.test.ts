import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const battleTimingFixtureCount = 21;
const battleTimingEventCodeFixtureCount = 21;
const battleTimingEventCodeExceptions: string[] = [];
const battleTimingKindCounts: Record<BattleTimingKind, number> = {
  afterDamageCalculation: 10,
  beforeDamageCalculation: 3,
  duringDamageCalculation: 2,
  endDamageStep: 4,
  startDamageStep: 2,
};
const battleTimingSemanticVariantCounts = {
  allyOfJusticeNullfierAfterDamageDisable: 1,
  cipherSoldierBeforeDamageCalculationBoost: 1,
  ddAssailantAfterDamageBanishBoth: 1,
  ddWarriorWallMandatoryBattledSegoc: 1,
  desKangarooEndDamageDestroy: 1,
  destructionPunchEndDamageTrapDestroy: 1,
  divineKnightIshzarkAfterDamageBanish: 1,
  fabledAshenveilPreDamageBoost: 1,
  geminiSoldierAfterDamageDeckSummon: 1,
  getsuFuhmaEndDamageTargetDestroy: 1,
  gundariStartDamageSynchroBounce: 1,
  hayateAfterDamageDeckSend: 1,
  kuribohBeforeDamagePrevent: 1,
  mirageKnightDuringDamageAtkBanish: 1,
  nightmareMagicianEndDamageControl: 1,
  predaplantSarraceniantAfterDamageDestroy: 1,
  reflectBounderStartAndAfterDamageDestroy: 1,
  shadowSpellDuringDamagePersistentStat: 1,
  shinobirdCrowStartDamageStatBoost: 1,
  topologicBomberAfterDamageBurn: 1,
  wallOfIllusionAfterDamageBounce: 1,
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

  it("requires battle timing fixtures to assert clean Lua restore and restored trigger outcomes", () => {
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
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("eventHistory")
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
  | "cipherSoldierBeforeDamageCalculationBoost"
  | "ddAssailantAfterDamageBanishBoth"
  | "ddWarriorWallMandatoryBattledSegoc"
  | "desKangarooEndDamageDestroy"
  | "destructionPunchEndDamageTrapDestroy"
  | "divineKnightIshzarkAfterDamageBanish"
  | "fabledAshenveilPreDamageBoost"
  | "geminiSoldierAfterDamageDeckSummon"
  | "getsuFuhmaEndDamageTargetDestroy"
  | "gundariStartDamageSynchroBounce"
  | "hayateAfterDamageDeckSend"
  | "kuribohBeforeDamagePrevent"
  | "mirageKnightDuringDamageAtkBanish"
  | "nightmareMagicianEndDamageControl"
  | "predaplantSarraceniantAfterDamageDestroy"
  | "reflectBounderStartAndAfterDamageDestroy"
  | "shadowSpellDuringDamagePersistentStat"
  | "shinobirdCrowStartDamageStatBoost"
  | "topologicBomberAfterDamageBurn"
  | "wallOfIllusionAfterDamageBounce";

function battleTimingSemanticVariants(): Array<{
  file: string;
  kind: BattleTimingSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-ally-of-justice-nullfier-battled-disable.test.ts",
      kind: "allyOfJusticeNullfierAfterDamageDisable",
      required: ["restores its EVENT_BATTLED label-object trigger and disables the LIGHT battle target", "eventName: \"afterDamageCalculation\"", "target disabled true"],
    },
    {
      file: "test/lua-real-script-cipher-soldier-pre-damage-calculate.test.ts",
      kind: "cipherSoldierBeforeDamageCalculationBoost",
      required: ["restores its EVENT_PRE_DAMAGE_CALCULATE trigger and applies the Warrior battle stat boost", "eventCode: 1134", "currentAttack(restored.session.state.cards.find"],
    },
    {
      file: "test/lua-real-script-dd-assailant-battled-remove.test.ts",
      kind: "ddAssailantAfterDamageBanishBoth",
      required: ["restores D.D. Assailant after damage calculation and banishes both battle participants", "triggerBucket: \"opponentMandatory\"", "eventName: \"banished\""],
    },
    {
      file: "test/lua-real-script-dd-warrior-wall-battled-segoc.test.ts",
      kind: "ddWarriorWallMandatoryBattledSegoc",
      required: ["restores simultaneous EVENT_BATTLED mandatory triggers and respects chain order battle relation", "triggerBucket: \"turnMandatory\"", "triggerBucket: \"opponentMandatory\""],
    },
    {
      file: "test/lua-real-script-des-kangaroo-damage-step-end.test.ts",
      kind: "desKangarooEndDamageDestroy",
      required: ["restores Des Kangaroo's end Damage Step trigger and destroys the lower-ATK attacker", "eventName: \"damageStepEnded\"", "eventName: \"destroyed\""],
    },
    {
      file: "test/lua-real-script-destruction-punch-damage-step-end.test.ts",
      kind: "destructionPunchEndDamageTrapDestroy",
      required: ["restores its end-Damage-Step Trap activation and destroys the battle attacker", "eventName: \"damageStepEnded\"", "location: \"graveyard\""],
    },
    {
      file: "test/lua-real-script-divine-knight-ishzark-battled-remove.test.ts",
      kind: "divineKnightIshzarkAfterDamageBanish",
      required: ["restores Divine Knight Ishzark after damage calculation and banishes the battle-destroyed target", "triggerBucket: \"turnMandatory\"", "eventName: \"banished\""],
    },
    {
      file: "test/lua-real-script-fabled-ashenveil-damage-step-boost.test.ts",
      kind: "fabledAshenveilPreDamageBoost",
      required: ["restores its hand cost and pre-damage calculation ATK boost", "battleWindow?.kind).toBe(\"beforeDamageCalculation\")", "eventReasonEffectId: 1"],
    },
    {
      file: "test/lua-real-script-gemini-soldier-battled-deck-summon.test.ts",
      kind: "geminiSoldierAfterDamageDeckSummon",
      required: ["restores battled trigger, Deck Special Summon, and battle indestructible count", "triggerBucket: \"turnOptional\"", "eventName: \"specialSummoned\""],
    },
    {
      file: "test/lua-real-script-getsu-fuhma-damage-step-end.test.ts",
      kind: "getsuFuhmaEndDamageTargetDestroy",
      required: ["restores Getsu Fuhma's stored battle target and destroys it at the end of the Damage Step", "battleWindow?.kind).toBe(\"endDamageStep\")", "effectLabelObjectUid"],
    },
    {
      file: "test/lua-real-script-gundari-battle-start-synchro-bounce.test.ts",
      kind: "gundariStartDamageSynchroBounce",
      required: ["restores its battle-start trigger and returns both battling monsters to hand", "eventName: \"battleStarted\"", "eventName: \"sentToHand\""],
    },
    {
      file: "test/lua-real-script-hayate-battled-send.test.ts",
      kind: "hayateAfterDamageDeckSend",
      required: ["restores its direct-attack EVENT_BATTLED trigger and sends a Sky Striker card from Deck to Graveyard", "triggerBucket: \"turnOptional\"", "eventReasonEffectId: 3"],
    },
    {
      file: "test/lua-real-script-kuriboh-pre-damage-prevent.test.ts",
      kind: "kuribohBeforeDamagePrevent",
      required: ["restores its before-damage hand Quick Effect and prevents battle damage after self-discard cost", "triggerEvent: \"beforeDamageCalculation\"", "battleDamage).toEqual({ 0: 0, 1: 0 })"],
    },
    {
      file: "test/lua-real-script-mirage-knight-battle-target-atk.test.ts",
      kind: "mirageKnightDuringDamageAtkBanish",
      required: ["restores GetBattleTarget damage-calculation ATK and End Phase self-banish after battle", "battleWindow?.kind).toBe(\"duringDamageCalculation\")", "eventName: \"banished\""],
    },
    {
      file: "test/lua-real-script-nightmare-magician-battle-control.test.ts",
      kind: "nightmareMagicianEndDamageControl",
      required: ["restores battle-target indestructibility and controls the battled monster at Damage Step end", "triggerBucket: \"turnOptional\"", "previousController: 1"],
    },
    {
      file: "test/lua-real-script-predaplant-sarraceniant-battled-destroy.test.ts",
      kind: "predaplantSarraceniantAfterDamageDestroy",
      required: ["restores its EVENT_BATTLED trigger and destroys the monster it battled", "eventCode: 1138", "reasonEffectId: 2"],
    },
    {
      file: "test/lua-real-script-reflect-bounder-battle-confirm-destroy.test.ts",
      kind: "reflectBounderStartAndAfterDamageDestroy",
      required: ["restores battle-confirm damage into a later battled self-destruction trigger", "eventName: \"battleConfirmed\"", "eventName: \"afterDamageCalculation\""],
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
      file: "test/lua-real-script-topologic-bomber-battled-damage.test.ts",
      kind: "topologicBomberAfterDamageBurn",
      required: ["restores its EVENT_BATTLED trigger and deals effect damage from the battle target's base ATK", "eventName: \"damageDealt\"", "eventValue: 1200"],
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
      cipherSoldierBeforeDamageCalculationBoost: 0,
      ddAssailantAfterDamageBanishBoth: 0,
      ddWarriorWallMandatoryBattledSegoc: 0,
      desKangarooEndDamageDestroy: 0,
      destructionPunchEndDamageTrapDestroy: 0,
      divineKnightIshzarkAfterDamageBanish: 0,
      fabledAshenveilPreDamageBoost: 0,
      geminiSoldierAfterDamageDeckSummon: 0,
      getsuFuhmaEndDamageTargetDestroy: 0,
      gundariStartDamageSynchroBounce: 0,
      hayateAfterDamageDeckSend: 0,
      kuribohBeforeDamagePrevent: 0,
      mirageKnightDuringDamageAtkBanish: 0,
      nightmareMagicianEndDamageControl: 0,
      predaplantSarraceniantAfterDamageDestroy: 0,
      reflectBounderStartAndAfterDamageDestroy: 0,
      shadowSpellDuringDamagePersistentStat: 0,
      shinobirdCrowStartDamageStatBoost: 0,
      topologicBomberAfterDamageBurn: 0,
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
      file: "test/lua-real-script-ally-of-justice-nullfier-battled-disable.test.ts",
      kind: "afterDamageCalculation",
      required: [
        'battleWindow?.kind).toBe("afterDamageCalculation")',
        'eventName: "afterDamageCalculation"',
        'triggerBucket: "turnMandatory"',
        "target disabled true",
        '"code": 2',
        '"code": 8',
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
      file: "test/lua-real-script-dd-warrior-wall-battled-segoc.test.ts",
      kind: "afterDamageCalculation",
      required: [
        'eventName: "afterDamageCalculation"',
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
      file: "test/lua-real-script-fabled-ashenveil-damage-step-boost.test.ts",
      kind: "beforeDamageCalculation",
      required: [
        'battleWindow?.kind).toBe("startDamageStep")',
        'battleWindow?.kind).toBe("beforeDamageCalculation")',
        'eventName: "sentToGraveyard"',
        "eventReasonEffectId: 1",
        "currentAttack(boostedAshenveil, restoredChain.session.state)).toBe((ashenveil.data.attack ?? 0) + 600)",
        "battleDamage[1]).toBe((ashenveil.data.attack ?? 0) + 600 - (defender.data.attack ?? 0))",
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
      file: "test/lua-real-script-getsu-fuhma-damage-step-end.test.ts",
      kind: "endDamageStep",
      required: [
        'battleWindow?.kind).toBe("endDamageStep")',
        'eventName: "damageStepEnded"',
        "effectLabelObjectUid",
        "battleDamage).toEqual({ 0: 300, 1: 0 })",
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
        "targetCardPredicate).toBeDefined()",
        "previousController: 1",
      ],
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
      file: "test/lua-real-script-shinobird-crow-damage-step-stat.test.ts",
      kind: "startDamageStep",
      required: [
        'battleWindow?.kind).toBe("startDamageStep")',
        'eventName: "discarded"',
        'eventName: "sentToGraveyard"',
        "effectLabelObjectUid",
        "currentAttack(restoredCrow, restoredChain.session.state)).toBe(700)",
        "battleDamage[1]).toBe(200)",
      ],
    },
    {
      file: "test/lua-real-script-predaplant-sarraceniant-battled-destroy.test.ts",
      kind: "afterDamageCalculation",
      required: [
        'battleWindow?.kind).toBe("afterDamageCalculation")',
        'eventName: "afterDamageCalculation"',
        "eventCode: 1138",
        'eventName: "destroyed"',
        "reasonEffectId: 2",
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
        'eventName: "damageDealt"',
        "eventValue: 1200",
        "pendingBattle).toBeUndefined()",
      ],
    },
    {
      file: "test/lua-real-script-wall-of-illusion-battled.test.ts",
      kind: "afterDamageCalculation",
      required: [
        'battleWindow?.kind).toBe("afterDamageCalculation")',
        'eventName: "afterDamageCalculation"',
        'triggerBucket: "opponentMandatory"',
        'eventName: "sentToHand"',
        'location: "hand"',
        "eventReasonEffectId: 1",
      ],
    },
  ] satisfies Array<{ file: string; kind: BattleTimingKind; required: string[] }>).sort((a, b) => a.file.localeCompare(b.file));
}
