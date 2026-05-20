import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const continuousOperationFixtureCount = 10;
const continuousOperationKindCounts = {
  attributeStatDestroyedToHand: 1,
  chainSolvingDoubleSnareNegateDestroy: 1,
  chainSolvingDiceNegateDestroy: 1,
  chainSolvingEquipNegateSend: 1,
  chainSolvingCustomSearch: 1,
  continuousRedirect: 2,
  endPhaseControlReturn: 1,
  originalCodeSummonLock: 1,
  summonTriggerBackrowDestroy: 1,
} satisfies Record<ContinuousOperationKind, number>;
const continuousOperationSemanticVariantCounts = {
  abyssScaleMizuchiSpellNegateSend: 1,
  changeOfHeartEndPhaseControlReturn: 1,
  coreOfChaosFaceUpLeaveFieldRedirect: 1,
  darkMagicianOriginalCodeSummonLock: 1,
  dimensionalFissureToGraveRedirect: 1,
  fenghuangSetBackrowDestroy: 1,
  goraTurtleTargetedSpellNegateDestroy: 1,
  magicalMusketeerCasparHandTrapSearch: 1,
  missusRadiantAttributeStatDestroyedToHand: 1,
  skullArchfiendDiceTargetNegateDestroy: 1,
} satisfies Record<ContinuousOperationSemanticVariant, number>;

type ContinuousOperationKind =
  | "attributeStatDestroyedToHand"
  | "chainSolvingDoubleSnareNegateDestroy"
  | "chainSolvingDiceNegateDestroy"
  | "chainSolvingEquipNegateSend"
  | "chainSolvingCustomSearch"
  | "continuousRedirect"
  | "endPhaseControlReturn"
  | "originalCodeSummonLock"
  | "summonTriggerBackrowDestroy";

type ContinuousOperationSemanticVariant =
  | "abyssScaleMizuchiSpellNegateSend"
  | "changeOfHeartEndPhaseControlReturn"
  | "coreOfChaosFaceUpLeaveFieldRedirect"
  | "darkMagicianOriginalCodeSummonLock"
  | "dimensionalFissureToGraveRedirect"
  | "fenghuangSetBackrowDestroy"
  | "goraTurtleTargetedSpellNegateDestroy"
  | "magicalMusketeerCasparHandTrapSearch"
  | "missusRadiantAttributeStatDestroyedToHand"
  | "skullArchfiendDiceTargetNegateDestroy";

