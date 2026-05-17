import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const battleTimingFixtureCount = 9;
const battleTimingKindCounts: Record<BattleTimingKind, number> = {
  afterDamageCalculation: 3,
  beforeDamageCalculation: 2,
  duringDamageCalculation: 1,
  endDamageStep: 2,
  startDamageStep: 1,
};

describe("Lua real battle timing restore coverage", () => {
  it("keeps battle timing fixture kinds explicit", () => {
    expect(countBattleTimingKinds(battleTimingFixtureFiles())).toEqual(battleTimingKindCounts);
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
});

type BattleTimingKind = "afterDamageCalculation" | "beforeDamageCalculation" | "duringDamageCalculation" | "endDamageStep" | "startDamageStep";

function countBattleTimingKinds(fixtures: Array<{ kind: BattleTimingKind }>): Record<BattleTimingKind, number> {
  return fixtures.reduce<Record<BattleTimingKind, number>>(
    (counts, { kind }) => ({ ...counts, [kind]: counts[kind] + 1 }),
    { afterDamageCalculation: 0, beforeDamageCalculation: 0, duringDamageCalculation: 0, endDamageStep: 0, startDamageStep: 0 },
  );
}

function battleTimingFixtureFiles(): Array<{ file: string; kind: BattleTimingKind; required: string[] }> {
  return ([
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
  ] satisfies Array<{ file: string; kind: BattleTimingKind; required: string[] }>).sort((a, b) => a.file.localeCompare(b.file));
}
