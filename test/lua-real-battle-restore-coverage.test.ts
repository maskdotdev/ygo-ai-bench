import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const testRoot = path.join(root, "test");
const battleKeywords = ["battle", "attack", "damage"];
const realScriptBattleFixtureCount = 141;
const battleLegalActionFixtureCount = 4;
const attackDeclarationTrapFixtureCount = 6;
const battleRoutingFixtureCount = 6;
const battleContinuousSemanticFixtureCount = 1;
const damageStepRestoreFixtureCount = 4;
const battleDamageSemanticFixtureCount = 8;
const battleTriggerSemanticFixtureCount = 11;
const attackDeclarationTrapKindCounts = {
  attackBanish: 1,
  attackDestroy: 1,
  attackNegateSetAgain: 1,
  battlePhaseSkipNegate: 1,
  damageReflect: 1,
  lpRecoverNegate: 1,
} satisfies Record<AttackDeclarationTrapKind, number>;
const battleRoutingKindCounts = {
  attackAllTargetFilter: 2,
  attackAnnouncementLock: 1,
  battleTargetSelectionLock: 1,
  extraMonsterAttack: 1,
  onlyAttackEquipped: 1,
} satisfies Record<BattleRoutingKind, number>;
const battleContinuousSemanticKindCounts = {
  battledGraveDisable: 1,
} satisfies Record<BattleContinuousSemanticKind, number>;
const damageStepRestoreKindCounts = {
  activatedDamageStepBoost: 1,
  honestDamageStepBoost: 1,
  persistentDamageCalculationStat: 1,
  persistentDamageStepStat: 1,
} satisfies Record<DamageStepRestoreKind, number>;
const battleDamageSemanticKindCounts = {
  alsoBattleDamage: 1,
  battleDamagePrevention: 1,
  battleDamageToEffect: 1,
  battleRetargetDamage: 1,
  halfBattleDamage: 1,
  pierceBattleDamage: 1,
  reflectBattleDamage: 1,
  temporaryDamageCalcBoost: 1,
} satisfies Record<BattleDamageSemanticKind, number>;
const battleTriggerSemanticKindCounts = {
  battleConfirmDestroy: 1,
  battleDestroyedDestroy: 1,
  battleSearch: 1,
  battledBounce: 1,
  battledDeckSend: 1,
  battledDestroy: 1,
  battledDamage: 1,
  battledDisable: 1,
  endDamageControl: 1,
  endDamageDestroy: 1,
  mutualBattleDestroyedSegoc: 1,
} satisfies Record<BattleTriggerSemanticKind, number>;

type AttackDeclarationTrapKind =
  | "attackBanish"
  | "attackDestroy"
  | "attackNegateSetAgain"
  | "battlePhaseSkipNegate"
  | "damageReflect"
  | "lpRecoverNegate";

type BattleRoutingKind =
  | "attackAllTargetFilter"
  | "attackAnnouncementLock"
  | "battleTargetSelectionLock"
  | "extraMonsterAttack"
  | "onlyAttackEquipped";

type BattleContinuousSemanticKind = "battledGraveDisable";

type DamageStepRestoreKind =
  | "activatedDamageStepBoost"
  | "honestDamageStepBoost"
  | "persistentDamageCalculationStat"
  | "persistentDamageStepStat";

type BattleDamageSemanticKind =
  | "alsoBattleDamage"
  | "battleDamagePrevention"
  | "battleDamageToEffect"
  | "battleRetargetDamage"
  | "halfBattleDamage"
  | "pierceBattleDamage"
  | "reflectBattleDamage"
  | "temporaryDamageCalcBoost";

type BattleTriggerSemanticKind =
  | "battleConfirmDestroy"
  | "battleDestroyedDestroy"
  | "battleSearch"
  | "battledBounce"
  | "battledDeckSend"
  | "battledDestroy"
  | "battledDamage"
  | "battledDisable"
  | "endDamageControl"
  | "endDamageDestroy"
  | "mutualBattleDestroyedSegoc";

