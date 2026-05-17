import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const resourceGateFixtureCount = 5;
const resourceGateKindCounts = {
  drawPhaseLock: 1,
  effectReleaseLock: 1,
  extraReleaseCost: 1,
  nonDrawPhaseLock: 1,
  unreleasableMonster: 1,
} satisfies Record<ResourceGateKind, number>;
const resourceGateSemanticVariantCounts = {
  dForcePlasmaDrawPhaseCannotDraw: 1,
  diabolosEffectReleaseLockCostReleaseAllowed: 1,
  protectorSanctuaryNonDrawPhaseCannotDraw: 1,
  redDustonUnreleasableSummonLocks: 1,
  rikkaKonkonOpponentExtraReleaseCost: 1,
} satisfies Record<ResourceGateSemanticVariant, number>;

type ResourceGateKind = "drawPhaseLock" | "effectReleaseLock" | "extraReleaseCost" | "nonDrawPhaseLock" | "unreleasableMonster";
type ResourceGateSemanticVariant =
  | "dForcePlasmaDrawPhaseCannotDraw"
  | "diabolosEffectReleaseLockCostReleaseAllowed"
  | "protectorSanctuaryNonDrawPhaseCannotDraw"
  | "redDustonUnreleasableSummonLocks"
  | "rikkaKonkonOpponentExtraReleaseCost";

describe("Lua real resource gate restore coverage", () => {
  it("requires resource gate fixtures to assert clean restore and restored blocked/allowed outcomes", () => {
    const files = resourceGateFixtureFiles();
    expect(files).toHaveLength(resourceGateFixtureCount);

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

  it("keeps resource gate fixture kinds explicit", () => {
    expect(countResourceGateKinds(resourceGateFixtureFiles())).toEqual(resourceGateKindCounts);
  });

  it("keeps named resource gate semantic variants explicit", () => {
    expect(countResourceGateSemanticVariants(resourceGateSemanticVariants())).toEqual(resourceGateSemanticVariantCounts);

    const weak = resourceGateSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function resourceGateFixtureFiles(): Array<{
  file: string;
  kind: ResourceGateKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-d-force-plasma-cannot-draw.test.ts",
      kind: "drawPhaseLock",
      required: [
        "code === 25",
        "d force can draw with plasma draw phase false",
        "d force draw with plasma draw phase 0/0",
        "d force can draw with plasma main1 true",
        "d force draw without plasma draw phase 1/1",
      ],
    },
    {
      file: "test/lua-real-script-diabolos-effect-release-lock.test.ts",
      kind: "effectReleaseLock",
      required: [
        "costRestored.missingRegistryKeys).toEqual([])",
        "costRestored.missingChainLimitRegistryKeys).toEqual([])",
        "diabolos release predicates true/false/true",
        "diabolos effect release 1",
        "diabolos cost release 1",
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-protector-sanctuary-cannot-draw.test.ts",
      kind: "nonDrawPhaseLock",
      required: [
        "code: 25",
        "protector can draw main1 false",
        "protector draw main1 0/0",
        "protector can draw draw phase true",
        "protector draw draw phase 1/1",
      ],
    },
    {
      file: "test/lua-real-script-red-duston-unreleasable.test.ts",
      kind: "unreleasableMonster",
      required: [
        "code === 43",
        "code === 44",
        "red duston release predicates false/false/false/false",
        "red duston release result 0",
        'location: "monsterZone"',
      ],
    },
    {
      file: "test/lua-real-script-rikka-konkon-extra-release-cost.test.ts",
      kind: "extraReleaseCost",
      required: [
        "code: 158",
        "code: Number(konkonCode)",
        "getLuaRestoreLegalActionGroups",
        "duelReason.release | duelReason.cost",
        'position: "faceUpDefense"',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: ResourceGateKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countResourceGateKinds(fixtures: Array<{ kind: ResourceGateKind }>): Record<ResourceGateKind, number> {
  return fixtures.reduce<Record<ResourceGateKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      drawPhaseLock: 0,
      effectReleaseLock: 0,
      extraReleaseCost: 0,
      nonDrawPhaseLock: 0,
      unreleasableMonster: 0,
    },
  );
}

function resourceGateSemanticVariants(): Array<{
  file: string;
  kind: ResourceGateSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-d-force-plasma-cannot-draw.test.ts",
      kind: "dForcePlasmaDrawPhaseCannotDraw",
      required: [
        'const dForceCode = "6186304"',
        "restores official conditional EFFECT_CANNOT_DRAW only while Plasma is present in Draw Phase",
        "d force can draw with plasma draw phase false",
      ],
    },
    {
      file: "test/lua-real-script-diabolos-effect-release-lock.test.ts",
      kind: "diabolosEffectReleaseLockCostReleaseAllowed",
      required: [
        'const diabolosCode = "29424328"',
        "restores official EFFECT_UNRELEASABLE_EFFECT while leaving cost release legal",
        "diabolos release predicates true/false/true",
      ],
    },
    {
      file: "test/lua-real-script-protector-sanctuary-cannot-draw.test.ts",
      kind: "protectorSanctuaryNonDrawPhaseCannotDraw",
      required: [
        'const protectorCode = "24221739"',
        "restores official EFFECT_CANNOT_DRAW and keeps its phase condition active",
        "protector can draw main1 false",
      ],
    },
    {
      file: "test/lua-real-script-red-duston-unreleasable.test.ts",
      kind: "redDustonUnreleasableSummonLocks",
      required: [
        'const redDustonCode = "61019812"',
        "restores official EFFECT_UNRELEASABLE_SUM and EFFECT_UNRELEASABLE_NONSUM release locks",
        "red duston release predicates false/false/false/false",
      ],
    },
    {
      file: "test/lua-real-script-rikka-konkon-extra-release-cost.test.ts",
      kind: "rikkaKonkonOpponentExtraReleaseCost",
      required: [
        'const konkonCode = "76869711"',
        "uses opponent Konkon extra-release material for Hellebore graveyard revival cost",
        "duelReason.release | duelReason.cost",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: ResourceGateSemanticVariant;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countResourceGateSemanticVariants(
  fixtures: Array<{ kind: ResourceGateSemanticVariant }>,
): Record<ResourceGateSemanticVariant, number> {
  return fixtures.reduce<Record<ResourceGateSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      dForcePlasmaDrawPhaseCannotDraw: 0,
      diabolosEffectReleaseLockCostReleaseAllowed: 0,
      protectorSanctuaryNonDrawPhaseCannotDraw: 0,
      redDustonUnreleasableSummonLocks: 0,
      rikkaKonkonOpponentExtraReleaseCost: 0,
    },
  );
}
