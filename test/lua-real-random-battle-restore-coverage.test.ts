import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const randomBattleFixtureCount = 1;
const randomBattleKindCounts = {
  callCoinAttackStat: 1,
} satisfies Record<RandomBattleKind, number>;
const randomBattleSemanticVariantCounts = {
  fairyBoxCallCoinAttackZero: 1,
} satisfies Record<RandomBattleSemanticVariant, number>;

type RandomBattleKind = "callCoinAttackStat";
type RandomBattleSemanticVariant = "fairyBoxCallCoinAttackZero";

describe("Lua real random battle restore coverage", () => {
  it("requires random battle fixtures to assert clean Lua restore, legal-action parity, and random outcomes", () => {
    const fixtures = realScriptRandomBattleFixtures();
    expect(fixtures).toHaveLength(randomBattleFixtureCount);

    const missing = fixtures
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
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps random battle fixture kinds explicit", () => {
    expect(countRandomBattleKinds(realScriptRandomBattleFixtures())).toEqual(randomBattleKindCounts);
  });

  it("keeps named random battle semantic variants explicit", () => {
    expect(countRandomBattleSemanticVariants(randomBattleSemanticVariants())).toEqual(randomBattleSemanticVariantCounts);
  });
});

function realScriptRandomBattleFixtures(): Array<{ file: string; kind: RandomBattleKind; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-fairy-box-call-coin-attack-zero.test.ts",
      kind: "callCoinAttackStat",
      required: [
        "restores attack-announcement CallCoin and sets the attacking monster's ATK to 0",
        'const fairyBoxCode = "21598948"',
        "Duel.SetTargetCard(Duel.GetAttacker())",
        "Duel.SetOperationInfo(0,CATEGORY_COIN,nil,0,tp,1)",
        "if Duel.CallCoin(tp,1) then",
        "e1:SetCode(EFFECT_SET_ATTACK_FINAL)",
        "lastCoinResults).toEqual([1])",
        "currentAttack(restoredChain.session.state.cards.find((card) => card.uid === attacker.uid), restoredChain.session.state)).toBe(0)",
        'eventName: "coinTossed"',
      ],
    },
  ];
}

function randomBattleSemanticVariants(): Array<{ file: string; kind: RandomBattleSemanticVariant; requiredSnippets: string[] }> {
  return [
    {
      file: "test/lua-real-script-fairy-box-call-coin-attack-zero.test.ts",
      kind: "fairyBoxCallCoinAttackZero",
      requiredSnippets: [
        'const fairyBoxCode = "21598948"',
        "restores attack-announcement CallCoin and sets the attacking monster's ATK to 0",
        "pendingBattle).toMatchObject({ attackerUid: attacker.uid, targetUid: target.uid })",
        "eventReasonEffectId: 2",
      ],
    },
  ];
}

function countRandomBattleKinds(fixtures: Array<{ kind: RandomBattleKind }>): Record<RandomBattleKind, number> {
  return fixtures.reduce(
    (counts, { kind }) => {
      counts[kind] += 1;
      return counts;
    },
    { callCoinAttackStat: 0 },
  );
}

function countRandomBattleSemanticVariants(fixtures: Array<{ kind: RandomBattleSemanticVariant }>): Record<RandomBattleSemanticVariant, number> {
  return fixtures.reduce(
    (counts, { kind }) => {
      counts[kind] += 1;
      return counts;
    },
    { fairyBoxCallCoinAttackZero: 0 },
  );
}
