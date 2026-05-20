import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const battleDestroyedSummonFixtureCount = 5;
const battleDestroyedSummonKindCounts = {
  battleDestroyedTrapActivationDeckSummon: 1,
  optionalDeckDefenseSpecialSummon: 1,
  optionalDeckRaceDefenseSpecialSummon: 1,
  optionalDeckSpecialSummon: 1,
  optionalOpponentAttackerDeckRaceAttackSummon: 1,
} satisfies Record<BattleDestroyedSummonKind, number>;
const battleDestroyedSummonSemanticVariantCounts = {
  heroSignalBattleDestroyedTrapDeckSummon: 1,
  phantomMagicianHeroDefenseDeckSummon: 1,
  redSparrowOpponentAttackerWarriorDeckSummon: 1,
  tricularBattleDestroyedDeckSummon: 1,
  unmaskedDragonWyrmDefenseDeckSummon: 1,
} satisfies Record<BattleDestroyedSummonSemanticVariant, number>;

type BattleDestroyedSummonKind =
  | "battleDestroyedTrapActivationDeckSummon"
  | "optionalDeckDefenseSpecialSummon"
  | "optionalDeckRaceDefenseSpecialSummon"
  | "optionalDeckSpecialSummon"
  | "optionalOpponentAttackerDeckRaceAttackSummon";
type BattleDestroyedSummonSemanticVariant =
  | "heroSignalBattleDestroyedTrapDeckSummon"
  | "phantomMagicianHeroDefenseDeckSummon"
  | "redSparrowOpponentAttackerWarriorDeckSummon"
  | "tricularBattleDestroyedDeckSummon"
  | "unmaskedDragonWyrmDefenseDeckSummon";

