import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const upstreamConstantFile = path.resolve(".upstream/ignis/script/constant.lua");

describe("parity progress report", () => {
  it.skipIf(!fs.existsSync(upstreamConstantFile))("reports scanner-backed parity counts without treating per-card fixture counts as full parity", () => {
    const output = execFileSync("node", ["tools/report-parity-progress.mjs", "--json"], { encoding: "utf8" });
    const report = JSON.parse(output) as {
      luaParity: {
        usedApis: number;
        implementedApis: number;
        missingApiUsages: number;
        upstreamConstants: number;
        localConstants: number;
        missingConstants: number;
      };
      chainLimitPatterns: {
        filesWithCalls: number;
        calls: number;
        unclassifiedCalls: number;
      };
      promptPatterns: {
        filesWithCalls: number;
        calls: number;
        selectOptionCalls: number;
        selectYesNoCalls: number;
        selectEffectCalls: number;
        selectEffectYesNoCalls: number;
        announcementHelperCalls: number;
        unclassifiedCalls: number;
      };
      cleanRestore: {
        restoredFixtures: number;
        totalFixtures: number;
        restorePercent: number;
        legalActionFixtures: number;
        legalActionTotalFixtures: number;
      };
      provenance: {
        files: number;
        expectationBlocks: number;
        edoproBlocks: number;
        backlogBlocks: number;
      };
      missedTiming: {
        fixtures: number;
        activationFixtures: number;
        declineFixtures: number;
        multiStepFixtures: number;
        sourceEffectCauseFixtures: number;
        sourceEffectCauseExceptions: number;
        sourceEffectCauseExceptionFamilies: {
          battleDamageCause: number;
          chainLifecycleOrigin: number;
          phaseBoundary: number;
        };
        chainExceptionFamilies: {
          chainActivatingState: number;
          chainLifecycleOrigin: number;
        };
        sourceEffectCauseEventCodeFixtures: number;
        sourceEffectCauseEventCodeExceptions: number;
        sourceEffectCauseEventHistoryFixtures: number;
        syntheticNoEventCodeEventHistoryFixtures: number;
        battleDamageExceptionEventHistoryFixtures: number;
        phaseBoundaryPlayerFixtures: number;
        phaseBoundaryEventHistoryFixtures: number;
        chainExceptionEventHistoryFixtures: number;
      };
      bridgeBundles: {
        playtest: {
          exists: boolean;
          maxBytes: number;
          sizeBytes: number | null;
          missingRequired: string[];
          forbiddenSnippets: string[];
        };
        pvp: {
          exists: boolean;
          maxBytes: number;
          sizeBytes: number | null;
          missingRequired: string[];
          forbiddenSnippets: string[];
        };
      };
      directScriptFixtureEstimate: {
        realScriptFixtures: number;
        officialScripts: number;
        allScripts: number;
        officialFixturePercent: number;
        allFixturePercent: number;
        remainingOfficialOnePerScript: number;
        remainingAllOnePerScript: number;
        note: string;
      };
    };

    expect(report.luaParity.usedApis).toBe(898);
    expect(report.luaParity.implementedApis).toBe(1233);
    expect(report.luaParity.missingApiUsages).toBe(0);
    expect(report.luaParity.upstreamConstants).toBe(1777);
    expect(report.luaParity.localConstants).toBe(1818);
    expect(report.luaParity.missingConstants).toBe(0);

    expect(report.chainLimitPatterns.filesWithCalls).toBe(124);
    expect(report.chainLimitPatterns.calls).toBe(141);
    expect(report.chainLimitPatterns.unclassifiedCalls).toBe(0);
    expect(report.promptPatterns.filesWithCalls).toBe(1957);
    expect(report.promptPatterns.calls).toBe(2458);
    expect(report.promptPatterns.selectOptionCalls).toBe(437);
    expect(report.promptPatterns.selectYesNoCalls).toBe(1172);
    expect(report.promptPatterns.selectEffectCalls).toBe(352);
    expect(report.promptPatterns.selectEffectYesNoCalls).toBe(250);
    expect(report.promptPatterns.announcementHelperCalls).toBe(247);
    expect(report.promptPatterns.unclassifiedCalls).toBe(0);

    expect(report.cleanRestore.restoredFixtures).toBe(report.cleanRestore.totalFixtures);
    expect(report.cleanRestore.totalFixtures).toBe(2262);
    expect(report.cleanRestore.restorePercent).toBe(100);
    expect(report.cleanRestore.legalActionFixtures).toBe(report.cleanRestore.legalActionTotalFixtures);
    expect(report.cleanRestore.legalActionTotalFixtures).toBe(2262);
    expect(report.provenance.files).toBe(945);
    expect(report.provenance.expectationBlocks).toBe(4939);
    expect(report.provenance.edoproBlocks).toBe(report.provenance.expectationBlocks);
    expect(report.provenance.backlogBlocks).toBe(0);

    expect(report.missedTiming.fixtures).toBe(171);
    expect(report.missedTiming.activationFixtures).toBe(86);
    expect(report.missedTiming.declineFixtures).toBe(85);
    expect(report.missedTiming.multiStepFixtures).toBe(166);
    expect(report.missedTiming.sourceEffectCauseFixtures).toBe(126);
    expect(report.missedTiming.sourceEffectCauseExceptions).toBe(40);
    expect(report.missedTiming.sourceEffectCauseExceptionFamilies).toEqual({
      battleDamageCause: 4,
      chainLifecycleOrigin: 14,
      phaseBoundary: 22,
    });
    expect(report.missedTiming.chainExceptionFamilies).toEqual({
      chainActivatingState: 2,
      chainLifecycleOrigin: 12,
    });
    expect(report.missedTiming.sourceEffectCauseEventCodeFixtures).toBe(123);
    expect(report.missedTiming.sourceEffectCauseEventCodeExceptions).toBe(3);
    expect(report.missedTiming.sourceEffectCauseEventHistoryFixtures).toBe(126);
    expect(report.missedTiming.syntheticNoEventCodeEventHistoryFixtures).toBe(3);
    expect(report.missedTiming.battleDamageExceptionEventHistoryFixtures).toBe(4);
    expect(report.missedTiming.phaseBoundaryPlayerFixtures).toBe(22);
    expect(report.missedTiming.phaseBoundaryEventHistoryFixtures).toBe(22);
    expect(report.missedTiming.chainExceptionEventHistoryFixtures).toBe(14);

    expect(report.bridgeBundles.playtest.maxBytes).toBe(128 * 1024);
    expect(report.bridgeBundles.pvp.maxBytes).toBe(384 * 1024);
    if (report.bridgeBundles.playtest.exists) {
      const playtestSizeBytes = report.bridgeBundles.playtest.sizeBytes;
      expect(playtestSizeBytes).not.toBeNull();
      expect(playtestSizeBytes! > 0).toBe(true);
      expect(playtestSizeBytes!).toBeLessThanOrEqual(report.bridgeBundles.playtest.maxBytes);
      expect(report.bridgeBundles.playtest.missingRequired).toEqual([]);
      expect(report.bridgeBundles.playtest.forbiddenSnippets).toEqual([]);
    }
    if (report.bridgeBundles.pvp.exists) {
      const pvpSizeBytes = report.bridgeBundles.pvp.sizeBytes;
      expect(pvpSizeBytes).not.toBeNull();
      expect(pvpSizeBytes! > 0).toBe(true);
      expect(pvpSizeBytes!).toBeLessThanOrEqual(report.bridgeBundles.pvp.maxBytes);
      expect(report.bridgeBundles.pvp.missingRequired).toEqual([]);
      expect(report.bridgeBundles.pvp.forbiddenSnippets).toEqual([]);
    }

    expect(report.directScriptFixtureEstimate.realScriptFixtures).toBe(2262);
    expect(report.directScriptFixtureEstimate.officialScripts).toBe(13299);
    expect(report.directScriptFixtureEstimate.allScripts).toBe(22326);
    expect(report.directScriptFixtureEstimate.remainingOfficialOnePerScript).toBe(
      report.directScriptFixtureEstimate.officialScripts - report.directScriptFixtureEstimate.realScriptFixtures,
    );
    expect(report.directScriptFixtureEstimate.remainingAllOnePerScript).toBe(
      report.directScriptFixtureEstimate.allScripts - report.directScriptFixtureEstimate.realScriptFixtures,
    );
    expect(report.directScriptFixtureEstimate.officialFixturePercent).toBeLessThan(75);
    expect(report.directScriptFixtureEstimate.allFixturePercent).toBeLessThan(75);
    expect(report.directScriptFixtureEstimate.note).toContain("not a proof of unique per-card EDOPro parity");
  }, 30_000);
});
