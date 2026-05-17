import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("parity progress report", () => {
  it("reports scanner-backed parity counts without treating per-card fixture counts as full parity", () => {
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

    expect(report.luaParity.usedApis).toBeGreaterThanOrEqual(898);
    expect(report.luaParity.implementedApis).toBeGreaterThanOrEqual(1219);
    expect(report.luaParity.missingApiUsages).toBe(0);
    expect(report.luaParity.upstreamConstants).toBeGreaterThanOrEqual(1775);
    expect(report.luaParity.localConstants).toBeGreaterThanOrEqual(1816);
    expect(report.luaParity.missingConstants).toBe(0);

    expect(report.cleanRestore.restoredFixtures).toBe(report.cleanRestore.totalFixtures);
    expect(report.cleanRestore.restorePercent).toBe(100);
    expect(report.cleanRestore.legalActionFixtures).toBe(report.cleanRestore.legalActionTotalFixtures);
    expect(report.provenance.edoproBlocks).toBe(report.provenance.expectationBlocks);
    expect(report.provenance.backlogBlocks).toBe(0);

    expect(report.directScriptFixtureEstimate.realScriptFixtures).toBeGreaterThanOrEqual(651);
    expect(report.directScriptFixtureEstimate.officialScripts).toBeGreaterThan(report.directScriptFixtureEstimate.realScriptFixtures);
    expect(report.directScriptFixtureEstimate.allScripts).toBeGreaterThan(report.directScriptFixtureEstimate.officialScripts);
    expect(report.directScriptFixtureEstimate.remainingOfficialOnePerScript).toBe(
      report.directScriptFixtureEstimate.officialScripts - report.directScriptFixtureEstimate.realScriptFixtures,
    );
    expect(report.directScriptFixtureEstimate.remainingAllOnePerScript).toBe(
      report.directScriptFixtureEstimate.allScripts - report.directScriptFixtureEstimate.realScriptFixtures,
    );
    expect(report.directScriptFixtureEstimate.officialFixturePercent).toBeLessThan(75);
    expect(report.directScriptFixtureEstimate.allFixturePercent).toBeLessThan(75);
    expect(report.directScriptFixtureEstimate.note).toContain("not a proof of unique per-card EDOPro parity");
  });
});
