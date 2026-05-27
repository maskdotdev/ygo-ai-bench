import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runScenario } from "./run.js";
import type { ScenarioScore } from "../core/types.js";

interface SuiteFile {
  id: string;
  scenarios: string[];
}

interface EvalRunRecord {
  score: ScenarioScore;
  runDir: string;
  viewerPath?: string;
}

export interface EvalSuiteSummary {
  suiteId: string;
  generatedAt: string;
  scenarios: string[];
  records: EvalRunRecord[];
  aggregate: Array<{
    agentId: string;
    runs: number;
    winRate: number;
    averageScore: number;
    weightedObjectiveScore: number;
    averageDecisions: number;
    illegalActionRate: number;
    invalidJsonRate: number;
    repeatedActionRate: number;
    averageLatencyMs: number;
    averageTokenCount: number | null;
  }>;
}

export async function evalSuite(suitePath: string, agentIds: string[], viewer: boolean, options?: { model?: string }): Promise<ScenarioScore[]> {
  const suite = JSON.parse(await readFile(resolve(suitePath), "utf8")) as SuiteFile;
  const records: EvalRunRecord[] = [];
  for (const agentId of agentIds) {
    for (const scenarioPath of suite.scenarios) {
      const result = await runScenario({ scenarioPath, agentId, viewer, ...(options?.model ? { model: options.model } : {}) });
      records.push({
        score: result.score,
        runDir: result.runDir,
        ...(viewer ? { viewerPath: `${result.runDir}/viewer.html` } : {}),
      });
      console.log(`${suite.id} ${agentId} ${result.score.scenarioId}: ${result.score.objectiveScore.toFixed(2)}`);
    }
  }
  const summary: EvalSuiteSummary = {
    suiteId: suite.id,
    generatedAt: new Date().toISOString(),
    scenarios: suite.scenarios,
    records,
    aggregate: aggregateScores(records.map((record) => record.score)),
  };
  await mkdir(resolve("benchmark-runs"), { recursive: true });
  await writeFile(resolve("benchmark-runs", `${suite.id}-summary.json`), JSON.stringify(summary, null, 2) + "\n");
  await writeFile(resolve("benchmark-runs", `${suite.id}-summary.csv`), renderCsv(summary));
  await writeFile(resolve("benchmark-runs", `${suite.id}-report.html`), renderHtmlReport(summary));
  return records.map((record) => record.score);
}

function aggregateScores(scores: ScenarioScore[]): EvalSuiteSummary["aggregate"] {
  return [...new Set(scores.map((score) => score.agentId))].map((agentId) => {
    const agentScores = scores.filter((score) => score.agentId === agentId);
    return {
      agentId,
      runs: agentScores.length,
      winRate: average(agentScores.map((score) => (score.won ? 1 : 0))),
      averageScore: average(agentScores.map((score) => score.objectiveScore)),
      weightedObjectiveScore: weightedObjectiveScore(agentScores),
      averageDecisions: average(agentScores.map((score) => score.decisionsTaken)),
      illegalActionRate: average(agentScores.map((score) => score.illegalActions)),
      invalidJsonRate: average(agentScores.map((score) => score.invalidJson)),
      repeatedActionRate: average(agentScores.map((score) => score.repeatedActions)),
      averageLatencyMs: average(agentScores.map((score) => score.latencyMs)),
      averageTokenCount: averageNullable(agentScores.map((score) => score.tokenCount)),
    };
  });
}

