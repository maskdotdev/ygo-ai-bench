import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const FREE_CHAIN_FIXTURE_COUNT = 15;
const FREE_CHAIN_OPERATION_INFO_FIXTURE_COUNT = 14;
const CHAINED_FREE_CHAIN_FIXTURE_COUNT = 6;
const FREE_CHAIN_INVENTORY_FIXTURE_COUNT = 15;
const freeChainKindCounts = {
  banishRemoval: 1,
  graveyardRevive: 1,
  multiTargetDestroy: 3,
  positionChange: 2,
  selectUnselectTargets: 1,
  singleDestroy: 3,
  targetNegation: 1,
  toDeckDiscard: 1,
  toHand: 2,
} satisfies Record<FreeChainKind, number>;
const freeChainSemanticVariantCounts = {
  armorBlastMergedTargets: 1,
  bookMoonPositionSet: 1,
  compulsoryToHand: 1,
  cosmicCycloneBanish: 1,
  destructionRingBothDamage: 1,
  infiniteImpermanenceTargetParam: 1,
  monsterRebornRevive: 1,
  mysticalSpaceTyphoonDestroy: 1,
  omegaJudgmentSelectUnselect: 1,
  phoenixWingDiscardToDeck: 1,
  raigekiBreakDiscardDestroy: 1,
  recurringNightmareChainInfoToHand: 1,
  spellShatteringArrowDestroyedCountDamage: 1,
  twinTwistersDiscardDestroy: 1,
  windstormGroupPositionSwitch: 1,
} satisfies Record<FreeChainSemanticVariant, number>;

type FreeChainKind =
  | "banishRemoval"
  | "graveyardRevive"
  | "multiTargetDestroy"
  | "positionChange"
  | "selectUnselectTargets"
  | "singleDestroy"
  | "targetNegation"
  | "toDeckDiscard"
  | "toHand";
type FreeChainSemanticVariant =
  | "armorBlastMergedTargets"
  | "bookMoonPositionSet"
  | "compulsoryToHand"
  | "cosmicCycloneBanish"
  | "destructionRingBothDamage"
  | "infiniteImpermanenceTargetParam"
  | "monsterRebornRevive"
  | "mysticalSpaceTyphoonDestroy"
  | "omegaJudgmentSelectUnselect"
  | "phoenixWingDiscardToDeck"
  | "raigekiBreakDiscardDestroy"
  | "recurringNightmareChainInfoToHand"
  | "spellShatteringArrowDestroyedCountDamage"
  | "twinTwistersDiscardDestroy"
  | "windstormGroupPositionSwitch";

describe("Lua real free-chain restore coverage", () => {
  it("keeps the combined free-chain restore fixture inventory explicit", () => {
    expect(combinedFreeChainFixtureFiles()).toHaveLength(FREE_CHAIN_INVENTORY_FIXTURE_COUNT);
    expect(combinedFreeChainFixtureFiles()).toEqual(realScriptFreeChainInventoryFiles());
  });

  it("keeps free-chain fixture kinds explicit", () => {
    expect(countFreeChainKinds(realScriptFreeChainFixtures())).toEqual(freeChainKindCounts);
  });

  it("keeps named free-chain semantic variants explicit", () => {
    expect(countFreeChainSemanticVariants(realScriptFreeChainSemanticVariants())).toEqual(freeChainSemanticVariantCounts);

    const weak = realScriptFreeChainSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });

  it("requires representative free-chain fixtures to assert grouped actions and clean Lua registry restore", () => {
    const files = realScriptFreeChainFixtureFiles();
    expect(files).toHaveLength(FREE_CHAIN_FIXTURE_COUNT);

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
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])");
      });

    expect(missing).toEqual([]);
  });

  it("requires representative free-chain fixtures to prove restored chain targets and outcomes", () => {
    const files = realScriptFreeChainFixtureFiles();
    expect(files).toHaveLength(FREE_CHAIN_FIXTURE_COUNT);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("applyLuaRestoreResponse")
          || !/state\.chain\)\.toHaveLength\((1|2)\)/.test(text)
          || !text.includes("targetUids")
          || !/location:\s*["'](graveyard|hand|deck|banished|monsterZone)["']/.test(text)
          || !text.includes("host.messages).not.toContain");
      });

    expect(missing).toEqual([]);
  });

  it("requires operation-info metadata for free-chain fixtures whose scripts announce operation categories", () => {
    const files = realScriptFreeChainOperationInfoFixtureFiles();
    expect(files).toHaveLength(FREE_CHAIN_OPERATION_INFO_FIXTURE_COUNT);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("operationInfos")
          || !/category:\s*0x[0-9a-f]+/i.test(text)
          || !/count:\s*[1-9]/.test(text)
          || !/player:\s*[01]/.test(text)
          || !/parameter:\s*0/.test(text);
      });

    expect(missing).toEqual([]);
  });

  it("requires chained free-chain fixtures to prove restored response suppression", () => {
    const files = realScriptChainedFreeChainFixtureFiles();
    expect(files).toHaveLength(CHAINED_FREE_CHAIN_FIXTURE_COUNT);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("chainStarterScript")
          || !text.includes("chainResponderScript")
          || !text.includes("host.messages).toContain")
          || !text.includes("host.messages).not.toContain");
      });

    expect(missing).toEqual([]);
  });
});

