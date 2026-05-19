import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const chainResponseFixtureCount = 19;
const chainResponseKindCounts = {
  destroyOnlyChainedResponse: 4,
  flipSummonTrapResponse: 3,
  genericChainResponse: 1,
  ignitionBanishCostColumnDestroyResponse: 1,
  ignitionHandToGraveCostLabelDestroyResponse: 1,
  ignitionReleaseCostDestroyResponse: 1,
  ignitionSelfTributeDestroyResponse: 1,
  spellActivationDestroyDamageResponse: 1,
  summonEffectNegateResponse: 1,
  summonSuccessTrapResponse: 3,
  trapNegateToDeckResponse: 1,
  tributeGateTrapNegateResponse: 1,
} satisfies Record<ChainResponseKind, number>;
const chainResponseSemanticVariantCounts = {
  adhesionTrapHoleFlipSummonAtkEffect: 1,
  bottomlessTrapHoleSummonSuccessBanish: 1,
  crimsonNinjaFlipConfirmTrapDestroy: 1,
  ghostBelleWantedChainNegationAndRecycle: 1,
  goldenFlyingFishReleaseCostTargetDestroy: 1,
  deepSweeperSelfTributeDestroy: 1,
  houseAdhesiveTapeFlipSummonDestroy: 1,
  mekkKnightYellowColumnProcedureDestroy: 1,
  mysticalSpaceTyphoonFreeChainDestroy: 1,
  shreddderHandMachineLevelDestroy: 1,
  overwhelmTributeGateTrapNegateDestroy: 1,
  raigekiBreakDiscardCostDestroy: 1,
  solemnWarningSpecialSummonEffectNegate: 1,
  spellReactorChainDestroyDamage: 1,
  synchBlastWaveSynchroGateTargetDestroy: 1,
  torrentialTributeSummonSuccessDestroyAll: 1,
  trapHoleFlipSummonAtkGateDestroy: 1,
  trapHoleSummonSuccessDestroy: 1,
  wiretapTrapNegateReturnToDeck: 1,
} satisfies Record<ChainResponseSemanticVariant, number>;

type ChainResponseKind =
  | "destroyOnlyChainedResponse"
  | "flipSummonTrapResponse"
  | "genericChainResponse"
  | "ignitionBanishCostColumnDestroyResponse"
  | "ignitionHandToGraveCostLabelDestroyResponse"
  | "ignitionReleaseCostDestroyResponse"
  | "ignitionSelfTributeDestroyResponse"
  | "spellActivationDestroyDamageResponse"
  | "summonEffectNegateResponse"
  | "summonSuccessTrapResponse"
  | "trapNegateToDeckResponse"
  | "tributeGateTrapNegateResponse";
