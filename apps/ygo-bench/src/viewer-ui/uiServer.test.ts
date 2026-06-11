import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
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

  it("starts and reports a browser-launched eval", async () => {
    const root = await mkdtemp(join(tmpdir(), "ygo-ui-server-eval-runs-"));
    const staticDir = await mkdtemp(join(tmpdir(), "ygo-ui-server-eval-static-"));
    const suitePath = join(root, "one-scenario-suite.json");
    await writeFile(join(staticDir, "index.html"), "<!doctype html><title>viewer</title></head><body>ok</body>");
    await writeFile(
      suitePath,
      JSON.stringify({
        id: "ui-eval-smoke",
        scenarios: ["scenarios/real/smoke-duel.json"],
      }),
    );
    process.env.YGO_BENCH_RUN_ROOT = root;
    const server = await startServerIfAllowed(root, staticDir);
    if (!server) {
      delete process.env.YGO_BENCH_RUN_ROOT;
      await rm(root, { recursive: true, force: true });
      await rm(staticDir, { recursive: true, force: true });
      return;
    }
    try {
      const created = (await postJson(`${server.url}api/evals`, {
        suitePath,
        competitors: [{ agentId: "greedy", competitorId: "greedy" }],
        runsPerScenario: 1,
        maxDecisions: 2,
        viewer: false,
      })) as { id: string; status: string };
      expect(created.id).toContain("eval-");

      const finished = await waitForEval(server.url, created.id);
      expect(finished.status).toBe("finished");
      expect(finished.progress.completed).toBe(1);
      expect(finished.summary?.aggregate[0]).toMatchObject({ competitorId: "greedy", runs: 1 });

      const evalRuns = (await fetchJson(`${server.url}api/evals/${encodeURIComponent(created.id)}/runs`)) as Array<{
        scenarioId: string;
        competitorId: string;
      }>;
      expect(evalRuns).toEqual([expect.objectContaining({ scenarioId: "real-smoke-duel", competitorId: "greedy" })]);

      await server.close();
      const restored = await startServerIfAllowed(root, staticDir);
      expect(restored).not.toBeNull();
      if (!restored) return;
      const evals = (await fetchJson(`${restored.url}api/evals`)) as Array<{ id: string; status: string; summary?: { aggregate: unknown[] } }>;
      expect(evals.find((evalView) => evalView.id === created.id)).toMatchObject({ status: "finished" });
      await restored.close();
    } finally {
      delete process.env.YGO_BENCH_RUN_ROOT;
      await server.close().catch(() => {});
      await rm(root, { recursive: true, force: true });
      await rm(staticDir, { recursive: true, force: true });
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

async function postJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
  return response.json();
}

async function waitForEval(url: string, id: string): Promise<{ status: string; progress: { completed: number }; summary?: { aggregate: unknown[] } }> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const view = (await fetchJson(`${url}api/evals/${encodeURIComponent(id)}`)) as {
      status: string;
      progress: { completed: number };
      summary?: { aggregate: unknown[] };
      error?: string;
    };
    if (view.status === "finished") return view;
    if (view.status === "error") throw new Error(view.error ?? "eval failed");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for eval");
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