describe("Lua real battle restore coverage", () => {
  it("requires real-script battle fixtures to assert Lua-aware complete restore with diagnostics", () => {
    const files = realScriptBattleFixtureFiles();
    expect(files).toHaveLength(realScriptBattleFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")');
      });

    expect(missing).toEqual([]);
  });

  it("requires representative real-script battle legal-action fixtures to assert restored grouped legal actions", () => {
    const files = realScriptBattleLegalActionFixtureFiles();
    expect(files).toHaveLength(battleLegalActionFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])");
      });

    expect(missing).toEqual([]);
  });

  it("requires representative attack-declaration trap fixtures to assert clean Lua registry restore and battle cleanup", () => {
    const files = realScriptAttackDeclarationTrapFixtureFiles();
    expect(files).toHaveLength(attackDeclarationTrapFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("pendingBattle).toBeUndefined()")
          || !text.includes("currentAttack).toBeUndefined()")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps attack-declaration trap fixture kinds explicit", () => {
    expect(countAttackDeclarationTrapKinds(realScriptAttackDeclarationTrapFixtureFiles())).toEqual(attackDeclarationTrapKindCounts);
  });

  it("requires representative battle routing fixtures to assert clean Lua registry restore", () => {
    const files = realScriptBattleRoutingFixtureFiles();
    expect(files).toHaveLength(battleRoutingFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("hasAttack")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps battle routing fixture kinds explicit", () => {
    expect(countBattleRoutingKinds(realScriptBattleRoutingFixtureFiles())).toEqual(battleRoutingKindCounts);
  });

  it("requires representative battle continuous fixtures to prove restored continuous outcomes", () => {
    const files = realScriptBattleContinuousSemanticFixtureFiles();
    expect(files).toHaveLength(battleContinuousSemanticFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("eventHistory")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps battle continuous semantic fixture kinds explicit", () => {
    expect(countBattleContinuousSemanticKinds(realScriptBattleContinuousSemanticFixtureFiles())).toEqual(battleContinuousSemanticKindCounts);
  });

  it("requires real damage-step restore fixtures to pin restorable battle windows and response replay", () => {
    const files = realScriptDamageStepRestoreFixtureFiles();
    expect(files).toHaveLength(damageStepRestoreFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !/battleWindow\?\.kind\)\.toBe\("(?:startDamageStep|duringDamageCalculation|afterDamageCalculation|endDamageStep)"\)/.test(text)
          || !/while\s*\(\s*(?:restored\.session\.state|session\.state)\.pendingBattle/.test(text)
          || !text.includes("chainResponderScript")
          || !/host\.messages\)\.not\.toContain/.test(text);
      });

    expect(missing).toEqual([]);
  });

  it("keeps damage-step restore fixture kinds explicit", () => {
    expect(countDamageStepRestoreKinds(realScriptDamageStepRestoreFixtures())).toEqual(damageStepRestoreKindCounts);
  });

  it("requires representative battle damage fixtures to prove restored damage semantics", () => {
    const files = realScriptBattleDamageSemanticFixtureFiles();
    expect(files).toHaveLength(battleDamageSemanticFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("battleDamage")
          || !text.includes("lifePoints")
          || !text.includes("battleDamageDealt")
          || !text.includes("while (")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps battle damage semantic fixture kinds explicit", () => {
    expect(countBattleDamageSemanticKinds(realScriptBattleDamageSemanticFixtureFiles())).toEqual(battleDamageSemanticKindCounts);
  });

  it("requires representative battle trigger fixtures to prove restored event payloads and outcomes", () => {
    const files = realScriptBattleTriggerSemanticFixtureFiles();
    expect(files).toHaveLength(battleTriggerSemanticFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("pendingTriggers")
          || !text.includes('type === "activateTrigger"')
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("eventHistory")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps battle trigger semantic fixture kinds explicit", () => {
    expect(countBattleTriggerSemanticKinds(realScriptBattleTriggerSemanticFixtureFiles())).toEqual(battleTriggerSemanticKindCounts);
  });
});

function realScriptBattleFixtureFiles(): string[] {
  return fs.readdirSync(testRoot)
    .filter((file) => file.startsWith("lua-real-script-") && file.endsWith(".test.ts"))
    .filter((file) => battleKeywords.some((keyword) => file.includes(keyword)))
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptBattleLegalActionFixtureFiles(): string[] {
  return [
    "lua-real-script-battle-protection.test.ts",
    "lua-real-script-command-knight-battle-target-lock.test.ts",
    "lua-real-script-dd-borderline-battle-phase-lock.test.ts",
    "lua-real-script-mirror-force-battle-window.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptAttackDeclarationTrapFixtureFiles(): Array<{
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

function realScriptBattleRoutingFixtureFiles(): Array<{
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

function realScriptBattleContinuousSemanticFixtureFiles(): Array<{
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

function realScriptDamageStepRestoreFixtureFiles(): string[] {
  return realScriptDamageStepRestoreFixtures().map(({ file }) => file);
}

function realScriptDamageStepRestoreFixtures(): Array<{ file: string; kind: DamageStepRestoreKind }> {
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

function realScriptBattleDamageSemanticFixtureFiles(): Array<{
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

function realScriptBattleTriggerSemanticFixtureFiles(): Array<{
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
      required: [
        "directAttack === true",
        'battleWindow?.kind).toBe("afterDamageCalculation")',
        'eventName: "afterDamageCalculation"',
        "eventCode: 1138",
        'eventName: "sentToGraveyard"',
        'location: "graveyard"',
        "reasonEffectId: 3",
      ],
    },
    {
      file: "lua-real-script-predaplant-sarraceniant-battled-destroy.test.ts",
      kind: "battledDestroy",
      required: [
        'battleWindow?.kind).toBe("afterDamageCalculation")',
        'eventName: "afterDamageCalculation"',
        "eventCode: 1138",
        'eventName: "destroyed"',
        'location: "graveyard"',
        "reasonEffectId: 2",
      ],
    },
    {
      file: "lua-real-script-topologic-bomber-battled-damage.test.ts",
      kind: "battledDamage",
      required: [
        'battleWindow?.kind).toBe("afterDamageCalculation")',
        'eventName: "afterDamageCalculation"',
        "eventCode: 1138",
        'eventName: "damageDealt"',
        "eventValue: 1200",
        "players[1].lifePoints).toBe(5000)",
      ],
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
      file: "lua-real-script-yomi-ship-battle-destroyed.test.ts",
      kind: "battleDestroyedDestroy",
      required: [
        'eventName: "battleDestroyed"',
        "eventCode: 1140",
        "reasonCardUid: attacker!.uid",
        'eventName: "destroyed"',
        'location: "graveyard"',
      ],
    },
    {
      file: "lua-real-script-giant-rat-mutual-battle-destroyed-segoc.test.ts",
      kind: "mutualBattleDestroyedSegoc",
      required: [
        'triggerBucket: "turnOptional"',
        'triggerBucket: "opponentOptional"',
        "pendingTriggerBuckets",
        'event.eventName === "specialSummoned"',
        'position: "faceUpAttack"',
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

function countAttackDeclarationTrapKinds(
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

function countBattleRoutingKinds(fixtures: Array<{ kind: BattleRoutingKind }>): Record<BattleRoutingKind, number> {
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

function countBattleContinuousSemanticKinds(
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

function countDamageStepRestoreKinds(
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

function countBattleDamageSemanticKinds(
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

function countBattleTriggerSemanticKinds(
  fixtures: Array<{ kind: BattleTriggerSemanticKind }>,
): Record<BattleTriggerSemanticKind, number> {
  return fixtures.reduce<Record<BattleTriggerSemanticKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      battleConfirmDestroy: 0,
      battleDestroyedDestroy: 0,
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
