import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const negationFixtureCount = 14;
const chainResponseNegationFixtureCount = 11;
const destroyOnlyResponseFixtureCount = 4;
const negationInventoryFixtureCount = 18;
const negationKindCounts = {
  chainDisable: 1,
  chainNegateDraw: 1,
  chainNegateToDeck: 1,
  chainNegateToGrave: 7,
  handTrapChainNegate: 1,
  summonNegateContinuation: 3,
} satisfies Record<NegationKind, number>;
const destroyOnlyResponseKindCounts = {
  chainDestroyOnly: 3,
  chainMultiDestroyOnly: 1,
} satisfies Record<DestroyOnlyResponseKind, number>;
const negationSemanticVariantCounts = {
  armorBreakEquipActiveTypeNegateDestroy: 1,
  ashBlossomHandTrapDeckSearchNegate: 1,
  darkBribeNegateDestroyOpponentDraw: 1,
  divineWrathDiscardMonsterNegateDestroy: 1,
  effectVeilerHandQuickDisableChainLink: 1,
  ghostOgreDestroyOnlyNoNegation: 1,
  magicJammerDiscardSpellNegateDestroy: 1,
  mysticalSpaceTyphoonDestroyOnlyNoNegation: 1,
  overwhelmTributeGateTrapNegateDestroy: 1,
  pollinosisPlantReleaseActivationNegateDestroy: 1,
  raigekiBreakDiscardDestroyOnlyNoNegation: 1,
  sevenToolsLpCostTrapNegateDestroy: 1,
  solemnJudgmentActivationNegateCostDestroy: 1,
  solemnStrikeSummonAndMonsterNegate: 1,
  solemnWarningSpecialSummonNegate: 1,
  sprightRedLinkReleaseMonsterNegateDestroy: 1,
  twinTwistersMultiDestroyOnlyNoNegation: 1,
  wiretapTrapNegateReturnToDeck: 1,
} satisfies Record<NegationSemanticVariant, number>;

type NegationKind =
  | "chainDisable"
  | "chainNegateDraw"
  | "chainNegateToDeck"
  | "chainNegateToGrave"
  | "handTrapChainNegate"
  | "summonNegateContinuation";

type DestroyOnlyResponseKind = "chainDestroyOnly" | "chainMultiDestroyOnly";
type NegationSemanticVariant =
  | "armorBreakEquipActiveTypeNegateDestroy"
  | "ashBlossomHandTrapDeckSearchNegate"
  | "darkBribeNegateDestroyOpponentDraw"
  | "divineWrathDiscardMonsterNegateDestroy"
  | "effectVeilerHandQuickDisableChainLink"
  | "ghostOgreDestroyOnlyNoNegation"
  | "magicJammerDiscardSpellNegateDestroy"
  | "mysticalSpaceTyphoonDestroyOnlyNoNegation"
  | "overwhelmTributeGateTrapNegateDestroy"
  | "pollinosisPlantReleaseActivationNegateDestroy"
  | "raigekiBreakDiscardDestroyOnlyNoNegation"
  | "sevenToolsLpCostTrapNegateDestroy"
  | "solemnJudgmentActivationNegateCostDestroy"
  | "solemnStrikeSummonAndMonsterNegate"
  | "solemnWarningSpecialSummonNegate"
  | "sprightRedLinkReleaseMonsterNegateDestroy"
  | "twinTwistersMultiDestroyOnlyNoNegation"
  | "wiretapTrapNegateReturnToDeck";

