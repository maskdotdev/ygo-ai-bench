import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evalSuite } from "./eval.js";

describe("evalSuite", () => {
  it("writes aggregate JSON, CSV, and HTML reports with viewer links", async () => {
    const cwd = process.cwd();
    const temp = await mkdtemp(join(tmpdir(), "ygo-bench-eval-"));
    await mkdir(join(temp, "benchmark-runs"));
    try {
      process.chdir(join(cwd, "apps/ygo-bench"));
      const scores = await evalSuite("suites/mvp.json", ["oracle"], true);
      expect(scores.length).toBeGreaterThanOrEqual(7);

      const summary = JSON.parse(await readFile("benchmark-runs/mvp-summary.json", "utf8")) as {
        aggregate: Array<{ agentId: string; winRate: number }>;
        records: Array<{ viewerPath?: string }>;
      };
      expect(summary.aggregate).toEqual([
        {
          agentId: "oracle",
          runs: scores.length,
          winRate: 1,
          averageScore: 1,
          averageDecisions: 2,
          illegalActionRate: 0,
          invalidJsonRate: 0,
          repeatedActionRate: 0,
        },
      ]);
      expect(summary.records.every((record) => record.viewerPath?.endsWith("/viewer.html"))).toBe(true);
      await expect(readFile("benchmark-runs/mvp-summary.csv", "utf8")).resolves.toContain("viewerPath");
      await expect(readFile("benchmark-runs/mvp-report.html", "utf8")).resolves.toContain("YGO Bench mvp Report");
    } finally {
      process.chdir(cwd);
    }
  });
});