function combinedFreeChainFixtureFiles(): string[] {
  return [
    ...realScriptFreeChainFixtureFiles(),
    ...realScriptFreeChainOperationInfoFixtureFiles(),
    ...realScriptChainedFreeChainFixtureFiles(),
  ].filter((file, index, files) => files.indexOf(file) === index).sort();
}

function realScriptFreeChainInventoryFiles(): string[] {
  return realScriptFreeChainFixtureFiles();
}

function realScriptFreeChainFixtureFiles(): string[] {
  return realScriptFreeChainFixtures().map(({ file }) => file);
}

function realScriptFreeChainOperationInfoFixtureFiles(): string[] {
  return realScriptFreeChainFixtureFiles()
    .filter((file) => !file.endsWith("lua-real-script-book-of-moon-free-chain.test.ts"));
}

function realScriptChainedFreeChainFixtureFiles(): string[] {
  return realScriptFreeChainFixtureFiles()
    .filter((file) => !file.endsWith("lua-real-script-armor-blast-multi-target-free-chain.test.ts"))
    .filter((file) => !file.endsWith("lua-real-script-book-of-moon-free-chain.test.ts"))
    .filter((file) => !file.endsWith("lua-real-script-destruction-ring-destroy-both-damage.test.ts"))
    .filter((file) => !file.endsWith("lua-real-script-infinite-impermanence-target-param.test.ts"))
    .filter((file) => !file.endsWith("lua-real-script-monster-reborn-free-chain.test.ts"))
    .filter((file) => !file.endsWith("lua-real-script-omega-judgment-select-unselect-targets.test.ts"))
    .filter((file) => !file.endsWith("lua-real-script-recurring-nightmare-grave-to-hand.test.ts"))
    .filter((file) => !file.endsWith("lua-real-script-spell-shattering-arrow-group-destroy-damage.test.ts"))
    .filter((file) => !file.endsWith("lua-real-script-windstorm-etaqua-group-position.test.ts"));
}

