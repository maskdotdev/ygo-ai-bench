import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const negationFixtureCount = 25;
const chainResponseNegationFixtureCount = 20;
const destroyOnlyResponseFixtureCount = 4;
const negationInventoryFixtureCount = 29;
const negationKindCounts = {
  chainDisable: 1,
  chainNegateCostToDeck: 1,
  chainNegateDraw: 1,
  chainNegateToDeck: 1,
  chainNegateToGrave: 17,
  handTrapChainNegate: 1,
  summonNegateContinuation: 3,
} satisfies Record<NegationKind, number>;
const destroyOnlyResponseKindCounts = {
  chainDestroyOnly: 3,
  chainMultiDestroyOnly: 1,
} satisfies Record<DestroyOnlyResponseKind, number>;
const negationSemanticVariantCounts = {
  adamancipatorResonanceDamageCalculationNegateDestroy: 1,
  armorBreakEquipActiveTypeNegateDestroy: 1,
  ashBlossomHandTrapDeckSearchNegate: 1,
  darkBribeNegateDestroyOpponentDraw: 1,
  disarmGladiatorCostToDeckSpellNegateDestroy: 1,
  divineWrathDiscardMonsterNegateDestroy: 1,
  effectVeilerHandQuickDisableChainLink: 1,
  faceOffDamagePhaseCurrentPhaseNegateDestroy: 1,
  gagagarushTargetMonsterNegateDamage: 1,
  ghostOgreDestroyOnlyNoNegation: 1,
  gGolemDignifiedTargetedLinkNegateDestroy: 1,
  giltiGearfriedTargetedChainNegateDestroy: 1,
  heraldPerfectionDamageCalculationNegateDestroy: 1,
  ironCoreLusterConfirmCostNegateDestroy: 1,
  lightImprisoningMirrorContinuousChainActivatingNegate: 1,
  magicJammerDiscardSpellNegateDestroy: 1,
  mysticalSpaceTyphoonDestroyOnlyNoNegation: 1,
  overwhelmTributeGateTrapNegateDestroy: 1,
  pollinosisPlantReleaseActivationNegateDestroy: 1,
  raigekiBreakDiscardDestroyOnlyNoNegation: 1,
  sevenToolsLpCostTrapNegateDestroy: 1,
  sintoFireFormationOathNegateDestroy: 1,
  solemnJudgmentActivationNegateCostDestroy: 1,
  solemnStrikeSummonAndMonsterNegate: 1,
  solemnWarningSpecialSummonNegate: 1,
  showdownOpponentGraveSameCodeNegateDestroy: 1,
  sprightRedLinkReleaseMonsterNegateDestroy: 1,
  twinTwistersMultiDestroyOnlyNoNegation: 1,
  tutanMaskTargetedZombieNegateDestroy: 1,
  wiretapTrapNegateReturnToDeck: 1,
} satisfies Record<NegationSemanticVariant, number>;

type NegationKind =
  | "chainDisable"
  | "chainNegateCostToDeck"
  | "chainNegateDraw"
  | "chainNegateToDeck"
  | "chainNegateToGrave"
  | "handTrapChainNegate"
  | "summonNegateContinuation";

