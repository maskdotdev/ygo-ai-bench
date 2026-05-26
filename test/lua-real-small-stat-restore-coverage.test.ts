import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const smallStatKindCounts = {
  armoredBeeCurrentAttackHalfFinalStat: 1,
  bayonaterOpponentCountAttackDrop: 1,
  dartonGroupDifferenceBaseAttack: 1,
  dreadscytheHarvesterInsectReleaseAttackGain: 1,
  flamvellBabyHandCostAttackGain: 1,
  heroicChampionExcaliburDetachFinalAttack: 1,
  hurricaneSynchroCopyFinalStat: 1,
  kayennGraveSelfBanishLavalGroupAttackGain: 1,
  littleSwordsmanGenericReleaseAttackGain: 1,
  marincessSeaStarHandCostAttackGain: 1,
  mistValleyShamanReturnCostAttackGain: 1,
  muzurhythmDetachDjinnFinalAttack: 1,
  nightPapilloperativeOverlayCountAttackGain: 1,
  piercingMorayReleasePierceAttackGain: 1,
  secondBoosterSelfTributeAttackGain: 1,
  treeOtterBeastGatedAttackGain: 1,
} satisfies Record<SmallStatKind, number>;
type SmallStatKind = "armoredBeeCurrentAttackHalfFinalStat" | "bayonaterOpponentCountAttackDrop" | "dartonGroupDifferenceBaseAttack" | "dreadscytheHarvesterInsectReleaseAttackGain" | "flamvellBabyHandCostAttackGain" | "heroicChampionExcaliburDetachFinalAttack" | "hurricaneSynchroCopyFinalStat" | "kayennGraveSelfBanishLavalGroupAttackGain" | "littleSwordsmanGenericReleaseAttackGain" | "marincessSeaStarHandCostAttackGain" | "mistValleyShamanReturnCostAttackGain" | "muzurhythmDetachDjinnFinalAttack" | "nightPapilloperativeOverlayCountAttackGain" | "piercingMorayReleasePierceAttackGain" | "secondBoosterSelfTributeAttackGain" | "treeOtterBeastGatedAttackGain";

