import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { runScenario } from "./run.js";
import { traceHash } from "../core/trace.js";
import type { Agent } from "../core/types.js";

describe("runScenario", () => {
  it("produces the same trace hash for a deterministic oracle scenario", async () => {
    const cwd = process.cwd();
    const temp = await mkdtemp(join(tmpdir(), "ygo-bench-run-"));
    try {
      process.chdir(appCwd(cwd));
      const first = await runScenario({ scenarioPath: "scenarios/lethal/lethal-001.json", agentId: "oracle", viewer: false });
      const second = await runScenario({ scenarioPath: "scenarios/lethal/lethal-001.json", agentId: "oracle", viewer: false });
      expect(traceHash(await readTrace(first.runDir))).toBe(traceHash(await readTrace(second.runDir)));
    } finally {
      process.chdir(cwd);
    }
  });

  it("falls back to a legal action and counts invalid agent output", async () => {
    const cwd = process.cwd();
    try {
      process.chdir(appCwd(cwd));
      const result = await runScenario({
        scenarioPath: "scenarios/lethal/lethal-001.json",
        agentId: "broken",
        viewer: false,
        agent: brokenAgent,
      });
      const trace = await readTrace(result.runDir);

      expect(result.score.invalidJson).toBeGreaterThan(0);
      expect(result.score.illegalActions).toBe(0);
      expect(trace[0]).toMatchObject({
        type: "decision",
        chosen: {
          actionId: "a_001",
        },
      });
    } finally {
      process.chdir(cwd);
    }
  });
});

const brokenAgent: Agent = {
  id: "broken",
  async chooseAction() {
    throw new SyntaxError("bad json");
  },
};

async function readTrace(runDir: string) {
  const raw = await readFile(join(runDir, "trace.jsonl"), "utf8");
  return raw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

function appCwd(cwd: string): string {
  return basename(cwd) === "ygo-bench" ? cwd : join(cwd, "apps/ygo-bench");
}