type DestroyOnlyResponseKind = "chainDestroyOnly" | "chainMultiDestroyOnly";
type NegationSemanticVariant =
  | "adamancipatorResonanceDamageCalculationNegateDestroy"
  | "armorBreakEquipActiveTypeNegateDestroy"
  | "ashBlossomHandTrapDeckSearchNegate"
  | "darkBribeNegateDestroyOpponentDraw"
  | "disarmGladiatorCostToDeckSpellNegateDestroy"
  | "divineWrathDiscardMonsterNegateDestroy"
  | "effectVeilerHandQuickDisableChainLink"
  | "faceOffDamagePhaseCurrentPhaseNegateDestroy"
  | "gagagarushTargetMonsterNegateDamage"
  | "ghostOgreDestroyOnlyNoNegation"
  | "gGolemDignifiedTargetedLinkNegateDestroy"
  | "giltiGearfriedTargetedChainNegateDestroy"
  | "heraldPerfectionDamageCalculationNegateDestroy"
  | "ironCoreLusterConfirmCostNegateDestroy"
  | "lightImprisoningMirrorContinuousChainActivatingNegate"
  | "magicJammerDiscardSpellNegateDestroy"
  | "mysticalSpaceTyphoonDestroyOnlyNoNegation"
  | "overwhelmTributeGateTrapNegateDestroy"
  | "pollinosisPlantReleaseActivationNegateDestroy"
  | "raigekiBreakDiscardDestroyOnlyNoNegation"
  | "sevenToolsLpCostTrapNegateDestroy"
  | "sintoFireFormationOathNegateDestroy"
  | "solemnJudgmentActivationNegateCostDestroy"
  | "solemnStrikeSummonAndMonsterNegate"
  | "solemnWarningSpecialSummonNegate"
  | "showdownOpponentGraveSameCodeNegateDestroy"
  | "sprightRedLinkReleaseMonsterNegateDestroy"
  | "twinTwistersMultiDestroyOnlyNoNegation"
  | "tutanMaskTargetedZombieNegateDestroy"
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
    "lua-real-script-adamancipator-resonance-damage-cal-negate.test.ts",
    "lua-real-script-ash-blossom-chain-negate.test.ts",
    "lua-real-script-armor-break-equip-active-type-negate.test.ts",
    "lua-real-script-dark-bribe-negate-draw.test.ts",
    "lua-real-script-disarm-gladiator-negate-to-deck-cost.test.ts",
    "lua-real-script-divine-wrath-monster-negate.test.ts",
    "lua-real-script-effect-veiler-chain-disable.test.ts",
    "lua-real-script-face-off-damage-phase-negate.test.ts",
    "lua-real-script-gagagarush-target-monster-negate-damage.test.ts",
    "lua-real-script-g-golem-dignified-trilithon-target-link-negate.test.ts",
    "lua-real-script-ghost-ogre-chain-destroy.test.ts",
    "lua-real-script-gilti-gearfried-target-chain-negate.test.ts",
    "lua-real-script-herald-perfection-damage-cal-negate.test.ts",
    "lua-real-script-iron-core-luster-confirm-negate.test.ts",
    "lua-real-script-magic-jammer-chain-negate.test.ts",
    "lua-real-script-mystical-space-typhoon-free-chain.test.ts",
    "lua-real-script-overwhelm-tribute-chain-negate.test.ts",
    "lua-real-script-pollinosis-release-activation-negate.test.ts",
    "lua-real-script-raigeki-break-discard-cost.test.ts",
    "lua-real-script-seven-tools-trap-negate.test.ts",
    "lua-real-script-sinto-oath-chain-negate.test.ts",
    "lua-real-script-solemn-judgment-summon-negate-part2.test.ts",
    "lua-real-script-solemn-strike-special-summon-negate.test.ts",
    "lua-real-script-solemn-warning-special-summon-effect-negate-part2.test.ts",
    "lua-real-script-showdown-secret-sense-scroll-negate.test.ts",
    "lua-real-script-spright-red-release-link2-negate.test.ts",
    "lua-real-script-twin-twisters-discard-cost.test.ts",
    "lua-real-script-tutan-mask-targeted-zombie-negate.test.ts",
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
    .filter((file) => !file.endsWith("lua-real-script-g-golem-dignified-trilithon-target-link-negate.test.ts"))
    .filter((file) => !file.endsWith("lua-real-script-gilti-gearfried-target-chain-negate.test.ts"))
    .filter((file) => !file.endsWith("lua-real-script-pollinosis-release-activation-negate.test.ts"))
    .filter((file) => !file.endsWith("lua-real-script-spright-red-release-link2-negate.test.ts"));
}

function realScriptDestroyOnlyResponseFixtureFiles(): string[] {
  return realScriptDestroyOnlyResponseFixtures().map(({ file }) => file);
}

