import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const spiritFixtureCount = 12;

describe("Lua real Spirit restore coverage", () => {
  it("requires representative Spirit fixtures to prove clean Lua restore and replayed legal actions", () => {
    const files = realScriptSpiritFixtureFiles();
    expect(files).toHaveLength(spiritFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getDuelLegalActions")
          || !text.includes("applyLuaRestoreResponse")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function realScriptSpiritFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "lua-real-script-sakitama-spirit-effect-summon.test.ts",
      required: [
        "restoredOpenWindow.missingRegistryKeys).toEqual([])",
        "restoredOpenWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChainWindow.missingRegistryKeys).toEqual([])",
        "restoredChainWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredReleaseChain.missingRegistryKeys).toEqual([])",
        "restoredReleaseChain.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerChain.missingRegistryKeys).toEqual([])",
        "restoredTriggerChain.missingChainLimitRegistryKeys).toEqual([])",
        'summonType: "normal"',
        'eventName: "released"',
        'location: "hand", controller: 0',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "lua-real-script-konohanasakuya-spirit-special-return.test.ts",
      required: [
        'action.type === "specialSummonProcedure"',
        'eventName: "phaseEnd"',
        'action.type === "activateTrigger"',
        'location: "hand"',
      ],
    },
    {
      file: "lua-real-script-izanagi-spirit-maynot-return.test.ts",
      required: [
        'action.type === "specialSummonProcedure"',
        'action.type === "declineTrigger"',
        'action.type === "activateTrigger"',
        'location: "banished"',
        'location: "hand"',
      ],
    },
    {
      file: "lua-real-script-nikitama-extra-spirit-summon.test.ts",
      required: [
        "normalSummonAvailable).toBe(false)",
        'action.type === "normalSummon"',
        "overLimit).toBeUndefined()",
      ],
    },
    {
      file: "lua-real-script-aratama-spirit-search.test.ts",
      required: [
        'action.type === "activateTrigger"',
        'eventName: "normalSummoned"',
        'eventName: "sentToHand"',
        'eventName: "sentToHandConfirmed"',
      ],
    },
    {
      file: "lua-real-script-ichiki-sayori-hime-effect-summon-search.test.ts",
      required: [
        'action.type === "activateEffect"',
        'action.type === "activateTrigger"',
        'action.type === "passChain"',
        'eventName: "normalSummoned"',
        'eventName: "sentToHand"',
        'eventName: "sentToHandConfirmed"',
        'summonType: "normal"',
        "category: 256",
        "category: 8",
        'location: "hand", controller: 0',
        'host.messages).not.toContain("ichiki responder resolved")',
      ],
    },
    {
      file: "lua-real-script-shinobird-pigeon-spirit-return.test.ts",
      required: [
        'action.type === "normalSummon"',
        'action.type === "activateEffect"',
        'action.type === "passChain"',
        'eventName: "sentToHand"',
        'location: "hand", controller: 0',
        'host.messages).not.toContain("shinobird pigeon responder resolved")',
      ],
    },
    {
      file: "lua-real-script-kuro-obi-karate-spirit-column-send.test.ts",
      required: [
        'action.type === "tributeSummon"',
        'action.type === "activateTrigger"',
        'eventName: "normalSummoned"',
        'eventName === "sentToGraveyard"',
        'location: "graveyard", controller: 1',
        'location: "spellTrapZone", controller: 1, sequence: 1',
        'action.type === "pendulumSummon"',
        'eventName: "specialSummoned"',
        'location: "hand", controller: 0',
        'summonType: "pendulum"',
      ],
    },
    {
      file: "lua-real-script-kai-den-kendo-spirit-column-send.test.ts",
      required: [
        'action.type === "tributeSummon"',
        'action.type === "activateTrigger"',
        'eventName: "normalSummoned"',
        'eventName === "sentToGraveyard"',
        'location: "graveyard", controller: 1',
        'location: "spellTrapZone", controller: 1, sequence: 1',
        'action.type === "pendulumSummon"',
        'eventName: "specialSummoned"',
        'location: "hand", controller: 0',
        'summonType: "pendulum"',
      ],
    },
    {
      file: "lua-real-script-gishki-natalia-spirit-to-deck.test.ts",
      required: [
        'action.type === "normalSummon"',
        'action.type === "activateTrigger"',
        'action.type === "passChain"',
        'eventName: "normalSummoned"',
        'eventName: "sentToDeck"',
        "category: 16",
        "targetUids",
        'location: "deck", controller: 0',
        'location: "graveyard", controller: 0',
        'host.messages).not.toContain("natalia responder resolved")',
      ],
    },
    {
      file: "lua-real-script-han-shi-kyudo-spirit-column-return.test.ts",
      required: [
        'action.type === "tributeSummon"',
        'action.type === "activateTrigger"',
        'action.type === "passChain"',
        'eventName: "normalSummoned"',
        'eventName: "sentToHand"',
        "category: 8",
        "possibleOperationInfos",
        "eventUids: [hanShi!.uid, lowScale!.uid, highScale!.uid]",
        'location: "hand", controller: 0',
        'host.messages).not.toContain("han-shi responder resolved")',
      ],
    },
    {
      file: "lua-real-script-yaksha-spirit-backrow-return.test.ts",
      required: [
        'action.type === "normalSummon"',
        'action.type === "activateTrigger"',
        'eventName: "normalSummoned"',
        'eventName: "sentToHand"',
        "category: 8",
        'location: "hand", controller: 1',
        'host.messages).not.toContain("yaksha responder resolved")',
      ],
    },
  ].map(({ file, required }) => ({ file: path.join("test", file), required }));
}