describe("Lua real negation restore coverage", () => {
  it("keeps the combined negation restore fixture inventory explicit", () => {
    expect(combinedNegationFixtureFiles()).toHaveLength(negationInventoryFixtureCount);
    expect(combinedNegationFixtureFiles()).toEqual(realScriptNegationInventoryFiles());
  });

  it("requires representative real-script negation fixtures to assert grouped legal actions and clean Lua registry restore", () => {
    const files = realScriptNegationFixtureFiles();
    expect(files).toHaveLength(negationFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("applyLuaRestoreResponse");
      });

    expect(missing).toEqual([]);
  });

  it("keeps real-script negation fixture kinds explicit", () => {
    expect(countNegationKinds(realScriptNegationFixtures())).toEqual(negationKindCounts);
  });

  it("requires representative real-script negation fixtures to prove restored chain suppression outcomes", () => {
    const files = realScriptNegationFixtureFiles();
    expect(files).toHaveLength(negationFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !/state\.chain\)\.toHaveLength\(0\)/.test(text)
          || !/eventName:\s*["']chainDisabled["']/.test(text)
          || !/location:\s*["']graveyard["']/.test(text)
          || !text.includes("operationInfos");
      });

    expect(missing).toEqual([]);
  });

  it("requires chain-response negation fixtures to pin negated-link events and suppressed follow-up operations", () => {
    const files = realScriptChainResponseNegationFixtureFiles();
    expect(files).toHaveLength(chainResponseNegationFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !/state\.chain\)\.toHaveLength\(2\)/.test(text)
          || (!/eventName:\s*["']chainNegated["']/.test(text) && !text.includes('"chainNegated"'))
          || (!/eventName:\s*["']chainDisabled["']/.test(text) && !text.includes('"chainDisabled"'))
          || !/host\.messages\)\.not\.toContain/.test(text);
      });

    expect(missing).toEqual([]);
  });

  it("requires destroy-only chain-response fixtures to prove restored destruction does not imply negation", () => {
    const files = realScriptDestroyOnlyResponseFixtureFiles();
    expect(files).toHaveLength(destroyOnlyResponseFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !/state\.chain\)\.toHaveLength\(2\)/.test(text)
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !/eventName:\s*["']destroyed["']/.test(text)
          || !/eventName:\s*["']cardsDrawn["']/.test(text)
          || (!/eventName:\s*["']chainNegated["']/.test(text) && !text.includes('"chainNegated"'))
          || (!/eventName:\s*["']chainDisabled["']/.test(text) && !text.includes('"chainDisabled"'))
          || (!/eventHistory\)\.not\.toEqual/.test(text) && !text.includes('["chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([])'))
          || !/host\.messages\)\.toContain/.test(text)
          || !/host\.messages\)\.not\.toContain/.test(text);
      });

    expect(missing).toEqual([]);
  });

  it("keeps destroy-only chain-response control kinds explicit", () => {
    expect(countDestroyOnlyResponseKinds(realScriptDestroyOnlyResponseFixtures())).toEqual(destroyOnlyResponseKindCounts);
  });

  it("keeps named negation and destroy-only semantic variants explicit", () => {
    expect(countNegationSemanticVariants(negationSemanticVariants())).toEqual(negationSemanticVariantCounts);

    const weak = negationSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function combinedNegationFixtureFiles(): string[] {
  return [
    ...realScriptNegationFixtureFiles(),
    ...realScriptChainResponseNegationFixtureFiles(),
    ...realScriptDestroyOnlyResponseFixtureFiles(),
  ].filter((file, index, files) => files.indexOf(file) === index).sort();
}

function realScriptNegationInventoryFiles(): string[] {
  return [
    "lua-real-script-ash-blossom-chain-negate.test.ts",
    "lua-real-script-armor-break-equip-active-type-negate.test.ts",
    "lua-real-script-dark-bribe-negate-draw.test.ts",
    "lua-real-script-divine-wrath-monster-negate.test.ts",
    "lua-real-script-effect-veiler-chain-disable.test.ts",
    "lua-real-script-ghost-ogre-chain-destroy.test.ts",
    "lua-real-script-magic-jammer-chain-negate.test.ts",
    "lua-real-script-mystical-space-typhoon-free-chain.test.ts",
    "lua-real-script-overwhelm-tribute-chain-negate.test.ts",
    "lua-real-script-pollinosis-release-activation-negate.test.ts",
    "lua-real-script-raigeki-break-discard-cost.test.ts",
    "lua-real-script-seven-tools-trap-negate.test.ts",
    "lua-real-script-solemn-judgment-summon-negate-part2.test.ts",
    "lua-real-script-solemn-strike-special-summon-negate.test.ts",
    "lua-real-script-solemn-warning-special-summon-effect-negate-part2.test.ts",
    "lua-real-script-spright-red-release-link2-negate.test.ts",
    "lua-real-script-twin-twisters-discard-cost.test.ts",
    "lua-real-script-wiretap-trap-negate-to-deck.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptNegationFixtureFiles(): string[] {
  return realScriptNegationFixtures().map(({ file }) => file);
}

function realScriptChainResponseNegationFixtureFiles(): string[] {
  return realScriptNegationFixtureFiles()
    .filter((file) => !file.endsWith("lua-real-script-ash-blossom-chain-negate.test.ts"))
    .filter((file) => !file.endsWith("lua-real-script-pollinosis-release-activation-negate.test.ts"))
    .filter((file) => !file.endsWith("lua-real-script-spright-red-release-link2-negate.test.ts"));
}

function realScriptDestroyOnlyResponseFixtureFiles(): string[] {
  return realScriptDestroyOnlyResponseFixtures().map(({ file }) => file);
}

function realScriptNegationFixtures(): Array<{ file: string; kind: NegationKind }> {
  return ([
    {
      file: "lua-real-script-ash-blossom-chain-negate.test.ts",
      kind: "handTrapChainNegate",
    },
    {
      file: "lua-real-script-armor-break-equip-active-type-negate.test.ts",
      kind: "chainNegateToGrave",
    },
    {
      file: "lua-real-script-dark-bribe-negate-draw.test.ts",
      kind: "chainNegateDraw",
    },
    {
      file: "lua-real-script-divine-wrath-monster-negate.test.ts",
      kind: "chainNegateToGrave",
    },
    {
      file: "lua-real-script-effect-veiler-chain-disable.test.ts",
      kind: "chainDisable",
    },
    {
      file: "lua-real-script-magic-jammer-chain-negate.test.ts",
      kind: "chainNegateToGrave",
    },
    {
      file: "lua-real-script-overwhelm-tribute-chain-negate.test.ts",
      kind: "chainNegateToGrave",
    },
    {
      file: "lua-real-script-pollinosis-release-activation-negate.test.ts",
      kind: "chainNegateToGrave",
    },
    {
      file: "lua-real-script-seven-tools-trap-negate.test.ts",
      kind: "chainNegateToGrave",
    },
    {
      file: "lua-real-script-solemn-judgment-summon-negate-part2.test.ts",
      kind: "summonNegateContinuation",
    },
    {
      file: "lua-real-script-solemn-strike-special-summon-negate.test.ts",
      kind: "summonNegateContinuation",
    },
    {
      file: "lua-real-script-solemn-warning-special-summon-effect-negate-part2.test.ts",
      kind: "summonNegateContinuation",
    },
    {
      file: "lua-real-script-spright-red-release-link2-negate.test.ts",
      kind: "chainNegateToGrave",
    },
    {
      file: "lua-real-script-wiretap-trap-negate-to-deck.test.ts",
      kind: "chainNegateToDeck",
    },
  ] satisfies Array<{ file: string; kind: NegationKind }>)
    .map(({ file, kind }) => ({ file: path.join("test", file), kind }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function realScriptDestroyOnlyResponseFixtures(): Array<{ file: string; kind: DestroyOnlyResponseKind }> {
  return ([
    {
      file: "lua-real-script-ghost-ogre-chain-destroy.test.ts",
      kind: "chainDestroyOnly",
    },
    {
      file: "lua-real-script-mystical-space-typhoon-free-chain.test.ts",
      kind: "chainDestroyOnly",
    },
    {
      file: "lua-real-script-raigeki-break-discard-cost.test.ts",
      kind: "chainDestroyOnly",
    },
    {
      file: "lua-real-script-twin-twisters-discard-cost.test.ts",
      kind: "chainMultiDestroyOnly",
    },
  ] satisfies Array<{ file: string; kind: DestroyOnlyResponseKind }>)
    .map(({ file, kind }) => ({ file: path.join("test", file), kind }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function negationSemanticVariants(): Array<{
  file: string;
  kind: NegationSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "lua-real-script-armor-break-equip-active-type-negate.test.ts",
      kind: "armorBreakEquipActiveTypeNegateDestroy",
      required: [
        'const armorBreakCode = "79649195"',
        "restores an IsActiveType(TYPE_EQUIP) activation response that negates, destroys, and suppresses the Equip operation",
        "re:IsActiveType(TYPE_EQUIP)",
        'eventName: "chainNegated"',
      ],
    },
    {
      file: "lua-real-script-ash-blossom-chain-negate.test.ts",
      kind: "ashBlossomHandTrapDeckSearchNegate",
      required: [
        'const ashBlossomCode = "14558127"',
        "restores its hand response to a Deck search and suppresses the negated operation",
        'eventName: "chainNegated"',
      ],
    },
    {
      file: "lua-real-script-dark-bribe-negate-draw.test.ts",
      kind: "darkBribeNegateDestroyOpponentDraw",
      required: [
        'const darkBribeCode = "77538567"',
        "restores activation negation that destroys the source, draws for the opponent, and suppresses the negated Spell",
        'eventName: "cardsDrawn"',
      ],
    },
    {
      file: "lua-real-script-divine-wrath-monster-negate.test.ts",
      kind: "divineWrathDiscardMonsterNegateDestroy",
      required: [
        'const divineWrathCode = "49010598"',
        "restores a Counter Trap response that discards, negates a monster effect, destroys its source, and suppresses its operation",
        'eventName: "chainDisabled"',
      ],
    },
    {
      file: "lua-real-script-effect-veiler-chain-disable.test.ts",
      kind: "effectVeilerHandQuickDisableChainLink",
      required: [
        'const effectVeilerCode = "97268402"',
        "restores its hand quick effect and negates the related monster chain link",
        'eventName: "chainDisabled"',
      ],
    },
    {
      file: "lua-real-script-ghost-ogre-chain-destroy.test.ts",
      kind: "ghostOgreDestroyOnlyNoNegation",
      required: [
        'const ghostOgreCode = "59438930"',
        "restores its hand response, destroys the related field source, and does not negate that chain link",
        '["chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([])',
      ],
    },
    {
      file: "lua-real-script-magic-jammer-chain-negate.test.ts",
      kind: "magicJammerDiscardSpellNegateDestroy",
      required: [
        'const magicJammerCode = "77414722"',
        "restores a Counter Trap response that discards, negates, destroys, and suppresses the Spell operation",
        'eventName: "chainNegated"',
      ],
    },
    {
      file: "lua-real-script-overwhelm-tribute-chain-negate.test.ts",
      kind: "overwhelmTributeGateTrapNegateDestroy",
      required: [
        'const overwhelmCode = "20140382"',
        "restores Overwhelm's Tribute Summoned Level 7+ gate, activation negation, source destruction, and suppressed Trap operation",
        'summonType = "tribute"',
        'eventName: "chainNegated"',
      ],
    },
    {
      file: "lua-real-script-mystical-space-typhoon-free-chain.test.ts",
      kind: "mysticalSpaceTyphoonDestroyOnlyNoNegation",
      required: [
        'const mstCode = "5318639"',
        "restores Mystical Space Typhoon's backrow target and destroys it",
        '["chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([])',
      ],
    },
    {
      file: "lua-real-script-pollinosis-release-activation-negate.test.ts",
      kind: "pollinosisPlantReleaseActivationNegateDestroy",
      required: [
        'const pollinosisCode = "91078716"',
        "restores its Plant release cost, activation negation, source destruction, and suppressed Spell operation",
        "Duel.CheckReleaseGroupCost(tp,s.filter,1,false,nil,nil)",
        "Duel.SelectReleaseGroupCost(tp,s.filter,1,1,false,nil,nil)",
        "Duel.NegateActivation(ev)",
        'eventName: "released"',
        'eventName: "chainNegated"',
        'host.messages).not.toContain("pollinosis spell resolved")',
      ],
    },
    {
      file: "lua-real-script-raigeki-break-discard-cost.test.ts",
      kind: "raigekiBreakDiscardDestroyOnlyNoNegation",
      required: [
        'const raigekiBreakCode = "4178474"',
        "restores Raigeki Break's discarded cost card, target, and destroy operation",
        '["chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([])',
      ],
    },
    {
      file: "lua-real-script-seven-tools-trap-negate.test.ts",
      kind: "sevenToolsLpCostTrapNegateDestroy",
      required: [
        'const sevenToolsCode = "3819470"',
        "restores an LP-cost Counter Trap response that negates and destroys a Trap activation",
        'eventName: "chainNegated"',
      ],
    },
    {
      file: "lua-real-script-solemn-judgment-summon-negate-part2.test.ts",
      kind: "solemnJudgmentActivationNegateCostDestroy",
      required: [
        'const solemnCode = "41420027"',
        "restores Solemn Judgment's Spell activation negation, LP-half cost, and source destruction",
        "restores Solemn Judgment's Trap activation negation, LP-half cost, and source destruction",
      ],
    },
    {
      file: "lua-real-script-solemn-strike-special-summon-negate.test.ts",
      kind: "solemnStrikeSummonAndMonsterNegate",
      required: [
        'const strikeCode = "40605147"',
        "restores Solemn Strike's Special Summon negation, fixed LP cost, and destroyed-event cleanup",
        "restores Solemn Strike's monster-effect negation, fixed LP cost, and source destruction",
      ],
    },
    {
      file: "lua-real-script-solemn-warning-special-summon-effect-negate-part2.test.ts",
      kind: "solemnWarningSpecialSummonNegate",
      required: [
        'const warningCode = "84749824"',
        "restores Solemn Warning's chain response to an activation that includes a Special Summon",
        "restores Solemn Warning's chain response to a monster effect that includes a Special Summon",
      ],
    },
    {
      file: "lua-real-script-spright-red-release-link2-negate.test.ts",
      kind: "sprightRedLinkReleaseMonsterNegateDestroy",
      required: [
        'const sprightRedCode = "75922381"',
        "restores its hand summon procedure, Link-2 release cost, yes/no destroy prompt, negation, and suppressed monster operation",
        "Duel.NegateEffect(ev)",
        "Duel.SelectYesNo(tp,aux.Stringid(id,1))",
        "Duel.BreakEffect()",
        'eventName: "chainNegated"',
        'expect(restoredOpenChain.host.messages).not.toContain("spright red monster resolved")',
      ],
    },
    {
      file: "lua-real-script-twin-twisters-discard-cost.test.ts",
      kind: "twinTwistersMultiDestroyOnlyNoNegation",
      required: [
        'const twinTwistersCode = "43898403"',
        "restores Twin Twisters' discarded cost card, two targets, and grouped destroy operation",
        '["chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([])',
      ],
    },
    {
      file: "lua-real-script-wiretap-trap-negate-to-deck.test.ts",
      kind: "wiretapTrapNegateReturnToDeck",
      required: [
        'const wiretapCode = "34507039"',
        "restores activation negation that cancels Trap cleanup and returns the negated source to Deck",
        'eventName: "chainNegated"',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: NegationSemanticVariant;
    required: string[];
  }>)
    .map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function countNegationKinds(fixtures: Array<{ kind: NegationKind }>): Record<NegationKind, number> {
  return fixtures.reduce<Record<NegationKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      chainDisable: 0,
      chainNegateDraw: 0,
      chainNegateToDeck: 0,
      chainNegateToGrave: 0,
      handTrapChainNegate: 0,
      summonNegateContinuation: 0,
    },
  );
}

function countDestroyOnlyResponseKinds(
  fixtures: Array<{ kind: DestroyOnlyResponseKind }>,
): Record<DestroyOnlyResponseKind, number> {
  return fixtures.reduce<Record<DestroyOnlyResponseKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      chainDestroyOnly: 0,
      chainMultiDestroyOnly: 0,
    },
  );
}

function countNegationSemanticVariants(
  fixtures: Array<{ kind: NegationSemanticVariant }>,
): Record<NegationSemanticVariant, number> {
  return fixtures.reduce<Record<NegationSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      armorBreakEquipActiveTypeNegateDestroy: 0,
      ashBlossomHandTrapDeckSearchNegate: 0,
      darkBribeNegateDestroyOpponentDraw: 0,
      divineWrathDiscardMonsterNegateDestroy: 0,
      effectVeilerHandQuickDisableChainLink: 0,
      ghostOgreDestroyOnlyNoNegation: 0,
      magicJammerDiscardSpellNegateDestroy: 0,
      mysticalSpaceTyphoonDestroyOnlyNoNegation: 0,
      overwhelmTributeGateTrapNegateDestroy: 0,
      pollinosisPlantReleaseActivationNegateDestroy: 0,
      raigekiBreakDiscardDestroyOnlyNoNegation: 0,
      sevenToolsLpCostTrapNegateDestroy: 0,
      solemnJudgmentActivationNegateCostDestroy: 0,
      solemnStrikeSummonAndMonsterNegate: 0,
      solemnWarningSpecialSummonNegate: 0,
      sprightRedLinkReleaseMonsterNegateDestroy: 0,
      twinTwistersMultiDestroyOnlyNoNegation: 0,
      wiretapTrapNegateReturnToDeck: 0,
    },
  );
}
