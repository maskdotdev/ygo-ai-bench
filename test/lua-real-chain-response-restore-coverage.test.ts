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
const chainResponseSemanticVariantCounts = {
  adhesionTrapHoleFlipSummonAtkEffect: 1,
  bottomlessTrapHoleSummonSuccessBanish: 1,
  ghostBelleWantedChainNegationAndRecycle: 1,
  houseAdhesiveTapeFlipSummonDestroy: 1,
  mysticalSpaceTyphoonFreeChainDestroy: 1,
  raigekiBreakDiscardCostDestroy: 1,
  solemnWarningSpecialSummonEffectNegate: 1,
  torrentialTributeSummonSuccessDestroyAll: 1,
  trapHoleFlipSummonAtkGateDestroy: 1,
  trapHoleSummonSuccessDestroy: 1,
  wiretapTrapNegateReturnToDeck: 1,
} satisfies Record<ChainResponseSemanticVariant, number>;

type ChainResponseKind =
  | "destroyOnlyChainedResponse"
  | "flipSummonTrapResponse"
  | "genericChainResponse"
  | "summonEffectNegateResponse"
  | "summonSuccessTrapResponse"
  | "trapNegateToDeckResponse";
type ChainResponseSemanticVariant =
  | "adhesionTrapHoleFlipSummonAtkEffect"
  | "bottomlessTrapHoleSummonSuccessBanish"
  | "ghostBelleWantedChainNegationAndRecycle"
  | "houseAdhesiveTapeFlipSummonDestroy"
  | "mysticalSpaceTyphoonFreeChainDestroy"
  | "raigekiBreakDiscardCostDestroy"
  | "solemnWarningSpecialSummonEffectNegate"
  | "torrentialTributeSummonSuccessDestroyAll"
  | "trapHoleFlipSummonAtkGateDestroy"
  | "trapHoleSummonSuccessDestroy"
  | "wiretapTrapNegateReturnToDeck";

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

  it("keeps named chain-response semantic variants explicit", () => {
    expect(countChainResponseSemanticVariants(chainResponseSemanticVariants())).toEqual(chainResponseSemanticVariantCounts);

    const weak = chainResponseSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
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

function chainResponseSemanticVariants(): Array<{
  file: string;
  kind: ChainResponseSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-adhesion-trap-hole-flip-summon.test.ts",
      kind: "adhesionTrapHoleFlipSummonAtkEffect",
      required: [
        'const trapCode = "62325062"',
        "restores Adhesion Trap Hole's Flip Summon success chain response and base ATK effect",
        "adhesion flip chain starter resolved",
        "restored.session.state.chain).toHaveLength(0)",
      ],
    },
    {
      file: "test/lua-real-script-bottomless-trap-hole-summon-success.test.ts",
      kind: "bottomlessTrapHoleSummonSuccessBanish",
      required: [
        'const bottomlessCode = "29401950"',
        "restores Bottomless Trap Hole's summon-success event target and banishes the destroyed monster",
        "restores Bottomless Trap Hole's Flip Summon success chain response and banishes the destroyed monster",
        "location: \"banished\"",
      ],
    },
    {
      file: "test/lua-real-script-chain-response.test.ts",
      kind: "ghostBelleWantedChainNegationAndRecycle",
      required: [
        'const ghostBelleCode = "73642296"',
        "lets Ghost Belle negate WANTED by reading live chain operation info",
        "resolves WANTED graveyard recycling through cost, target, bottom-deck, and draw",
        "location: \"deck\"",
      ],
    },
    {
      file: "test/lua-real-script-house-adhesive-tape-flip-summon.test.ts",
      kind: "houseAdhesiveTapeFlipSummonDestroy",
      required: [
        'const trapCode = "15083728"',
        "restores its Flip Summon success trap activation in the chain-response window",
        "house tape flip chain starter resolved",
        "eventName: \"destroyed\"",
      ],
    },
    {
      file: "test/lua-real-script-mystical-space-typhoon-free-chain.test.ts",
      kind: "mysticalSpaceTyphoonFreeChainDestroy",
      required: [
        'const mstCode = "5318639"',
        "restores Mystical Space Typhoon's backrow target and destroys it",
        "pass?.windowKind).toBe(\"chainResponse\")",
        "[\"chainNegated\", \"chainDisabled\"].includes(event.eventName))).toEqual([])",
      ],
    },
    {
      file: "test/lua-real-script-raigeki-break-discard-cost.test.ts",
      kind: "raigekiBreakDiscardCostDestroy",
      required: [
        'const raigekiBreakCode = "4178474"',
        "restores Raigeki Break's discarded cost card, target, and destroy operation",
        "pass?.windowKind).toBe(\"chainResponse\")",
        "eventName: \"destroyed\"",
      ],
    },
    {
      file: "test/lua-real-script-solemn-warning-special-summon-effect-negate-part2.test.ts",
      kind: "solemnWarningSpecialSummonEffectNegate",
      required: [
        'const warningCode = "84749824"',
        "restores Solemn Warning's chain response to an activation that includes a Special Summon",
        "restores Solemn Warning's chain response to a monster effect that includes a Special Summon",
        "eventName: \"chainNegated\"",
      ],
    },
    {
      file: "test/lua-real-script-torrential-tribute-summon-success.test.ts",
      kind: "torrentialTributeSummonSuccessDestroyAll",
      required: [
        'const torrentialCode = "53582587"',
        "restores Torrential Tribute's summon-success operation info and destroys every monster",
        "torrential chain responder resolved",
        "location: \"graveyard\"",
      ],
    },
    {
      file: "test/lua-real-script-trap-hole-flip-summon.test.ts",
      kind: "trapHoleFlipSummonAtkGateDestroy",
      required: [
        'const trapCode = "4206964"',
        "restores Trap Hole's Flip Summon success chain response and ATK-gated destruction",
        "trap hole flip chain starter resolved",
        "eventName: \"destroyed\"",
      ],
    },
    {
      file: "test/lua-real-script-trap-hole-summon-success.test.ts",
      kind: "trapHoleSummonSuccessDestroy",
      required: [
        'const trapHoleCode = "4206964"',
        "restores Trap Hole's summon-success event target and destroys the summoned monster",
        "trap hole responder resolved",
        "restored.session.state.chain).toHaveLength(2)",
      ],
    },
    {
      file: "test/lua-real-script-wiretap-trap-negate-to-deck.test.ts",
      kind: "wiretapTrapNegateReturnToDeck",
      required: [
        'const wiretapCode = "34507039"',
        "restores activation negation that cancels Trap cleanup and returns the negated source to Deck",
        "restoredPendingResolution.session.state.chain).toHaveLength(0)",
        "location: \"deck\"",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: ChainResponseSemanticVariant;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countChainResponseSemanticVariants(
  fixtures: Array<{ kind: ChainResponseSemanticVariant }>,
): Record<ChainResponseSemanticVariant, number> {
  return fixtures.reduce<Record<ChainResponseSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      adhesionTrapHoleFlipSummonAtkEffect: 0,
      bottomlessTrapHoleSummonSuccessBanish: 0,
      ghostBelleWantedChainNegationAndRecycle: 0,
      houseAdhesiveTapeFlipSummonDestroy: 0,
      mysticalSpaceTyphoonFreeChainDestroy: 0,
      raigekiBreakDiscardCostDestroy: 0,
      solemnWarningSpecialSummonEffectNegate: 0,
      torrentialTributeSummonSuccessDestroyAll: 0,
      trapHoleFlipSummonAtkGateDestroy: 0,
      trapHoleSummonSuccessDestroy: 0,
      wiretapTrapNegateReturnToDeck: 0,
    },
  );
}
