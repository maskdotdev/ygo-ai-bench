import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const EXTRA_ATTACK_FIXTURE_COUNT = 16;
const extraAttackKindCounts = {
  attackAll: 2,
  chainAttack: 3,
  chainFlagExtraAttack: 1,
  extraAttack: 6,
  monsterOnlyExtraAttack: 3,
  overlayCountMonsterExtraAttack: 1,
} satisfies Record<ExtraAttackKind, number>;
const extraAttackSemanticVariantCounts = {
  alienHunterBattleDestroyChainAttack: 1,
  ashuraKingOverlayCountExtraAttack: 1,
  asuraPriestSpiritAttackAllMonsters: 1,
  borrelswordPositionExtraAttackStat: 1,
  comboMasterChainFlagExtraAttack: 1,
  doubleOrNothingAttackDisabledExtraFinalStat: 1,
  elementDoomAttributeGatedChainAttack: 1,
  ghostBirdSequenceGatedMonsterOnlyExtraAttack: 1,
  hexeTrudeDestroyGrantMonsterOnlyExtraAttack: 1,
  hayabusaKnightStaticSecondDirectAttack: 1,
  hiSpeedroidChanbaraExtraBattleStatToHand: 1,
  juggernautLiebeOverlayCountMonsterExtraAttack: 1,
  machineLordUrAttackAllNoDirectAttack: 1,
  matazaControlLockStaticExtraAttack: 1,
  nitroWarriorPositionChangedChainAttack: 1,
  shootingcodeTalkerLinkedBattleStartMonsterOnlyExtraAttack: 1,
} satisfies Record<ExtraAttackSemanticVariant, number>;

type ExtraAttackKind = "attackAll" | "chainAttack" | "chainFlagExtraAttack" | "extraAttack" | "monsterOnlyExtraAttack" | "overlayCountMonsterExtraAttack";
type ExtraAttackSemanticVariant =
  | "alienHunterBattleDestroyChainAttack"
  | "ashuraKingOverlayCountExtraAttack"
  | "asuraPriestSpiritAttackAllMonsters"
  | "borrelswordPositionExtraAttackStat"
  | "comboMasterChainFlagExtraAttack"
  | "doubleOrNothingAttackDisabledExtraFinalStat"
  | "elementDoomAttributeGatedChainAttack"
  | "ghostBirdSequenceGatedMonsterOnlyExtraAttack"
  | "hexeTrudeDestroyGrantMonsterOnlyExtraAttack"
  | "hayabusaKnightStaticSecondDirectAttack"
  | "hiSpeedroidChanbaraExtraBattleStatToHand"
  | "juggernautLiebeOverlayCountMonsterExtraAttack"
  | "machineLordUrAttackAllNoDirectAttack"
  | "matazaControlLockStaticExtraAttack"
  | "nitroWarriorPositionChangedChainAttack"
  | "shootingcodeTalkerLinkedBattleStartMonsterOnlyExtraAttack";

