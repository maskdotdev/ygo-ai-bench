import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ScenarioScore } from "../core/types.js";
import type { RealAgentId } from "./realAgent.js";
import { runRealDuel } from "./realRunner.js";
import { loadRealSuite } from "./realSuite.js";

export interface RealEvalOptions {
  agentIds: RealAgentId[];
  runsPerAgent: number;
  maxDecisions: number;
  viewer: boolean;
  cardDataPath: string;
  scriptRoot: string;
  suitePath: string;
  model?: string;
}

export interface RealEvalSummary {
  suiteId: string;
  generatedAt: string;
  records: Array<{
    score: ScenarioScore;
    runDir: string;
    viewerPath?: string;
  }>;
  scores: ScenarioScore[];
  aggregate: Array<{
    agentId: string;
    runs: number;
    winRate: number;
    averageScore: number;
    averageDecisions: number;
    averageLpDelta: number;
    averageLatencyMs: number;
    averageTokenCount: number | null;
  }>;
}

export async function evalRealSuite(options: RealEvalOptions): Promise<RealEvalSummary> {
  const records: RealEvalSummary["records"] = [];
  const suite = await loadRealSuite(options.suitePath);
  for (const agentId of options.agentIds) {
    for (const scenarioPath of suite.scenarios) {
      for (let run = 0; run < options.runsPerAgent; run += 1) {
        const result = await runRealDuel({
          agentId,
          cardDataPath: options.cardDataPath,
          scriptRoot: options.scriptRoot,
          maxDecisions: options.maxDecisions,
          viewer: options.viewer,
          scenarioPath,
          ...(options.model ? { model: options.model } : {}),
        });
        records.push({
          score: result.score,
          runDir: result.runDir,
          ...(options.viewer ? { viewerPath: `${result.runDir}/viewer.html` } : {}),
        });
        console.log(
          `${suite.id} ${agentId} ${result.score.scenarioId} run ${run + 1}: score=${result.score.objectiveScore.toFixed(2)} decisions=${result.score.decisionsTaken}`,
        );
      }
    }
  }

  const summary: RealEvalSummary = {
    suiteId: suite.id,
    generatedAt: new Date().toISOString(),
    records,
    scores: records.map((record) => record.score),
    aggregate: aggregateScores(records.map((record) => record.score)),
  };
  await mkdir(resolve("benchmark-runs"), { recursive: true });
  await writeFile(resolve("benchmark-runs", `${suite.id}-summary.json`), JSON.stringify(summary, null, 2) + "\n");
  await writeFile(resolve("benchmark-runs", `${suite.id}-summary.csv`), renderCsv(summary));
  await writeFile(resolve("benchmark-runs", `${suite.id}-report.html`), renderHtmlReport(summary));
  return summary;
}

function aggregateScores(scores: ScenarioScore[]): RealEvalSummary["aggregate"] {
  const agentIds = [...new Set(scores.map((score) => score.agentId))];
  return agentIds.map((agentId) => {
    const agentScores = scores.filter((score) => score.agentId === agentId);
    return {
      agentId,
      runs: agentScores.length,
      winRate: average(agentScores.map((score) => (score.won ? 1 : 0))),
      averageScore: average(agentScores.map((score) => score.objectiveScore)),
      averageDecisions: average(agentScores.map((score) => score.decisionsTaken)),
      averageLpDelta: average(agentScores.map((score) => score.finalLpDelta)),
      averageLatencyMs: average(agentScores.map((score) => score.latencyMs)),
      averageTokenCount: averageNullable(agentScores.map((score) => score.tokenCount)),
    };
  });
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageNullable(values: Array<number | null>): number | null {
  const concrete = values.filter((value): value is number => value !== null);
  return concrete.length === 0 ? null : average(concrete);
}

function renderCsv(summary: RealEvalSummary): string {
  const rows = [
    [
      "agentId",
      "scenarioId",
      "won",
      "objectiveScore",
      "decisionsTaken",
      "illegalActions",
      "invalidJson",
      "finalLpDelta",
      "latencyMs",
      "tokenCount",
      "viewerPath",
    ],
    ...summary.records.map((record) => [
      record.score.agentId,
      record.score.scenarioId,
      String(record.score.won),
      record.score.objectiveScore.toFixed(4),
      String(record.score.decisionsTaken),
      String(record.score.illegalActions),
      String(record.score.invalidJson),
      String(record.score.finalLpDelta),
      String(record.score.latencyMs),
      record.score.tokenCount === null ? "" : String(record.score.tokenCount),
      record.viewerPath ?? "",
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function renderHtmlReport(summary: RealEvalSummary): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>YGO Bench ${escapeHtml(summary.suiteId)} Report</title>
  <style>
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #f5f7f8; color: #17212b; }
    main { max-width: 1180px; margin: 0 auto; padding: 28px; display: grid; gap: 22px; }
    h1 { margin: 0; font-size: 28px; }
    h2 { margin: 0 0 12px; font-size: 18px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #d8e0e7; }
    th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid #e2e8ee; font-size: 14px; }
    th { background: #e9eef3; font-size: 12px; text-transform: uppercase; color: #52616f; }
    a { color: #0b66a8; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>YGO Bench ${escapeHtml(summary.suiteId)} Report</h1>
      <p>Generated ${escapeHtml(summary.generatedAt)}.</p>
    </header>
    <section>
      <h2>Aggregate</h2>
      <table>
        <thead><tr><th>Agent</th><th>Runs</th><th>Win Rate</th><th>Avg Score</th><th>Avg Decisions</th><th>Avg LP Delta</th><th>Avg Latency</th><th>Avg Tokens</th></tr></thead>
        <tbody>${summary.aggregate.map(renderAggregateRow).join("")}</tbody>
      </table>
    </section>
    <section>
      <h2>Runs</h2>
      <table>
        <thead><tr><th>Agent</th><th>Scenario</th><th>Won</th><th>Score</th><th>Decisions</th><th>LP Delta</th><th>Latency</th><th>Tokens</th><th>Viewer</th></tr></thead>
        <tbody>${summary.records.map(renderRunRow).join("")}</tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}

function renderAggregateRow(row: RealEvalSummary["aggregate"][number]): string {
  return `<tr><td>${escapeHtml(row.agentId)}</td><td>${row.runs}</td><td>${row.winRate.toFixed(2)}</td><td>${row.averageScore.toFixed(2)}</td><td>${row.averageDecisions.toFixed(1)}</td><td>${row.averageLpDelta.toFixed(0)}</td><td>${row.averageLatencyMs.toFixed(0)} ms</td><td>${row.averageTokenCount === null ? "" : row.averageTokenCount.toFixed(0)}</td></tr>`;
}

function renderRunRow(record: RealEvalSummary["records"][number]): string {
  const viewer = record.viewerPath ? `<a href="${escapeHtml(record.viewerPath)}">viewer</a>` : "";
  return `<tr><td>${escapeHtml(record.score.agentId)}</td><td>${escapeHtml(record.score.scenarioId)}</td><td>${record.score.won ? "yes" : "no"}</td><td>${record.score.objectiveScore.toFixed(2)}</td><td>${record.score.decisionsTaken}</td><td>${record.score.finalLpDelta}</td><td>${record.score.latencyMs} ms</td><td>${record.score.tokenCount ?? ""}</td><td>${viewer}</td></tr>`;
}

function csvCell(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;");
}
