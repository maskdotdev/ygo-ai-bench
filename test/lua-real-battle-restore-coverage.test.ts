import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";
import {
  attackDeclarationTrapFixtureCount,
  attackDeclarationTrapKindCounts,
  battleContinuousSemanticFixtureCount,
  battleContinuousSemanticKindCounts,
  battleDamageSemanticFixtureCount,
  battleDamageSemanticKindCounts,
  battleLegalActionFixtureCount,
  battleRoutingFixtureCount,
  battleRoutingKindCounts,
  battleSemanticVariantCounts,
  battleTriggerSemanticFixtureCount,
  battleTriggerSemanticKindCounts,
  countAttackDeclarationTrapKinds,
  countBattleContinuousSemanticKinds,
  countBattleDamageSemanticKinds,
  countBattleRoutingKinds,
  countBattleSemanticVariants,
  countBattleTriggerSemanticKinds,
  countDamageStepRestoreKinds,
  damageStepRestoreFixtureCount,
  damageStepRestoreKindCounts,
  realScriptAttackDeclarationTrapFixtureFiles,
  realScriptBattleContinuousSemanticFixtureFiles,
  realScriptBattleDamageSemanticFixtureFiles,
  realScriptBattleFixtureCount,
  realScriptBattleFixtureFiles,
  realScriptBattleLegalActionFixtureFiles,
  realScriptBattleRoutingFixtureFiles,
  realScriptBattleSemanticVariants,
  realScriptBattleTriggerSemanticFixtureFiles,
  realScriptDamageStepRestoreFixtureFiles,
  realScriptDamageStepRestoreFixtures,
} from "./lua-real-battle-restore-fixtures.js";

const root = process.cwd();
const scriptedCalculateDamageFixtureCount = 6;
const scriptedCalculateDamageKindCounts = {
  attackNegationRecalculation: 3,
  attackSwapControlRecalculation: 1,
  battleTargetRecalculation: 2,
} satisfies Record<ScriptedCalculateDamageKind, number>;

type ScriptedCalculateDamageKind = "attackNegationRecalculation" | "attackSwapControlRecalculation" | "battleTargetRecalculation";
type ScriptedCalculateDamageFixture = { file: string; kind: ScriptedCalculateDamageKind; required: string[] };

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

  it("requires scripted CalculateDamage fixtures to prove restored battle recalculation outcomes", () => {
    const files = realScriptCalculateDamageFixtures();
    expect(files).toHaveLength(scriptedCalculateDamageFixtureCount);

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
          || !text.includes("eventCode")
          || !text.includes("eventCardUid")
          || !text.includes("battleDamage")
          || !text.includes("lifePoints")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps scripted CalculateDamage fixture kinds explicit", () => {
    expect(countScriptedCalculateDamageKinds(realScriptCalculateDamageFixtures())).toEqual(scriptedCalculateDamageKindCounts);
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

  it("keeps named battle semantic variants explicit", () => {
    expect(countBattleSemanticVariants(realScriptBattleSemanticVariants())).toEqual(battleSemanticVariantCounts);

    const weak = realScriptBattleSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function realScriptCalculateDamageFixtures(): ScriptedCalculateDamageFixture[] {
  return ([
    { file: "test/lua-real-script-dispatchparazzi-calculate-damage.test.ts", kind: "battleTargetRecalculation", required: ["Duel.CalculateDamage(at,c)", "pendingBattle).toBeUndefined()", 'eventName: "battleDamageDealt"', "players[1].lifePoints).toBe(7200)"] },
    { file: "test/lua-real-script-gagaga-samurai-calculate-damage.test.ts", kind: "battleTargetRecalculation", required: ["Duel.CalculateDamage(at,c)", "pendingBattle).toBeUndefined()", "position: \"faceUpDefense\"", "players[1].lifePoints).toBe(8000)"] },
    { file: "test/lua-real-script-last-counter-negate-calculate-damage.test.ts", kind: "attackNegationRecalculation", required: ["Duel.NegateAttack()", "Duel.CalculateDamage(bc,sc)", "pendingBattle).toBeUndefined()", 'eventName: "battleDamageDealt"', "players[1].lifePoints).toBe(6800)"] },
    { file: "test/lua-real-script-magical-arm-shield-calculate-damage.test.ts", kind: "attackNegationRecalculation", required: ['battleWindow?.kind).toBe("attackNegationResponse")', 'eventName: "controlChanged"', "battleDamage).toEqual({ 0: 1500, 1: 0 })", 'eventName: "battleDamageDealt"'] },
    { file: "test/lua-real-script-mirror-gate-swap-calculate-damage.test.ts", kind: "attackSwapControlRecalculation", required: ["Duel.SwapControl(a,at,RESET_PHASE|PHASE_END,1)", "Duel.CalculateDamage(a,at)", 'eventName: "controlChanged"', "battleDamage).toEqual({ 0: 0, 1: 800 })", "players[1].lifePoints).toBe(7200)"] },
    { file: "test/lua-real-script-super-junior-confrontation-calculate-damage.test.ts", kind: "attackNegationRecalculation", required: ['battleWindow?.kind).toBe("attackNegationResponse")', "skippedPhases).toEqual([{ player: 1, phase: \"battle\", remaining: 1 }])", "battleDamage).toEqual({ 0: 0, 1: 0 })", 'eventName: "attackDisabled"'] },
  ] satisfies ScriptedCalculateDamageFixture[]).sort((a, b) => a.file.localeCompare(b.file));
}

function countScriptedCalculateDamageKinds(fixtures: Array<{ kind: ScriptedCalculateDamageKind }>): Record<ScriptedCalculateDamageKind, number> {
  return fixtures.reduce<Record<ScriptedCalculateDamageKind, number>>((counts, fixture) => {
    counts[fixture.kind] += 1;
    return counts;
  }, { attackNegationRecalculation: 0, attackSwapControlRecalculation: 0, battleTargetRecalculation: 0 });
}
