import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const searchSetLockFixtureCount = 7;
const searchSetLockKindCounts = {
  continuousMonsterSetLock: 1,
  continuousSelfSpellTrapSetSpecialLock: 1,
  continuousSpellTrapSetLock: 1,
  facedownSpecialSummonLock: 1,
  searchCreatedSummonSetLock: 1,
  searchCreatedMultiSetLock: 1,
  searchedCodeActivationLock: 1,
} satisfies Record<SearchSetLockKind, number>;
const searchSetLockSemanticVariantCounts = {
  ancientGearWyvernFaceDownSpecialSummonLock: 1,
  ancientGearWyvernPostSearchMultiSetLocks: 1,
  darkSimorghOpponentSetLocks: 1,
  fusionConscriptionSearchedCodeLocks: 1,
  hiddenArmorySearchCreatedSummonSetOath: 1,
  lightInterventionPlayerTargetedSetLocks: 1,
  secondSarcophagusSelfSetSpecialLocks: 1,
} satisfies Record<SearchSetLockSemanticVariant, number>;

type SearchSetLockKind =
  | "continuousMonsterSetLock"
  | "continuousSelfSpellTrapSetSpecialLock"
  | "continuousSpellTrapSetLock"
  | "facedownSpecialSummonLock"
  | "searchCreatedSummonSetLock"
  | "searchCreatedMultiSetLock"
  | "searchedCodeActivationLock";
type SearchSetLockSemanticVariant =
  | "ancientGearWyvernFaceDownSpecialSummonLock"
  | "ancientGearWyvernPostSearchMultiSetLocks"
  | "darkSimorghOpponentSetLocks"
  | "fusionConscriptionSearchedCodeLocks"
  | "hiddenArmorySearchCreatedSummonSetOath"
  | "lightInterventionPlayerTargetedSetLocks"
  | "secondSarcophagusSelfSetSpecialLocks";

