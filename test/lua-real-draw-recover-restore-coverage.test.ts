import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const DRAW_RECOVER_FIXTURE_COUNT = 29;
const drawRecoverKindCounts = {
  costBanishDraw: 3,
  diceDraw: 1,
  costDiscardDraw: 1,
  costGraveDraw: 1,
  drawRecoverOrDamage: 2,
  drawTrigger: 15,
  handToDeckDraw: 1,
  negateThenDraw: 1,
  overlayDetachDraw: 1,
  recoverTrigger: 2,
  releaseDestroyDraw: 1,
} satisfies Record<DrawRecoverKind, number>;
const drawRecoverSemanticVariantCounts = {
  badReactionDrawThenDamage: 1,
  amritaraDestroyedSelectToDeckDraw: 1,
  cardSafeReturnGraveSpecialDraw: 1,
  darkBribeNegateDestroyDraw: 1,
  darkStringsCounterDestroyDrawDamage: 1,
  blizzedBattleDestroyedDraw: 1,
  darkseaFloatDestroyedToGraveDraw: 1,
  darkseaRescueSynchroMaterialDraw: 1,
  damageMageEventDamageSummonRecover: 1,
  ectoplasmicFortificationSelectStatDraw: 1,
  flowerCardianCurtainRevealDrawSummon: 1,
  orgothTripleDiceDrawDirect: 1,
  geminiSparkReleaseDestroyDraw: 1,
  morayGreedHandToDeckDraw: 1,
  morayAvariceFieldBanishDraw: 1,
  kujiKiriLevel9GraveDraw: 1,
  magmachoDragonDestroyedSummonDrawRedirect: 1,
  maskedSorcererBattleDamageDraw: 1,
  naturiaRagweedOpponentDrawTrigger: 1,
  potDesiresFaceDownDeckCostDraw: 1,
  potExtravaganceRandomExtraCostDrawLock: 1,
  sacredCraneSelfSpecialDraw: 1,
  secondExpeditionDangerGraveToDeckDraw: 1,
  shinobirdCraneSpiritSummonDraw: 1,
  skullMarkLadybugToGraveRecover: 1,
  tradeInLevel8DiscardDraw: 1,
  upstartGoblinDrawRecover: 1,
  uradoraTargetBoostBattleDrawRecover: 1,
  ufolightEndDrawBanishStat: 1,
  xyzGiftOverlayDetachDraw: 1,
} satisfies Record<DrawRecoverSemanticVariant, number>;

type DrawRecoverKind = "costBanishDraw" | "costDiscardDraw" | "costGraveDraw" | "diceDraw" | "drawRecoverOrDamage" | "drawTrigger" | "handToDeckDraw" | "negateThenDraw" | "overlayDetachDraw" | "recoverTrigger" | "releaseDestroyDraw";

type DrawRecoverSemanticVariant =
  | "badReactionDrawThenDamage"
  | "amritaraDestroyedSelectToDeckDraw"
  | "cardSafeReturnGraveSpecialDraw"
  | "darkBribeNegateDestroyDraw"
  | "darkStringsCounterDestroyDrawDamage"
  | "blizzedBattleDestroyedDraw"
  | "darkseaFloatDestroyedToGraveDraw"
  | "darkseaRescueSynchroMaterialDraw"
  | "damageMageEventDamageSummonRecover"
  | "ectoplasmicFortificationSelectStatDraw"
  | "flowerCardianCurtainRevealDrawSummon"
  | "orgothTripleDiceDrawDirect"
  | "geminiSparkReleaseDestroyDraw"
  | "kujiKiriLevel9GraveDraw"
  | "magmachoDragonDestroyedSummonDrawRedirect"
  | "morayGreedHandToDeckDraw"
  | "morayAvariceFieldBanishDraw"
  | "maskedSorcererBattleDamageDraw"
  | "naturiaRagweedOpponentDrawTrigger"
  | "potDesiresFaceDownDeckCostDraw"
  | "potExtravaganceRandomExtraCostDrawLock"
  | "sacredCraneSelfSpecialDraw"
  | "secondExpeditionDangerGraveToDeckDraw"
  | "shinobirdCraneSpiritSummonDraw"
  | "skullMarkLadybugToGraveRecover"
  | "tradeInLevel8DiscardDraw"
  | "upstartGoblinDrawRecover"
  | "uradoraTargetBoostBattleDrawRecover"
  | "ufolightEndDrawBanishStat"
  | "xyzGiftOverlayDetachDraw";

