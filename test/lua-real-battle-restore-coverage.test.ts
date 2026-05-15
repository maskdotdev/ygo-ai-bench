import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const testRoot = path.join(root, "test");
const battleKeywords = ["battle", "attack", "damage"];
const realScriptBattleFixtureCount = 124;
const battleLegalActionFixtureCount = 4;
const attackDeclarationTrapFixtureCount = 6;
const battleRoutingFixtureCount = 6;
const damageStepRestoreFixtureCount = 3;
const battleDamageSemanticFixtureCount = 8;
const battleTriggerSemanticFixtureCount = 7;

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
          || (!text.includes("while (restored.session.state.pendingBattle)") && !text.includes("while (session.state.pendingBattle)"))
          || !text.includes("chainResponderScript")
          || !/host\.messages\)\.not\.toContain/.test(text);
      });

    expect(missing).toEqual([]);
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

function realScriptAttackDeclarationTrapFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "lua-real-script-magic-cylinder-battle-window.test.ts",
      required: [
        "targetUids: [attacker!.uid]",
        "attackCanceledUids).toEqual([attacker!.uid])",
        "lifePoints).toBe(6200)",
      ],
    },
    {
      file: "lua-real-script-dimensional-prison-battle-window.test.ts",
      required: [
        "targetUids: [attacker!.uid]",
        'location: "banished"',
        "lifePoints).toBe(8000)",
      ],
    },
    {
      file: "lua-real-script-draining-shield-battle-window.test.ts",
      required: [
        "attackCanceledUids).toEqual([attacker!.uid])",
        "players[1].lifePoints).toBe(9800)",
      ],
    },
    {
      file: "lua-real-script-sakuretsu-armor-battle-window.test.ts",
      required: [
        'location: "graveyard"',
        "players[1].lifePoints).toBe(8000)",
      ],
    },
    {
      file: "lua-real-script-scrap-iron-scarecrow-battle-window.test.ts",
      required: [
        "attackCanceledUids).toEqual([attacker!.uid])",
        'location: "spellTrapZone", position: "faceDown", faceUp: false',
      ],
    },
    {
      file: "lua-real-script-negate-attack-battle-window.test.ts",
      required: [
        "attackCanceledUids).toEqual([firstAttacker!.uid])",
        "skippedPhases).toEqual([{ player: 0, phase: \"battle\", remaining: 1 }])",
      ],
    },
  ].map(({ file, required }) => ({ file: path.join("test", file), required }));
}

function realScriptBattleRoutingFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "lua-real-script-aoj-thousand-arms-attack-all-light.test.ts",
      required: [
        "hasAttack(actions, thousandArms.uid, lightTarget.uid)).toBe(true)",
        "hasAttack(actions, thousandArms.uid, darkTarget.uid)).toBe(false)",
        "hasDirectAttack(actions, thousandArms.uid)).toBe(false)",
      ],
    },
    {
      file: "lua-real-script-decoyroid-battle-target-selection-lock.test.ts",
      required: [
        "hasAttack(actions, attacker.uid, decoyroid.uid)).toBe(true)",
        "hasAttack(actions, attacker.uid, protectedTarget.uid)).toBe(false)",
      ],
    },
    {
      file: "lua-real-script-ghost-bird-extra-monster-attack.test.ts",
      required: [
        "hasAttack(actions, ghostBird.uid, target.uid)).toBe(true)",
        "hasDirectAttack(actions, ghostBird.uid)).toBe(false)",
        "hasDirectAttack(noTargetActions, ghostBird.uid)).toBe(false)",
      ],
    },
    {
      file: "lua-real-script-grasschopper-gemini-attack-all.test.ts",
      required: [
        "hasAttack(firstActions, grasschopper.uid, firstTarget.uid)).toBe(true)",
        "hasAttack(secondActions, grasschopper.uid, secondTarget.uid)).toBe(true)",
        "hasDirectAttack(secondActions, grasschopper.uid)).toBe(false)",
      ],
    },
    {
      file: "lua-real-script-naturia-spiderfang-attack-announce-lock.test.ts",
      required: [
        "hasAttack(actions, spiderfang.uid, target.uid)).toBe(false)",
        "hasAttack(actions, ordinary.uid, target.uid)).toBe(true)",
      ],
    },
    {
      file: "lua-real-script-ring-of-magnetism-only-attack.test.ts",
      required: [
        "hasAttack(actions, attacker.uid, equippedTarget.uid)).toBe(true)",
        "hasAttack(actions, attacker.uid, sideTarget.uid)).toBe(false)",
        "directAttack)).toBe(false)",
      ],
    },
  ]
    .map(({ file, required }) => ({ file: path.join("test", file), required }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function realScriptDamageStepRestoreFixtureFiles(): string[] {
  return [
    "lua-real-script-honest-damage-step.test.ts",
    "lua-real-script-miniaturize-persistent-damage-step-stat.test.ts",
    "lua-real-script-shadow-spell-goat-damage-calculation-persistent.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptBattleDamageSemanticFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "lua-real-script-ancient-gear-golem-pierce-battle-damage.test.ts",
      required: [
        "expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 1500 })",
        "eventValue: 1500",
      ],
    },
    {
      file: "lua-real-script-amazoness-swords-woman-reflect-battle-damage.test.ts",
      required: [
        "expect(restored.session.state.battleDamage).toEqual({ 0: 500, 1: 0 })",
        "eventPlayer: 0",
        "eventValue: 500",
      ],
    },
    {
      file: "lua-real-script-battle-damage-prevention.test.ts",
      required: [
        "expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 0 })",
        'expect.objectContaining({ action: "battleDamage", player: 1, detail: "0" })',
      ],
    },
    {
      file: "lua-real-script-gravekeepers-vassal-battle-damage-to-effect.test.ts",
      required: [
        "expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 700 })",
        'expect.objectContaining({ action: "effectDamage", player: 1, detail: "700" })',
        "eventReason: 64",
      ],
    },
    {
      file: "lua-real-script-magical-arm-shield-calculate-damage.test.ts",
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
      required: [
        'battleWindow?.kind).toBe("duringDamageCalculation")',
        "expect(restoredDamageCalc.session.state.battleDamage).toEqual({ 0: 0, 1: 2800 })",
        'eventName: "battleDamageDealt"',
        'location: "banished"',
      ],
    },
    {
      file: "lua-real-script-number-c96-also-battle-damage.test.ts",
      required: [
        "expect(restored.session.state.battleDamage).toEqual({ 0: 800, 1: 800 })",
        "eventPlayer: 0",
        "eventPlayer: 1",
      ],
    },
    {
      file: "lua-real-script-susa-soldier-half-damage.test.ts",
      required: [
        "expect(restored.session.state.battleDamage[1]).toBe(500)",
        "eventValue: 500",
      ],
    },
  ].map(({ file, required }) => ({ file: path.join("test", file), required }));
}

function realScriptBattleTriggerSemanticFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "lua-real-script-ally-of-justice-nullfier-battled-disable.test.ts",
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
      required: [
        'battleWindow?.kind).toBe("afterDamageCalculation")',
        'eventName: "afterDamageCalculation"',
        "eventCode: 1138",
        'eventName: "sentToHand"',
        'location: "hand"',
      ],
    },
    {
      file: "lua-real-script-topologic-bomber-battled-damage.test.ts",
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
      required: [
        'triggerBucket: "turnOptional"',
        'triggerBucket: "opponentOptional"',
        "pendingTriggerBuckets",
        'event.eventName === "specialSummoned"',
        'position: "faceUpAttack"',
      ],
    },
    {
      file: "lua-real-script-getsu-fuhma-damage-step-end.test.ts",
      required: [
        'battleWindow?.kind).toBe("endDamageStep")',
        'eventName: "damageStepEnded"',
        "eventCode: 1141",
        'eventName: "destroyed"',
        'location: "graveyard"',
      ],
    },
  ].map(({ file, required }) => ({ file: path.join("test", file), required }));
}