describe("Lua real search and set-lock restore coverage", () => {
  it("requires representative search-created set locks to assert clean Lua registry restore", () => {
    const files = searchSetLockFixtureFiles();
    expect(files).toHaveLength(searchSetLockFixtureCount);

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

  it("keeps search and set-lock fixture kinds explicit", () => {
    expect(countSearchSetLockKinds(searchSetLockFixtureFiles())).toEqual(searchSetLockKindCounts);
  });

  it("keeps named search and set-lock semantic variants explicit", () => {
    expect(countSearchSetLockSemanticVariants(searchSetLockSemanticVariants())).toEqual(searchSetLockSemanticVariantCounts);

    const weak = searchSetLockSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function searchSetLockFixtureFiles(): Array<{
  file: string;
  kind: SearchSetLockKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-ancient-gear-wyvern-facedown-summon-lock.test.ts",
      kind: "facedownSpecialSummonLock",
      required: [
        'luaTargetDescriptor: "target:special-summon-position-facedown"',
        "wyvern facedown special 0",
        "wyvern faceup special 1",
      ],
    },
    {
      file: "test/lua-real-script-ancient-gear-wyvern-set-locks.test.ts",
      kind: "searchCreatedMultiSetLock",
      required: [
        "lockCodes(restored.session.state, wyvern.uid)).toEqual([22, 23, 24, 69])",
        'action.type === "normalSummon"',
        'action.type === "setMonster"',
        'action.type === "setSpellTrap"',
      ],
    },
    {
      file: "test/lua-real-script-hidden-armory-summon-set-lock.test.ts",
      kind: "searchCreatedSummonSetLock",
      required: [
        "lockCodes(restored.session, hiddenArmory.uid)).toEqual([20, 23])",
        "lockCodes(restoredLock.session, hiddenArmory.uid)).toEqual([20, 23])",
        'eventName: "sentToHandConfirmed"',
        'action.type === "normalSummon"',
        'action.type === "setMonster"',
      ],
    },
    {
      file: "test/lua-real-script-dark-simorgh-set-lock.test.ts",
      kind: "continuousSpellTrapSetLock",
      required: [
        'action.type === "normalSummon"',
        'action.type === "setMonster"',
        'action.type === "setSpellTrap"',
        "dark simorgh turn set false/false/true",
      ],
    },
    {
      file: "test/lua-real-script-fusion-conscription-monster-effect-lock.test.ts",
      kind: "searchedCodeActivationLock",
      required: [
        "target:same-code-label",
        "cannot-activate:same-code-monster-effect",
        'action.type === "normalSummon"',
        'action.type === "setMonster"',
        'action.type === "activateEffect"',
      ],
    },
    {
      file: "test/lua-real-script-second-sarcophagus-self-set-lock.test.ts",
      kind: "continuousSelfSpellTrapSetSpecialLock",
      required: [
        "restores its static cannot-SSet and cannot-Special-Summon self restrictions",
        "e1:SetCode(EFFECT_CANNOT_SSET)",
        "e2:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)",
        "lockCodes(restored.session, secondSarcophagus.uid)).toEqual([effectCannotSpecialSummon, effectCannotSSet])",
        'action.type === "setSpellTrap"',
        "second sarcophagus ssetable true/true",
        "canSpecialSummonDuelCard(restoredMonster.session.state, monsterSarcophagus.uid, 0, undefined, undefined, true)).toBe(false)",
        "second sarcophagus sset result 0",
        "second sarcophagus ordinary sset result 1",
      ],
    },
    {
      file: "test/lua-real-script-light-intervention-set-lock.test.ts",
      kind: "continuousMonsterSetLock",
      required: [
        'action.type === "setMonster"',
        'type: "normalSummon", uid: playerHandMonster!.uid',
        "restoredActivation.missingRegistryKeys).toEqual([])",
        "restoredActivation.missingChainLimitRegistryKeys).toEqual([])",
        "restoredLock.missingRegistryKeys).toEqual([])",
        "restoredLock.missingChainLimitRegistryKeys).toEqual([])",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: SearchSetLockKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countSearchSetLockKinds(
  fixtures: Array<{ kind: SearchSetLockKind }>,
): Record<SearchSetLockKind, number> {
  return fixtures.reduce<Record<SearchSetLockKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      continuousMonsterSetLock: 0,
      continuousSelfSpellTrapSetSpecialLock: 0,
      continuousSpellTrapSetLock: 0,
      facedownSpecialSummonLock: 0,
      searchCreatedSummonSetLock: 0,
      searchCreatedMultiSetLock: 0,
      searchedCodeActivationLock: 0,
    },
  );
}

function searchSetLockSemanticVariants(): Array<{
  file: string;
  kind: SearchSetLockSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-ancient-gear-wyvern-facedown-summon-lock.test.ts",
      kind: "ancientGearWyvernFaceDownSpecialSummonLock",
      required: [
        'const wyvernCode = "17663375"',
        "restores its face-down special summon lock",
        "wyvern facedown special 0",
      ],
    },
    {
      file: "test/lua-real-script-ancient-gear-wyvern-set-locks.test.ts",
      kind: "ancientGearWyvernPostSearchMultiSetLocks",
      required: [
        'const wyvernCode = "17663375"',
        "restores its post-search monster and Spell/Trap Set locks while leaving Normal Summons legal",
        "lockCodes(restored.session.state, wyvern.uid)).toEqual([22, 23, 24, 69])",
      ],
    },
    {
      file: "test/lua-real-script-dark-simorgh-set-lock.test.ts",
      kind: "darkSimorghOpponentSetLocks",
      required: [
        'const simorghCode = "11366199"',
        "restores its opponent monster and Spell/Trap Set locks from a monster source",
        "dark simorgh turn set false/false/true",
      ],
    },
    {
      file: "test/lua-real-script-fusion-conscription-monster-effect-lock.test.ts",
      kind: "fusionConscriptionSearchedCodeLocks",
      required: [
        'const conscriptionCode = "17194258"',
        "restores searched-code summon, set, and monster-effect activation locks",
        "cannot-activate:same-code-monster-effect",
      ],
    },
    {
      file: "test/lua-real-script-hidden-armory-summon-set-lock.test.ts",
      kind: "hiddenArmorySearchCreatedSummonSetOath",
      required: [
        'const hiddenArmoryCode = "52105192"',
        "restores its Deck discard cost, Equip search, and Normal Summon/Set oath locks",
        "lockCodes(restored.session, hiddenArmory.uid)).toEqual([20, 23])",
      ],
    },
    {
      file: "test/lua-real-script-second-sarcophagus-self-set-lock.test.ts",
      kind: "secondSarcophagusSelfSetSpecialLocks",
      required: [
        'const secondSarcophagusCode = "4081094"',
        "restores its static cannot-SSet and cannot-Special-Summon self restrictions",
        "e1:SetCode(EFFECT_CANNOT_SSET)",
        "e2:SetCode(EFFECT_CANNOT_SPECIAL_SUMMON)",
        "second sarcophagus ssetable true/true",
        'action.type === "normalSummon" && action.uid === ordinaryMonster.uid',
      ],
    },
    {
      file: "test/lua-real-script-light-intervention-set-lock.test.ts",
      kind: "lightInterventionPlayerTargetedSetLocks",
      required: [
        'const lightCode = "62867251"',
        "restores official player-targeted monster Set and turn-Set restrictions",
        'type: "normalSummon", uid: playerHandMonster!.uid',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: SearchSetLockSemanticVariant;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countSearchSetLockSemanticVariants(
  fixtures: Array<{ kind: SearchSetLockSemanticVariant }>,
): Record<SearchSetLockSemanticVariant, number> {
  return fixtures.reduce<Record<SearchSetLockSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      ancientGearWyvernFaceDownSpecialSummonLock: 0,
      ancientGearWyvernPostSearchMultiSetLocks: 0,
      darkSimorghOpponentSetLocks: 0,
      fusionConscriptionSearchedCodeLocks: 0,
      hiddenArmorySearchCreatedSummonSetOath: 0,
      lightInterventionPlayerTargetedSetLocks: 0,
      secondSarcophagusSelfSetSpecialLocks: 0,
    },
  );
}
