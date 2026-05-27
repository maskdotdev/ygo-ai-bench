import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runScenario } from "./run.js";
import { traceHash } from "../core/trace.js";

describe("runScenario", () => {
  it("produces the same trace hash for a deterministic oracle scenario", async () => {
    const cwd = process.cwd();
    const temp = await mkdtemp(join(tmpdir(), "ygo-bench-run-"));
    try {
      process.chdir(join(cwd, "apps/ygo-bench"));
      const first = await runScenario({ scenarioPath: "scenarios/lethal/lethal-001.json", agentId: "oracle", viewer: false });
      const second = await runScenario({ scenarioPath: "scenarios/lethal/lethal-001.json", agentId: "oracle", viewer: false });
      expect(traceHash(await readTrace(first.runDir))).toBe(traceHash(await readTrace(second.runDir)));
    } finally {
      process.chdir(cwd);
    }
  });
});

async function readTrace(runDir: string) {
  const raw = await readFile(join(runDir, "trace.jsonl"), "utf8");
  return raw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}
