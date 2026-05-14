import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Lua real summon-negation restore coverage", () => {
  it("requires representative summon-negation fixtures to assert grouped legal actions and clean Lua restore", () => {
    const missing = realScriptSummonNegationFixtures()
      .filter((fixture) => {
        const text = fs.readFileSync(path.join(root, fixture.file), "utf8");
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])");
      })
      .map((fixture) => fixture.file);

    expect(missing).toEqual([]);
  });

  it("requires representative summon-negation fixtures to prove restored summon-attempt chain metadata and cleanup", () => {
    const weak = realScriptSummonNegationFixtures()
      .filter((fixture) => {
        const text = fs.readFileSync(path.join(root, fixture.file), "utf8");
        return ![
          "state.chain).toHaveLength(1)",
          "category: 0x8000",
          "category: 0x1",
          'location: "graveyard"',
          "eventHistory).not.toEqual",
          "host.messages).not.toContain",
          ...fixture.requiredSnippets,
        ].every((snippet) => text.includes(snippet));
      })
      .map((fixture) => fixture.file);

    expect(weak).toEqual([]);
  });
});

function realScriptSummonNegationFixtures(): Array<{ file: string; requiredSnippets: string[] }> {
  return [
    {
      file: "test/lua-real-script-solemn-judgment-summon-negate.test.ts",
      requiredSnippets: [
        'eventName: "normalSummoning"',
        'eventName: "flipSummoning"',
        'eventName: "specialSummoning"',
        'eventName: "normalSummonNegated"',
        'eventName: "flipSummonNegated"',
        'eventName: "specialSummonNegated"',
        'eventName: "lifePointCostPaid"',
        "eventValue: 4000",
      ],
    },
    {
      file: "test/lua-real-script-solemn-warning-special-summon-effect-negate.test.ts",
      requiredSnippets: [
        'eventName: "normalSummoning"',
        'eventName: "flipSummoning"',
        'eventName: "specialSummoning"',
        'eventName: "normalSummonNegated"',
        'eventName: "flipSummonNegated"',
        'eventName: "specialSummonNegated"',
        'eventName: "lifePointCostPaid"',
        "eventValue: 2000",
      ],
    },
    {
      file: "test/lua-real-script-solemn-strike-special-summon-negate.test.ts",
      requiredSnippets: [
        'eventName: "specialSummoning"',
        'eventName: "specialSummonNegated"',
        'eventName: "lifePointCostPaid"',
        "eventValue: 1500",
      ],
    },
    {
      file: "test/lua-real-script-black-horn-special-summon-negate.test.ts",
      requiredSnippets: [
        'eventName: "specialSummoning"',
        'eventName: "specialSummonNegated"',
        "eventReasonPlayer: 0",
        "players[1].lifePoints).toBe(8000)",
      ],
    },
    {
      file: "test/lua-real-script-grand-horn-special-summon-negate.test.ts",
      requiredSnippets: [
        'eventName: "specialSummoning"',
        'eventName: "specialSummonNegated"',
        'eventName: "cardsDrawn"',
        'skippedPhases).toEqual([{ player: 0, phase: "main1", remaining: 1 }])',
        'type: "changePhase", phase: "battle"',
      ],
    },
    {
      file: "test/lua-real-script-horn-of-heaven-release-cost-negate.test.ts",
      requiredSnippets: [
        'eventName: "specialSummoning"',
        'eventName: "specialSummonNegated"',
        'eventName: "released"',
        "duelReason.release",
        "duelReason.cost",
        "previousLocation: \"monsterZone\"",
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
