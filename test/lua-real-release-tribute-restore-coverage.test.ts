import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const releaseAndTributeFixtureCount = 9;
const legalActionFixtureCount = 7;
const releaseAndTributeKindCounts = {
  archetypeCannotRelease: 1,
  attributeTributeLimit: 1,
  extraDeckReleaseCost: 1,
  globalCannotRelease: 1,
  linkReleaseCost: 1,
  plantReleaseCost: 1,
  raceTributeLimit: 1,
  setcodeTributeLimit: 1,
  unreleasableTributeLock: 1,
} satisfies Record<ReleaseAndTributeKind, number>;
const releaseAndTributeSemanticVariantCounts = {
  amorphageWrathConditionalCannotRelease: 1,
  apoqliphortSetcodeTributeLimit: 1,
  assaultZoneExtraDeckReleaseCost: 1,
  diabolosAttributeTributeLimit: 1,
  maskOfRestrictGlobalCannotRelease: 1,
  pollinosisPlantReleaseCost: 1,
  sprightRedLinkReleaseCost: 1,
  troposphereRaceTributeLimit: 1,
  yellowDustonUnreleasableTributeLock: 1,
} satisfies Record<ReleaseAndTributeSemanticVariant, number>;

type ReleaseAndTributeKind =
  | "archetypeCannotRelease"
  | "attributeTributeLimit"
  | "extraDeckReleaseCost"
  | "globalCannotRelease"
  | "linkReleaseCost"
  | "plantReleaseCost"
  | "raceTributeLimit"
  | "setcodeTributeLimit"
  | "unreleasableTributeLock";
type ReleaseAndTributeSemanticVariant =
  | "amorphageWrathConditionalCannotRelease"
  | "apoqliphortSetcodeTributeLimit"
  | "assaultZoneExtraDeckReleaseCost"
  | "diabolosAttributeTributeLimit"
  | "maskOfRestrictGlobalCannotRelease"
  | "pollinosisPlantReleaseCost"
  | "sprightRedLinkReleaseCost"
  | "troposphereRaceTributeLimit"
  | "yellowDustonUnreleasableTributeLock";

