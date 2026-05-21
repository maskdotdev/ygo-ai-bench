import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const TO_DECK_FIXTURE_COUNT = 9;
const toDeckKindCounts = {
  battleDamageGraveContinuousSpellToDeckTop: 1,
  battleDestroyingSetTargetCardToDeckTop: 1,
  freeChainReleaseTargetShuffleToDeck: 1,
  graveExtraToExtraDeckTop: 1,
  handRevealSelfShuffleToDeck: 1,
  flipGraveTargetShuffleToDeck: 1,
  selfTributeCurrentTurnBattleGraveToDeckBottom: 1,
  toGraveSelfShuffleToDeck: 1,
  freeChainMultiGraveShuffleToDeck: 1,
} satisfies Record<ToDeckKind, number>;
const toDeckSemanticVariantCounts = {
  adamancipatorLeoniteGraveExtraDeckTop: 1,
  crimsonSentrySelfTributeBattleGraveToDeckBottom: 1,
  desFeralImpFlipGraveTargetShuffleToDeck: 1,
  majespecterStormReleaseTargetShuffleToDeck: 1,
  nubianGuardBattleDamageGraveSpellDeckTop: 1,
  outstandingDogMarronToGraveSelfShuffleToDeck: 1,
  blackRoseAssaultRevealSelfShuffleToDeck: 1,
  wingedSageFalcosBattleDestroyingDeckTop: 1,
  volcanicRechargeFreeChainGraveShuffleToDeck: 1,
} satisfies Record<ToDeckSemanticVariant, number>;

type ToDeckKind =
  | "battleDamageGraveContinuousSpellToDeckTop"
  | "battleDestroyingSetTargetCardToDeckTop"
  | "freeChainReleaseTargetShuffleToDeck"
  | "graveExtraToExtraDeckTop"
  | "handRevealSelfShuffleToDeck"
  | "flipGraveTargetShuffleToDeck"
  | "selfTributeCurrentTurnBattleGraveToDeckBottom"
  | "toGraveSelfShuffleToDeck"
  | "freeChainMultiGraveShuffleToDeck";

type ToDeckSemanticVariant =
  | "adamancipatorLeoniteGraveExtraDeckTop"
  | "crimsonSentrySelfTributeBattleGraveToDeckBottom"
  | "desFeralImpFlipGraveTargetShuffleToDeck"
  | "majespecterStormReleaseTargetShuffleToDeck"
  | "nubianGuardBattleDamageGraveSpellDeckTop"
  | "outstandingDogMarronToGraveSelfShuffleToDeck"
  | "blackRoseAssaultRevealSelfShuffleToDeck"
  | "wingedSageFalcosBattleDestroyingDeckTop"
  | "volcanicRechargeFreeChainGraveShuffleToDeck";

