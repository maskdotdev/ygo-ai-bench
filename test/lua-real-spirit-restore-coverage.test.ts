import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const spiritFixtureCount = 19;
const spiritKindCounts = {
  columnSendPendulum: 3,
  delayedShuffleDraw: 1,
  effectExtraNormalSummon: 2,
  graveToDeckTrigger: 1,
  normalSummonSearch: 2,
  procedureReturn: 2,
  returnToHandTrigger: 4,
  ritualSelfSummonSearch: 2,
  ritualShuffleSummon: 1,
  trapDisable: 1,
} satisfies Record<SpiritKind, number>;

describe("Lua real Spirit restore coverage", () => {
  it("keeps representative Spirit fixture kinds explicit", () => {
    expect(countSpiritKinds(realScriptSpiritFixtureFiles())).toEqual(spiritKindCounts);
  });

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

type SpiritKind =
  | "columnSendPendulum"
  | "delayedShuffleDraw"
  | "effectExtraNormalSummon"
  | "graveToDeckTrigger"
  | "normalSummonSearch"
  | "procedureReturn"
  | "returnToHandTrigger"
  | "ritualSelfSummonSearch"
  | "ritualShuffleSummon"
  | "trapDisable";

function countSpiritKinds(fixtures: Array<{ kind: SpiritKind }>): Record<SpiritKind, number> {
  return fixtures.reduce<Record<SpiritKind, number>>(
    (counts, { kind }) => ({ ...counts, [kind]: counts[kind] + 1 }),
    {
      columnSendPendulum: 0,
      delayedShuffleDraw: 0,
      effectExtraNormalSummon: 0,
      graveToDeckTrigger: 0,
      normalSummonSearch: 0,
      procedureReturn: 0,
      returnToHandTrigger: 0,
      ritualSelfSummonSearch: 0,
      ritualShuffleSummon: 0,
      trapDisable: 0,
    },
  );
}

function realScriptSpiritFixtureFiles(): Array<{ file: string; kind: SpiritKind; required: string[] }> {
  return ([
    {
      file: "lua-real-script-sakitama-spirit-effect-summon.test.ts",
      kind: "effectExtraNormalSummon",
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
      kind: "procedureReturn",
      required: [
        'action.type === "specialSummonProcedure"',
        'eventName: "phaseEnd"',
        'action.type === "activateTrigger"',
        'location: "hand"',
      ],
    },
    {
      file: "lua-real-script-izanagi-spirit-maynot-return.test.ts",
      kind: "procedureReturn",
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
      kind: "effectExtraNormalSummon",
      required: [
        "normalSummonAvailable).toBe(false)",
        'action.type === "normalSummon"',
        "overLimit).toBeUndefined()",
      ],
    },
    {
      file: "lua-real-script-aratama-spirit-search.test.ts",
      kind: "normalSummonSearch",
      required: [
        'action.type === "activateTrigger"',
        'eventName: "normalSummoned"',
        'eventName: "sentToHand"',
        'eventName: "sentToHandConfirmed"',
      ],
    },
    {
      file: "lua-real-script-ichiki-sayori-hime-effect-summon-search.test.ts",
      kind: "normalSummonSearch",
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
      file: "lua-real-script-shinobaroness-shade-peacock-search-self-summon.test.ts",
      kind: "ritualSelfSummonSearch",
      required: [
        'ritualSummonDuelCard(session.state, 0, shade!.uid',
        'summonType: "ritual"',
        'eventName: "specialSummoned"',
        'eventName: "sentToHand"',
        'eventName: "sentToHandConfirmed"',
        'eventName: "phaseStandby"',
        'triggerBucket": "turnMandatory"',
        'location: "banished"',
        'summonType: "special"',
        "category: 8",
        "category: 512",
        'host.messages).not.toContain("shinobaroness responder resolved")',
      ],
    },
    {
      file: "lua-real-script-shinobaroness-peacock-shuffle-summon.test.ts",
      kind: "ritualShuffleSummon",
      required: [
        "ritualSummonDuelCard(session.state, 0, peacock.uid",
        'action.type === "activateTrigger"',
        'action.type === "passChain"',
        'api: "SelectYesNo"',
        'summonType: "ritual"',
        'summonType: "special"',
        'eventName: "specialSummoned"',
        'eventName: "sentToDeck"',
        "category: 16",
        "category: 512",
        "possibleOperationInfos",
        'location: "deck", controller: 1',
        'location: "monsterZone", controller: 0',
        'host.messages).not.toContain("shinobaroness peacock responder resolved")',
      ],
    },
    {
      file: "lua-real-script-shinobaron-shade-peacock-tribute-search-self-summon.test.ts",
      kind: "ritualSelfSummonSearch",
      required: [
        'ritualSummonDuelCard(session.state, 0, shade!.uid',
        'action.type === "activateEffect"',
        'action.type === "passChain"',
        'summonType: "ritual"',
        'eventName: "released"',
        'eventName: "sentToHand"',
        'eventName: "sentToHandConfirmed"',
        'eventName: "phaseStandby"',
        'triggerBucket": "turnMandatory"',
        'location: "banished"',
        'summonType: "special"',
        "category: 8",
        "category: 512",
        'host.messages).not.toContain("shinobaron responder resolved")',
      ],
    },
    {
      file: "lua-real-script-shinobird-pigeon-spirit-return.test.ts",
      kind: "returnToHandTrigger",
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
      kind: "columnSendPendulum",
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
      kind: "columnSendPendulum",
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
      file: "lua-real-script-yoko-zuna-sumo-spirit-column-send.test.ts",
      kind: "columnSendPendulum",
      required: [
        'action.type === "tributeSummon"',
        'action.type === "activateTrigger"',
        'eventName: "normalSummoned"',
        'eventName === "sentToGraveyard"',
        'location: "graveyard", controller: 1',
        'location: "monsterZone", controller: 1, sequence: 1',
        'location: "spellTrapZone", controller: 0, sequence: 0',
        'action.type === "pendulumSummon"',
        'eventName: "specialSummoned"',
        'location: "hand", controller: 0',
        'summonType: "pendulum"',
      ],
    },
    {
      file: "lua-real-script-tsumuha-kutsunagi-delayed-shuffle.test.ts",
      kind: "delayedShuffleDraw",
      required: [
        'action.type === "tributeSummon"',
        'action.type === "activateTrigger"',
        'action.type === "passChain"',
        'api: "SelectYesNo"',
        'eventName: "normalSummoned"',
        'eventName: "sentToGraveyard"',
        'eventName: "cardsDrawn"',
        'eventName: "sentToDeck"',
        "possibleOperationInfos",
        "category: 32",
        "category: 16",
        'location: "graveyard", controller: 1',
        'location: "hand", controller: 0',
        'location: "deck", controller: 0',
      ],
    },
    {
      file: "lua-real-script-gishki-natalia-spirit-to-deck.test.ts",
      kind: "graveToDeckTrigger",
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
      file: "lua-real-script-gishki-emilia-trap-disable.test.ts",
      kind: "trapDisable",
      required: [
        'action.type === "normalSummon"',
        'action.type === "activateTrigger"',
        'action.type === "activateEffect"',
        'eventName: "normalSummoned"',
        '"triggerBucket": "turnMandatory"',
        'location: "graveyard", previousLocation: "spellTrapZone"',
        'eventName: "chainDisabled"',
        "gishki emilia trap disabled true",
        'host.messages).not.toContain("gishki emilia disabled trap resolved")',
      ],
    },
    {
      file: "lua-real-script-han-shi-kyudo-spirit-column-return.test.ts",
      kind: "returnToHandTrigger",
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
      kind: "returnToHandTrigger",
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
    {
      file: "lua-real-script-sacred-spirit-ice-barrier-return.test.ts",
      kind: "returnToHandTrigger",
      required: [
        'action.type === "normalSummon"',
        'action.type === "activateTrigger"',
        'action.type === "passChain"',
        'eventName: "phaseEnd"',
        '"triggerBucket": "turnMandatory"',
        'eventName: "sentToHand"',
        "category: 8",
        "targetUids",
        "property).toBe(0x10)",
        'location: "hand", controller: 1',
        'location: "monsterZone", controller: 0',
        'host.messages).not.toContain("sacred spirit responder resolved")',
      ],
    },
  ] satisfies Array<{ file: string; kind: SpiritKind; required: string[] }>)
    .map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }));
}
