import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { evalSuite } from "./eval.js";

describe("evalSuite", () => {
  it("writes aggregate JSON, CSV, and HTML reports with viewer links", async () => {
    const cwd = process.cwd();
    const temp = await mkdtemp(join(tmpdir(), "ygo-bench-eval-"));
    await mkdir(join(temp, "benchmark-runs"));
    try {
      process.chdir(appCwd(cwd));
      const scores = await evalSuite("suites/mock-mvp.json", ["oracle"], true);
      expect(scores.length).toBeGreaterThanOrEqual(7);

      const summary = JSON.parse(await readFile("benchmark-runs/mock-mvp-summary.json", "utf8")) as {
        aggregate: Array<{ agentId: string; winRate: number }>;
        records: Array<{ viewerPath?: string }>;
      };
      expect(summary.aggregate).toEqual([
        {
          agentId: "oracle",
          runs: scores.length,
          winRate: 1,
          averageScore: 1,
          weightedObjectiveScore: 1,
          averageDecisions: 2,
          illegalActionRate: 0,
          invalidJsonRate: 0,
          modelErrorRate: 0,
          repeatedActionRate: 0,
          averageLatencyMs: 0,
          averageTokenCount: null,
        },
      ]);
      expect(summary.records.every((record) => record.viewerPath?.endsWith("/viewer.html"))).toBe(true);
      await expect(readFile("benchmark-runs/mock-mvp-summary.csv", "utf8")).resolves.toContain("viewerPath");
      await expect(readFile("benchmark-runs/mock-mvp-report.html", "utf8")).resolves.toContain("YGO Bench mock-mvp Report");
    } finally {
      process.chdir(cwd);
    }
  });
});

function appCwd(cwd: string): string {
  return basename(cwd) === "ygo-bench" ? cwd : join(cwd, "apps/ygo-bench");
}