function renderCsv(summary: EvalSuiteSummary): string {
  const rows = [
    [
      "agentId",
      "scenarioId",
      "won",
      "family",
      "objectiveScore",
      "decisionsTaken",
      "illegalActions",
      "invalidJson",
      "repeatedActions",
      "latencyMs",
      "tokenCount",
      "viewerPath",
    ],
    ...summary.records.map((record) => [
      record.score.agentId,
      record.score.scenarioId,
      String(record.score.won),
      record.score.family,
      record.score.objectiveScore.toFixed(4),
      String(record.score.decisionsTaken),
      String(record.score.illegalActions),
      String(record.score.invalidJson),
      String(record.score.repeatedActions),
      String(record.score.latencyMs),
      record.score.tokenCount === null ? "" : String(record.score.tokenCount),
      record.viewerPath ?? "",
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function renderHtmlReport(summary: EvalSuiteSummary): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>YGO Bench ${escapeHtml(summary.suiteId)} Report</title>
  <style>
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #f4f6f8; color: #16202a; }
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
      <p>Generated ${escapeHtml(summary.generatedAt)}. Scenarios: ${summary.scenarios.length}.</p>
    </header>
    <section>
      <h2>Aggregate</h2>
      <table>
        <thead><tr><th>Agent</th><th>Runs</th><th>Win Rate</th><th>Avg Score</th><th>Weighted Score</th><th>Avg Decisions</th><th>Illegal</th><th>Invalid JSON</th><th>Repeated</th><th>Avg Latency</th><th>Avg Tokens</th></tr></thead>
        <tbody>${summary.aggregate.map(renderAggregateRow).join("")}</tbody>
      </table>
    </section>
    <section>
      <h2>Runs</h2>
      <table>
        <thead><tr><th>Agent</th><th>Scenario</th><th>Family</th><th>Won</th><th>Score</th><th>Decisions</th><th>Latency</th><th>Tokens</th><th>Viewer</th></tr></thead>
        <tbody>${summary.records.map(renderRunRow).join("")}</tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}

function renderAggregateRow(row: EvalSuiteSummary["aggregate"][number]): string {
  return `<tr><td>${escapeHtml(row.agentId)}</td><td>${row.runs}</td><td>${row.winRate.toFixed(2)}</td><td>${row.averageScore.toFixed(2)}</td><td>${row.weightedObjectiveScore.toFixed(2)}</td><td>${row.averageDecisions.toFixed(1)}</td><td>${row.illegalActionRate.toFixed(2)}</td><td>${row.invalidJsonRate.toFixed(2)}</td><td>${row.repeatedActionRate.toFixed(2)}</td><td>${row.averageLatencyMs.toFixed(0)} ms</td><td>${row.averageTokenCount === null ? "" : row.averageTokenCount.toFixed(0)}</td></tr>`;
}

function renderRunRow(record: EvalRunRecord): string {
  const viewer = record.viewerPath ? `<a href="${escapeHtml(record.viewerPath)}">viewer</a>` : "";
  return `<tr><td>${escapeHtml(record.score.agentId)}</td><td>${escapeHtml(record.score.scenarioId)}</td><td>${escapeHtml(record.score.family)}</td><td>${record.score.won ? "yes" : "no"}</td><td>${record.score.objectiveScore.toFixed(2)}</td><td>${record.score.decisionsTaken}</td><td>${record.score.latencyMs} ms</td><td>${record.score.tokenCount ?? ""}</td><td>${viewer}</td></tr>`;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function averageNullable(values: Array<number | null>): number | null {
  const concrete = values.filter((value): value is number => value !== null);
  return concrete.length === 0 ? null : average(concrete);
}

function weightedObjectiveScore(scores: ScenarioScore[]): number {
  const weights = { lethal: 0.3, interruption: 0.3, resource: 0.3, smoke: 0.1 } as const;
  const presentFamilies = Object.keys(weights).filter((family) =>
    scores.some((score) => score.family === family),
  ) as Array<keyof typeof weights>;
  const totalWeight = presentFamilies.reduce((sum, family) => sum + weights[family], 0);
  if (totalWeight === 0) return 0;
  return (
    presentFamilies.reduce((sum, family) => {
      const familyScores = scores.filter((score) => score.family === family);
      return sum + average(familyScores.map((score) => score.objectiveScore)) * weights[family];
    }, 0) / totalWeight
  );
}

function csvCell(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;");
}
