import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const chainResponseFixtureCount = 11;
const chainResponseKindCounts = {
  destroyOnlyChainedResponse: 2,
  flipSummonTrapResponse: 3,
  genericChainResponse: 1,
  summonEffectNegateResponse: 1,
  summonSuccessTrapResponse: 3,
  trapNegateToDeckResponse: 1,
} satisfies Record<ChainResponseKind, number>;

type ChainResponseKind =
  | "destroyOnlyChainedResponse"
  | "flipSummonTrapResponse"
  | "genericChainResponse"
  | "summonEffectNegateResponse"
  | "summonSuccessTrapResponse"
  | "trapNegateToDeckResponse";

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

  it("keeps chain-response fixture kinds explicit", () => {
    expect(countChainResponseKinds(chainResponseFixtureFiles())).toEqual(chainResponseKindCounts);
  });
});

function chainResponseFixtureFiles(): Array<{
  file: string;
  kind: ChainResponseKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-adhesion-trap-hole-flip-summon.test.ts",
      kind: "flipSummonTrapResponse",
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
      kind: "genericChainResponse",
      required: [
        'action.type === "activateEffect" && action.uid === ghostBelle!.uid',
        'action.type === "passChain"',
        "restored.session.state.chain).toHaveLength(0)",
        'location: "graveyard"',
        'location: "deck"',
      ],
    },
    {
      file: "test/lua-real-script-bottomless-trap-hole-summon-success.test.ts",
      kind: "summonSuccessTrapResponse",
      required: [
        'action.type === "activateEffect" && action.uid === bottomless!.uid',
        'action.type === "passChain"',
        "restored.session.state.chain).toHaveLength(2)",
        'location: "banished"',
        'location: "graveyard"',
        'host.messages).not.toContain("bottomless chain responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-house-adhesive-tape-flip-summon.test.ts",
      kind: "flipSummonTrapResponse",
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
      kind: "trapNegateToDeckResponse",
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
      kind: "destroyOnlyChainedResponse",
      required: [
        'action.type === "activateEffect" && action.uid === raigekiBreak!.uid',
        'action.type === "passChain"',
        'pass?.windowKind).toBe("chainResponse")',
        "restored.session.state.chain).toHaveLength(2)",
        'eventName: "destroyed"',
        'eventName: "cardsDrawn"',
        '["chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([])',
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-mystical-space-typhoon-free-chain.test.ts",
      kind: "destroyOnlyChainedResponse",
      required: [
        'action.type === "activateEffect" && action.uid === mst!.uid',
        'action.type === "passChain"',
        'pass?.windowKind).toBe("chainResponse")',
        "restored.session.state.chain).toHaveLength(2)",
        'eventName: "destroyed"',
        'eventName: "cardsDrawn"',
        '["chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([])',
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-torrential-tribute-summon-success.test.ts",
      kind: "summonSuccessTrapResponse",
      required: [
        'action.type === "activateEffect" && action.uid === torrential!.uid',
        'action.type === "passChain"',
        "restored.session.state.chain).toHaveLength(2)",
        'location: "graveyard"',
        'host.messages).not.toContain("torrential chain responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-trap-hole-summon-success.test.ts",
      kind: "summonSuccessTrapResponse",
      required: [
        'action.type === "activateEffect" && action.uid === trapHole!.uid',
        'action.type === "passChain"',
        "restored.session.state.chain).toHaveLength(2)",
        'location: "graveyard"',
        'host.messages).not.toContain("trap hole responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-trap-hole-flip-summon.test.ts",
      kind: "flipSummonTrapResponse",
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
      kind: "summonEffectNegateResponse",
      required: [
        'action.type === "activateEffect" && action.uid === warning!.uid',
        'action.type === "passChain"',
        "restoredPendingResolution.session.state.chain).toHaveLength(0)",
        'eventName: "chainNegated"',
        'eventName: "chainDisabled"',
        'location: "graveyard"',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: ChainResponseKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countChainResponseKinds(fixtures: Array<{ kind: ChainResponseKind }>): Record<ChainResponseKind, number> {
  return fixtures.reduce<Record<ChainResponseKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      destroyOnlyChainedResponse: 0,
      flipSummonTrapResponse: 0,
      genericChainResponse: 0,
      summonEffectNegateResponse: 0,
      summonSuccessTrapResponse: 0,
      trapNegateToDeckResponse: 0,
    },
  );
}