describe("Lua real draw and recover restore coverage", () => {
  it("requires draw/recover fixtures to assert clean Lua registry restore and restored event outcomes", () => {
    const files = drawRecoverFixtureFiles();
    expect(files).toHaveLength(DRAW_RECOVER_FIXTURE_COUNT);

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
          || (!text.includes('eventName: "cardsDrawn"') && !text.includes('eventName: "recoveredLifePoints"'))
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps draw/recover fixture kinds explicit", () => {
    expect(countDrawRecoverKinds(drawRecoverFixtureFiles())).toEqual(drawRecoverKindCounts);
  });

  it("keeps named draw/recover semantic variants explicit", () => {
    expect(countDrawRecoverSemanticVariants(drawRecoverSemanticVariants())).toEqual(drawRecoverSemanticVariantCounts);

    const weak = drawRecoverSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function drawRecoverFixtureFiles(): Array<{
  file: string;
  kind: DrawRecoverKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-bad-reaction-reverse-recover.test.ts",
      kind: "drawRecoverOrDamage",
      required: [
        'eventName: "cardsDrawn"',
        'eventName: "damageDealt"',
        "targetPlayer: 0",
        "targetParam: 1",
        "category: 0x100000",
        "players[1].lifePoints).toBe(7000)",
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-damage-mage-event-damage-summon-recover.test.ts",
      kind: "recoverTrigger",
      required: [
        "CATEGORY_SPECIAL_SUMMON+CATEGORY_RECOVER",
        "e1:SetCode(EVENT_DAMAGE)",
        "Duel.SetOperationInfo(0,CATEGORY_RECOVER,nil,0,tp,ev)",
        "operationInfos",
        'eventName: "specialSummoned"',
        'eventName: "recoveredLifePoints"',
        "lifePoints).toBe(8000)",
      ],
    },
    {
      file: "test/lua-real-script-dark-bribe-negate-draw.test.ts",
      kind: "negateThenDraw",
      required: [
        'eventName: "cardsDrawn"',
        'eventName: "chainNegated"',
        'eventName: "chainDisabled"',
        "category: 65536",
        'location: "graveyard"',
        'location: "hand", controller: 0',
        'recoveredLifePoints")).toEqual([])',
      ],
    },
    {
      file: "test/lua-real-script-darksea-float-to-grave-draw.test.ts",
      kind: "drawTrigger",
      required: [
        'eventName: "destroyed"',
        'eventName: "cardsDrawn"',
        "targetPlayer: 0",
        "targetParam: 1",
        "category: 0x10000",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
        'location: "graveyard"',
        'location: "hand", controller: 0',
      ],
    },
    {
      file: "test/lua-real-script-amritara-destroyed-select-todeck-draw.test.ts",
      kind: "drawTrigger",
      required: [
        'eventName: "destroyed"',
        'eventName: "sentToDeck"',
        'eventName: "cardsDrawn"',
        "Duel.SetTargetCard(g)",
        "Duel.SelectEffect(tp,",
        "Duel.SetOperationInfo(0,CATEGORY_TODECK,g,1,0,0)",
        "Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)",
        "Duel.SendtoDeck(tc,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)",
        "Duel.Draw(tp,1,REASON_EFFECT)",
        "operationInfos",
      ],
    },
    {
      file: "test/lua-real-script-flower-cardian-curtain-reveal-draw-summon.test.ts",
      kind: "drawTrigger",
      required: [
        'eventName: "cardsDrawn"',
        'eventName: "confirmed"',
        'eventName: "specialSummoned"',
        "e1:SetCost(Cost.SelfReveal)",
        "Duel.GetOperatedGroup():GetFirst()",
        "Duel.ConfirmCards(1-tp,dc)",
        "Duel.SpecialSummon(c,0,tp,tp,true,false,POS_FACEUP)",
        "Duel.ShuffleHand(tp)",
        "operationInfos",
      ],
    },
    {
      file: "test/lua-real-script-magmacho-dragon-destroyed-summon-draw-redirect.test.ts",
      kind: "drawTrigger",
      required: [
        'eventName: "destroyed"',
        'eventName: "specialSummoned"',
        'eventName: "breakEffect"',
        'eventName: "cardsDrawn"',
        "Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,tp,0)",
        "Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)",
        "Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)>0",
        "EFFECT_LEAVE_FIELD_REDIRECT",
        "Duel.BreakEffect()",
        "Duel.Draw(tp,1,REASON_EFFECT)",
        "operationInfos",
      ],
    },
    {
      file: "test/lua-real-script-second-expedition-danger-grave-todeck-draw.test.ts",
      kind: "drawTrigger",
      required: [
        'eventName: "discarded"',
        'eventName: "sentToDeck"',
        'eventName: "breakEffect"',
        'eventName: "cardsDrawn"',
        "Duel.DiscardHand(tp,s.costfilter,1,1,REASON_COST|REASON_DISCARD,nil)",
        "Duel.SetOperationInfo(0,CATEGORY_TODECK,e:GetHandler(),1,0,0)",
        "Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)",
        "Duel.SendtoDeck(c,nil,SEQ_DECKBOTTOM,REASON_EFFECT)",
        "Duel.BreakEffect()",
        "Duel.Draw(tp,1,REASON_EFFECT)",
        "operationInfos",
      ],
    },
    {
      file: "test/lua-real-script-darksea-rescue-synchro-material-draw.test.ts",
      kind: "drawTrigger",
      required: [
        'eventName: "usedAsMaterial"',
        'eventName: "cardsDrawn"',
        "e1:SetCode(EVENT_BE_MATERIAL)",
        "r==REASON_SYNCHRO",
        "Duel.SetTargetPlayer(tp)",
        "Duel.SetTargetParam(1)",
        "Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)",
        "operationInfos",
        "darksea rescue responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-gemini-spark-release-destroy-draw.test.ts",
      kind: "releaseDestroyDraw",
      required: [
        'eventName: "cardsDrawn"',
        'eventName: "released"',
        "category: 0x10000",
        "parameter: 1",
        'location: "graveyard"',
        'location: "hand", controller: 0',
        "gemini spark responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-moray-greed-hand-to-deck-draw.test.ts",
      kind: "handToDeckDraw",
      required: [
        'eventName: "cardsDrawn"',
        'eventName: "sentToDeck"',
        'eventName: "confirmed"',
        "category: 0x10",
        "category: 0x10000",
        "Duel.ConfirmCards(1-p,sg)",
        "Duel.SendtoDeck(sg,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)",
        "Duel.Draw(p,3,REASON_EFFECT)",
      ],
    },
    {
      file: "test/lua-real-script-orgoth-dice-draw-direct-stat.test.ts",
      kind: "diceDraw",
      required: [
        'const orgothCode = "15744417"',
        "restores triple dice into ATK/DEF gain, draw, protection, and direct attack permission",
        "Duel.SetOperationInfo(0,CATEGORY_DICE,nil,0,tp,3)",
        "Duel.Draw(tp,2,REASON_EFFECT)",
        'eventName: "diceTossed"',
        'eventName: "cardsDrawn"',
        "operationInfos",
        "lastDiceResults).toEqual([3, 3, 3])",
      ],
    },
    {
      file: "test/lua-real-script-moray-avarice-field-banish-draw.test.ts",
      kind: "costBanishDraw",
      required: [
        'eventName: "banished"',
        'eventName: "cardsDrawn"',
        "Duel.SelectMatchingCard(tp,s.drcostfilter,tp,LOCATION_MZONE,0,1,1,nil)",
        "Duel.Remove(g,POS_FACEUP,REASON_COST)",
        "Duel.SetTargetParam(2)",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
        "category: 0x10000",
        "targetParam: 2",
        'location: "banished"',
        'location: "hand", controller: 0',
      ],
    },
    {
      file: "test/lua-real-script-masked-sorcerer-battle-damage-draw.test.ts",
      kind: "drawTrigger",
      required: [
        'eventName: "battleDamageDealt"',
        'eventTriggerTiming: "when"',
        'eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 }',
        'eventName: "cardsDrawn"',
        "Duel.SetTargetPlayer(tp)",
        "Duel.SetTargetParam(1)",
        "Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
        "operationInfos",
        "masked sorcerer responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-blizzed-battle-destroyed-draw.test.ts",
      kind: "drawTrigger",
      required: [
        'eventName: "battleDestroyed"',
        'eventName: "cardsDrawn"',
        "Duel.SetTargetPlayer(tp)",
        "Duel.SetTargetParam(1)",
        "Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
        "opponentMandatory",
      ],
    },
    {
      file: "test/lua-real-script-card-safe-return-grave-special-draw.test.ts",
      kind: "drawTrigger",
      required: [
        'eventName: "specialSummoned"',
        'eventName: "cardsDrawn"',
        "Duel.SetTargetPlayer(tp)",
        "Duel.SetTargetParam(1)",
        "Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
        "targetPlayer: 0",
        "targetParam: 1",
        "operationInfos",
        "card of safe return responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-sacred-crane-special-summon-draw.test.ts",
      kind: "drawTrigger",
      required: [
        'eventName: "specialSummoned"',
        "effectId: \"lua-1-1102\"",
        "eventCode: eventSpecialSummonSuccess",
        'eventTriggerTiming: "when"',
        'triggerBucket: "turnMandatory"',
        'eventName: "cardsDrawn"',
        "e1:SetCode(EVENT_SPSUMMON_SUCCESS)",
        "Duel.SetTargetPlayer(tp)",
        "Duel.SetTargetParam(1)",
        "Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
        "operationInfos",
        "sacred crane responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-naturia-ragweed-event-draw-trigger.test.ts",
      kind: "drawTrigger",
      required: [
        'eventName: "cardsDrawn"',
        "targetPlayer: 1",
        "targetParam: 2",
        "category: 0x10000",
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-pot-of-desires-deck-cost.test.ts",
      kind: "costBanishDraw",
      required: [
        'eventName: "cardsDrawn"',
        "targetPlayer: 0",
        "targetParam: 2",
        "category: 65536",
        'location: "banished"',
        'location: "hand", controller: 0',
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-pot-of-extravagance-extra-cost.test.ts",
      kind: "costBanishDraw",
      required: [
        'eventName: "cardsDrawn"',
        "targetPlayer: 0",
        "targetParam: 1",
        "category: 65536",
        "randomCounter).toBe(1)",
        'location: "banished"',
        'location: "hand", controller: 0',
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-shinobird-crane-spirit-summon-draw.test.ts",
      kind: "drawTrigger",
      required: [
        'eventName: "normalSummoned"',
        "targetPlayer: 0",
        "targetParam: 1",
        "category: 0x10000",
        'location: "hand", controller: 0',
      ],
    },
    {
      file: "test/lua-real-script-skull-mark-ladybug-to-grave-recover.test.ts",
      kind: "recoverTrigger",
      required: [
        'eventName: "destroyed"',
        'eventName: "recoveredLifePoints"',
        "targetPlayer: 0",
        "targetParam: 1000",
        "category: 0x100000",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
        'location: "graveyard"',
        "lifePoints).toBe(7500)",
      ],
    },
    {
      file: "test/lua-real-script-trade-in-discard-draw.test.ts",
      kind: "costDiscardDraw",
      required: [
        'eventName: "discarded"',
        'eventName: "cardsDrawn"',
        "targetPlayer: 0",
        "targetParam: 2",
        "category: 0x10000",
        "duelReason.cost | duelReason.discard",
        'location: "graveyard"',
        'location: "hand", controller: 0',
      ],
    },
    {
      file: "test/lua-real-script-kuji-kiri-curse-level9-grave-draw.test.ts",
      kind: "costGraveDraw",
      required: [
        'eventName: "sentToGraveyard"',
        'eventName: "cardsDrawn"',
        "Duel.SelectMatchingCard(tp,s.filter,tp,LOCATION_HAND|LOCATION_MZONE,0,1,1,nil)",
        "Duel.SendtoGrave(g,REASON_COST)",
        "Duel.SetTargetParam(2)",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
        "category: 0x10000",
        "targetParam: 2",
        'location: "graveyard"',
        'location: "hand", controller: 0',
      ],
    },
    {
      file: "test/lua-real-script-upstart-goblin-draw-recover.test.ts",
      kind: "drawRecoverOrDamage",
      required: [
        "category: 0x10000",
        "category: 0x100000",
        'eventName: "recoveredLifePoints"',
        "players[1].lifePoints).toBe(9000)",
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-uradora-target-boost-battle-draw-recover.test.ts",
      kind: "drawTrigger",
      required: [
        'eventName: "cardsDrawn"',
        'eventName: "recoveredLifePoints"',
        'eventName: "confirmed"',
        "operationInfos",
        "Duel.SelectOption(tp,aux.Stringid(id,2),aux.Stringid(id,3))",
        "Duel.MoveSequence(tc,0)",
        "Duel.Draw(tp,math.floor(tc:GetAttack()/1000),REASON_EFFECT)",
        "Duel.Recover(tp,ct*1000,REASON_EFFECT)",
        "lifePoints).toBe(9000)",
      ],
    },
    {
      file: "test/lua-real-script-ufolight-end-draw-banish-stat-indestructible.test.ts",
      kind: "drawTrigger",
      required: [
        'eventName: "cardsDrawn"',
        'eventName: "banished"',
        "Duel.ShuffleHand(tp)",
        "Duel.SelectMatchingCard(tp,Card.IsAbleToRemove,tp,LOCATION_HAND,0,1,ct,nil)",
        "Duel.GetOperatedGroup():FilterCount(Card.IsLocation,nil,LOCATION_REMOVED)",
        "EFFECT_INDESTRUCTABLE_BATTLE",
        "currentAttack",
      ],
    },
    {
      file: "test/lua-real-script-ectoplasmic-fortification-select-stat-draw.test.ts",
      kind: "drawTrigger",
      required: [
        'eventName: "cardsDrawn"',
        "Duel.SelectEffect(tp,",
        "Duel.SelectYesNo(tp,aux.Stringid(id,3))",
        "Duel.GetMatchingGroupCount(aux.FaceupFilter(Card.IsCode,CARD_CALL_OF_THE_HAUNTED),tp,LOCATION_ONFIELD,0,nil)",
        "tc:UpdateAttack(400,RESET_EVENT|RESETS_STANDARD,c)",
        "currentAttack",
        "operationInfos",
      ],
    },
    {
      file: "test/lua-real-script-xyz-gift-overlay-draw.test.ts",
      kind: "overlayDetachDraw",
      required: [
        'eventName: "cardsDrawn"',
        'eventName: "detachedMaterial"',
        "category: 0x10000",
        "parameter: 2",
        "overlayUids: []",
        'location: "graveyard"',
        'location: "hand", controller: 0',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: DrawRecoverKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countDrawRecoverKinds(fixtures: Array<{ kind: DrawRecoverKind }>): Record<DrawRecoverKind, number> {
  return fixtures.reduce<Record<DrawRecoverKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      costBanishDraw: 0,
      costDiscardDraw: 0,
      costGraveDraw: 0,
      diceDraw: 0,
      drawRecoverOrDamage: 0,
      drawTrigger: 0,
      handToDeckDraw: 0,
      negateThenDraw: 0,
      overlayDetachDraw: 0,
      recoverTrigger: 0,
      releaseDestroyDraw: 0,
    },
  );
}

function drawRecoverSemanticVariants(): Array<{
  file: string;
  kind: DrawRecoverSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-bad-reaction-reverse-recover.test.ts",
      kind: "badReactionDrawThenDamage",
      required: [
        'const badReactionCode = "40633297"',
        "restores Bad Reaction to Simochi and converts Upstart Goblin recovery into damage",
        "targetRange: [0, 1]",
        "eventName: \"cardsDrawn\"",
        "eventName: \"damageDealt\"",
        "players[1].lifePoints).toBe(7000)",
      ],
    },
    {
      file: "test/lua-real-script-damage-mage-event-damage-summon-recover.test.ts",
      kind: "damageMageEventDamageSummonRecover",
      required: [
        'const damageMageCode = "50613779"',
        "restores effect-damage hand trigger into self Special Summon and event-value recovery",
        "return ep==tp and (r&REASON_EFFECT)~=0",
        "Duel.SpecialSummon(c,0,tp,tp,false,false,POS_FACEUP)",
        "Duel.Recover(tp,ev,REASON_EFFECT)",
        'eventName: "specialSummoned"',
        'eventName: "recoveredLifePoints"',
      ],
    },
    {
      file: "test/lua-real-script-amritara-destroyed-select-todeck-draw.test.ts",
      kind: "amritaraDestroyedSelectToDeckDraw",
      required: [
        'const amritaraCode = "62314831"',
        "restores destroyed group targeting into SelectEffect shuffle-into-Deck and draw branch",
        "e2:SetCode(EVENT_DESTROYED)",
        "Duel.SetTargetCard(g)",
        "Duel.SelectEffect(tp,",
        'eventName: "sentToDeck"',
        'eventName: "cardsDrawn"',
      ],
    },
    {
      file: "test/lua-real-script-flower-cardian-curtain-reveal-draw-summon.test.ts",
      kind: "flowerCardianCurtainRevealDrawSummon",
      required: [
        'const curtainCode = "5489987"',
        "restores SelfReveal hand ignition into draw, confirm, hand shuffle, and self Special Summon",
        "e1:SetCost(Cost.SelfReveal)",
        "Duel.SetPossibleOperationInfo(0,CATEGORY_SPECIAL_SUMMON,c,1,tp,0)",
        "Duel.GetOperatedGroup():GetFirst()",
        'eventName: "cardsDrawn"',
        'eventName: "specialSummoned"',
      ],
    },
    {
      file: "test/lua-real-script-dark-bribe-negate-draw.test.ts",
      kind: "darkBribeNegateDestroyDraw",
      required: [
        'const darkBribeCode = "77538567"',
        "restores activation negation that destroys the source, draws for the opponent, and suppresses the negated Spell",
        "category: 0x10000000",
        "eventName: \"chainNegated\"",
        "eventName: \"chainDisabled\"",
        "eventName === \"recoveredLifePoints\")).toEqual([])",
      ],
    },
    {
      file: "test/lua-real-script-dark-strings-counter-destroy-draw-damage.test.ts",
      kind: "darkStringsCounterDestroyDrawDamage",
      required: [
        'const darkStringsCode = "69170557"',
        "restores detach counter placement and Special Summon destroy-draw-damage trigger",
        "Duel.GetOperatedGroup():Filter(Card.IsLocation,nil,LOCATION_GRAVE)",
        "Duel.Draw(tp,1,REASON_EFFECT)",
        "Duel.BreakEffect()",
        "Duel.Damage(1-tp,matk,REASON_EFFECT)",
        'eventName: "cardsDrawn"',
        'eventName: "damageDealt"',
      ],
    },
    {
      file: "test/lua-real-script-darksea-float-to-grave-draw.test.ts",
      kind: "darkseaFloatDestroyedToGraveDraw",
      required: [
        'const darkseaFloatCode = "70054514"',
        "restores its destroyed-from-field EVENT_TO_GRAVE draw trigger and CHAININFO target parameter",
        "c:IsReason(REASON_DESTROY) and c:IsReason(REASON_EFFECT) and c:IsPreviousLocation(LOCATION_ONFIELD)",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
        "eventName: \"destroyed\"",
        "eventName: \"cardsDrawn\"",
        "darksea float responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-darksea-rescue-synchro-material-draw.test.ts",
      kind: "darkseaRescueSynchroMaterialDraw",
      required: [
        'const darkseaCode = "34659866"',
        "restores its Synchro material trigger into CHAININFO-targeted controller draw",
        "e1:SetCode(EVENT_BE_MATERIAL)",
        "r==REASON_SYNCHRO",
        "expect(restoredOpen.session.state.pendingTriggers).toEqual",
        'id: "trigger-4-1"',
        'effectId: "lua-1-1108"',
        "eventCode: eventBeMaterial",
        'eventTriggerTiming: "when"',
        'triggerBucket: "turnMandatory"',
        "eventName: \"usedAsMaterial\"",
        "eventName: \"cardsDrawn\"",
        "darksea rescue responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-gemini-spark-release-destroy-draw.test.ts",
      kind: "geminiSparkReleaseDestroyDraw",
      required: [
        'const sparkCode = "33846209"',
        "restores its Gemini release cost, target destruction, and draw",
        "eventName: \"released\"",
        "eventName: \"destroyed\"",
        "eventName: \"cardsDrawn\"",
        "gemini spark responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-ectoplasmic-fortification-select-stat-draw.test.ts",
      kind: "ectoplasmicFortificationSelectStatDraw",
      required: [
        'const fortificationCode = "16734927"',
        "restores SelectEffect Zombie ATK branch into optional Call of the Haunted-count draw",
        "e1:SetCountLimit(1,id,EFFECT_COUNT_CODE_OATH)",
        "Duel.SelectEffect(tp,",
        "Duel.SelectYesNo(tp,aux.Stringid(id,3))",
        'eventName: "cardsDrawn"',
        "currentAttack",
      ],
    },
    {
      file: "test/lua-real-script-moray-greed-hand-to-deck-draw.test.ts",
      kind: "morayGreedHandToDeckDraw",
      required: [
        'const morayCode = "22123627"',
        "restores confirmed WATER hand returns into shuffled Deck placement and a three-card draw",
        "Duel.SetOperationInfo(0,CATEGORY_TODECK,nil,2,tp,LOCATION_HAND)",
        "Duel.ConfirmCards(1-p,sg)",
        "Duel.BreakEffect()",
        "eventName: \"cardsDrawn\"",
      ],
    },
    {
      file: "test/lua-real-script-kuji-kiri-curse-level9-grave-draw.test.ts",
      kind: "kujiKiriLevel9GraveDraw",
      required: [
        'const kujiCode = "78543464"',
        "restores its Level 9 send-to-Grave cost into CHAININFO-targeted draw two",
        "c:IsLevel(9) and c:IsAbleToGraveAsCost()",
        "Duel.SendtoGrave(g,REASON_COST)",
        "eventName: \"sentToGraveyard\"",
        "eventName: \"cardsDrawn\"",
        "kuji-kiri curse responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-magmacho-dragon-destroyed-summon-draw-redirect.test.ts",
      kind: "magmachoDragonDestroyedSummonDrawRedirect",
      required: [
        'const magmachoCode = "50951254"',
        "Magmacho Dragon destroyed summon draw redirect",
        "EFFECT_FLAG2_CHECK_SIMULTANEOUS",
        "c:GetPreviousAttributeOnField()&ATTRIBUTE_FIRE>0",
        "eventReasonEffectId: 99",
        "property: 0x4000400",
        "duelReason.effect | duelReason.destroy | duelReason.redirect",
      ],
    },
    {
      file: "test/lua-real-script-second-expedition-danger-grave-todeck-draw.test.ts",
      kind: "secondExpeditionDangerGraveToDeckDraw",
      required: [
        'const expeditionCode = "52534264"',
        "Second Expedition into Danger grave to-Deck draw",
        "e2:SetCondition(aux.StatChangeDamageStepCondition)",
        "return c:IsSetCard(SET_DANGER) and c:IsMonster() and c:IsDiscardable()",
        "effectId.startsWith(\"lua-3\")",
        "eventReasonCardUid: expedition.uid",
      ],
    },
    {
      file: "test/lua-real-script-moray-avarice-field-banish-draw.test.ts",
      kind: "morayAvariceFieldBanishDraw",
      required: [
        'const morayCode = "73244186"',
        "restores its face-up Fish field banish cost into CHAININFO-targeted draw two",
        "c:IsFaceup() and c:IsRace(RACE_FISH|RACE_SEASERPENT|RACE_AQUA) and c:IsAbleToRemoveAsCost()",
        "Duel.Remove(g,POS_FACEUP,REASON_COST)",
        "eventName: \"banished\"",
        "eventName: \"cardsDrawn\"",
        "moray of avarice responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-masked-sorcerer-battle-damage-draw.test.ts",
      kind: "maskedSorcererBattleDamageDraw",
      required: [
        'const maskedSorcererCode = "10189126"',
        "restores its mandatory battle-damage trigger into CHAININFO-targeted controller draw",
        "e1:SetCode(EVENT_BATTLE_DAMAGE)",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
        "eventName: \"battleDamageDealt\"",
        'eventTriggerTiming: "when"',
        'eventPreviousState: { controller: 0, faceUp: false, location: "deck", position: "faceDown", sequence: 1 }',
        "eventName: \"cardsDrawn\"",
      ],
    },
    {
      file: "test/lua-real-script-blizzed-battle-destroyed-draw.test.ts",
      kind: "blizzedBattleDestroyedDraw",
      required: [
        'const blizzedCode = "60161788"',
        "restores its battle-destroyed Graveyard condition into CHAININFO-targeted controller draw",
        "e1:SetCode(EVENT_BATTLE_DESTROYED)",
        "e:GetHandler():IsLocation(LOCATION_GRAVE) and e:GetHandler():IsReason(REASON_BATTLE)",
        "eventName: \"battleDestroyed\"",
        "eventName: \"cardsDrawn\"",
      ],
    },
    {
      file: "test/lua-real-script-card-safe-return-grave-special-draw.test.ts",
      kind: "cardSafeReturnGraveSpecialDraw",
      required: [
        'const safeReturnCode = "57953380"',
        "restores its field Special Summon trigger into CHAININFO-targeted controller draw",
        "e2:SetCode(EVENT_SPSUMMON_SUCCESS)",
        "c:IsPreviousLocation(LOCATION_GRAVE) and c:IsPreviousControler(tp)",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
        "eventName: \"specialSummoned\"",
        "eventName: \"cardsDrawn\"",
      ],
    },
    {
      file: "test/lua-real-script-naturia-ragweed-event-draw-trigger.test.ts",
      kind: "naturiaRagweedOpponentDrawTrigger",
      required: [
        'const ragweedCode = "87649699"',
        "restores Naturia Ragweed's opponent-draw trigger, self cost, and CHAININFO draw count",
        "eventUids: [opponentDrawn!.uid, opponentDrawnSecond!.uid]",
        "targetParam: 2",
        "targetPlayer: 1",
        "eventReasonCardUid: giftOfGreed!.uid",
      ],
    },
    {
      file: "test/lua-real-script-pot-of-desires-deck-cost.test.ts",
      kind: "potDesiresFaceDownDeckCostDraw",
      required: [
        'const potCode = "35261759"',
        "restores Pot of Desires' face-down banished deck cost and draw operation",
        "costUids).toHaveLength(10)",
        "position: \"faceDownDefense\"",
        "eventReason: duelReason.cost",
        "eventUids: drawUids",
      ],
    },
    {
      file: "test/lua-real-script-pot-of-extravagance-extra-cost.test.ts",
      kind: "potExtravaganceRandomExtraCostDrawLock",
      required: [
        'const potCode = "49238328"',
        "restores Pot of Extravagance's random Extra Deck cost and draw lock",
        "randomCounter).toBe(1)",
        "eventUids.every((uid) => originalExtraUids.includes(uid))",
        "code === 25",
        "drawDuelCards(restored.session.state, 0, 1, \"Blocked effect draw\")).toBe(0)",
      ],
    },
    {
      file: "test/lua-real-script-sacred-crane-special-summon-draw.test.ts",
      kind: "sacredCraneSelfSpecialDraw",
      required: [
        'const sacredCraneCode = "30914564"',
        "restores its self Special Summon trigger into CHAININFO-targeted controller draw",
        "e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)",
        "e1:SetCode(EVENT_SPSUMMON_SUCCESS)",
        "effectId: \"lua-1-1102\"",
        "eventCode: eventSpecialSummonSuccess",
        "eventTriggerTiming: \"when\"",
        "triggerBucket: \"turnMandatory\"",
        "eventName: \"specialSummoned\"",
        "eventName: \"cardsDrawn\"",
        "sacred crane responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-shinobird-crane-spirit-summon-draw.test.ts",
      kind: "shinobirdCraneSpiritSummonDraw",
      required: [
        'const craneCode = "66815913"',
        "restores its field trigger when another Spirit monster is Summoned and draws 1 card",
        'eventName": "normalSummoned"',
        "targetParam: 1",
        "eventReasonCardUid: crane!.uid",
        "shinobird crane responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-orgoth-dice-draw-direct-stat.test.ts",
      kind: "orgothTripleDiceDrawDirect",
      required: [
        'const orgothCode = "15744417"',
        "restores triple dice into ATK/DEF gain, draw, protection, and direct attack permission",
        "Duel.Draw(tp,2,REASON_EFFECT)",
        'eventName: "cardsDrawn"',
        "players[1].lifePoints).toBe(8000 - (orgothData!.attack ?? 0) - 900)",
      ],
    },
    {
      file: "test/lua-real-script-skull-mark-ladybug-to-grave-recover.test.ts",
      kind: "skullMarkLadybugToGraveRecover",
      required: [
        'const ladybugCode = "64306248"',
        "restores its EVENT_TO_GRAVE recovery trigger and CHAININFO target parameter",
        "Duel.SetTargetParam(1000)",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
        "eventName: \"destroyed\"",
        "eventName: \"recoveredLifePoints\"",
        "skull-mark ladybug responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-trade-in-discard-draw.test.ts",
      kind: "tradeInLevel8DiscardDraw",
      required: [
        'const tradeInCode = "38120068"',
        "restores Trade-In's Level 8 discard cost, target-player draw metadata, and draw-two resolution",
        "Duel.DiscardHand(tp,s.filter,1,1,REASON_COST|REASON_DISCARD)",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
        "eventName: \"discarded\"",
        "eventName: \"cardsDrawn\"",
        "trade-in responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-upstart-goblin-draw-recover.test.ts",
      kind: "upstartGoblinDrawRecover",
      required: [
        'const upstartCode = "70368879"',
        "restores Upstart Goblin's draw/recover operation info and resolves both effects",
        "category: 1048576",
        "eventName: \"recoveredLifePoints\"",
        "players[1].lifePoints).toBe(9000)",
        "upstart goblin responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-uradora-target-boost-battle-draw-recover.test.ts",
      kind: "uradoraTargetBoostBattleDrawRecover",
      required: [
        'const uradoraCode = "27753563"',
        "restores LP-cost target boost into battle-destroying Deck-bottom draw and recovery",
        "e2:SetCode(EVENT_BATTLE_DESTROYING)",
        "Duel.MoveSequence(tc,0)",
        'eventName: "cardsDrawn"',
        'eventName: "recoveredLifePoints"',
        'triggerEvent: "battleDestroyed"',
      ],
    },
    {
      file: "test/lua-real-script-ufolight-end-draw-banish-stat-indestructible.test.ts",
      kind: "ufolightEndDrawBanishStat",
      required: [
        'const ufolightCode = "9275482"',
        "restores target protection, battle indestructibility, and End Phase draw-banish ATK gain",
        "e1:SetCode(EFFECT_CANNOT_BE_EFFECT_TARGET)",
        "e2:SetCode(EFFECT_INDESTRUCTABLE_BATTLE)",
        "e3:SetCode(EVENT_PHASE+PHASE_END)",
        'eventName: "cardsDrawn"',
        'eventName: "banished"',
      ],
    },
    {
      file: "test/lua-real-script-xyz-gift-overlay-draw.test.ts",
      kind: "xyzGiftOverlayDetachDraw",
      required: [
        'const xyzGiftCode = "72355441"',
        "restores Xyz Gift after detaching two Xyz materials and drawing two cards",
        'eventName: "detachedMaterial"',
        "eventUids: [secondDraw.uid, firstDraw.uid]",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: DrawRecoverSemanticVariant;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countDrawRecoverSemanticVariants(fixtures: Array<{ kind: DrawRecoverSemanticVariant }>): Record<DrawRecoverSemanticVariant, number> {
  return fixtures.reduce<Record<DrawRecoverSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      badReactionDrawThenDamage: 0,
      amritaraDestroyedSelectToDeckDraw: 0,
      blizzedBattleDestroyedDraw: 0,
      cardSafeReturnGraveSpecialDraw: 0,
      damageMageEventDamageSummonRecover: 0,
      darkBribeNegateDestroyDraw: 0,
      darkStringsCounterDestroyDrawDamage: 0,
      darkseaFloatDestroyedToGraveDraw: 0,
      darkseaRescueSynchroMaterialDraw: 0,
      ectoplasmicFortificationSelectStatDraw: 0,
      flowerCardianCurtainRevealDrawSummon: 0,
      geminiSparkReleaseDestroyDraw: 0,
      orgothTripleDiceDrawDirect: 0,
      kujiKiriLevel9GraveDraw: 0,
      magmachoDragonDestroyedSummonDrawRedirect: 0,
      morayGreedHandToDeckDraw: 0,
      morayAvariceFieldBanishDraw: 0,
      maskedSorcererBattleDamageDraw: 0,
      naturiaRagweedOpponentDrawTrigger: 0,
      potDesiresFaceDownDeckCostDraw: 0,
      potExtravaganceRandomExtraCostDrawLock: 0,
      sacredCraneSelfSpecialDraw: 0,
      secondExpeditionDangerGraveToDeckDraw: 0,
      shinobirdCraneSpiritSummonDraw: 0,
      skullMarkLadybugToGraveRecover: 0,
      tradeInLevel8DiscardDraw: 0,
      upstartGoblinDrawRecover: 0,
      uradoraTargetBoostBattleDrawRecover: 0,
      ufolightEndDrawBanishStat: 0,
      xyzGiftOverlayDetachDraw: 0,
    },
  );
}
