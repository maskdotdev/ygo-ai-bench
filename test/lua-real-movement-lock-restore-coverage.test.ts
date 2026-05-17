import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const MOVEMENT_LOCK_FIXTURE_COUNT = 3;
const movementLockKindCounts = {
  banishLock: 1,
  deckToGraveLock: 1,
  searchLock: 1,
} satisfies Record<MovementLockKind, number>;
const movementLockSemanticVariantCounts = {
  artifactLanceaTemporaryBanishLock: 1,
  dimensionFortressDeckToGraveLock: 1,
  thunderKingDeckToHandSearchLock: 1,
} satisfies Record<MovementLockSemanticVariant, number>;

type MovementLockKind = "banishLock" | "deckToGraveLock" | "searchLock";

type MovementLockSemanticVariant =
  | "artifactLanceaTemporaryBanishLock"
  | "dimensionFortressDeckToGraveLock"
  | "thunderKingDeckToHandSearchLock";

describe("Lua real movement-lock restore coverage", () => {
  it("requires representative movement locks to assert clean Lua restore and blocked movement probes", () => {
    const files = movementLockFixtureFiles();
    expect(files).toHaveLength(MOVEMENT_LOCK_FIXTURE_COUNT);

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

  it("keeps movement-lock fixture kinds explicit", () => {
    expect(countMovementLockKinds(movementLockFixtureFiles())).toEqual(movementLockKindCounts);
  });

  it("keeps named movement-lock semantic variants explicit", () => {
    expect(countMovementLockSemanticVariants(movementLockSemanticVariants())).toEqual(movementLockSemanticVariantCounts);

    const weak = movementLockSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function movementLockFixtureFiles(): Array<{
  file: string;
  kind: MovementLockKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-artifact-lancea-banish-lock.test.ts",
      kind: "banishLock",
      required: [
        "EFFECT_CANNOT_REMOVE",
        "lancea self able remove locked false",
        "lancea opp able remove locked false",
        "lancea self remove locked 0/0",
        "lancea opp remove locked 0/0",
        "lancea self remove after end 1/1",
        "lancea opp remove after end 1/1",
      ],
    },
    {
      file: "test/lua-real-script-dimension-fortress-deck-grave-lock.test.ts",
      kind: "deckToGraveLock",
      required: [
        "code: 68",
        "targetRange: [1, 1]",
        "fortress self able grave false",
        "fortress opp able grave false",
        "fortress self grave result 0/0",
        "fortress opp grave result 0/0",
      ],
    },
    {
      file: "test/lua-real-script-thunder-king-search-lock.test.ts",
      kind: "searchLock",
      required: [
        "code: 65",
        "targetRange: [1, 1]",
        "thunder self able hand false",
        "thunder opp able hand false",
        "thunder self hand result 0/0",
        "thunder opp hand result 0/0",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: MovementLockKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countMovementLockKinds(fixtures: Array<{ kind: MovementLockKind }>): Record<MovementLockKind, number> {
  return fixtures.reduce<Record<MovementLockKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      banishLock: 0,
      deckToGraveLock: 0,
      searchLock: 0,
    },
  );
}

function movementLockSemanticVariants(): Array<{
  file: string;
  kind: MovementLockSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-artifact-lancea-banish-lock.test.ts",
      kind: "artifactLanceaTemporaryBanishLock",
      required: [
        'const lanceaCode = "34267821"',
        "restores official temporary EFFECT_CANNOT_REMOVE and blocks banish helpers until End Phase",
        "lancea self able remove locked false",
        "lancea opp able remove locked false",
        "lancea self able remove after end true",
        "lancea opp able remove after end true",
      ],
    },
    {
      file: "test/lua-real-script-dimension-fortress-deck-grave-lock.test.ts",
      kind: "dimensionFortressDeckToGraveLock",
      required: [
        'const fortressCode = "1596508"',
        "restores official EFFECT_CANNOT_TO_GRAVE and blocks Deck-to-GY movement for both players",
        'registryKey: "lua:1596508:lua-1-68"',
        "fortress self able grave false",
        "fortress opp grave result 0/0",
        "location: \"deck\"",
      ],
    },
    {
      file: "test/lua-real-script-thunder-king-search-lock.test.ts",
      kind: "thunderKingDeckToHandSearchLock",
      required: [
        'const thunderKingCode = "71564252"',
        "restores official EFFECT_CANNOT_TO_HAND and blocks Deck-to-hand movement for both players",
        'registryKey: "lua:71564252:lua-1-65"',
        "thunder self able hand false",
        "thunder opp hand result 0/0",
        "location: \"deck\"",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: MovementLockSemanticVariant;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countMovementLockSemanticVariants(fixtures: Array<{ kind: MovementLockSemanticVariant }>): Record<MovementLockSemanticVariant, number> {
  return fixtures.reduce<Record<MovementLockSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      artifactLanceaTemporaryBanishLock: 0,
      dimensionFortressDeckToGraveLock: 0,
      thunderKingDeckToHandSearchLock: 0,
    },
  );
}
