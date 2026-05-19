import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const phaseDamageFixtureCount = 1;
const phaseDamageKindCounts = {
  standbyBanishedMonsterDamage: 1,
} satisfies Record<PhaseDamageKind, number>;
const phaseDamageSemanticVariantCounts = {
  graverobbersRetributionStandbyBanishedMonsterDamage: 1,
} satisfies Record<PhaseDamageSemanticVariant, number>;

type PhaseDamageKind = "standbyBanishedMonsterDamage";
type PhaseDamageSemanticVariant = "graverobbersRetributionStandbyBanishedMonsterDamage";

describe("Lua real phase damage restore coverage", () => {
  it("requires phase damage fixtures to assert clean Lua registry restore and restored legal actions", () => {
    const fixtures = phaseDamageFixtureFiles();
    expect(fixtures).toHaveLength(phaseDamageFixtureCount);

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

  it("requires phase damage fixtures to prove operation info, phase trigger, LP changes, and damage events", () => {
    const fixtures = phaseDamageFixtureFiles();
    expect(fixtures).toHaveLength(phaseDamageFixtureCount);

    const missing = fixtures
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("operationInfos")
          || !text.includes("category: 0x80000")
          || !text.includes('eventName: "phaseStandby"')
          || !text.includes('eventName: "damageDealt"')
          || !text.includes("lifePoints")
          || !text.includes('"banished", 1')
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps phase damage fixture kinds explicit", () => {
    expect(countPhaseDamageKinds(phaseDamageFixtureFiles())).toEqual(phaseDamageKindCounts);
  });

  it("keeps named phase damage semantic variants explicit", () => {
    expect(countPhaseDamageSemanticVariants(phaseDamageSemanticVariants())).toEqual(phaseDamageSemanticVariantCounts);

    const weak = phaseDamageSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });

  it("keeps phase damage fixtures script-gated and database-scoped", () => {
    const weak = phaseDamageSemanticVariants()
      .filter(({ file }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("workspace.readScript")
          || !text.includes("workspace.readDatabaseCards")
          || !text.includes("describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)");
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function phaseDamageFixtureFiles(): Array<{ file: string; kind: PhaseDamageKind; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-graverobbers-retribution-standby-damage.test.ts",
      kind: "standbyBanishedMonsterDamage",
      required: [
        'const graverobbersCode = "33737664"',
        "restores its mandatory Standby trigger and counts opponent face-up banished monsters for damage",
        "Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER)",
        "Duel.GetMatchingGroupCount(s.filter,tp,0,LOCATION_REMOVED,nil)*100",
        "triggerBucket: \"turnMandatory\"",
        "eventCode: 0x1002",
        "targetPlayer: 1",
        "eventValue: 200",
        "players[1].lifePoints).toBe(7800)",
      ],
    },
  ];
}

function phaseDamageSemanticVariants(): Array<{ file: string; kind: PhaseDamageSemanticVariant; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-graverobbers-retribution-standby-damage.test.ts",
      kind: "graverobbersRetributionStandbyBanishedMonsterDamage",
      required: [
        'const graverobbersCode = "33737664"',
        "return tp==Duel.GetTurnPlayer()",
        "Duel.SetTargetPlayer(1-tp)",
        "Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,0)",
        "Duel.Damage(p,d,REASON_EFFECT)",
      ],
    },
  ];
}

function countPhaseDamageKinds(fixtures: Array<{ kind: PhaseDamageKind }>): Record<PhaseDamageKind, number> {
  return fixtures.reduce<Record<PhaseDamageKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      standbyBanishedMonsterDamage: 0,
    },
  );
}

function countPhaseDamageSemanticVariants(
  fixtures: Array<{ kind: PhaseDamageSemanticVariant }>,
): Record<PhaseDamageSemanticVariant, number> {
  return fixtures.reduce<Record<PhaseDamageSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      graverobbersRetributionStandbyBanishedMonsterDamage: 0,
    },
  );
}
