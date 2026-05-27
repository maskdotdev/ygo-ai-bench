import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getRunArtifact, listRunArtifacts, listSummaryArtifacts, readRunTrace, readSummaryArtifact, resolveRunDir } from "./artifacts.js";

describe("viewer artifact index", () => {
  it("lists runs, summaries, details, and parsed trace frames", async () => {
    const root = await mkdtemp(join(tmpdir(), "ygo-ui-artifacts-"));
    const runDir = join(root, "real-run-2026-05-27T13-24-55.443Z-real-lethal-001-greedy");
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "final-score.json"), JSON.stringify(score("real-lethal-001", "greedy", 1), null, 2));
    await writeFile(join(runDir, "metadata.json"), JSON.stringify({ engine: { adapter: "test" } }));
    await writeFile(join(runDir, "reduced-state.json"), JSON.stringify({ turn: 1, phase: "MAIN1" }));
    await writeFile(join(runDir, "model-transcript.md"), "# transcript\n");
    await writeFile(join(runDir, "trace.jsonl"), `${JSON.stringify({ type: "event", text: "start" })}\n${JSON.stringify({ type: "decision", chosen: { actionId: "a_001" } })}\n`);
    await writeFile(
      join(root, "mvp-summary.json"),
      JSON.stringify({
        suiteId: "mvp",
        generatedAt: "2026-05-27T00:00:00.000Z",
        records: [{ score: score("real-lethal-001", "greedy", 1), runDir }],
        scores: [score("real-lethal-001", "greedy", 1)],
        aggregate: [],
      }),
    );

    const runs = await listRunArtifacts(root);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ scenarioId: "real-lethal-001", agentId: "greedy", score: 1 });

    const detail = await getRunArtifact(runs[0].id, root);
    expect(detail?.metadata).toMatchObject({ engine: { adapter: "test" } });
    expect(detail?.artifacts.trace).toContain("/trace/raw");

    const trace = await readRunTrace(runs[0].id, root);
    expect(trace).toHaveLength(2);

    expect(await listSummaryArtifacts(root)).toEqual(["mvp"]);
    expect(await readSummaryArtifact("mvp", root)).toMatchObject({ suiteId: "mvp" });
  });

  it("rejects unsafe run ids", async () => {
    const root = await mkdtemp(join(tmpdir(), "ygo-ui-artifacts-"));
    expect(await resolveRunDir("../outside", root)).toBeNull();
    expect(await getRunArtifact("../outside", root)).toBeNull();
  });
});

function score(scenarioId: string, agentId: string, objectiveScore: number) {
  return {
    scenarioId,
    agentId,
    family: "lethal",
    won: objectiveScore === 1,
    turnsTaken: 1,
    decisionsTaken: 2,
    illegalActions: 0,
    invalidJson: 0,
    modelErrors: 0,
    repeatedActions: 0,
    finalLpDelta: 1000,
    objectiveScore,
    latencyMs: 12,
    tokenCount: null,
    notes: [],
  };
}
