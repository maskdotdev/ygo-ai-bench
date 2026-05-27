import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startBenchUiServer } from "./uiServer.js";

describe("YGO Bench UI server", () => {
  it("serves built assets and artifact API routes", async () => {
    const root = await mkdtemp(join(tmpdir(), "ygo-ui-server-runs-"));
    const staticDir = await mkdtemp(join(tmpdir(), "ygo-ui-server-static-"));
    const runDir = join(root, "real-run-2026-05-27T13-24-55.443Z-real-smoke-greedy");
    await mkdir(runDir, { recursive: true });
    await writeFile(join(staticDir, "index.html"), "<!doctype html><title>viewer</title></head><body>ok</body>");
    await writeFile(join(runDir, "final-score.json"), JSON.stringify(score(), null, 2));
    await writeFile(join(runDir, "trace.jsonl"), `${JSON.stringify({ type: "decision", chosen: { actionId: "a_001" } })}\n`);
    await writeFile(join(root, "mvp-summary.json"), JSON.stringify({ suiteId: "mvp", generatedAt: "2026-05-27T00:00:00.000Z", records: [], scores: [], aggregate: [] }));

    const server = await startServerIfAllowed(root, staticDir);
    if (!server) return;
    try {
      const runs = (await fetchJson(`${server.url}api/runs`)) as Array<{ id: string; scenarioId: string }>;
      expect(runs[0]).toMatchObject({ scenarioId: "real-smoke" });

      const trace = (await fetchJson(`${server.url}api/runs/${runs[0].id}/trace`)) as unknown[];
      expect(trace).toHaveLength(1);

      expect(await fetchJson(`${server.url}api/summaries`)).toEqual(["mvp"]);
      expect(await fetchText(server.url)).toContain("viewer");
    } finally {
      await server.close();
    }
  });
});

async function startServerIfAllowed(root: string, staticDir: string): Promise<Awaited<ReturnType<typeof startBenchUiServer>> | null> {
  try {
    return await startBenchUiServer({ root, staticDir, port: 0 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EPERM") return null;
    throw error;
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  expect(response.ok).toBe(true);
  return response.json();
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  expect(response.ok).toBe(true);
  return response.text();
}

function score() {
  return {
    scenarioId: "real-smoke",
    agentId: "greedy",
    family: "smoke",
    won: false,
    turnsTaken: 1,
    decisionsTaken: 1,
    illegalActions: 0,
    invalidJson: 0,
    modelErrors: 0,
    repeatedActions: 0,
    finalLpDelta: 0,
    objectiveScore: 0.25,
    latencyMs: 0,
    tokenCount: null,
    notes: [],
  };
}