function realScriptNegationFixtures(): Array<{ file: string; kind: NegationKind }> {
  return ([
    {
      file: "lua-real-script-adamancipator-resonance-damage-cal-negate.test.ts",
      kind: "chainNegateToGrave",
    },
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
      file: "lua-real-script-disarm-gladiator-negate-to-deck-cost.test.ts",
      kind: "chainNegateCostToDeck",
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
      file: "lua-real-script-face-off-damage-phase-negate.test.ts",
      kind: "chainNegateToGrave",
    },
    {
      file: "lua-real-script-gagagarush-target-monster-negate-damage.test.ts",
      kind: "chainNegateToGrave",
    },
    {
      file: "lua-real-script-g-golem-dignified-trilithon-target-link-negate.test.ts",
      kind: "chainNegateToGrave",
    },
    {
      file: "lua-real-script-gilti-gearfried-target-chain-negate.test.ts",
      kind: "chainNegateToGrave",
    },
    {
      file: "lua-real-script-herald-perfection-damage-cal-negate.test.ts",
      kind: "chainNegateToGrave",
    },
    {
      file: "lua-real-script-iron-core-luster-confirm-negate.test.ts",
      kind: "chainNegateToGrave",
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
      file: "lua-real-script-sinto-oath-chain-negate.test.ts",
      kind: "chainNegateToGrave",
    },
    {
      file: "lua-real-script-tutan-mask-targeted-zombie-negate.test.ts",
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
      file: "lua-real-script-showdown-secret-sense-scroll-negate.test.ts",
      kind: "chainNegateToGrave",
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
      file: "lua-real-script-adamancipator-resonance-damage-cal-negate.test.ts",
      kind: "adamancipatorResonanceDamageCalculationNegateDestroy",
      required: [
        'const resonanceCode = "45730592"',
        "restores its Damage Calculation Adamancipator Synchro gate, monster activation negation, source destruction, and suppressed operation",
        "e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DAMAGE_CAL)",
        "Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_MZONE,0,1,nil)",
        "return c:IsFaceup() and c:IsSetCard(SET_ADAMANCIPATOR) and c:IsType(TYPE_SYNCHRO)",
        "and re:IsMonsterEffect() and Duel.IsChainNegatable(ev)",
        'eventName: "chainNegated"',
        'host.messages).not.toContain("adamancipator monster resolved")',
      ],
    },
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
      file: "lua-real-script-disarm-gladiator-negate-to-deck-cost.test.ts",
      kind: "disarmGladiatorCostToDeckSpellNegateDestroy",
      required: [
        'const disarmCode = "26834022"',
        "restores its hand Gladiator Beast to-Deck cost, activation negation, source destruction, and suppressed Spell operation",
        "Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_HAND,0,1,1,nil)",
        "Duel.ConfirmCards(1-tp,g)",
        "Duel.SendtoDeck(g,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)",
        "Duel.NegateActivation(ev)",
        'eventName: "confirmed"',
        'eventName: "sentToDeck"',
        'eventName: "chainNegated"',
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
      file: "lua-real-script-face-off-damage-phase-negate.test.ts",
      kind: "faceOffDamagePhaseCurrentPhaseNegateDestroy",
      required: [
        'const faceOffCode = "39276790"',
        "restores its Duel.GetCurrentPhase Damage Calculation gate, activation negation, source destruction, and suppressed monster operation",
        "local ph=Duel.GetCurrentPhase()",
        "return (ph==PHASE_DAMAGE or ph==PHASE_DAMAGE_CAL)",
        "and (re:IsMonsterEffect() or re:IsHasType(EFFECT_TYPE_ACTIVATE))",
        "Duel.NegateActivation(ev)",
        'eventName: "chainNegated"',
        'host.messages).not.toContain("face-off monster resolved")',
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
      file: "lua-real-script-gagagarush-target-monster-negate-damage.test.ts",
      kind: "gagagarushTargetMonsterNegateDamage",
      required: [
        'const gagagarushCode = "13166204"',
        "restores targeted Gagaga monster chain response into monster-effect negation, destruction, BreakEffect, and damage",
        "e1:SetCode(EVENT_BECOME_TARGET)",
        "s.listed_series={SET_GAGAGA}",
        "Duel.IsChainDisablable(ev)",
        "Duel.NegateEffect(ev)",
        "Duel.Destroy(re:GetHandler(),REASON_EFFECT)",
        "Duel.BreakEffect()",
        "Duel.Damage(1-tp,a,REASON_EFFECT)",
        'eventName: "becameTarget"',
        'eventName: "chainNegated"',
        'eventName: "damageDealt"',
        'host.messages).not.toContain("gagagarush starter resolved")',
      ],
    },
    {
      file: "lua-real-script-g-golem-dignified-trilithon-target-link-negate.test.ts",
      kind: "gGolemDignifiedTargetedLinkNegateDestroy",
      required: [
        'const gGolemCode = "50546029"',
        "restores targeted Link chain response negation, source destruction, and suppressed operation",
        "tg and tg:IsExists(s.tfilter,1,nil,tp) and Duel.IsChainDisablable(ev)",
        "return c:IsFaceup() and c:IsLocation(LOCATION_MZONE) and c:IsType(TYPE_LINK) and c:IsControler(tp)",
        "Duel.NegateEffect(ev)",
        "Duel.Destroy(eg,REASON_EFFECT)",
        'eventName: "becameTarget"',
        'eventName: "chainNegated"',
        'host.messages).not.toContain("g golem targeting starter resolved")',
      ],
    },
    {
      file: "lua-real-script-gilti-gearfried-target-chain-negate.test.ts",
      kind: "giltiGearfriedTargetedChainNegateDestroy",
      required: [
        'const giltiGearfriedCode = "49161188"',
        "restores targeted chain response negation and selected card destruction",
        "local loc,tg=Duel.GetChainInfo(ev,CHAININFO_TRIGGERING_LOCATION,CHAININFO_TARGET_CARDS)",
        "return Duel.IsChainDisablable(ev) and loc~=LOCATION_DECK",
        "Duel.NegateEffect(ev)",
        'eventName: "becameTarget"',
        'eventName: "chainNegated"',
        'host.messages).not.toContain("gilti gearfried targeting starter resolved")',
      ],
    },
    {
      file: "lua-real-script-herald-perfection-damage-cal-negate.test.ts",
      kind: "heraldPerfectionDamageCalculationNegateDestroy",
      required: [
        'const heraldCode = "44665365"',
        "restores its Damage Calculation Fairy hand cost, activation negation, source destruction, and suppressed monster operation",
        "e1:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DAMAGE_CAL)",
        "Duel.SelectMatchingCard(tp,s.costfilter,tp,LOCATION_HAND,0,1,1,nil)",
        "Duel.SendtoGrave(g,REASON_COST)",
        "Duel.NegateActivation(ev)",
        'eventName: "sentToGraveyard"',
        'eventName: "chainNegated"',
        'host.messages).not.toContain("herald monster resolved")',
      ],
    },
    {
      file: "lua-real-script-iron-core-luster-confirm-negate.test.ts",
      kind: "ironCoreLusterConfirmCostNegateDestroy",
      required: [
        'const lusterCode = "34545235"',
        "restores its hidden Iron Core confirmation cost, hand shuffle, activation negation, destruction, and suppressed Spell operation",
        "Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_HAND,0,1,1,nil)",
        "Duel.ConfirmCards(1-tp,g)",
        "Duel.ShuffleHand(tp)",
        "Duel.NegateActivation(ev)",
        'eventName: "confirmed"',
        'eventName: "chainNegated"',
        'host.messages).not.toContain("iron core luster spell resolved")',
      ],
    },
    {
      file: "lua-real-script-light-imprisoning-mirror-chain-activating-negate.test.ts",
      kind: "lightImprisoningMirrorContinuousChainActivatingNegate",
      required: [
        'const mirrorCode = "53341729"',
        "restores EVENT_CHAIN_ACTIVATING continuous negation of a LIGHT monster effect from field",
        "Duel.GetChainInfo(ev,CHAININFO_TRIGGERING_LOCATION)",
        "re:IsMonsterEffect() and (loc==LOCATION_MZONE or loc==LOCATION_GRAVE)",
        "re:GetHandler():IsAttribute(ATTRIBUTE_LIGHT)",
        "Duel.NegateEffect(ev)",
        'eventName: "chainNegated"',
        'eventName: "chainDisabled"',
        'host.messages).not.toContain("light mirror source resolved")',
        'host.messages).toContain("dark mirror source resolved")',
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
      file: "lua-real-script-sinto-oath-chain-negate.test.ts",
      kind: "sintoFireFormationOathNegateDestroy",
      required: [
        'const sintoCode = "55538156"',
        "restores its Fire Fist and Fire Formation gate, OATH activation negation, source destruction, and suppressed Spell operation",
        "e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)",
        "Duel.IsExistingMatchingCard(s.filter1,tp,LOCATION_MZONE,0,1,nil)",
        "Duel.IsExistingMatchingCard(s.filter2,tp,LOCATION_SZONE,0,1,nil)",
        "Duel.NegateActivation(ev)",
        'eventName: "chainNegated"',
        "action.uid === secondSinto!.uid)).toBe(false)",
        'host.messages).not.toContain("sinto first spell resolved")',
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
      file: "lua-real-script-showdown-secret-sense-scroll-negate.test.ts",
      kind: "showdownOpponentGraveSameCodeNegateDestroy",
      required: [
        'const showdownCode = "92080692"',
        "restores its opponent-Graveyard same-code gate, activation negation, source destruction, and suppressed monster operation",
        "rp~=tp and (re:IsMonsterEffect() or re:IsHasType(EFFECT_TYPE_ACTIVATE))",
        "Duel.IsExistingMatchingCard(Card.IsCode,tp,0,LOCATION_GRAVE,1,nil,re:GetHandler():GetCode())",
        "Duel.NegateActivation(ev)",
        'eventName: "chainNegated"',
        'host.messages).not.toContain("showdown monster resolved")',
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
      file: "lua-real-script-tutan-mask-targeted-zombie-negate.test.ts",
      kind: "tutanMaskTargetedZombieNegateDestroy",
      required: [
        'const tutanCode = "3149764"',
        "restores CHAININFO_TARGET_CARDS gating for a single face-up Zombie target, activation negation, destruction, and suppressed Spell operation",
        "local tg=Duel.GetChainInfo(ev,CHAININFO_TARGET_CARDS)",
        "return tg and #tg==1 and s.cfilter(tg:GetFirst()) and Duel.IsChainNegatable(ev)",
        'targetUids: [zombie.uid]',
        'eventName: "becameTarget"',
        'eventName: "chainNegated"',
        'host.messages).not.toContain("tutan targeted spell resolved")',
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
      chainNegateCostToDeck: 0,
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
      adamancipatorResonanceDamageCalculationNegateDestroy: 0,
      armorBreakEquipActiveTypeNegateDestroy: 0,
      ashBlossomHandTrapDeckSearchNegate: 0,
      darkBribeNegateDestroyOpponentDraw: 0,
      disarmGladiatorCostToDeckSpellNegateDestroy: 0,
      divineWrathDiscardMonsterNegateDestroy: 0,
      effectVeilerHandQuickDisableChainLink: 0,
      faceOffDamagePhaseCurrentPhaseNegateDestroy: 0,
      gagagarushTargetMonsterNegateDamage: 0,
      ghostOgreDestroyOnlyNoNegation: 0,
      gGolemDignifiedTargetedLinkNegateDestroy: 0,
      giltiGearfriedTargetedChainNegateDestroy: 0,
      heraldPerfectionDamageCalculationNegateDestroy: 0,
      ironCoreLusterConfirmCostNegateDestroy: 0,
      lightImprisoningMirrorContinuousChainActivatingNegate: 0,
      magicJammerDiscardSpellNegateDestroy: 0,
      mysticalSpaceTyphoonDestroyOnlyNoNegation: 0,
      overwhelmTributeGateTrapNegateDestroy: 0,
      pollinosisPlantReleaseActivationNegateDestroy: 0,
      raigekiBreakDiscardDestroyOnlyNoNegation: 0,
      sevenToolsLpCostTrapNegateDestroy: 0,
      sintoFireFormationOathNegateDestroy: 0,
      solemnJudgmentActivationNegateCostDestroy: 0,
      solemnStrikeSummonAndMonsterNegate: 0,
      solemnWarningSpecialSummonNegate: 0,
      showdownOpponentGraveSameCodeNegateDestroy: 0,
      sprightRedLinkReleaseMonsterNegateDestroy: 0,
      twinTwistersMultiDestroyOnlyNoNegation: 0,
      tutanMaskTargetedZombieNegateDestroy: 0,
      wiretapTrapNegateReturnToDeck: 0,
    },
  );
}