describe("Lua real small stat restore coverage", () => {
  it("keeps Armored Bee's current-ATK half final stat restore owned", () => {
    const file = "test/lua-real-script-armored-bee-target-half-attack-stat.test.ts";
    const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
    expectCleanRestoreEvidence(text);
    for (const snippet of [
      'const armoredBeeCode = "86915847"',
      "Armored Bee",
      "restores opponent face-up target into final ATK half of current ATK",
      "Duel.IsExistingTarget(Card.IsFaceup,tp,0,LOCATION_MZONE,1,nil)",
      "Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)",
      "e1:SetCode(EFFECT_SET_ATTACK_FINAL)",
      "e1:SetReset(RESETS_STANDARD_PHASE_END)",
      "e1:SetValue(tc:GetAttack()/2)",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === opponentTarget.uid), restored.session.state)).toBe(1100)",
      "effectSetAttackFinal",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Bayonater's opponent-count ATK drop restore owned", () => {
    const file = "test/lua-real-script-bayonater-opponent-count-attack-drop.test.ts";
    const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
    expectCleanRestoreEvidence(text);
    for (const snippet of [
      'const bayonaterCode = "47474172"',
      "Bayonater, the Baneful Barrel",
      "restores opponent face-up target into ATK loss based on opponent monster count",
      "Duel.SelectTarget(tp,Card.IsFaceup,tp,0,LOCATION_MZONE,1,1,nil)",
      "Duel.GetFieldGroupCount(tp,0,LOCATION_MZONE)*1000",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetValue(-atk)",
      "e1:SetReset(RESET_EVENT|RESETS_STANDARD)",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === opponentTarget.uid), restored.session.state)).toBe(600)",
      "effectUpdateAttack",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Tree Otter's Beast-gated target ATK gain restore owned", () => {
    const file = "test/lua-real-script-tree-otter-beast-condition-attack-stat.test.ts";
    const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
    expectCleanRestoreEvidence(text);
    for (const snippet of [
      'const otterCode = "71759912"',
      "Tree Otter",
      "restores Beast-gated same-field target into temporary ATK gain",
      "Duel.IsExistingMatchingCard(aux.FaceupFilter(Card.IsRace,RACE_BEAST),tp,LOCATION_MZONE,0,1,e:GetHandler())",
      "Duel.SelectTarget(tp,Card.IsFaceup,tp,LOCATION_MZONE,0,1,1,nil)",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetValue(1000)",
      "e1:SetReset(RESETS_STANDARD_PHASE_END)",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === otter.uid), restored.session.state)).toBe(2200)",
      "effectUpdateAttack",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Flamvell Baby's hand-cost FIRE ATK gain restore owned", () => {
    const file = "test/lua-real-script-flamvell-baby-hand-cost-attack-stat.test.ts";
    const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
    expectCleanRestoreEvidence(text);
    for (const snippet of [
      'const babyCode = "13761956"',
      "Flamvell Baby",
      "restores hand self-send cost into targeted FIRE monster ATK update",
      "e1:SetRange(LOCATION_HAND)",
      "Duel.SendtoGrave(e:GetHandler(),REASON_COST)",
      "return c:IsFaceup() and c:IsAttribute(ATTRIBUTE_FIRE)",
      "Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetValue(400)",
      "e1:SetReset(RESET_EVENT|RESETS_STANDARD)",
      "reasonEffectId: 1",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === fireTarget.uid), restored.session.state)).toBe(1900)",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Darton's group ATK-difference base ATK restore owned", () => {
    const file = "test/lua-real-script-darton-group-difference-base-attack.test.ts";
    const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
    expectCleanRestoreEvidence(text);
    for (const snippet of [
      'const dartonCode = "86271510"',
      "Darton the Mechanical Monstrosity",
      "restores fieldwide current/base ATK differences into its original ATK",
      "return c:IsFaceup() and not c:IsAttack(c:GetBaseAttack())",
      "Duel.GetMatchingGroup(s.atkfilter,tp,LOCATION_MZONE,LOCATION_MZONE,nil)",
      "sum=sum+(math.abs(tc:GetBaseAttack()-tc:GetAttack()))",
      "e1:SetCode(EFFECT_SET_BASE_ATTACK)",
      "e1:SetValue(sum)",
      "e1:SetReset(RESETS_STANDARD_PHASE_END|RESET_OPPO_TURN,1)",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === darton.uid), restored.session.state)).toBe(800)",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === boostedAlly.uid), restored.session.state)).toBe(1900)",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === weakenedOpponent.uid), restored.session.state)).toBe(1700)",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === unchangedOpponent.uid), restored.session.state)).toBe(1200)",
      "effectSetBaseAttack",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Dreadscythe Harvester's Insect release ATK gain restore owned", () => {
    const file = "test/lua-real-script-dreadscythe-harvester-insect-release-attack-stat.test.ts";
    const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
    expectCleanRestoreEvidence(text);
    for (const snippet of [
      'const harvesterCode = "66973070"',
      "Dreadscythe Harvester",
      "restores Card.IsRace release cost into self ATK gain",
      "Duel.CheckReleaseGroupCost(tp,Card.IsRace,1,false,nil,e:GetHandler(),RACE_INSECT)",
      "Duel.SelectReleaseGroupCost(tp,Card.IsRace,1,1,false,nil,e:GetHandler(),RACE_INSECT)",
      "Duel.Release(sg,REASON_COST)",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetValue(500)",
      "e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)",
      "reasonEffectId: 1",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === harvester.uid), restored.session.state)).toBe(2800)",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Blackwing Hurricane's Synchro target final ATK copy restore owned", () => {
    const file = "test/lua-real-script-blackwing-hurricane-synchro-copy-final-stat.test.ts";
    const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
    expectCleanRestoreEvidence(text);
    for (const snippet of [
      'const hurricaneCode = "36442179"',
      "Blackwing - Hurricane the Tornado",
      "restores a face-up Synchro target into the source monster final ATK",
      "return c:IsFaceup() and c:IsType(TYPE_SYNCHRO)",
      "Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,LOCATION_MZONE,1,1,nil)",
      "e1:SetCode(EFFECT_SET_ATTACK_FINAL)",
      "e1:SetValue(tc:GetAttack())",
      "e1:SetReset(RESETS_STANDARD_PHASE_END)",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === hurricane.uid), restored.session.state)).toBe(2600)",
      "effectSetAttackFinal",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Heroic Champion Excalibur's detach final ATK restore owned", () => {
    const file = "test/lua-real-script-heroic-champion-excalibur-detach-final-attack.test.ts";
    const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
    expectCleanRestoreEvidence(text);
    for (const snippet of [
      'const excaliburCode = "60645181"',
      "Heroic Champion - Excalibur",
      "restores Xyz metadata and two-material detach cost into doubled final ATK",
      "Xyz.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsRace,RACE_WARRIOR),4,2)",
      "e1:SetCost(Cost.DetachFromSelf(2))",
      "e1:SetCode(EFFECT_SET_ATTACK_FINAL)",
      "e1:SetValue(c:GetBaseAttack()*2)",
      "e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END,2)",
      "reasonEffectId: 3",
      "overlayUids).toEqual([])",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === excalibur.uid), restored.session.state)).toBe(4000)",
      "effectSetAttackFinal",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Marincess Sea Star's hand-cost Marincess ATK gain restore owned", () => {
    const file = "test/lua-real-script-marincess-sea-star-hand-cost-attack-stat.test.ts";
    const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
    expectCleanRestoreEvidence(text);
    for (const snippet of [
      'const seaStarCode = "62886670"',
      "Marincess Sea Star",
      "restores SelfToGrave hand cost and operation info into targeted Marincess ATK boost",
      "e1:SetRange(LOCATION_HAND)",
      "e1:SetCountLimit(2,id)",
      "e1:SetCost(Cost.SelfToGrave)",
      "s.listed_series={SET_MARINCESS}",
      "return c:IsFaceup() and c:IsSetCard(SET_MARINCESS)",
      "Duel.SelectTarget(tp,s.filter,tp,LOCATION_MZONE,0,1,1,nil)",
      "Duel.SetOperationInfo(0,CATEGORY_ATKCHANGE,g,1,tp,800)",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetValue(800)",
      "e1:SetReset(RESETS_STANDARD_PHASE_END)",
      "reasonEffectId: 1",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === marincessTarget.uid), restored.session.state)).toBe(2300)",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps The Little Swordsman of Aile's generic release ATK gain restore owned", () => {
    const file = "test/lua-real-script-little-swordsman-generic-release-attack-stat.test.ts";
    const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
    expectCleanRestoreEvidence(text);
    for (const snippet of [
      'const swordsmanCode = "25109950"',
      "The Little Swordsman of Aile",
      "restores unfiltered release cost into self ATK gain",
      "Duel.CheckReleaseGroupCost(tp,nil,1,false,nil,e:GetHandler())",
      "Duel.SelectReleaseGroupCost(tp,nil,1,1,false,nil,e:GetHandler())",
      "Duel.Release(g,REASON_COST)",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetValue(700)",
      "e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)",
      "reasonEffectId: 1",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === swordsman.uid), restored.session.state)).toBe(1500)",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Kayenn's grave self-banish Laval group ATK gain restore owned", () => {
    const file = "test/lua-real-script-kayenn-grave-self-banish-laval-group-stat.test.ts";
    const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
    expectCleanRestoreEvidence(text);
    for (const snippet of [
      'const kayennCode = "51554871"',
      "Kayenn, the Master Magma Blacksmith",
      "restores grave SelfBanish cost into all face-up Laval ATK gains",
      "e1:SetRange(LOCATION_GRAVE)",
      "e1:SetCost(Cost.SelfBanish)",
      "return c:IsFaceup() and c:IsSetCard(SET_LAVAL)",
      "Duel.GetMatchingGroup(s.filter,tp,LOCATION_MZONE,0,nil)",
      "for tc in aux.Next(g) do",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetValue(400)",
      "e1:SetReset(RESET_EVENT|RESETS_STANDARD)",
      "reasonEffectId: 1",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === firstLaval.uid), restored.session.state)).toBe(1900)",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === secondLaval.uid), restored.session.state)).toBe(2100)",
      "eventName: \"banished\"",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Mist Valley Shaman's return-cost ATK gain restore owned", () => {
    const file = "test/lua-real-script-mist-valley-shaman-return-cost-attack-stat.test.ts";
    const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
    expectCleanRestoreEvidence(text);
    for (const snippet of [
      'const shamanCode = "95443805"',
      "Mist Valley Shaman",
      "restores selected return-to-hand cost into self ATK gain",
      "Duel.IsExistingMatchingCard(Card.IsAbleToHandAsCost,tp,LOCATION_MZONE,0,1,e:GetHandler())",
      "Duel.SelectMatchingCard(tp,Card.IsAbleToHandAsCost,tp,LOCATION_MZONE,0,1,1,e:GetHandler())",
      "Duel.SendtoHand(g,nil,REASON_COST)",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetValue(500)",
      "e1:SetReset(RESETS_STANDARD_DISABLE_PHASE_END)",
      "reasonEffectId: 1",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === shaman.uid), restored.session.state)).toBe(1700)",
      "eventName: \"sentToHand\"",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Night Papilloperative's overlay-count ATK gain restore owned", () => {
    const file = "test/lua-real-script-night-papilloperative-detach-overlay-count-stat.test.ts";
    const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
    expectCleanRestoreEvidence(text);
    for (const snippet of [
      'const papilloperativeCode = "2191144"',
      "Night Papilloperative",
      "restores detach cost into ATK gain based on remaining overlay count",
      "Xyz.AddProcedure(c,nil,4,3)",
      "e1:SetCost(Cost.DetachFromSelf(1))",
      "if chk==0 then return Duel.GetOverlayCount(tp,1,1)>1 end",
      "local ct=Duel.GetOverlayCount(tp,1,1)",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetValue(ct*300)",
      "e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)",
      "reasonEffectId: 2",
      "overlayUids).toEqual([secondMaterial.uid, thirdMaterial.uid])",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === papilloperative.uid), restored.session.state)).toBe(3200)",
      "value: 600",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Muzurhythm's Damage Step detach final ATK restore owned", () => {
    const file = "test/lua-real-script-muzurhythm-detach-djinn-final-attack.test.ts";
    const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
    expectCleanRestoreEvidence(text);
    for (const snippet of [
      'const muzurhythmCode = "26563200"',
      "Muzurhythm the String Djinn",
      "restores Damage Step Djinn Xyz detach into attacker final ATK doubling",
      "Xyz.AddProcedure(c,nil,3,2)",
      "if ph~=PHASE_DAMAGE or Duel.IsDamageCalculated() then return false end",
      "tc:IsControler(tp) and tc:IsRelateToBattle() and tc:IsSetCard(SET_DJINN) and tc:IsType(TYPE_XYZ)",
      "e1:SetCost(Cost.DetachFromSelf(1))",
      "e1:SetCode(EFFECT_SET_ATTACK_FINAL)",
      "e1:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)",
      "e1:SetValue(tc:GetAttack()*2)",
      "reasonEffectId: 2",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === muzurhythm.uid), restored.session.state)).toBe(3000)",
      "eventName: \"detachedMaterial\"",
      "battleDamage[1]).toBe(1800)",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Piercing Moray's race-gated release pierce stat restore owned", () => {
    const file = "test/lua-real-script-piercing-moray-release-pierce-stat.test.ts";
    const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
    expectCleanRestoreEvidence(text);
    for (const snippet of [
      'const morayCode = "69846323"',
      "Piercing Moray",
      "restores race-gated release cost into self ATK gain while preserving pierce",
      "e1:SetCost(s.cost)",
      "e2:SetCode(EFFECT_PIERCE)",
      "return c:IsRace(RACE_FISH|RACE_AQUA|RACE_SEASERPENT)",
      "Duel.CheckReleaseGroupCost(tp,s.cfilter,1,false,nil,e:GetHandler())",
      "Duel.SelectReleaseGroupCost(tp,s.cfilter,1,1,false,nil,e:GetHandler())",
      "Duel.Release(sg,REASON_COST)",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetValue(600)",
      "e1:SetReset(RESET_EVENT|RESETS_STANDARD_DISABLE)",
      "reasonEffectId: 1",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === moray.uid), restored.session.state)).toBe(2100)",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Second Booster's self-tribute ATK gain restore owned", () => {
    const file = "test/lua-real-script-second-booster-self-tribute-attack-stat.test.ts";
    const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
    expectCleanRestoreEvidence(text);
    for (const snippet of [
      'const boosterCode = "88032368"',
      "Second Booster",
      "restores SelfTribute cost into face-up attack-position target ATK gain",
      "e1:SetCost(Cost.SelfTribute)",
      "Duel.IsExistingTarget(Card.IsPosition,tp,LOCATION_MZONE,0,1,e:GetHandler(),POS_FACEUP_ATTACK)",
      "Duel.SelectTarget(tp,Card.IsPosition,tp,LOCATION_MZONE,0,1,1,nil,POS_FACEUP_ATTACK)",
      "tc:IsRelateToEffect(e) and tc:IsPosition(POS_FACEUP_ATTACK)",
      "e1:SetCode(EFFECT_UPDATE_ATTACK)",
      "e1:SetValue(1500)",
      "e1:SetReset(RESETS_STANDARD_PHASE_END)",
      "reasonEffectId: 1",
      "currentAttack(restored.session.state.cards.find((card) => card.uid === attackTarget.uid), restored.session.state)).toBe(3100)",
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps small stat fixture kinds explicit", () => {
    expect(smallStatKindCounts).toEqual({
      armoredBeeCurrentAttackHalfFinalStat: 1,
      bayonaterOpponentCountAttackDrop: 1,
      dartonGroupDifferenceBaseAttack: 1,
      dreadscytheHarvesterInsectReleaseAttackGain: 1,
      flamvellBabyHandCostAttackGain: 1,
      heroicChampionExcaliburDetachFinalAttack: 1,
      hurricaneSynchroCopyFinalStat: 1,
      kayennGraveSelfBanishLavalGroupAttackGain: 1,
      littleSwordsmanGenericReleaseAttackGain: 1,
      marincessSeaStarHandCostAttackGain: 1,
      mistValleyShamanReturnCostAttackGain: 1,
      muzurhythmDetachDjinnFinalAttack: 1,
      nightPapilloperativeOverlayCountAttackGain: 1,
      piercingMorayReleasePierceAttackGain: 1,
      secondBoosterSelfTributeAttackGain: 1,
      treeOtterBeastGatedAttackGain: 1,
    });
  });
});

function expectCleanRestoreEvidence(text: string): void {
  expect(text.includes("restoreDuelWithLuaScripts")).toBe(true);
  expect(text.includes("restoreComplete")).toBe(true);
  expect(text.includes('incompleteReasons.join("; ")')).toBe(true);
  expect(text.includes("missingRegistryKeys).toEqual([])")).toBe(true);
  expect(text.includes("missingChainLimitRegistryKeys).toEqual([])")).toBe(true);
  expect(text.includes("getLuaRestoreLegalActions")).toBe(true);
  expect(text.includes("getLuaRestoreLegalActionGroups")).toBe(true);
  expect(text.includes("getGroupedDuelLegalActions")).toBe(true);
}