function realScriptFreeChainFixtures(): Array<{ file: string; kind: FreeChainKind }> {
  return ([
    {
      file: "lua-real-script-armor-blast-multi-target-free-chain.test.ts",
      kind: "multiTargetDestroy",
    },
    {
      file: "lua-real-script-book-of-moon-free-chain.test.ts",
      kind: "positionChange",
    },
    {
      file: "lua-real-script-compulsory-evacuation-device-free-chain.test.ts",
      kind: "toHand",
    },
    {
      file: "lua-real-script-cosmic-cyclone-free-chain.test.ts",
      kind: "banishRemoval",
    },
    {
      file: "lua-real-script-destruction-ring-destroy-both-damage.test.ts",
      kind: "singleDestroy",
    },
    {
      file: "lua-real-script-infinite-impermanence-target-param.test.ts",
      kind: "targetNegation",
    },
    {
      file: "lua-real-script-monster-reborn-free-chain.test.ts",
      kind: "graveyardRevive",
    },
    {
      file: "lua-real-script-mystical-space-typhoon-free-chain.test.ts",
      kind: "singleDestroy",
    },
    {
      file: "lua-real-script-omega-judgment-select-unselect-targets.test.ts",
      kind: "selectUnselectTargets",
    },
    {
      file: "lua-real-script-phoenix-wing-wind-blast-discard-cost.test.ts",
      kind: "toDeckDiscard",
    },
    {
      file: "lua-real-script-raigeki-break-discard-cost.test.ts",
      kind: "singleDestroy",
    },
    {
      file: "lua-real-script-recurring-nightmare-grave-to-hand.test.ts",
      kind: "toHand",
    },
    {
      file: "lua-real-script-spell-shattering-arrow-group-destroy-damage.test.ts",
      kind: "multiTargetDestroy",
    },
    {
      file: "lua-real-script-twin-twisters-discard-cost.test.ts",
      kind: "multiTargetDestroy",
    },
    {
      file: "lua-real-script-windstorm-etaqua-group-position.test.ts",
      kind: "positionChange",
    },
  ] satisfies Array<{ file: string; kind: FreeChainKind }>)
    .map(({ file, kind }) => ({ file: path.join("test", file), kind }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function realScriptFreeChainSemanticVariants(): Array<{ file: string; kind: FreeChainSemanticVariant; required: string[] }> {
  return ([
    {
      file: "lua-real-script-armor-blast-multi-target-free-chain.test.ts",
      kind: "armorBlastMergedTargets",
      required: [
        "restores Armor Blast's merged Inzektor and opponent targets, then destroys them",
        "const armorBlastCode = \"79155167\"",
        "expect(restored.session.state.chain[0]?.operationInfos).toEqual([{ category: 0x1, targetUids, count: 3, player: 0, parameter: 0 }])",
      ],
    },
    {
      file: "lua-real-script-book-of-moon-free-chain.test.ts",
      kind: "bookMoonPositionSet",
      required: [
        "restores Book of Moon's selected target and turns it face-down on resolution",
        "const bookOfMoonCode = \"14087893\"",
        "{ category: 0x1000, targetUids: [target!.uid], count: 1, player: 0, parameter: 8 }",
      ],
    },
    {
      file: "lua-real-script-compulsory-evacuation-device-free-chain.test.ts",
      kind: "compulsoryToHand",
      required: [
        "restores Compulsory's selected monster target and returns it to hand",
        "const compulsoryCode = \"94192409\"",
        "{ category: 0x8, targetUids: [target!.uid], count: 1, player: 0, parameter: 0 }",
      ],
    },
    {
      file: "lua-real-script-cosmic-cyclone-free-chain.test.ts",
      kind: "cosmicCycloneBanish",
      required: [
        "restores Cosmic Cyclone's LP cost, backrow target, and banish operation",
        "const cosmicCode = \"8267140\"",
        "{ category: 0x4, targetUids: [targetTrap!.uid], count: 1, player: 0, parameter: 0 }",
      ],
    },
    {
      file: "lua-real-script-destruction-ring-destroy-both-damage.test.ts",
      kind: "destructionRingBothDamage",
      required: [
        "restores its selected own face-up monster target, destruction, both-player damage, and RDComplete",
        "const destructionRingCode = \"21219755\"",
        "Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,PLAYER_ALL,1000)",
        "Duel.RDComplete()",
        "{ category: 0x80000, targetUids: [], count: 0, player: 0, parameter: 1000 }",
        "players[0].lifePoints).toBe(7000)",
        "players[1].lifePoints).toBe(7000)",
      ],
    },
    {
      file: "lua-real-script-infinite-impermanence-target-param.test.ts",
      kind: "infiniteImpermanenceTargetParam",
      required: [
        "restores Infinite Impermanence's face-down activation target param and disables the target monster",
        "const impermCode = \"10045474\"",
        "expect(restored.host.messages).toContain(\"impermanence target disabled true\")",
      ],
    },
    {
      file: "lua-real-script-monster-reborn-free-chain.test.ts",
      kind: "monsterRebornRevive",
      required: [
        "restores Monster Reborn's Graveyard target and Special Summons it on resolution",
        "const monsterRebornCode = \"83764718\"",
        "{ category: 0x200, targetUids: [target!.uid], count: 1, player: 0, parameter: 0 }",
      ],
    },
    {
      file: "lua-real-script-mystical-space-typhoon-free-chain.test.ts",
      kind: "mysticalSpaceTyphoonDestroy",
      required: [
        "restores Mystical Space Typhoon's backrow target and destroys it",
        "const mstCode = \"5318639\"",
        "{ category: 0x1, targetUids: [targetTrap!.uid], count: 1, player: 1, parameter: 0 }",
      ],
    },
    {
      file: "lua-real-script-omega-judgment-select-unselect-targets.test.ts",
      kind: "omegaJudgmentSelectUnselect",
      required: [
        "restores Omega Judgment's selected monster-in-S/T and opponent targets, then destroys them",
        "const omegaJudgmentCode = \"53923690\"",
        "const targetUids = [ownTrapMonster!.uid, opponentMonster!.uid, opponentSpell!.uid]",
      ],
    },
    {
      file: "lua-real-script-phoenix-wing-wind-blast-discard-cost.test.ts",
      kind: "phoenixWingDiscardToDeck",
      required: [
        "restores Phoenix Wing Wind Blast's discarded cost card, target, and deck-top return",
        "const phoenixWingCode = \"63356631\"",
        "{ category: 0x10, targetUids: [target!.uid], count: 1, player: 1, parameter: 0 }",
      ],
    },
    {
      file: "lua-real-script-raigeki-break-discard-cost.test.ts",
      kind: "raigekiBreakDiscardDestroy",
      required: [
        "restores Raigeki Break's discarded cost card, target, and destroy operation",
        "const raigekiBreakCode = \"4178474\"",
        "{ category: 0x1, targetUids: [target!.uid], count: 1, player: 0, parameter: 0 }",
      ],
    },
    {
      file: "lua-real-script-recurring-nightmare-grave-to-hand.test.ts",
      kind: "recurringNightmareChainInfoToHand",
      required: [
        "restores Recurring Nightmare's two Graveyard targets from CHAININFO_TARGET_CARDS and returns only related DARK 0 DEF monsters",
        "const recurringNightmareCode = \"81191584\"",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_CARDS)",
        "g:Filter(Card.IsRelateToEffect,nil,e)",
        "{ category: 0x8, targetUids: [firstTarget!.uid, secondTarget!.uid], count: 2, player: 0, parameter: 0 }",
      ],
    },
    {
      file: "lua-real-script-spell-shattering-arrow-group-destroy-damage.test.ts",
      kind: "spellShatteringArrowDestroyedCountDamage",
      required: [
        "restores its opponent face-up Spell group destruction and destroyed-count damage",
        "const spellShatteringArrowCode = \"93260132\"",
        "Duel.GetMatchingGroup(s.filter,tp,0,LOCATION_ONFIELD,nil)",
        "Duel.Damage(1-tp,ct*500,REASON_EFFECT)",
        "{ category: 0x80000, targetUids: [], count: 0, player: 1, parameter: 1000 }",
        "players[1].lifePoints).toBe(7000)",
        "eventName: \"damageDealt\"",
      ],
    },
    {
      file: "lua-real-script-twin-twisters-discard-cost.test.ts",
      kind: "twinTwistersDiscardDestroy",
      required: [
        "restores Twin Twisters' discarded cost card, two targets, and grouped destroy operation",
        "const twinTwistersCode = \"43898403\"",
        "{ category: 0x1, targetUids: [firstTarget!.uid, secondTarget!.uid], count: 2, player: 0, parameter: 0 }",
      ],
    },
    {
      file: "lua-real-script-windstorm-etaqua-group-position.test.ts",
      kind: "windstormGroupPositionSwitch",
      required: [
        "restores Windstorm of Etaqua's opponent-only group position switch",
        "const windstormCode = \"59744639\"",
        "{ category: 0x1000, targetUids, count: 2, player: 0, parameter: 0 }",
        "Duel.ChangePosition(sg,POS_FACEUP_DEFENSE,0,POS_FACEUP_ATTACK,0)",
      ],
    },
  ] satisfies Array<{ file: string; kind: FreeChainSemanticVariant; required: string[] }>)
    .map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }))
    .sort((a, b) => a.kind.localeCompare(b.kind));
}

