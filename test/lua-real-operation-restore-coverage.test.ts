import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const operationFixtureCount = 12;
const summonTriggerOperationFixtureCount = 5;

describe("Lua real operation restore coverage", () => {
  it("requires representative simple spell operations to assert clean Lua registry restore and restored operation metadata", () => {
    const files = operationFixtureFiles();
    expect(files).toHaveLength(operationFixtureCount);

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
          || !text.includes("operationInfos")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires summon-trigger operations to assert clean Lua registry restore and restored operation metadata", () => {
    const files = summonTriggerOperationFixtureFiles();
    expect(files).toHaveLength(summonTriggerOperationFixtureCount);

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
          || !text.includes("operationInfos")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function operationFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-castle-gate-release-cost-damage.test.ts",
      required: [
        "categoryDamage",
        "effectLabel: 1700",
        "targetParam: 1700",
        'eventName: "released"',
        'eventName: "damageDealt"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-dicelops-toss-dice-restore.test.ts",
      required: [
        "categoryDice",
        "categoryHandes",
        "lastDiceResults).toEqual([])",
        'eventName: "diceTossed"',
        'location: "graveyard"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-foolish-burial-deck-to-grave.test.ts",
      required: [
        "category: 0x20",
        'eventName: "sentToGraveyard"',
        'location: "graveyard", controller: 0',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-harpies-feather-duster-group-destroy.test.ts",
      required: [
        "category: 0x1",
        "sortedUids([opponentTrap!.uid, opponentSpell!.uid])",
        'eventName: "destroyed"',
        'location: "spellTrapZone"',
        'location: "graveyard"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-lightning-storm-select-effect.test.ts",
      required: [
        "effectLabel: 1",
        "effectLabel: 2",
        "category: 0x1",
        "sortedUids([opponentAttacker!.uid, opponentSecondAttacker!.uid])",
        "sortedUids([opponentTrap!.uid, opponentSpell!.uid])",
        'eventName: "destroyed"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-pot-of-desires-deck-cost.test.ts",
      required: [
        "category: 0x10000",
        'eventName: "banished"',
        'eventName: "cardsDrawn"',
        "faceUp: false",
        "reason: 0x80",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-pot-of-duality-excavate.test.ts",
      required: [
        "category: 0x8",
        'eventName: "confirmed"',
        'eventName: "sentToHandConfirmed"',
        "effect.sourceUid === pot!.uid && effect.code === 22",
        'action.type === "specialSummonProcedure"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-pot-of-extravagance-extra-cost.test.ts",
      required: [
        "category: 0x10000",
        "randomCounter).toBe(1)",
        'eventName: "cardsDrawn"',
        "faceUp: false",
        "drawDuelCards(restored.session.state, 0, 1",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-pot-of-prosperity-excavate.test.ts",
      required: [
        "category: 0x8",
        'eventName: "confirmed"',
        'eventName: "sentToHandConfirmed"',
        "drawDuelCards(restored.session.state, 0, 1",
        "effect.sourceUid === pot!.uid && effect.code === 82",
        "battleDamage[1]).toBe(500)",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-raigeki-group-destroy.test.ts",
      required: [
        "category: 0x1",
        "sortedUids([opponentAttack!.uid, opponentDefense!.uid])",
        'eventName: "destroyed"',
        'location: "graveyard"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-saion-toss-coin-restore.test.ts",
      required: [
        "categoryCoin",
        "lastCoinResults).toEqual([])",
        'eventName: "coinTossed"',
        "saion disabled true",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-reinforcement-of-the-army-search.test.ts",
      required: [
        "category: 0x8",
        'eventName: "sentToHand"',
        'eventName: "sentToHandConfirmed"',
        'location: "hand", controller: 0',
        "host.messages).not.toContain",
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}

function summonTriggerOperationFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-shinobird-crane-spirit-summon-draw.test.ts",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChainWindow.missingRegistryKeys).toEqual([])",
        "restoredChainWindow.missingChainLimitRegistryKeys).toEqual([])",
        'eventName": "normalSummoned"',
        'eventName: "cardsDrawn"',
        "category: 65536",
        "targetParam: 1",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-dark-dust-spirit-destroy.test.ts",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChainWindow.missingRegistryKeys).toEqual([])",
        "restoredChainWindow.missingChainLimitRegistryKeys).toEqual([])",
        'eventName: "normalSummoned"',
        'eventName: "destroyed"',
        "category: 0x1",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-aratama-spirit-search.test.ts",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChainWindow.missingRegistryKeys).toEqual([])",
        "restoredChainWindow.missingChainLimitRegistryKeys).toEqual([])",
        'eventName": "normalSummoned"',
        'eventName: "sentToHand"',
        "category: 8",
        "eventName: \"sentToHandConfirmed\"",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-izanami-spirit-grave-return.test.ts",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChainWindow.missingRegistryKeys).toEqual([])",
        "restoredChainWindow.missingChainLimitRegistryKeys).toEqual([])",
        'eventName": "normalSummoned"',
        'eventName: "discarded"',
        'eventName: "sentToHand"',
        "category: 8",
        "eventName: \"sentToHandConfirmed\"",
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-yaksha-spirit-backrow-return.test.ts",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChainWindow.missingRegistryKeys).toEqual([])",
        "restoredChainWindow.missingChainLimitRegistryKeys).toEqual([])",
        'eventName: "normalSummoned"',
        'eventName: "sentToHand"',
        "category: 8",
        "targetUids",
        "host.messages).not.toContain",
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