describe("Lua real to-Deck restore coverage", () => {
  it("requires representative to-Deck operations to assert clean Lua restore and restored movement events", () => {
    const files = toDeckFixtureFiles();
    expect(files).toHaveLength(TO_DECK_FIXTURE_COUNT);

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

  it("keeps to-Deck fixture kinds explicit", () => {
    expect(countToDeckKinds(toDeckFixtureFiles())).toEqual(toDeckKindCounts);
  });

  it("keeps named to-Deck semantic variants explicit", () => {
    expect(countToDeckSemanticVariants(toDeckSemanticVariants())).toEqual(toDeckSemanticVariantCounts);

    const weak = toDeckSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function toDeckFixtureFiles(): Array<{
  file: string;
  kind: ToDeckKind;
  required: string[];
}> {
  return [
    {
      file: "test/lua-real-script-winged-sage-falcos-battle-destroying-decktop.test.ts",
      kind: "battleDestroyingSetTargetCardToDeckTop",
      required: [
        'const falcosCode = "87523462"',
        "restores GetBattleTarget SetTargetCard into destroyed monster sent to Deck top",
        "e1:SetCategory(CATEGORY_TODECK)",
        "e1:SetCode(EVENT_BATTLE_DESTROYING)",
        "local bc=c:GetBattleTarget()",
        "Duel.SetTargetCard(bc)",
        "Duel.SetOperationInfo(0,CATEGORY_TODECK,bc,1,0,0)",
        "Duel.SendtoDeck(tc,nil,SEQ_DECKTOP,REASON_EFFECT)",
        'eventName: "battleDestroyed"',
        'eventName: "sentToDeck"',
        "previousPosition: \"faceUpAttack\"",
      ],
    },
    {
      file: "test/lua-real-script-black-rose-assault-reveal-shuffle-stat.test.ts",
      kind: "handRevealSelfShuffleToDeck",
      required: [
        'const assaultCode = "46985799"',
        "restores SelfReveal hand ignition into self Deck shuffle and nonzero ATK final zero",
        "e2:SetCategory(CATEGORY_TODECK+CATEGORY_ATKCHANGE)",
        "e2:SetCost(Cost.SelfReveal)",
        "Duel.SetOperationInfo(0,CATEGORY_TODECK,c,1,tp,0)",
        "Duel.SendtoDeck(c,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)>0",
        'eventName: "confirmed"',
        'eventName: "sentToDeck"',
        "location: \"deck\"",
      ],
    },
    {
      file: "test/lua-real-script-nubian-guard-battle-damage-grave-spell-decktop.test.ts",
      kind: "battleDamageGraveContinuousSpellToDeckTop",
      required: [
        'const nubianGuardCode = "51616747"',
        "restores battle-damage targeting of an own Graveyard Continuous Spell sent to Deck top",
        "e1:SetCategory(CATEGORY_TODECK)",
        "e1:SetCode(EVENT_BATTLE_DAMAGE)",
        "return ep~=tp",
        "return c:IsContinuousSpell() and c:IsAbleToDeck()",
        "Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil)",
        "Duel.SendtoDeck(tc,nil,SEQ_DECKTOP,REASON_EFFECT)",
        "operationInfos",
        'eventName: "battleDamageDealt"',
        'eventName: "sentToDeck"',
        "sequence: 0",
      ],
    },
    {
      file: "test/lua-real-script-adamancipator-leonite-grave-extra-decktop.test.ts",
      kind: "graveExtraToExtraDeckTop",
      required: [
        'const leoniteCode = "47897376"',
        "restores targeted FIRE Synchro leave-Grave to Extra Deck, self Deck-top return, and deck-top confirmation",
        "Duel.SetOperationInfo(0,CATEGORY_LEAVE_GRAVE,tc,1,tp,0)",
        "Duel.SendtoDeck(tc,nil,SEQ_DECKTOP,REASON_EFFECT)",
        "Duel.SendtoDeck(c,nil,SEQ_DECKTOP,REASON_EFFECT)",
        "Duel.ConfirmDecktop(tp,1)",
        "operationInfos",
        "category: 0x10",
        "category: 0x4000000",
        'eventName: "sentToDeck"',
        'eventName: "confirmed"',
        "location: \"extraDeck\"",
      ],
    },
    {
      file: "test/lua-real-script-des-feral-imp-flip-grave-to-deck.test.ts",
      kind: "flipGraveTargetShuffleToDeck",
      required: [
        'const impCode = "81985784"',
        "restores its Flip target and shuffles an own Graveyard card into the Deck",
        "e1:SetCategory(CATEGORY_TODECK)",
        "e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP)",
        "Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil)",
        "Duel.SetOperationInfo(0,CATEGORY_TODECK,g,#g,0,0)",
        "Duel.SendtoDeck(tc,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)",
        "operationInfos: [{ category: 0x10",
        'eventName: "sentToDeck"',
        "eventCode: 1013",
        "eventReason: duelReason.effect",
        "eventReasonEffectId: 1",
      ],
    },
    {
      file: "test/lua-real-script-crimson-sentry-self-tribute-battle-to-deck.test.ts",
      kind: "selfTributeCurrentTurnBattleGraveToDeckBottom",
      required: [
        'const sentryCode = "28358902"',
        "restores SelfTribute cost into current-turn battle-reason Graveyard target sent to Deck bottom",
        "e1:SetCost(Cost.SelfTribute)",
        "return c:IsMonster() and c:GetTurnID()==tid and c:IsReason(REASON_BATTLE) and c:IsAbleToDeck()",
        "local tid=Duel.GetTurnCount()",
        "Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil,tid)",
        "Duel.SendtoDeck(tc,nil,SEQ_DECKBOTTOM,REASON_EFFECT)",
        "operationInfos: [{ category: 0x10",
        'eventName: "released"',
        'eventName: "sentToDeck"',
      ],
    },
    {
      file: "test/lua-real-script-outstanding-dog-marron-to-grave-shuffle.test.ts",
      kind: "toGraveSelfShuffleToDeck",
      required: [
        'const marronCode = "11548522"',
        "restores its mandatory EVENT_TO_GRAVE trigger and shuffles itself from Graveyard into the Deck",
        "e1:SetCategory(CATEGORY_TODECK)",
        "e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)",
        "e1:SetCode(EVENT_TO_GRAVE)",
        "Duel.SetOperationInfo(0,CATEGORY_TODECK,e:GetHandler(),1,0,0)",
        "Duel.SendtoDeck(e:GetHandler(),nil,SEQ_DECKSHUFFLE,REASON_EFFECT)",
        "operationInfos: [{ category: 0x10",
        'eventName: "sentToGraveyard"',
        'eventName: "sentToDeck"',
        "eventCode: 1013",
        "eventReason: duelReason.effect",
        "eventReasonEffectId: 1",
      ],
    },
    {
      file: "test/lua-real-script-volcanic-recharge-grave-shuffle.test.ts",
      kind: "freeChainMultiGraveShuffleToDeck",
      required: [
        'const rechargeCode = "33725271"',
        "restores free-chain Graveyard Volcanic monster targets and shuffles only valid cards into the Deck",
        "e1:SetType(EFFECT_TYPE_ACTIVATE)",
        "e1:SetCode(EVENT_FREE_CHAIN)",
        "Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,3,nil)",
        "Duel.SetOperationInfo(0,CATEGORY_TODECK,g,#g,0,0)",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)",
        "Duel.SendtoDeck(sg,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)",
        "chain.flatMap((link) => link.operationInfos ?? [])",
        'eventName: "sentToDeck"',
        "eventCode: 1013",
        "eventUids: [volcanicOne.uid, volcanicTwo.uid]",
      ],
    },
    {
      file: "test/lua-real-script-majespecter-storm-release-to-deck.test.ts",
      kind: "freeChainReleaseTargetShuffleToDeck",
      required: [
        'const stormCode = "13972452"',
        "restores aux.ReleaseCheckTarget release cost into targeted opponent monster shuffle",
        "e1:SetType(EFFECT_TYPE_ACTIVATE)",
        "e1:SetCode(EVENT_FREE_CHAIN)",
        "Duel.CheckReleaseGroupCost(tp,s.cfilter,1,false,aux.ReleaseCheckTarget,nil,dg)",
        "Duel.SelectReleaseGroupCost(tp,s.cfilter,1,1,false,aux.ReleaseCheckTarget,nil,dg)",
        "Duel.Release(g,REASON_COST)",
        "Duel.SelectTarget(tp,Card.IsAbleToDeck,tp,0,LOCATION_MZONE,1,1,nil)",
        "Duel.SetOperationInfo(0,CATEGORY_TODECK,g,1,0,0)",
        "Duel.SendtoDeck(tc,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)",
        "operationInfos: [{ category: 0x10",
        'eventName: "released"',
        'eventName: "sentToDeck"',
      ],
    },
  ];
}

function countToDeckKinds(fixtures: Array<{ kind: ToDeckKind }>): Record<ToDeckKind, number> {
  return fixtures.reduce<Record<ToDeckKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      battleDamageGraveContinuousSpellToDeckTop: 0,
      battleDestroyingSetTargetCardToDeckTop: 0,
      freeChainReleaseTargetShuffleToDeck: 0,
      graveExtraToExtraDeckTop: 0,
      handRevealSelfShuffleToDeck: 0,
      flipGraveTargetShuffleToDeck: 0,
      selfTributeCurrentTurnBattleGraveToDeckBottom: 0,
      toGraveSelfShuffleToDeck: 0,
      freeChainMultiGraveShuffleToDeck: 0,
    },
  );
}

function toDeckSemanticVariants(): Array<{
  file: string;
  kind: ToDeckSemanticVariant;
  required: string[];
}> {
  return [
    {
      file: "test/lua-real-script-winged-sage-falcos-battle-destroying-decktop.test.ts",
      kind: "wingedSageFalcosBattleDestroyingDeckTop",
      required: [
        'const falcosCode = "87523462"',
        "restores GetBattleTarget SetTargetCard into destroyed monster sent to Deck top",
        "bc:IsPreviousPosition(POS_FACEUP_ATTACK)",
        "Duel.SetTargetCard(bc)",
        "Duel.GetFirstTarget()",
        "Duel.SendtoDeck(tc,nil,SEQ_DECKTOP,REASON_EFFECT)",
        'eventName: "sentToDeck"',
        "reasonEffectId: 1",
      ],
    },
    {
      file: "test/lua-real-script-nubian-guard-battle-damage-grave-spell-decktop.test.ts",
      kind: "nubianGuardBattleDamageGraveSpellDeckTop",
      required: [
        'const nubianGuardCode = "51616747"',
        "restores battle-damage targeting of an own Graveyard Continuous Spell sent to Deck top",
        "Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil)",
        "Duel.SendtoDeck(tc,nil,SEQ_DECKTOP,REASON_EFFECT)",
        'eventName: "battleDamageDealt"',
        'eventName: "sentToDeck"',
        'location: "deck"',
        'location: "graveyard"',
        "nubianGuard.uid",
      ],
    },
    {
      file: "test/lua-real-script-adamancipator-leonite-grave-extra-decktop.test.ts",
      kind: "adamancipatorLeoniteGraveExtraDeckTop",
      required: [
        'const leoniteCode = "47897376"',
        "restores targeted FIRE Synchro leave-Grave to Extra Deck, self Deck-top return, and deck-top confirmation",
        "Duel.GetFirstTarget()",
        "Duel.SendtoDeck(tc,nil,SEQ_DECKTOP,REASON_EFFECT)",
        "Duel.ConfirmDecktop(tp,1)",
        'eventName: "confirmed"',
        "confirmed decktop 0",
      ],
    },
    {
      file: "test/lua-real-script-des-feral-imp-flip-grave-to-deck.test.ts",
      kind: "desFeralImpFlipGraveTargetShuffleToDeck",
      required: [
        'const impCode = "81985784"',
        "restores its Flip target and shuffles an own Graveyard card into the Deck",
        "Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil)",
        "Duel.SendtoDeck(tc,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)",
        'eventName: "sentToDeck"',
        "location: \"deck\"",
        "des feral imp responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-crimson-sentry-self-tribute-battle-to-deck.test.ts",
      kind: "crimsonSentrySelfTributeBattleGraveToDeckBottom",
      required: [
        'const sentryCode = "28358902"',
        "moveDuelCard(session.state, battleTarget.uid, \"graveyard\", 0, duelReason.battle, 1).turnId = session.state.turn",
        "moveDuelCard(session.state, oldBattleDecoy.uid, \"graveyard\", 0, duelReason.battle, 1).turnId = session.state.turn - 1",
        "moveDuelCard(session.state, effectDecoy.uid, \"graveyard\", 0, duelReason.effect, 0).turnId = session.state.turn",
        "sequence: 1",
        "crimson sentry responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-outstanding-dog-marron-to-grave-shuffle.test.ts",
      kind: "outstandingDogMarronToGraveSelfShuffleToDeck",
      required: [
        'const marronCode = "11548522"',
        "restores its mandatory EVENT_TO_GRAVE trigger and shuffles itself from Graveyard into the Deck",
        "Duel.SetOperationInfo(0,CATEGORY_TODECK,e:GetHandler(),1,0,0)",
        "Duel.SendtoDeck(e:GetHandler(),nil,SEQ_DECKSHUFFLE,REASON_EFFECT)",
        'eventName: "sentToGraveyard"',
        'eventName: "sentToDeck"',
        "location: \"deck\"",
        "outstanding dog marron responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-black-rose-assault-reveal-shuffle-stat.test.ts",
      kind: "blackRoseAssaultRevealSelfShuffleToDeck",
      required: [
        'const assaultCode = "46985799"',
        "Cost.SelfReveal",
        "Duel.SendtoDeck(c,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)>0",
        'eventName: "confirmed"',
        'eventName: "sentToDeck"',
        "reasonEffectId: 4",
      ],
    },
    {
      file: "test/lua-real-script-volcanic-recharge-grave-shuffle.test.ts",
      kind: "volcanicRechargeFreeChainGraveShuffleToDeck",
      required: [
        'const rechargeCode = "33725271"',
        "restores free-chain Graveyard Volcanic monster targets and shuffles only valid cards into the Deck",
        "return c:IsSetCard(SET_VOLCANIC) and c:IsMonster() and c:IsAbleToDeck()",
        "Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,3,nil)",
        "eventUids: [volcanicOne.uid, volcanicTwo.uid]",
        'location: "deck"',
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-majespecter-storm-release-to-deck.test.ts",
      kind: "majespecterStormReleaseTargetShuffleToDeck",
      required: [
        'const stormCode = "13972452"',
        "return c:IsRace(RACE_SPELLCASTER) and c:IsAttribute(ATTRIBUTE_WIND)",
        "Duel.CheckReleaseGroupCost(tp,s.cfilter,1,false,aux.ReleaseCheckTarget,nil,dg)",
        "Duel.SelectTarget(tp,Card.IsAbleToDeck,tp,0,LOCATION_MZONE,1,1,nil)",
        "reason: duelReason.release | duelReason.cost",
        "operationInfos: [{ category: 0x10",
        'eventName: "sentToDeck"',
        'location: "deck"',
        "majespecter storm responder resolved",
      ],
    },
  ];
}

function countToDeckSemanticVariants(fixtures: Array<{ kind: ToDeckSemanticVariant }>): Record<ToDeckSemanticVariant, number> {
  return fixtures.reduce<Record<ToDeckSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      adamancipatorLeoniteGraveExtraDeckTop: 0,
      crimsonSentrySelfTributeBattleGraveToDeckBottom: 0,
      desFeralImpFlipGraveTargetShuffleToDeck: 0,
      majespecterStormReleaseTargetShuffleToDeck: 0,
      nubianGuardBattleDamageGraveSpellDeckTop: 0,
      outstandingDogMarronToGraveSelfShuffleToDeck: 0,
      blackRoseAssaultRevealSelfShuffleToDeck: 0,
      wingedSageFalcosBattleDestroyingDeckTop: 0,
      volcanicRechargeFreeChainGraveShuffleToDeck: 0,
    },
  );
}