describe("Lua real battle-destroyed summon restore coverage", () => {
  it("requires battle-destroyed summon fixtures to assert clean restore and exact Special Summon outcomes", () => {
    const files = battleDestroyedSummonFixtureFiles();
    expect(files).toHaveLength(battleDestroyedSummonFixtureCount);

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
          || !text.includes("pendingTriggers")
          || !text.includes("eventHistory")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps battle-destroyed summon fixture kinds explicit", () => {
    expect(countBattleDestroyedSummonKinds(battleDestroyedSummonFixtureFiles())).toEqual(battleDestroyedSummonKindCounts);
  });

  it("keeps named battle-destroyed summon semantic variants explicit", () => {
    expect(countBattleDestroyedSummonSemanticVariants(battleDestroyedSummonSemanticVariants())).toEqual(
      battleDestroyedSummonSemanticVariantCounts,
    );

    const weak = battleDestroyedSummonSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });

  it("keeps battle-destroyed summon fixtures script-gated and database-independent", () => {
    const weak = battleDestroyedSummonSemanticVariants()
      .filter(({ file }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return text.includes("readDatabaseCards")
          || text.includes("hasUpstreamDatabase")
          || !text.includes("workspace.readScript")
          || !text.includes("describe.skipIf(!hasUpstreamScripts || !has");
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function battleDestroyedSummonFixtureFiles(): Array<{
  file: string;
  kind: BattleDestroyedSummonKind;
  required: string[];
}> {
  return [
    {
      file: "test/lua-real-script-hero-signal-battle-destroyed-trap-summon.test.ts",
      kind: "battleDestroyedTrapActivationDeckSummon",
      required: [
        'const heroSignalCode = "22020907"',
        "restores Hero Signal's battle-destroyed Trap activation and Special Summons a low-level Elemental HERO",
        "e1:SetType(EFFECT_TYPE_ACTIVATE)",
        "e1:SetCode(EVENT_BATTLE_DESTROYED)",
        "Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,nil,1,tp,LOCATION_HAND|LOCATION_DECK)",
        "Duel.SelectMatchingCard(tp,s.spfilter,tp,LOCATION_HAND|LOCATION_DECK,0,1,1,nil,e,tp)",
        "Duel.SpecialSummon(g,0,tp,tp,false,false,POS_FACEUP)",
        'activationLocation: "spellTrapZone"',
        'eventName: "battleDestroyed"',
        'eventName: "specialSummoned"',
        "operationInfos: [{ category: 0x200",
      ],
    },
    {
      file: "test/lua-real-script-phantom-magician-battle-destroyed-defense-summon.test.ts",
      kind: "optionalDeckDefenseSpecialSummon",
      required: [
        'const phantomMagicianCode = "24103628"',
        'const heroTargetCode = "24103630"',
        "restores Phantom Magician's battle-destroyed HERO filter and face-up Defense Special Summon",
        'triggerBucket: "opponentOptional"',
        'eventName: "battleDestroyed"',
        'eventName: "specialSummoned"',
        'position: "faceUpDefense"',
        'location: "deck", controller: 0',
      ],
    },
    {
      file: "test/lua-real-script-red-sparrow-summoner-battle-destroyed-warrior-summon.test.ts",
      kind: "optionalOpponentAttackerDeckRaceAttackSummon",
      required: [
        'const sparrowCode = "81354330"',
        'const warriorTargetCode = "81354331"',
        "restores opponent-attacker battle destruction into low-ATK Warrior Deck Special Summon",
        "Duel.GetAttacker():IsControler(1-tp)",
        "c:IsAttackBelow(1500) and c:IsRace(RACE_WARRIOR)",
        'triggerBucket: "opponentOptional"',
        'eventName: "battleDestroyed"',
        'eventName: "specialSummoned"',
        'position: "faceUpAttack"',
        'location: "deck", controller: 0',
      ],
    },
    {
      file: "test/lua-real-script-tricular-battle-destroyed-summon.test.ts",
      kind: "optionalDeckSpecialSummon",
      required: [
        'const tricularCode = "20797524"',
        'const bicularId = "83392426"',
        "restores Tricular's optional battle-destroyed trigger and Special Summons Bicular from Deck",
        'eventName: "battleDestroyed"',
        'triggerBucket": "opponentOptional"',
        'eventName: "specialSummoned"',
        'location: "monsterZone"',
        "eventReasonEffectId: 1",
      ],
    },
    {
      file: "test/lua-real-script-unmasked-dragon-battle-destroyed-wyrm-summon.test.ts",
      kind: "optionalDeckRaceDefenseSpecialSummon",
      required: [
        'const unmaskedDragonCode = "24218047"',
        'const wyrmTargetCode = "24218048"',
        "restores Unmasked Dragon's battle-destroyed Wyrm DEF filter and face-up Special Summon",
        'eventName: "battleDestroyed"',
        'triggerBucket: "opponentOptional"',
        'eventName: "specialSummoned"',
        'location: "deck", controller: 0',
        "RACE_WYRM",
        "IsDefenseBelow(1500)",
      ],
    },
  ];
}

function battleDestroyedSummonSemanticVariants(): Array<{
  file: string;
  kind: BattleDestroyedSummonSemanticVariant;
  required: string[];
}> {
  return [
    {
      file: "test/lua-real-script-hero-signal-battle-destroyed-trap-summon.test.ts",
      kind: "heroSignalBattleDestroyedTrapDeckSummon",
      required: [
        "EFFECT_TYPE_ACTIVATE",
        "EVENT_BATTLE_DESTROYED",
        "LOCATION_HAND|LOCATION_DECK",
        'type === "activateEffect"',
        "pendingTriggers).toEqual([])",
        'activationLocation: "spellTrapZone"',
        "hero signal responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-phantom-magician-battle-destroyed-defense-summon.test.ts",
      kind: "phantomMagicianHeroDefenseDeckSummon",
      required: [
        'triggerEvent: "battleDestroyed"',
        "triggerSourceOnly: true",
        'type === "activateTrigger"',
        "c:IsSetCard(SET_HERO)",
        "POS_FACEUP_DEFENSE",
        "eventReasonCardUid: phantomMagician.uid",
      ],
    },
    {
      file: "test/lua-real-script-red-sparrow-summoner-battle-destroyed-warrior-summon.test.ts",
      kind: "redSparrowOpponentAttackerWarriorDeckSummon",
      required: [
        'triggerEvent: "battleDestroyed"',
        "triggerSourceOnly: true",
        'type === "activateTrigger"',
        "Duel.GetAttacker():IsControler(1-tp)",
        "c:IsRace(RACE_WARRIOR)",
        "POS_FACEUP_ATTACK",
        "eventReasonCardUid: sparrow.uid",
      ],
    },
    {
      file: "test/lua-real-script-tricular-battle-destroyed-summon.test.ts",
      kind: "tricularBattleDestroyedDeckSummon",
      required: [
        'triggerEvent: "battleDestroyed"',
        "triggerSourceOnly: true",
        'type === "activateTrigger"',
        'eventName: "specialSummoned"',
        "eventReasonCardUid: tricular!.uid",
      ],
    },
    {
      file: "test/lua-real-script-unmasked-dragon-battle-destroyed-wyrm-summon.test.ts",
      kind: "unmaskedDragonWyrmDefenseDeckSummon",
      required: [
        'triggerEvent: "battleDestroyed"',
        "triggerSourceOnly: true",
        'type === "activateTrigger"',
        "c:IsDefenseBelow(1500) and c:IsRace(RACE_WYRM)",
        "eventReasonCardUid: unmaskedDragon.uid",
      ],
    },
  ];
}

function countBattleDestroyedSummonKinds(fixtures: Array<{ kind: BattleDestroyedSummonKind }>): Record<BattleDestroyedSummonKind, number> {
  return fixtures.reduce<Record<BattleDestroyedSummonKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      battleDestroyedTrapActivationDeckSummon: 0,
      optionalDeckDefenseSpecialSummon: 0,
      optionalDeckRaceDefenseSpecialSummon: 0,
      optionalDeckSpecialSummon: 0,
      optionalOpponentAttackerDeckRaceAttackSummon: 0,
    },
  );
}

function countBattleDestroyedSummonSemanticVariants(
  fixtures: Array<{ kind: BattleDestroyedSummonSemanticVariant }>,
): Record<BattleDestroyedSummonSemanticVariant, number> {
  return fixtures.reduce<Record<BattleDestroyedSummonSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      heroSignalBattleDestroyedTrapDeckSummon: 0,
      phantomMagicianHeroDefenseDeckSummon: 0,
      redSparrowOpponentAttackerWarriorDeckSummon: 0,
      tricularBattleDestroyedDeckSummon: 0,
      unmaskedDragonWyrmDefenseDeckSummon: 0,
    },
  );
}