function countFreeChainKinds(fixtures: Array<{ kind: FreeChainKind }>): Record<FreeChainKind, number> {
  return fixtures.reduce<Record<FreeChainKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      banishRemoval: 0,
      graveyardRevive: 0,
      multiTargetDestroy: 0,
      positionChange: 0,
      selectUnselectTargets: 0,
      singleDestroy: 0,
      targetNegation: 0,
      toDeckDiscard: 0,
      toHand: 0,
    },
  );
}

function countFreeChainSemanticVariants(fixtures: Array<{ kind: FreeChainSemanticVariant }>): Record<FreeChainSemanticVariant, number> {
  return fixtures.reduce<Record<FreeChainSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      armorBlastMergedTargets: 0,
      bookMoonPositionSet: 0,
      compulsoryToHand: 0,
      cosmicCycloneBanish: 0,
      destructionRingBothDamage: 0,
      infiniteImpermanenceTargetParam: 0,
      monsterRebornRevive: 0,
      mysticalSpaceTyphoonDestroy: 0,
      omegaJudgmentSelectUnselect: 0,
      phoenixWingDiscardToDeck: 0,
      raigekiBreakDiscardDestroy: 0,
      recurringNightmareChainInfoToHand: 0,
      spellShatteringArrowDestroyedCountDamage: 0,
      twinTwistersDiscardDestroy: 0,
      windstormGroupPositionSwitch: 0,
    },
  );
}
