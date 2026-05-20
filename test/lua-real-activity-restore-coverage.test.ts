import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const activityKindCounts = {
  customSpecialSummonOath: 2,
  mulcharmyChainSummonCounters: 1,
} satisfies Record<ActivityKind, number>;
const activitySemanticVariantCounts = {
  movementSoloCustomSpecialSummonOath: 1,
  mulcharmySharedChainLimitAndDelayedDraw: 1,
  supayDiscardSelfSummonSynchroOath: 1,
} satisfies Record<ActivitySemanticVariant, number>;

type ActivityKind = "customSpecialSummonOath" | "mulcharmyChainSummonCounters";

type ActivitySemanticVariant = "movementSoloCustomSpecialSummonOath" | "mulcharmySharedChainLimitAndDelayedDraw" | "supayDiscardSelfSummonSynchroOath";

describe("Lua real activity restore coverage", () => {
  it("requires representative activity fixtures to assert clean Lua restore", () => {
    const missing = realScriptActivityFixtureFiles()
      .filter(({ file }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("getLuaRestoreLegalActions");
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires representative activity fixtures to prove restored activity counters and delayed operations", () => {
    const missing = realScriptActivityFixtureFiles()
      .filter(({ file, requiredSnippets }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("activityHistory")
          || requiredSnippets.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps activity fixture kinds explicit", () => {
    expect(countActivityKinds(realScriptActivityFixtureFiles())).toEqual(activityKindCounts);
  });

  it("keeps named activity semantic variants explicit", () => {
    expect(countActivitySemanticVariants(activitySemanticVariants())).toEqual(activitySemanticVariantCounts);

    const weak = activitySemanticVariants()
      .filter(({ file, requiredSnippets }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return requiredSnippets.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });

  it("keeps activity fixtures script-gated and database-independent", () => {
    const weak = activitySemanticVariants()
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

function realScriptActivityFixtureFiles(): Array<{
  file: string;
  kind: ActivityKind;
  requiredSnippets: string[];
}> {
  return [
    {
      file: "test/lua-real-script-1st-movement-solo-activity-lock.test.ts",
      kind: "customSpecialSummonOath",
      requiredSnippets: [
        "Duel.AddCustomActivityCounter(id,ACTIVITY_SPSUMMON,s.counterfilter)",
        "Duel.GetCustomActivityCount(id,tp,ACTIVITY_SPSUMMON)==0",
        "activity === duelActivitySpecialSummon",
        "target:not-setcode",
        "off-set hand probe resolved",
        "melodious hand probe resolved",
      ],
    },
    {
      file: "test/lua-real-script-mulcharmy-activity.test.ts",
      kind: "mulcharmyChainSummonCounters",
      requiredSnippets: [
        "Mulcharmy activity counters",
        "toHaveLength(1)",
        "toHaveLength(2)",
        "getLuaRestoreLegalActions(restoredAfterPurulia, 0).some",
        "chain summoner hand after summon 0",
        'location: "hand", controller: 0',
      ],
    },
    {
      file: "test/lua-real-script-supay-duskwalker-discard-summon-lock.test.ts",
      kind: "customSpecialSummonOath",
      requiredSnippets: [
        "Duel.AddCustomActivityCounter(id,ACTIVITY_SPSUMMON,s.counterfilter)",
        "Duel.GetCustomActivityCount(id,tp,ACTIVITY_SPSUMMON)==0",
        "Duel.DiscardHand(tp,Card.IsDiscardable,1,1,REASON_COST|REASON_DISCARD,c)",
        "Duel.SelectYesNo(tp,aux.Stringid(id,1))",
        "activity === duelActivitySpecialSummon",
        "special-summon-limit:not-type-extra:8192",
        "target:not-original-type:8192",
        "supay fusion extra special 0",
        "supay synchro extra special 1",
      ],
    },
  ];
}

function countActivityKinds(fixtures: Array<{ kind: ActivityKind }>): Record<ActivityKind, number> {
  return fixtures.reduce<Record<ActivityKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      customSpecialSummonOath: 0,
      mulcharmyChainSummonCounters: 0,
    },
  );
}

function activitySemanticVariants(): Array<{
  file: string;
  kind: ActivitySemanticVariant;
  requiredSnippets: string[];
}> {
  return [
    {
      file: "test/lua-real-script-1st-movement-solo-activity-lock.test.ts",
      kind: "movementSoloCustomSpecialSummonOath",
      requiredSnippets: [
        'const soloCode = "44256816"',
        "restores custom Special Summon activity cost, Melodious-only oath lock, and hand summon filtering",
        "record.player === 0 && record.activity === duelActivitySpecialSummon",
        'luaTargetDescriptor: `target:not-setcode:${setMelodious}`',
        "expect(restoredLocked.host.messages).not.toContain(\"off-set hand probe resolved\")",
        "expect(restoredAfterBlockedProbe.host.messages).toContain(\"melodious hand probe resolved\")",
      ],
    },
    {
      file: "test/lua-real-script-mulcharmy-activity.test.ts",
      kind: "mulcharmySharedChainLimitAndDelayedDraw",
      requiredSnippets: [
        'const fuwalosCode = "42141493"',
        'const puruliaCode = "84192580"',
        'const meowlsCode = "87126721"',
        "counts real Mulcharmy monster effect chain activations for the shared two-activation limit",
        "delays restored Mulcharmy chain-solving draws until the current chain link is solved",
        "record.activity === duelActivity.chain",
        "effectId?.startsWith(\"lua-\")",
        "action.type === \"activateEffect\" && action.uid === meowls?.uid)).toBe(false)",
        "chain summoner hand after summon 0",
      ],
    },
    {
      file: "test/lua-real-script-supay-duskwalker-discard-summon-lock.test.ts",
      kind: "supayDiscardSelfSummonSynchroOath",
      requiredSnippets: [
        'const supayCode = "17315396"',
        "restores discard-cost self summon, optional listed summon, and Extra Deck Synchro oath",
        "Duel.DiscardHand(tp,Card.IsDiscardable,1,1,REASON_COST|REASON_DISCARD,c)",
        "Duel.SelectYesNo(tp,aux.Stringid(id,1))",
        "record.player === 0 && record.activity === duelActivitySpecialSummon",
        'luaTargetDescriptor: "special-summon-limit:not-type-extra:8192"',
        'luaTargetDescriptor: "target:not-original-type:8192"',
        '"supay fusion extra special 0"',
        '"supay synchro extra special 1"',
      ],
    },
  ];
}

function countActivitySemanticVariants(fixtures: Array<{ kind: ActivitySemanticVariant }>): Record<ActivitySemanticVariant, number> {
  return fixtures.reduce<Record<ActivitySemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      movementSoloCustomSpecialSummonOath: 0,
      mulcharmySharedChainLimitAndDelayedDraw: 0,
      supayDiscardSelfSummonSynchroOath: 0,
    },
  );
}