describe("Lua real release and tribute restore coverage", () => {
  it("requires release and tribute restriction fixtures to assert clean Lua registry restore", () => {
    const files = releaseAndTributeFixtureFiles();
    expect(files).toHaveLength(releaseAndTributeFixtureCount);

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

  it("requires UI-facing legal-action parity where restored release and tribute locks expose actions", () => {
    const files = legalActionFixtureFiles();
    expect(files).toHaveLength(legalActionFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("getLuaRestoreLegalActions");
      });

    expect(missing).toEqual([]);
  });

  it("keeps release and tribute fixture kinds explicit", () => {
    expect(countReleaseAndTributeKinds(releaseAndTributeFixtureFiles())).toEqual(releaseAndTributeKindCounts);
  });

  it("keeps named release and tribute semantic variants explicit", () => {
    expect(countReleaseAndTributeSemanticVariants(releaseAndTributeSemanticVariants())).toEqual(
      releaseAndTributeSemanticVariantCounts,
    );

    const weak = releaseAndTributeSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function releaseAndTributeFixtureFiles(): Array<{
  file: string;
  kind: ReleaseAndTributeKind;
  required: string[];
}> {
  return ([
    {
      file: "lua-real-script-amorphage-wrath-release-lock.test.ts",
      kind: "archetypeCannotRelease",
      required: [
        "EFFECT_CANNOT_RELEASE",
        "target:not-setcode:",
        "amorphage releasable true/false/false",
        "amorphage release locked 0",
        "amorphage release allowed 1",
      ],
    },
    {
      file: "lua-real-script-apoqliphort-tribute-limit.test.ts",
      kind: "setcodeTributeLimit",
      required: [
        "EFFECT_TRIBUTE_LIMIT",
        "cannot-material:target-not-setcode:170",
        "tributeSummon",
        "cannot be released",
        "normalTributes).toBe(3)",
      ],
    },
    {
      file: "lua-real-script-assault-zone-extra-deck-release-cost.test.ts",
      kind: "extraDeckReleaseCost",
      required: [
        "effectExtraReleaseNonsum",
        "targetRange: [locationExtra, 0]",
        "duelReason.release | duelReason.cost",
        "previousLocation: \"extraDeck\"",
        "stardustAssault",
      ],
    },
    {
      file: "lua-real-script-diabolos-tribute-limit.test.ts",
      kind: "attributeTributeLimit",
      required: [
        "EFFECT_TRIBUTE_LIMIT",
        "cannot-material:target-not-attribute:32",
        "tributeSummon",
        "cannot be released",
        "Dark Tribute Target",
      ],
    },
    {
      file: "lua-real-script-mask-of-restrict-cannot-release.test.ts",
      kind: "globalCannotRelease",
      required: [
        "EFFECT_CANNOT_RELEASE",
        "targetRange: [1, 1]",
        "mask release predicates false/false/false",
        "mask release result 0",
      ],
    },
    {
      file: "lua-real-script-pollinosis-release-activation-negate.test.ts",
      kind: "plantReleaseCost",
      required: [
        "Duel.CheckReleaseGroupCost(tp,s.filter,1,false,nil,nil)",
        "Duel.SelectReleaseGroupCost(tp,s.filter,1,1,false,nil,nil)",
        "c:IsRace(RACE_PLANT)",
        "duelReason.cost | duelReason.release",
        'eventName: "released"',
      ],
    },
    {
      file: "lua-real-script-spright-red-release-link2-negate.test.ts",
      kind: "linkReleaseCost",
      required: [
        "Duel.CheckReleaseGroupCost(tp,s.discostfilter,1,false,nil,c)",
        "Duel.SelectReleaseGroupCost(tp,s.discostfilter,1,1,false,nil,c)",
        "return c:IsLevel(2) or c:IsRank(2) or c:IsLink(2)",
        "duelReason.cost | duelReason.release",
        'eventName: "released"',
      ],
    },
    {
      file: "lua-real-script-troposphere-tribute-limit.test.ts",
      kind: "raceTributeLimit",
      required: [
        "EFFECT_TRIBUTE_LIMIT",
        "cannot-material:target-not-race:512",
        "tributeSummon",
        "cannot be released",
        "Winged Beast Tribute",
      ],
    },
    {
      file: "lua-real-script-yellow-duston-unreleasable-tribute-lock.test.ts",
      kind: "unreleasableTributeLock",
      required: [
        "Yellow Duston unreleasable tribute lock",
        "code: 43",
        "code: 44",
        "tributeSummon",
        "cannot be released",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: ReleaseAndTributeKind;
    required: string[];
  }>)
    .map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function legalActionFixtureFiles(): string[] {
  return [
    "lua-real-script-apoqliphort-tribute-limit.test.ts",
    "lua-real-script-assault-zone-extra-deck-release-cost.test.ts",
    "lua-real-script-diabolos-tribute-limit.test.ts",
    "lua-real-script-pollinosis-release-activation-negate.test.ts",
    "lua-real-script-spright-red-release-link2-negate.test.ts",
    "lua-real-script-troposphere-tribute-limit.test.ts",
    "lua-real-script-yellow-duston-unreleasable-tribute-lock.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function releaseAndTributeSemanticVariants(): Array<{
  file: string;
  kind: ReleaseAndTributeSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "lua-real-script-amorphage-wrath-release-lock.test.ts",
      kind: "amorphageWrathConditionalCannotRelease",
      required: [
        'const wrathCode = "79794767"',
        "restores official conditional EFFECT_CANNOT_RELEASE with its non-Amorphage target filter",
        "amorphage releasable true/false/false",
      ],
    },
    {
      file: "lua-real-script-apoqliphort-tribute-limit.test.ts",
      kind: "apoqliphortSetcodeTributeLimit",
      required: [
        'const skybaseCode = "40061558"',
        "restores target-owned EFFECT_TRIBUTE_LIMIT material setcode checks",
        "cannot-material:target-not-setcode:170",
      ],
    },
    {
      file: "lua-real-script-assault-zone-extra-deck-release-cost.test.ts",
      kind: "assaultZoneExtraDeckReleaseCost",
      required: [
        'const assaultZoneCode = "91002901"',
        "activates Assault Mode Activate by releasing a Synchro Monster from the Extra Deck after restore",
        "effectExtraReleaseNonsum",
      ],
    },
    {
      file: "lua-real-script-diabolos-tribute-limit.test.ts",
      kind: "diabolosAttributeTributeLimit",
      required: [
        'const diabolosCode = "29424328"',
        "restores official EFFECT_TRIBUTE_LIMIT target attribute checks",
        "cannot-material:target-not-attribute:32",
      ],
    },
    {
      file: "lua-real-script-mask-of-restrict-cannot-release.test.ts",
      kind: "maskOfRestrictGlobalCannotRelease",
      required: [
        'const maskCode = "29549364"',
        "restores official EFFECT_CANNOT_RELEASE and blocks release queries and movement",
        "mask release predicates false/false/false",
      ],
    },
    {
      file: "lua-real-script-pollinosis-release-activation-negate.test.ts",
      kind: "pollinosisPlantReleaseCost",
      required: [
        'const pollinosisCode = "91078716"',
        "restores its Plant release cost, activation negation, source destruction, and suppressed Spell operation",
        "Duel.CheckReleaseGroupCost(tp,s.filter,1,false,nil,nil)",
        "Duel.SelectReleaseGroupCost(tp,s.filter,1,1,false,nil,nil)",
        'eventName: "released"',
      ],
    },
    {
      file: "lua-real-script-spright-red-release-link2-negate.test.ts",
      kind: "sprightRedLinkReleaseCost",
      required: [
        'const sprightRedCode = "75922381"',
        "restores its hand summon procedure, Link-2 release cost, yes/no destroy prompt, negation, and suppressed monster operation",
        "Duel.CheckReleaseGroupCost(tp,s.discostfilter,1,false,nil,c)",
        "Duel.SelectReleaseGroupCost(tp,s.discostfilter,1,1,false,nil,c)",
        'eventName: "released"',
      ],
    },
    {
      file: "lua-real-script-troposphere-tribute-limit.test.ts",
      kind: "troposphereRaceTributeLimit",
      required: [
        'const troposphereCode = "72144675"',
        "restores target-owned EFFECT_TRIBUTE_LIMIT material race checks",
        "cannot-material:target-not-race:512",
      ],
    },
    {
      file: "lua-real-script-yellow-duston-unreleasable-tribute-lock.test.ts",
      kind: "yellowDustonUnreleasableTributeLock",
      required: [
        'const dustonCode = "16366810"',
        "restores official unreleasable summon lock and removes Tribute Summon actions",
        "cannot be released",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: ReleaseAndTributeSemanticVariant;
    required: string[];
  }>)
    .map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function countReleaseAndTributeKinds(
  fixtures: Array<{ kind: ReleaseAndTributeKind }>,
): Record<ReleaseAndTributeKind, number> {
  return fixtures.reduce<Record<ReleaseAndTributeKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      archetypeCannotRelease: 0,
      attributeTributeLimit: 0,
      extraDeckReleaseCost: 0,
      globalCannotRelease: 0,
      linkReleaseCost: 0,
      plantReleaseCost: 0,
      raceTributeLimit: 0,
      setcodeTributeLimit: 0,
      unreleasableTributeLock: 0,
    },
  );
}

function countReleaseAndTributeSemanticVariants(
  fixtures: Array<{ kind: ReleaseAndTributeSemanticVariant }>,
): Record<ReleaseAndTributeSemanticVariant, number> {
  return fixtures.reduce<Record<ReleaseAndTributeSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      amorphageWrathConditionalCannotRelease: 0,
      apoqliphortSetcodeTributeLimit: 0,
      assaultZoneExtraDeckReleaseCost: 0,
      diabolosAttributeTributeLimit: 0,
      maskOfRestrictGlobalCannotRelease: 0,
      pollinosisPlantReleaseCost: 0,
      sprightRedLinkReleaseCost: 0,
      troposphereRaceTributeLimit: 0,
      yellowDustonUnreleasableTributeLock: 0,
    },
  );
}
