import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const EXTRA_ATTACK_FIXTURE_COUNT = 11;
const extraAttackKindCounts = {
  attackAll: 2,
  chainAttack: 3,
  chainFlagExtraAttack: 1,
  extraAttack: 3,
  monsterOnlyExtraAttack: 1,
  overlayCountMonsterExtraAttack: 1,
} satisfies Record<ExtraAttackKind, number>;
const extraAttackSemanticVariantCounts = {
  alienHunterBattleDestroyChainAttack: 1,
  ashuraKingOverlayCountExtraAttack: 1,
  asuraPriestSpiritAttackAllMonsters: 1,
  comboMasterChainFlagExtraAttack: 1,
  elementDoomAttributeGatedChainAttack: 1,
  ghostBirdSequenceGatedMonsterOnlyExtraAttack: 1,
  hayabusaKnightStaticSecondDirectAttack: 1,
  juggernautLiebeOverlayCountMonsterExtraAttack: 1,
  machineLordUrAttackAllNoDirectAttack: 1,
  matazaControlLockStaticExtraAttack: 1,
  nitroWarriorPositionChangedChainAttack: 1,
} satisfies Record<ExtraAttackSemanticVariant, number>;

type ExtraAttackKind = "attackAll" | "chainAttack" | "chainFlagExtraAttack" | "extraAttack" | "monsterOnlyExtraAttack" | "overlayCountMonsterExtraAttack";
type ExtraAttackSemanticVariant =
  | "alienHunterBattleDestroyChainAttack"
  | "ashuraKingOverlayCountExtraAttack"
  | "asuraPriestSpiritAttackAllMonsters"
  | "comboMasterChainFlagExtraAttack"
  | "elementDoomAttributeGatedChainAttack"
  | "ghostBirdSequenceGatedMonsterOnlyExtraAttack"
  | "hayabusaKnightStaticSecondDirectAttack"
  | "juggernautLiebeOverlayCountMonsterExtraAttack"
  | "machineLordUrAttackAllNoDirectAttack"
  | "matazaControlLockStaticExtraAttack"
  | "nitroWarriorPositionChangedChainAttack";

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
        "hasDirectAttack(secondActions, ashura.uid)).toBe(false)",
        "secondAttack",
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
        "hasDirectAttack(secondActions, ashura.uid)).toBe(false)",
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
      comboMasterChainFlagExtraAttack: 0,
      elementDoomAttributeGatedChainAttack: 0,
      ghostBirdSequenceGatedMonsterOnlyExtraAttack: 0,
      hayabusaKnightStaticSecondDirectAttack: 0,
      juggernautLiebeOverlayCountMonsterExtraAttack: 0,
      machineLordUrAttackAllNoDirectAttack: 0,
      matazaControlLockStaticExtraAttack: 0,
      nitroWarriorPositionChangedChainAttack: 0,
    },
  );
}