describe("Lua real continuous operation restore coverage", () => {
  it("requires continuous operation fixtures to assert clean restore and restored outcomes", () => {
    const files = continuousOperationFixtureFiles();
    expect(files).toHaveLength(continuousOperationFixtureCount);

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
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps continuous operation fixture kinds explicit", () => {
    expect(countContinuousOperationKinds(continuousOperationFixtureFiles())).toEqual(continuousOperationKindCounts);
  });

  it("keeps named continuous operation semantic variants explicit", () => {
    expect(countContinuousOperationSemanticVariants(continuousOperationSemanticVariants())).toEqual(continuousOperationSemanticVariantCounts);

    const weak = continuousOperationSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function continuousOperationFixtureFiles(): Array<{
  file: string;
  kind: ContinuousOperationKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-skull-archfiend-dice-target-negate.test.ts",
      kind: "chainSolvingDiceNegateDestroy",
      required: [
        "restores mandatory Standby LP upkeep and dice-gated chain-solving targeted-effect negation",
        "EVENT_PHASE|PHASE_STANDBY",
        "Duel.CheckLPCost(tp,500)",
        "Duel.PayLPCost(tp,500)",
        "Duel.Destroy(e:GetHandler(),REASON_COST)",
        "EVENT_CHAIN_SOLVING",
        "Duel.GetChainInfo(ev,CHAININFO_TARGET_CARDS)",
        "Duel.TossDice(tp,1)",
        "Duel.NegateEffect(ev)",
        "Duel.Destroy(rc,REASON_EFFECT)",
        'eventName: "lifePointCostPaid"',
        'eventName: "diceTossed"',
        'eventName: "chainNegated"',
        'eventName: "chainDisabled"',
        'eventName: "destroyed"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-gora-turtle-targeted-spell-negate.test.ts",
      kind: "chainSolvingDoubleSnareNegateDestroy",
      required: [
        "restores Double Snare validity and chain-solving targeted Spell negation with handler destruction",
        "aux.DoubleSnareValidity(c,LOCATION_MZONE)",
        "EVENT_CHAIN_SOLVING",
        "Duel.GetChainInfo(ev,CHAININFO_TARGET_CARDS)",
        "Duel.NegateEffect(ev)",
        "Duel.Destroy(re:GetHandler(),REASON_EFFECT)",
        'eventName: "chainNegated"',
        'eventName: "chainDisabled"',
        'eventName: "destroyed"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-abyss-scale-mizuchi-chain-solving-negate.test.ts",
      kind: "chainSolvingEquipNegateSend",
      required: [
        "restores equipped EVENT_CHAIN_SOLVING Spell negation and sends the Equip Spell to Graveyard",
        "aux.AddEquipProcedure(c,nil,aux.FilterBoolFunction(Card.IsSetCard,SET_MERMAIL))",
        "EVENT_CHAIN_SOLVING",
        "re:IsSpellEffect() and Duel.IsChainDisablable(ev)",
        "Duel.NegateEffect(ev)",
        "Duel.SendtoGrave(e:GetHandler(),REASON_EFFECT)",
        'eventName: "chainNegated"',
        'eventName: "chainDisabled"',
        'eventName: "sentToGraveyard"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-magical-musketeer-caspar-hand-trap-search.test.ts",
      kind: "chainSolvingCustomSearch",
      required: [
        "uses EFFECT_TRAP_ACT_IN_HAND to activate a Magical Musket Trap from hand and raise Caspar's custom search trigger",
        "EFFECT_TRAP_ACT_IN_HAND",
        "EVENT_CHAIN_SOLVING",
        "Duel.RaiseSingleEvent(c,EVENT_CUSTOM+id,e,0,0,0,0)",
        "action.type === \"activateTrigger\"",
        "eventName: \"moved\"",
        "location).toBe(\"hand\")",
      ],
    },
    {
      file: "test/lua-real-script-missus-radiant-destroyed-attribute-to-hand.test.ts",
      kind: "attributeStatDestroyedToHand",
      required: [
        "restores cloned EARTH/WIND stat effects and its delayed destroyed target return",
        "target:attribute:1",
        "target:attribute:8",
        "triggerEvent: \"destroyed\"",
        "triggerSourceOnly: true",
        'eventName: "destroyed"',
        'eventName: "sentToHand"',
        "currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === radiant.uid)!",
        "location: \"hand\", controller: 0",
      ],
    },
    {
      file: "test/lua-real-script-change-of-heart-control-return.test.ts",
      kind: "endPhaseControlReturn",
      required: [
        "restores Change of Heart's target, control operation, and End Phase return",
        "temporary-control-return",
        "operation: [Function]",
        "previousController: 1",
        "previousController: 0",
        'action.type === "endTurn"',
        "not.toContain(`lua:${targetCode}:temporary-control-return",
      ],
    },
    {
      file: "test/lua-real-script-core-of-chaos-faceup-redirect.test.ts",
      kind: "continuousRedirect",
      required: [
        "condition:source-faceup",
        "code: 60",
        "property: 0x400",
        "duelReason.effect | duelReason.redirect",
        'location: "banished"',
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-dimensional-fissure-to-grave-redirect.test.ts",
      kind: "continuousRedirect",
      required: [
        "restores its non-Spell/Trap EFFECT_TO_GRAVE_REDIRECT target predicate",
        'const fissureCode = "81674782"',
        "code: 63",
        "target:not-location-not-spelltrap:128",
        "duelReason.effect | duelReason.redirect",
        'location: "banished"',
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-dark-magician-destruction-original-code-lock.test.ts",
      kind: "originalCodeSummonLock",
      required: [
        "target:summon-type-code-any:original:",
        "restored original/current",
        "dark magician fusion special 0",
        "dark magician alternate special 0",
        "other fusion special 1",
      ],
    },
    {
      file: "test/lua-real-script-fenghuang-set-backrow-destroy.test.ts",
      kind: "summonTriggerBackrowDestroy",
      required: [
        "restoredSummonWindow.missingRegistryKeys).toEqual([])",
        "restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingRegistryKeys).toEqual([])",
        "restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChain.missingRegistryKeys).toEqual([])",
        "restoredChain.missingChainLimitRegistryKeys).toEqual([])",
        "operationInfos: [{ category: 0x1",
        'eventName: "destroyed"',
        "host.messages).not.toContain",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: ContinuousOperationKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countContinuousOperationKinds(
  fixtures: Array<{ kind: ContinuousOperationKind }>,
): Record<ContinuousOperationKind, number> {
  return fixtures.reduce<Record<ContinuousOperationKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      attributeStatDestroyedToHand: 0,
      chainSolvingDoubleSnareNegateDestroy: 0,
      chainSolvingDiceNegateDestroy: 0,
      chainSolvingEquipNegateSend: 0,
      chainSolvingCustomSearch: 0,
      continuousRedirect: 0,
      endPhaseControlReturn: 0,
      originalCodeSummonLock: 0,
      summonTriggerBackrowDestroy: 0,
    },
  );
}

function continuousOperationSemanticVariants(): Array<{
  file: string;
  kind: ContinuousOperationSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-skull-archfiend-dice-target-negate.test.ts",
      kind: "skullArchfiendDiceTargetNegateDestroy",
      required: [
        'const skullArchfiendCode = "61370518"',
        "setArchfiend = 0x45",
        "eventName: \"lifePointCostPaid\"",
        "eventName: \"diceTossed\"",
        "lastDiceResults).toEqual([3])",
        "relatedEffectId: 4",
        "eventReasonCardUid: skull.uid",
      ],
    },
    {
      file: "test/lua-real-script-gora-turtle-targeted-spell-negate.test.ts",
      kind: "goraTurtleTargetedSpellNegateDestroy",
      required: [
        'const goraCode = "42868711"',
        'const eventChainSolving = 1020',
        "code: 3682106",
        "relatedEffectId: 6",
        "reason: duelReason.effect | duelReason.destroy",
        "gora targeting spell resolved",
      ],
    },
    {
      file: "test/lua-real-script-abyss-scale-mizuchi-chain-solving-negate.test.ts",
      kind: "abyssScaleMizuchiSpellNegateSend",
      required: [
        'const mizuchiCode = "72932673"',
        'const setMermail = 0x74',
        "currentAttack(restoredOpen.session.state.cards.find((card) => card.uid === mermail.uid), restoredOpen.session.state)).toBe(2400)",
        "currentAttack(restoredChain.session.state.cards.find((card) => card.uid === mermail.uid), restoredChain.session.state)).toBe(1600)",
        "relatedEffectId: 5",
        "eventReasonCardUid: mizuchi.uid",
      ],
    },
    {
      file: "test/lua-real-script-magical-musketeer-caspar-hand-trap-search.test.ts",
      kind: "magicalMusketeerCasparHandTrapSearch",
      required: [
        'const casparCode = "32841045"',
        'const setMagicalMusket = 0x108',
        "EFFECT_TRAP_ACT_IN_HAND",
        "EVENT_CHAIN_SOLVING",
        "Duel.RaiseSingleEvent(c,EVENT_CUSTOM+id,e,0,0,0,0)",
        "magical musket fixture trap resolved",
      ],
    },
    {
      file: "test/lua-real-script-missus-radiant-destroyed-attribute-to-hand.test.ts",
      kind: "missusRadiantAttributeStatDestroyedToHand",
      required: [
        'const radiantCode = "3987233"',
        "restores cloned EARTH/WIND stat effects and its delayed destroyed target return",
        "registryKey: \"lua:3987233:lua-6-1029\"",
        "target:attribute:1",
        "target:attribute:8",
        'eventName: "sentToHand"',
      ],
    },
    {
      file: "test/lua-real-script-change-of-heart-control-return.test.ts",
      kind: "changeOfHeartEndPhaseControlReturn",
      required: [
        'const changeOfHeartCode = "4031928"',
        "restores Change of Heart's target, control operation, and End Phase return",
        "temporary-control-return",
        "eventName: \"controlChanged\"",
        "previousController: 1",
        "not.toContain(`lua:${targetCode}:temporary-control-return",
      ],
    },
    {
      file: "test/lua-real-script-core-of-chaos-faceup-redirect.test.ts",
      kind: "coreOfChaosFaceUpLeaveFieldRedirect",
      required: [
        'const coreOfChaosCode = "3806388"',
        "restores comma-local face-up-only EFFECT_LEAVE_FIELD_REDIRECT",
        "restores local-handler face-up-only EFFECT_LEAVE_FIELD_REDIRECT",
        "restores its face-up-only EFFECT_LEAVE_FIELD_REDIRECT",
        "condition:source-faceup",
        "duelReason.effect | duelReason.redirect",
      ],
    },
    {
      file: "test/lua-real-script-dimensional-fissure-to-grave-redirect.test.ts",
      kind: "dimensionalFissureToGraveRedirect",
      required: [
        'const fissureCode = "81674782"',
        "restores its non-Spell/Trap EFFECT_TO_GRAVE_REDIRECT target predicate",
        "target:not-location-not-spelltrap:128",
        "targetRange: [0xff, 0xff]",
        "value: 0x20",
        "duelReason.effect | duelReason.redirect",
      ],
    },
    {
      file: "test/lua-real-script-dark-magician-destruction-original-code-lock.test.ts",
      kind: "darkMagicianOriginalCodeSummonLock",
      required: [
        'const darkMagicianDestructionCode = "59400890"',
        "restores original-code Fusion or alternate-procedure summon locks without using current code",
        "target:summon-type-code-any:original:",
        "restored original/current",
        "dark magician fusion special 0",
        "other fusion special 1",
      ],
    },
    {
      file: "test/lua-real-script-fenghuang-set-backrow-destroy.test.ts",
      kind: "fenghuangSetBackrowDestroy",
      required: [
        'const fenghuangCode = "50866755"',
        "restores its Spirit summon trigger and destroys only opponent set Spell/Trap cards",
        "operationInfos: [{ category: 0x1",
        "sortedUids([opponentSetTrap!.uid, opponentSetSpell!.uid])",
        "eventName: \"destroyed\"",
        "fenghuang responder resolved",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: ContinuousOperationSemanticVariant;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countContinuousOperationSemanticVariants(
  fixtures: Array<{ kind: ContinuousOperationSemanticVariant }>,
): Record<ContinuousOperationSemanticVariant, number> {
  return fixtures.reduce<Record<ContinuousOperationSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      abyssScaleMizuchiSpellNegateSend: 0,
      changeOfHeartEndPhaseControlReturn: 0,
      coreOfChaosFaceUpLeaveFieldRedirect: 0,
      darkMagicianOriginalCodeSummonLock: 0,
      dimensionalFissureToGraveRedirect: 0,
      fenghuangSetBackrowDestroy: 0,
      goraTurtleTargetedSpellNegateDestroy: 0,
      magicalMusketeerCasparHandTrapSearch: 0,
      missusRadiantAttributeStatDestroyedToHand: 0,
      skullArchfiendDiceTargetNegateDestroy: 0,
    },
  );
}
