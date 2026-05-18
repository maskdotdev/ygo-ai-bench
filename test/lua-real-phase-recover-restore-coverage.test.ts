import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const phaseRecoverFixtureCount = 1;
const phaseRecoverKindCounts = {
  standbyGraveyardRecover: 1,
} satisfies Record<PhaseRecoverKind, number>;
const phaseRecoverSemanticVariantCounts = {
  darklordMarieStandbyGraveyardRecover: 1,
} satisfies Record<PhaseRecoverSemanticVariant, number>;

type PhaseRecoverKind = "standbyGraveyardRecover";
type PhaseRecoverSemanticVariant = "darklordMarieStandbyGraveyardRecover";

describe("Lua real phase recover restore coverage", () => {
  it("requires phase recover fixtures to assert clean Lua registry restore and restored legal actions", () => {
    const fixtures = phaseRecoverFixtureFiles();
    expect(fixtures).toHaveLength(phaseRecoverFixtureCount);

    const missing = fixtures
      .filter(({ file }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("applyLuaRestoreResponse");
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires phase recover fixtures to prove operation info, phase trigger, LP changes, and recover events", () => {
    const fixtures = phaseRecoverFixtureFiles();
    expect(fixtures).toHaveLength(phaseRecoverFixtureCount);

    const missing = fixtures
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("operationInfos")
          || !text.includes("category: 0x100000")
          || !text.includes('eventName: "phaseStandby"')
          || !text.includes('eventName: "recoveredLifePoints"')
          || !text.includes("lifePoints")
          || !text.includes('location: "graveyard"')
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps phase recover fixture kinds explicit", () => {
    expect(countPhaseRecoverKinds(phaseRecoverFixtureFiles())).toEqual(phaseRecoverKindCounts);
  });

  it("keeps named phase recover semantic variants explicit", () => {
    expect(countPhaseRecoverSemanticVariants(phaseRecoverSemanticVariants())).toEqual(phaseRecoverSemanticVariantCounts);

    const weak = phaseRecoverSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function phaseRecoverFixtureFiles(): Array<{ file: string; kind: PhaseRecoverKind; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-darklord-marie-standby-recover.test.ts",
      kind: "standbyGraveyardRecover",
      required: [
        'const marieCode = "57579381"',
        "restores its mandatory Standby Phase graveyard recovery from CHAININFO target player and param",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)",
        "triggerBucket: \"turnMandatory\"",
        "eventCode: 0x1002",
        "targetParam: 200",
        "targetPlayer: 0",
        "players[0].lifePoints).toBe(8200)",
      ],
    },
  ];
}

function phaseRecoverSemanticVariants(): Array<{ file: string; kind: PhaseRecoverSemanticVariant; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-darklord-marie-standby-recover.test.ts",
      kind: "darklordMarieStandbyGraveyardRecover",
      required: [
        'const marieCode = "57579381"',
        "Duel.SetTargetPlayer(tp)",
        "Duel.SetTargetParam(200)",
        "Duel.SetOperationInfo(0,CATEGORY_RECOVER,nil,0,tp,200)",
        "Duel.Recover(p,d,REASON_EFFECT)",
      ],
    },
  ];
}

function countPhaseRecoverKinds(fixtures: Array<{ kind: PhaseRecoverKind }>): Record<PhaseRecoverKind, number> {
  return fixtures.reduce<Record<PhaseRecoverKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      standbyGraveyardRecover: 0,
    },
  );
}

function countPhaseRecoverSemanticVariants(
  fixtures: Array<{ kind: PhaseRecoverSemanticVariant }>,
): Record<PhaseRecoverSemanticVariant, number> {
  return fixtures.reduce<Record<PhaseRecoverSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      darklordMarieStandbyGraveyardRecover: 0,
    },
  );
}
