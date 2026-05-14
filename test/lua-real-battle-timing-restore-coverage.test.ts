import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Lua real battle timing restore coverage", () => {
  it("requires battle timing fixtures to assert clean Lua restore and restored trigger outcomes", () => {
    const missing = battleTimingFixtureFiles()
      .filter(({ file, required }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || required.some((snippet) => !text.includes(snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function battleTimingFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-cipher-soldier-pre-damage-calculate.test.ts",
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
      required: [
        'battleWindow?.kind).toBe("endDamageStep")',
        'eventName: "damageStepEnded"',
        'eventName: "destroyed"',
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-destruction-punch-damage-step-end.test.ts",
      required: [
        'battleWindow?.kind).toBe("endDamageStep")',
        'eventName: "damageStepEnded"',
        'eventName: "destroyed"',
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-gundari-battle-start-synchro-bounce.test.ts",
      required: [
        "restoredSetup.missingRegistryKeys).toEqual([])",
        "restoredTrigger.missingRegistryKeys).toEqual([])",
        'battleWindow?.kind).toBe("startDamageStep")',
        'eventName: "battleStarted"',
        'eventName: "sentToHand"',
        "pendingBattle).toBeUndefined()",
      ],
    },
    {
      file: "test/lua-real-script-topologic-bomber-battled-damage.test.ts",
      required: [
        'battleWindow?.kind).toBe("afterDamageCalculation")',
        'eventName: "afterDamageCalculation"',
        'eventName: "damageDealt"',
        "eventValue: 1200",
        "pendingBattle).toBeUndefined()",
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
