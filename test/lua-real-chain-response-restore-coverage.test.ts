import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const chainResponseFixtureCount = 8;

describe("Lua real chain response restore coverage", () => {
  it("requires chain response fixtures to assert clean restore and restored response outcomes", () => {
    const files = chainResponseFixtureFiles();
    expect(files).toHaveLength(chainResponseFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function chainResponseFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-adhesion-trap-hole-flip-summon.test.ts",
      required: [
        'action.type === "activateEffect" && action.uid === trap.uid',
        'windowKind).toBe("chainResponse")',
        "restored.session.state.chain).toHaveLength(0)",
        'location: "graveyard"',
        'location: "monsterZone"',
        "adhesion flip chain starter resolved",
      ],
    },
    {
      file: "test/lua-real-script-chain-response.test.ts",
      required: [
        'action.type === "activateEffect" && action.uid === ghostBelle!.uid',
        'action.type === "passChain"',
        "restored.session.state.chain).toHaveLength(0)",
        'location: "graveyard"',
        'location: "deck"',
      ],
    },
    {
      file: "test/lua-real-script-house-adhesive-tape-flip-summon.test.ts",
      required: [
        'action.type === "activateEffect" && action.uid === trap.uid',
        'windowKind).toBe("chainResponse")',
        "restored.session.state.chain).toHaveLength(0)",
        'eventName: "destroyed"',
        'location: "graveyard"',
        "house tape flip chain starter resolved",
      ],
    },
    {
      file: "test/lua-real-script-wiretap-trap-negate-to-deck.test.ts",
      required: [
        'action.type === "activateEffect" && action.uid === wiretap!.uid',
        'action.type === "passChain"',
        "restoredPendingResolution.session.state.chain).toHaveLength(0)",
        'location: "graveyard"',
        'location: "deck"',
      ],
    },
    {
      file: "test/lua-real-script-raigeki-break-discard-cost.test.ts",
      required: [
        'action.type === "activateEffect" && action.uid === raigekiBreak!.uid',
        'action.type === "passChain"',
        "restored.session.state.chain).toHaveLength(2)",
        'eventName: "destroyed"',
        'eventName: "cardsDrawn"',
        '["chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([])',
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-mystical-space-typhoon-free-chain.test.ts",
      required: [
        'action.type === "activateEffect" && action.uid === mst!.uid',
        'action.type === "passChain"',
        "restored.session.state.chain).toHaveLength(2)",
        'eventName: "destroyed"',
        'eventName: "cardsDrawn"',
        '["chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([])',
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-trap-hole-flip-summon.test.ts",
      required: [
        'action.type === "activateEffect" && action.uid === trap.uid',
        'windowKind).toBe("chainResponse")',
        "restored.session.state.chain).toHaveLength(0)",
        'eventName: "destroyed"',
        'location: "graveyard"',
        "trap hole flip chain starter resolved",
      ],
    },
    {
      file: "test/lua-real-script-solemn-warning-special-summon-effect-negate-part2.test.ts",
      required: [
        'action.type === "activateEffect" && action.uid === warning!.uid',
        'action.type === "passChain"',
        "restoredPendingResolution.session.state.chain).toHaveLength(0)",
        'eventName: "chainNegated"',
        'eventName: "chainDisabled"',
        'location: "graveyard"',
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