type ChainResponseSemanticVariant =
  | "adhesionTrapHoleFlipSummonAtkEffect"
  | "bottomlessTrapHoleSummonSuccessBanish"
  | "crimsonNinjaFlipConfirmTrapDestroy"
  | "ghostBelleWantedChainNegationAndRecycle"
  | "goldenFlyingFishReleaseCostTargetDestroy"
  | "deepSweeperSelfTributeDestroy"
  | "houseAdhesiveTapeFlipSummonDestroy"
  | "mekkKnightYellowColumnProcedureDestroy"
  | "mysticalSpaceTyphoonFreeChainDestroy"
  | "shreddderHandMachineLevelDestroy"
  | "overwhelmTributeGateTrapNegateDestroy"
  | "raigekiBreakDiscardCostDestroy"
  | "solemnWarningSpecialSummonEffectNegate"
  | "spellReactorChainDestroyDamage"
  | "synchBlastWaveSynchroGateTargetDestroy"
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
      file: "test/lua-real-script-crimson-ninja-flip-confirm-trap-destroy.test.ts",
      kind: "destroyOnlyChainedResponse",
      required: [
        'action.type === "activateTrigger" && action.uid === crimsonNinja.uid',
        'pass?.windowKind).toBe("chainResponse")',
        "restoredChainWindow.session.state.chain).toEqual([])",
        'eventName: "confirmed"',
        'eventName: "destroyed"',
        'location: "graveyard"',
        'host.messages).not.toContain("crimson ninja responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-golden-flying-fish-release-destroy.test.ts",
      kind: "ignitionReleaseCostDestroyResponse",
      required: [
        "Duel.CheckReleaseGroupCost(tp,s.cfilter,1,false,aux.ReleaseCheckTarget,e:GetHandler(),dg)",
        "Duel.SelectReleaseGroupCost(tp,s.cfilter,1,1,false,aux.ReleaseCheckTarget,e:GetHandler(),dg)",
        "Duel.Release(g,REASON_COST)",
        'eventName: "released"',
        'eventName: "destroyed"',
        'host.messages).not.toContain("golden flying fish responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-deep-sweeper-self-tribute-destroy.test.ts",
      kind: "ignitionSelfTributeDestroyResponse",
      required: [
        "e1:SetCost(Cost.SelfTribute)",
        "Duel.SelectTarget(tp,s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil)",
        'activationLocation: "monsterZone"',
        'eventName: "released"',
        'eventName: "destroyed"',
        'host.messages).not.toContain("deep sweeper responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-mekk-knight-yellow-column-procedure-destroy.test.ts",
      kind: "ignitionBanishCostColumnDestroyResponse",
      required: [
        "return c:GetColumnGroupCount()>0",
        "zone=(zone|tc:GetColumnZone(LOCATION_MZONE,0,0,tp))",
        "Duel.SelectMatchingCard(tp,s.costfilter,tp,LOCATION_GRAVE,0,1,1,nil)",
        "Duel.Remove(g,POS_FACEUP,REASON_COST)",
        "Duel.SelectTarget(tp,s.filter,tp,LOCATION_ONFIELD,LOCATION_ONFIELD,1,1,nil,cg)",
        'eventName: "banished"',
        'eventName: "destroyed"',
        'host.messages).not.toContain("mekk-knight yellow responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-shreddder-hand-machine-level-destroy.test.ts",
      kind: "ignitionHandToGraveCostLabelDestroyResponse",
      required: [
        "Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_HAND,0,1,1,nil,tp)",
        "local lv=g:GetFirst():GetLevel()",
        "e:SetLabel(lv)",
        "Duel.SendtoGrave(g,REASON_COST)",
        "Duel.SelectTarget(tp,s.dfilter,tp,0,LOCATION_MZONE,1,1,nil,e:GetLabel())",
        "effectLabel: 5",
        'eventName: "sentToGraveyard"',
        'eventName: "destroyed"',
        'host.messages).not.toContain("shreddder responder resolved")',
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
      file: "test/lua-real-script-overwhelm-tribute-chain-negate.test.ts",
      kind: "tributeGateTrapNegateResponse",
      required: [
        'action.type === "activateEffect" && action.uid === overwhelm.uid',
        'action.type === "passChain"',
        "restoredPendingResolution.session.state.chain).toHaveLength(0)",
        'eventName: "chainNegated"',
        'location: "graveyard"',
        'summonType: "tribute"',
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
      file: "test/lua-real-script-synch-blast-wave-target-destroy.test.ts",
      kind: "destroyOnlyChainedResponse",
      required: [
        'candidate.type === "activateEffect" && candidate.uid === synchBlastWave.uid',
        'pass?.windowKind).toBe("chainResponse")',
        "restoredChainWindow.session.state.chain).toEqual([])",
        'eventName: "destroyed"',
        'location: "graveyard"',
        'host.messages).not.toContain("synch blast wave responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-spell-reactor-chain-destroy-damage.test.ts",
      kind: "spellActivationDestroyDamageResponse",
      required: [
        'action.type === "activateEffect" && action.uid === spellReactor.uid',
        'windowKind: "chainResponse"',
        "restoredResponse.session.state.chain).toHaveLength(0)",
        'eventName: "destroyed"',
        'eventName: "damageDealt"',
        'location: "graveyard"',
        'effectId: "lua-2-1027"',
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
      ignitionBanishCostColumnDestroyResponse: 0,
      ignitionHandToGraveCostLabelDestroyResponse: 0,
      ignitionReleaseCostDestroyResponse: 0,
      ignitionSelfTributeDestroyResponse: 0,
      spellActivationDestroyDamageResponse: 0,
      summonEffectNegateResponse: 0,
      summonSuccessTrapResponse: 0,
      trapNegateToDeckResponse: 0,
      tributeGateTrapNegateResponse: 0,
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
      file: "test/lua-real-script-crimson-ninja-flip-confirm-trap-destroy.test.ts",
      kind: "crimsonNinjaFlipConfirmTrapDestroy",
      required: [
        'const crimsonNinjaCode = "14618326"',
        "restores Crimson Ninja's flip target, facedown Trap confirmation, and conditional destroy",
        "EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP",
        "Duel.ConfirmCards(tp,tc)",
        "confirmed 0:",
        "eventName: \"destroyed\"",
      ],
    },
    {
      file: "test/lua-real-script-golden-flying-fish-release-destroy.test.ts",
      kind: "goldenFlyingFishReleaseCostTargetDestroy",
      required: [
        'const goldenFlyingFishCode = "76203291"',
        "restores aux.ReleaseCheckTarget release cost into targeted on-field destruction",
        "Duel.CheckReleaseGroupCost(tp,s.cfilter,1,false,aux.ReleaseCheckTarget,e:GetHandler(),dg)",
        "Duel.SelectReleaseGroupCost(tp,s.cfilter,1,1,false,aux.ReleaseCheckTarget,e:GetHandler(),dg)",
        "Duel.Release(g,REASON_COST)",
        "golden flying fish responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-deep-sweeper-self-tribute-destroy.test.ts",
      kind: "deepSweeperSelfTributeDestroy",
      required: [
        'const deepSweeperCode = "8649148"',
        "restores Cost.SelfTribute release cost into targeted Spell/Trap destruction after the source leaves field",
        "e1:SetCost(Cost.SelfTribute)",
        "activationLocation: \"monsterZone\"",
        "deep sweeper responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-mekk-knight-yellow-column-procedure-destroy.test.ts",
      kind: "mekkKnightYellowColumnProcedureDestroy",
      required: [
        'const yellowStarCode = "29415459"',
        "restores its column-gated hand Special Summon procedure and grave banish-cost Spell/Trap destruction",
        "e1:SetCode(EFFECT_SPSUMMON_PROC)",
        "return c:GetColumnGroupCount()>0",
        "Duel.Remove(g,POS_FACEUP,REASON_COST)",
        "mekk-knight yellow responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-shreddder-hand-machine-level-destroy.test.ts",
      kind: "shreddderHandMachineLevelDestroy",
      required: [
        'const shreddderCode = "3603242"',
        "restores its hand Machine to-Grave cost label into opponent face-up monster destruction",
        "Duel.SelectMatchingCard(tp,s.cfilter,tp,LOCATION_HAND,0,1,1,nil,tp)",
        "tc:IsLevelBelow(e:GetLabel())",
        "shreddder responder resolved",
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
      file: "test/lua-real-script-overwhelm-tribute-chain-negate.test.ts",
      kind: "overwhelmTributeGateTrapNegateDestroy",
      required: [
        'const overwhelmCode = "20140382"',
        "restores Overwhelm's Tribute Summoned Level 7+ gate, activation negation, source destruction, and suppressed Trap operation",
        "restoredOpenChain.session.state.chain).toHaveLength(2)",
        'eventName: "chainNegated"',
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
      file: "test/lua-real-script-spell-reactor-chain-destroy-damage.test.ts",
      kind: "spellReactorChainDestroyDamage",
      required: [
        'const spellReactorCode = "15175429"',
        "restores its spell-activation chain response that destroys the source and deals damage",
        "EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DAMAGE_CAL",
        "re:IsHasType(EFFECT_TYPE_ACTIVATE) and re:IsSpellEffect()",
        "players[0].lifePoints).toBe(7200)",
        "players[1].lifePoints).toBe(7800)",
      ],
    },
    {
      file: "test/lua-real-script-synch-blast-wave-target-destroy.test.ts",
      kind: "synchBlastWaveSynchroGateTargetDestroy",
      required: [
        'const synchBlastWaveCode = "35537860"',
        "restores Synch Blast Wave's face-up Synchro gate, opponent monster target, and destroy operation",
        "return c:IsFaceup() and c:IsType(TYPE_SYNCHRO)",
        "Duel.SelectTarget(tp,aux.TRUE,tp,0,LOCATION_MZONE,1,1,nil)",
        "eventName: \"destroyed\"",
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
      crimsonNinjaFlipConfirmTrapDestroy: 0,
      deepSweeperSelfTributeDestroy: 0,
      ghostBelleWantedChainNegationAndRecycle: 0,
      goldenFlyingFishReleaseCostTargetDestroy: 0,
      houseAdhesiveTapeFlipSummonDestroy: 0,
      mekkKnightYellowColumnProcedureDestroy: 0,
      mysticalSpaceTyphoonFreeChainDestroy: 0,
      shreddderHandMachineLevelDestroy: 0,
      overwhelmTributeGateTrapNegateDestroy: 0,
      raigekiBreakDiscardCostDestroy: 0,
      solemnWarningSpecialSummonEffectNegate: 0,
      spellReactorChainDestroyDamage: 0,
      synchBlastWaveSynchroGateTargetDestroy: 0,
      torrentialTributeSummonSuccessDestroyAll: 0,
      trapHoleFlipSummonAtkGateDestroy: 0,
      trapHoleSummonSuccessDestroy: 0,
      wiretapTrapNegateReturnToDeck: 0,
    },
  );
}