describe("Lua real extra attack restore coverage", () => {
  it("requires representative multi-attack fixtures to assert clean Lua restore and replayed legal attacks", () => {
    const files = realScriptExtraAttackFixtureFiles();
    expect(files).toHaveLength(EXTRA_ATTACK_FIXTURE_COUNT);

    const missing = files
      .filter(({ file, kind, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("declareAttack")
          || (kind === "chainAttack" && (!text.includes("eventCode") || !text.includes("eventCardUid")))
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps extra-attack fixture kinds explicit", () => {
    expect(countExtraAttackKinds(realScriptExtraAttackFixtureFiles())).toEqual(extraAttackKindCounts);
  });

  it("keeps named extra-attack semantic variants explicit", () => {
    expect(countExtraAttackSemanticVariants(extraAttackSemanticVariants())).toEqual(extraAttackSemanticVariantCounts);

    const weak = extraAttackSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function realScriptExtraAttackFixtureFiles(): Array<{
  file: string;
  kind: ExtraAttackKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-combo-master-chain-extra-attack.test.ts",
      kind: "chainFlagExtraAttack",
      required: [
        "EVENT_CHAINING",
        "GetCurrentChain()>1",
        "flagEffects.filter((flag) => flag.ownerId === comboMaster!.uid",
        "code: 194",
        "hasDirectAttack(secondActions, comboMaster!.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-alien-hunter-chain-attack.test.ts",
      kind: "chainAttack",
      required: [
        "Duel.ChainAttack",
        'eventName: "battleDestroyed"',
        "attacksDeclared).not.toContain(alienHunter!.uid)",
        "targetUid: followupTarget!.uid",
      ],
    },
    {
      file: "test/lua-real-script-element-doom-chain-attack.test.ts",
      kind: "chainAttack",
      required: [
        "attributeEarth",
        "attributeWind",
        "Duel.ChainAttack",
        'eventName: "battleDestroyed"',
        "attacksDeclared).not.toContain(elementDoom!.uid)",
        "targetUid: followupTarget!.uid",
      ],
    },
    {
      file: "test/lua-real-script-asura-priest-attack-all.test.ts",
      kind: "attackAll",
      required: [
        "code: 193",
        "hasDirectAttack(openingActions, asura!.uid)).toBe(false)",
        "hasAttack(secondActions, asura!.uid, secondTarget!.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-ashura-king-battle-extra-stat.test.ts",
      kind: "extraAttack",
      required: [
        'const ashuraCode = "80993256"',
        "e1:SetCode(EFFECT_EXTRA_ATTACK)",
        "return math.max(0,oc-1)",
        'eventTriggerTiming: "when"',
        'eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 }',
        "hasDirectAttack(secondActions, ashura.uid)).toBe(false)",
        "secondAttack",
      ],
    },
    {
      file: "test/lua-real-script-hi-speedroid-chanbara-extra-battle-stat-tohand.test.ts",
      kind: "extraAttack",
      required: [
        'const chanbaraCode = "42110604"',
        "restores static extra attack, mandatory battle-start ATK gain, and delayed Speedroid banished recovery",
        "EFFECT_EXTRA_ATTACK",
        "EVENT_BATTLE_START",
        "secondActions.some((action) => action.type === \"declareAttack\" && action.attackerUid === chanbara.uid && action.targetUid === secondTarget.uid)).toBe(true)",
        "secondActions.some((action) => action.type === \"declareAttack\" && action.attackerUid === chanbara.uid && action.directAttack === true)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-borrelsword-position-extra-attack-stat.test.ts",
      kind: "extraAttack",
      required: [
        'const borrelswordCode = "85289965"',
        "Duel.SetChainLimit(s.chlimit)",
        "e2:SetCode(EFFECT_EXTRA_ATTACK)",
        "code: 194",
        "declareAttack",
        "currentAttack(restoredStat.session.state.cards.find((card) => card.uid === borrelsword.uid), restoredStat.session.state)).toBe(4251)",
      ],
    },
    {
      file: "test/lua-real-script-double-or-nothing-attack-disabled-extra-final-stat.test.ts",
      kind: "extraAttack",
      required: [
        'const doubleOrNothingCode = "94770493"',
        "restores attack-disabled activation into extra attack and battle-start final ATK doubling",
        "e1:SetCode(EVENT_ATTACK_DISABLED)",
        "Duel.SetTargetCard(eg:GetFirst())",
        "tc:RegisterFlagEffect(id,RESETS_STANDARD_PHASE_END,0,1)",
        "e1:SetCode(EFFECT_EXTRA_ATTACK)",
        "e1:SetValue(tc:GetAttackAnnouncedCount())",
        "e2:SetCode(EVENT_BATTLE_START)",
        "e1:SetCode(EFFECT_SET_ATTACK_FINAL)",
        "secondAttack",
        "battleDamage).toEqual({ 0: 0, 1: 2200 })",
      ],
    },
    {
      file: "test/lua-real-script-ghost-bird-extra-monster-attack.test.ts",
      kind: "monsterOnlyExtraAttack",
      required: [
        "code: 346",
        "hasAttack(actions, ghostBird.uid, target.uid)).toBe(true)",
        "hasDirectAttack(noTargetActions, ghostBird.uid)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-hexe-trude-destroy-extra-battle-stat.test.ts",
      kind: "monsterOnlyExtraAttack",
      required: [
        "restores Golden Castle destroy into monster-only extra attack and battle-destroying ATK trigger",
        "e1:SetCode(EFFECT_EXTRA_ATTACK_MONSTER)",
        "value: 1",
        "secondAttack",
        "action.directAttack === true)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-hayabusa-knight-extra-attack.test.ts",
      kind: "extraAttack",
      required: [
        "code: 194",
        "hasAttack(secondActions, hayabusa!.uid, target!.uid)).toBe(false)",
        "hasDirectAttack(secondActions, hayabusa!.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-machine-lord-ur-attack-all.test.ts",
      kind: "attackAll",
      required: [
        "code: 193",
        "code: 200",
        "hasAttack(restoredActions, ur!.uid, secondTarget!.uid)).toBe(true)",
        "battleDamage).toEqual({ 0: 0, 1: 0 })",
      ],
    },
    {
      file: "test/lua-real-script-juggernaut-liebe-detach-stat-attack-lock.test.ts",
      kind: "overlayCountMonsterExtraAttack",
      required: [
        'const liebeCode = "26096328"',
        "restores detach-cost self stat boost, other-monster attack lock, and overlay-count extra monster attack",
        "e2:SetCode(EFFECT_EXTRA_ATTACK_MONSTER)",
        "return math.max(0,oc)",
        "hasAttack(secondActions, liebe.uid, secondTarget.uid)).toBe(true)",
        "hasDirectAttack(battleActions, liebe.uid)).toBe(false)",
        "eventName: \"battleDamageDealt\"",
        "eventReasonCardUid: liebe.uid",
      ],
    },
    {
      file: "test/lua-real-script-mataza-control-extra-attack.test.ts",
      kind: "extraAttack",
      required: [
        "code: 194",
        "hasAttack(secondActions, mataza!.uid, target!.uid)).toBe(false)",
        "hasDirectAttack(secondActions, mataza!.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-nitro-warrior-chain-attack-target.test.ts",
      kind: "chainAttack",
      required: [
        "effectId.endsWith(\"-1138\")",
        "targetUid: followupTarget!.uid",
        "battleDamage).toMatchObject({ 1: 1800 })",
        "eventName: \"battleDamageDealt\"",
        "eventValue: 1800",
        "eventReason: duelReason.battle",
        "eventReasonCardUid: nitro!.uid",
        "eventReasonPlayer: 0",
      ],
    },
    {
      file: "test/lua-real-script-shootingcode-talker-battle-extra-draw.test.ts",
      kind: "monsterOnlyExtraAttack",
      required: [
        'const shootingcodeCode = "33897356"',
        "restores linked Battle Start extra attack, damage-calculation ATK loss, battle-destroying flag, and Battle Phase draw",
        "e1:SetCode(EFFECT_EXTRA_ATTACK_MONSTER)",
        "e:GetHandler():GetLinkedGroupCount()>0",
        "eventName: \"phaseBattle\"",
        "code: 346",
        "value: 1",
        "eventName: \"battleDestroyed\"",
        "eventName: \"cardsDrawn\"",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: ExtraAttackKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countExtraAttackKinds(fixtures: Array<{ kind: ExtraAttackKind }>): Record<ExtraAttackKind, number> {
  return fixtures.reduce<Record<ExtraAttackKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      attackAll: 0,
      chainAttack: 0,
      chainFlagExtraAttack: 0,
      extraAttack: 0,
      monsterOnlyExtraAttack: 0,
      overlayCountMonsterExtraAttack: 0,
    },
  );
}

function extraAttackSemanticVariants(): Array<{
  file: string;
  kind: ExtraAttackSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-combo-master-chain-extra-attack.test.ts",
      kind: "comboMasterChainFlagExtraAttack",
      required: [
        'const comboMasterCode = "44800181"',
        "restores its EVENT_CHAINING flag into a conditional extra Battle Phase attack",
        "Duel.GetCurrentChain()>1",
        "eventName: \"chaining\"",
        "hasDirectAttack(secondActions, comboMaster!.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-alien-hunter-chain-attack.test.ts",
      kind: "alienHunterBattleDestroyChainAttack",
      required: [
        'const alienHunterCode = "62315111"',
        "restores Alien Hunter's battle-destroying trigger and reopens its attack with Duel.ChainAttack",
        "Duel.ChainAttack",
        'eventName: "battleDestroyed"',
      ],
    },
    {
      file: "test/lua-real-script-asura-priest-attack-all.test.ts",
      kind: "asuraPriestSpiritAttackAllMonsters",
      required: [
        'const asuraCode = "2134346"',
        "restores its Spirit attack-all effect and lets it attack each monster with battle damage",
        "hasDirectAttack(openingActions, asura!.uid)).toBe(false)",
        "hasAttack(secondActions, asura!.uid, secondTarget!.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-ashura-king-battle-extra-stat.test.ts",
      kind: "ashuraKingOverlayCountExtraAttack",
      required: [
        'const ashuraCode = "80993256"',
        "restores overlay-count extra attacks and mandatory battle-start ATK stacking",
        "EFFECT_EXTRA_ATTACK",
        'eventTriggerTiming: "when"',
        'eventPreviousState: { controller: 0, faceUp: false, location: "extraDeck", position: "faceDown", sequence: 0 }',
        "hasDirectAttack(secondActions, ashura.uid)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-borrelsword-position-extra-attack-stat.test.ts",
      kind: "borrelswordPositionExtraAttackStat",
      required: [
        'const borrelswordCode = "85289965"',
        "restores target position chain-limit, extra attack grant, and attack-announcement ATK steal",
        "Duel.ChangePosition(tc,POS_FACEUP_DEFENSE,POS_FACEDOWN_DEFENSE)",
        "code: 194",
        "eventName: \"attackDeclared\"",
        "value: 1251",
      ],
    },
    {
      file: "test/lua-real-script-element-doom-chain-attack.test.ts",
      kind: "elementDoomAttributeGatedChainAttack",
      required: [
        'const elementDoomCode = "23118924"',
        "restores its attribute-gated battled disable and reopens its attack with Duel.ChainAttack",
        "attributeEarth",
        "attributeWind",
      ],
    },
    {
      file: "test/lua-real-script-ghost-bird-extra-monster-attack.test.ts",
      kind: "ghostBirdSequenceGatedMonsterOnlyExtraAttack",
      required: [
        'const ghostBirdCode = "15419596"',
        "restores sequence-gated monster-only extra attacks without allowing direct attacks",
        "hasAttack(actions, ghostBird.uid, target.uid)).toBe(true)",
        "hasDirectAttack(noTargetActions, ghostBird.uid)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-hexe-trude-destroy-extra-battle-stat.test.ts",
      kind: "hexeTrudeDestroyGrantMonsterOnlyExtraAttack",
      required: [
        'const hexeCode = "46294982"',
        "restores Golden Castle destroy into monster-only extra attack and battle-destroying ATK trigger",
        "e1:SetCode(EFFECT_EXTRA_ATTACK_MONSTER)",
        "secondAttack",
        "action.directAttack === true)).toBe(false)",
      ],
    },
    {
      file: "test/lua-real-script-hayabusa-knight-extra-attack.test.ts",
      kind: "hayabusaKnightStaticSecondDirectAttack",
      required: [
        'const hayabusaCode = "21015833"',
        "restores official static extra attack and allows the second attack to become direct",
        "hasAttack(secondActions, hayabusa!.uid, target!.uid)).toBe(false)",
        "hasDirectAttack(secondActions, hayabusa!.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-hi-speedroid-chanbara-extra-battle-stat-tohand.test.ts",
      kind: "hiSpeedroidChanbaraExtraBattleStatToHand",
      required: [
        'const chanbaraCode = "42110604"',
        "restores static extra attack, mandatory battle-start ATK gain, and delayed Speedroid banished recovery",
        "EFFECT_EXTRA_ATTACK",
        "eventName: \"battleStarted\"",
        "battleDamage).toEqual({ 0: 0, 1: 1200 })",
      ],
    },
    {
      file: "test/lua-real-script-machine-lord-ur-attack-all.test.ts",
      kind: "machineLordUrAttackAllNoDirectAttack",
      required: [
        'const urCode = "96938777"',
        "restores Machine Lord Ur and lets it attack each opponent monster once without granting a direct attack",
        "hasAttack(restoredActions, ur!.uid, secondTarget!.uid)).toBe(true)",
        "battleDamage).toEqual({ 0: 0, 1: 0 })",
      ],
    },
    {
      file: "test/lua-real-script-juggernaut-liebe-detach-stat-attack-lock.test.ts",
      kind: "juggernautLiebeOverlayCountMonsterExtraAttack",
      required: [
        'const liebeCode = "26096328"',
        "restores detach-cost self stat boost, other-monster attack lock, and overlay-count extra monster attack",
        "e2:SetCode(EFFECT_EXTRA_ATTACK_MONSTER)",
        "hasAttack(secondActions, liebe.uid, secondTarget.uid)).toBe(true)",
        "eventName: \"battleDamageDealt\"",
        "eventReasonCardUid: liebe.uid",
      ],
    },
    {
      file: "test/lua-real-script-mataza-control-extra-attack.test.ts",
      kind: "matazaControlLockStaticExtraAttack",
      required: [
        'const matazaCode = "22609617"',
        "restores official control-change lock and static extra attack",
        "hasAttack(secondActions, mataza!.uid, target!.uid)).toBe(false)",
        "hasDirectAttack(secondActions, mataza!.uid)).toBe(true)",
      ],
    },
    {
      file: "test/lua-real-script-nitro-warrior-chain-attack-target.test.ts",
      kind: "nitroWarriorPositionChangedChainAttack",
      required: [
        'const nitroCode = "18013090"',
        "restores its battled trigger and chain-attacks the selected position-changed monster",
        'effectId.endsWith("-1138")',
        "battleDamage).toMatchObject({ 1: 1800 })",
        "eventName: \"battleDamageDealt\"",
        "eventReasonCardUid: nitro!.uid",
      ],
    },
    {
      file: "test/lua-real-script-shootingcode-talker-battle-extra-draw.test.ts",
      kind: "shootingcodeTalkerLinkedBattleStartMonsterOnlyExtraAttack",
      required: [
        'const shootingcodeCode = "33897356"',
        "restores linked Battle Start extra attack, damage-calculation ATK loss, battle-destroying flag, and Battle Phase draw",
        "EFFECT_EXTRA_ATTACK_MONSTER",
        "GetLinkedGroupCount()>0",
        "currentAttack(restoredBattleStart.session.state.cards.find",
        "eventReasonEffectId: 3",
      ],
    },
    {
      file: "test/lua-real-script-double-or-nothing-attack-disabled-extra-final-stat.test.ts",
      kind: "doubleOrNothingAttackDisabledExtraFinalStat",
      required: [
        'const doubleOrNothingCode = "94770493"',
        "restores attack-disabled activation into extra attack and battle-start final ATK doubling",
        "EVENT_ATTACK_DISABLED",
        "EFFECT_EXTRA_ATTACK",
        "EVENT_BATTLE_START",
        "EFFECT_SET_ATTACK_FINAL",
        "secondAttack",
        "toBe(3600)",
        "battleDamage).toEqual({ 0: 0, 1: 2200 })",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: ExtraAttackSemanticVariant;
    required: string[];
  }>);
}

function countExtraAttackSemanticVariants(
  fixtures: Array<{ kind: ExtraAttackSemanticVariant }>,
): Record<ExtraAttackSemanticVariant, number> {
  return fixtures.reduce<Record<ExtraAttackSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      alienHunterBattleDestroyChainAttack: 0,
      ashuraKingOverlayCountExtraAttack: 0,
      asuraPriestSpiritAttackAllMonsters: 0,
      borrelswordPositionExtraAttackStat: 0,
      comboMasterChainFlagExtraAttack: 0,
      doubleOrNothingAttackDisabledExtraFinalStat: 0,
      elementDoomAttributeGatedChainAttack: 0,
      ghostBirdSequenceGatedMonsterOnlyExtraAttack: 0,
      hexeTrudeDestroyGrantMonsterOnlyExtraAttack: 0,
      hayabusaKnightStaticSecondDirectAttack: 0,
      hiSpeedroidChanbaraExtraBattleStatToHand: 0,
      juggernautLiebeOverlayCountMonsterExtraAttack: 0,
      machineLordUrAttackAllNoDirectAttack: 0,
      matazaControlLockStaticExtraAttack: 0,
      nitroWarriorPositionChangedChainAttack: 0,
      shootingcodeTalkerLinkedBattleStartMonsterOnlyExtraAttack: 0,
    },
  );
}
