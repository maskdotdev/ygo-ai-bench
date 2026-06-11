import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { competitorIdFor, type ScenarioScore } from "../core/types.js";
import type { RealAgentId } from "./realAgent.js";
import { runRealDuel } from "./realRunner.js";
import { loadRealSuite } from "./realSuite.js";

export interface RealEvalOptions {
  agentIds: RealAgentId[];
  competitors?: RealEvalCompetitor[];
  runsPerAgent: number;
  maxDecisions: number;
  viewer: boolean;
  cardDataPath: string;
  scriptRoot: string;
  runRoot?: string;
  suitePath: string;
  model?: string;
  onRecord?: (record: RealEvalSummary["records"][number], progress: { completed: number; total: number }) => void | Promise<void>;
  shouldStop?: () => boolean;
}

export interface RealEvalCompetitor {
  agentId: RealAgentId;
  model?: string;
  competitorId?: string;
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
    competitorId: string;
    agentId: string;
    model?: string;
    runs: number;
    completedRuns: number;
    failedRuns: number;
    winRate: number;
    averageScore: number;
    weightedObjectiveScore: number;
    averageStrategicProgressScore: number;
    averageResourceScore: number;
    averageAdaptationScore: number;
    averagePlanConsistencyScore: number;
    averageRiskManagementScore: number;
    averageExecutionPenalty: number;
    averageDecisions: number;
    averageLpDelta: number;
    modelErrorRate: number;
    averageLatencyMs: number;
    averageTokenCount: number | null;
  }>;
}

export async function evalRealSuite(options: RealEvalOptions): Promise<RealEvalSummary> {
  const records: RealEvalSummary["records"] = [];
  const suite = await loadRealSuite(options.suitePath);
  const competitors: RealEvalCompetitor[] =
    options.competitors ?? options.agentIds.map((agentId) => ({ agentId, ...(options.model ? { model: options.model } : {}) }));
  const totalRuns = competitors.length * suite.scenarios.length * options.runsPerAgent;
  for (const competitor of competitors) {
    for (const scenarioPath of suite.scenarios) {
      for (let run = 0; run < options.runsPerAgent; run += 1) {
        if (options.shouldStop?.()) break;
        const result = await runRealDuel({
          agentId: competitor.agentId,
          cardDataPath: options.cardDataPath,
          scriptRoot: options.scriptRoot,
          maxDecisions: options.maxDecisions,
          viewer: options.viewer,
          ...(options.runRoot ? { runRoot: options.runRoot } : {}),
          scenarioPath,
          suiteId: suite.id,
          runIndex: run,
          competitorId: competitor.competitorId ?? competitorIdFor(competitor.agentId, competitor.model ?? options.model),
          ...(competitor.model ?? options.model ? { model: competitor.model ?? options.model } : {}),
        });
        const record = {
          score: result.score,
          runDir: result.runDir,
          ...(options.viewer ? { viewerPath: `${result.runDir}/viewer.html` } : {}),
        };
        records.push(record);
        await options.onRecord?.(record, { completed: records.length, total: totalRuns });
        console.log(
          `${suite.id} ${result.score.competitorId ?? competitor.agentId} ${result.score.scenarioId} run ${run + 1}: score=${result.score.objectiveScore.toFixed(2)} status=${result.score.status ?? "completed"} decisions=${result.score.decisionsTaken}`,
        );
      }
      if (options.shouldStop?.()) break;
    }
    if (options.shouldStop?.()) break;
  }

  const summary: RealEvalSummary = {
    suiteId: suite.id,
    generatedAt: new Date().toISOString(),
    records,
    scores: records.map((record) => record.score),
    aggregate: aggregateScores(records.map((record) => record.score)),
  };
  const runRoot = options.runRoot ?? process.env.YGO_BENCH_RUN_ROOT ?? "benchmark-runs";
  await mkdir(resolve(runRoot), { recursive: true });
  await writeFile(resolve(runRoot, `${suite.id}-summary.json`), JSON.stringify(summary, null, 2) + "\n");
  await writeFile(resolve(runRoot, `${suite.id}-summary.csv`), renderCsv(summary));
  await writeFile(resolve(runRoot, `${suite.id}-report.html`), renderHtmlReport(summary));
  return summary;
}

function aggregateScores(scores: ScenarioScore[]): RealEvalSummary["aggregate"] {
  const competitorIds = [...new Set(scores.map((score) => score.competitorId ?? competitorIdFor(score.agentId, score.model)))];
  return competitorIds.map((competitorId) => {
    const agentScores = scores.filter((score) => (score.competitorId ?? competitorIdFor(score.agentId, score.model)) === competitorId);
    const representative = agentScores[0];
    return {
      competitorId,
      agentId: representative?.agentId ?? competitorId,
      ...(representative?.model ? { model: representative.model } : {}),
      runs: agentScores.length,
      completedRuns: agentScores.filter((score) => (score.status ?? "completed") === "completed").length,
      failedRuns: agentScores.filter((score) => (score.status ?? "completed") !== "completed").length,
      winRate: average(agentScores.map((score) => (score.won ? 1 : 0))),
      averageScore: average(agentScores.map((score) => score.objectiveScore)),
      weightedObjectiveScore: weightedObjectiveScore(agentScores),
      averageStrategicProgressScore: average(agentScores.map((score) => score.components?.strategicProgressScore ?? score.objectiveScore)),
      averageResourceScore: average(agentScores.map((score) => score.components?.resourceScore ?? 0)),
      averageAdaptationScore: average(agentScores.map((score) => score.components?.adaptationScore ?? 0)),
      averagePlanConsistencyScore: average(agentScores.map((score) => score.components?.planConsistencyScore ?? 0)),
      averageRiskManagementScore: average(agentScores.map((score) => score.components?.riskManagementScore ?? 0)),
      averageExecutionPenalty: average(agentScores.map((score) => score.components?.executionPenalty ?? 0)),
      averageDecisions: average(agentScores.map((score) => score.decisionsTaken)),
      averageLpDelta: average(agentScores.map((score) => score.finalLpDelta)),
      modelErrorRate: average(agentScores.map((score) => score.modelErrors)),
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
      "competitorId",
      "model",
      "scenarioId",
      "status",
      "won",
      "family",
      "objectiveScore",
      "strategicProgressScore",
      "resourceScore",
      "adaptationScore",
      "planConsistencyScore",
      "riskManagementScore",
      "executionPenalty",
      "decisionsTaken",
      "illegalActions",
      "invalidJson",
      "modelErrors",
      "finalLpDelta",
      "latencyMs",
      "tokenCount",
      "viewerPath",
    ],
    ...summary.records.map((record) => [
      record.score.agentId,
      record.score.competitorId ?? competitorIdFor(record.score.agentId, record.score.model),
      record.score.model ?? "",
      record.score.scenarioId,
      record.score.status ?? "completed",
      String(record.score.won),
      record.score.family,
      record.score.objectiveScore.toFixed(4),
      String(record.score.components?.strategicProgressScore ?? ""),
      String(record.score.components?.resourceScore ?? ""),
      String(record.score.components?.adaptationScore ?? ""),
      String(record.score.components?.planConsistencyScore ?? ""),
      String(record.score.components?.riskManagementScore ?? ""),
      String(record.score.components?.executionPenalty ?? ""),
      String(record.score.decisionsTaken),
      String(record.score.illegalActions),
      String(record.score.invalidJson),
      String(record.score.modelErrors),
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
        <thead><tr><th>Competitor</th><th>Runs</th><th>Failed</th><th>Win Rate</th><th>Avg Score</th><th>Weighted Score</th><th>Progress</th><th>Resource</th><th>Adapt</th><th>Plan</th><th>Risk</th><th>Penalty</th><th>Avg Decisions</th><th>Avg LP Delta</th><th>Model Errors</th><th>Avg Latency</th><th>Avg Tokens</th></tr></thead>
        <tbody>${summary.aggregate.map(renderAggregateRow).join("")}</tbody>
      </table>
    </section>
    <section>
      <h2>Runs</h2>
      <table>
        <thead><tr><th>Competitor</th><th>Scenario</th><th>Status</th><th>Family</th><th>Won</th><th>Score</th><th>Progress</th><th>Plan</th><th>Decisions</th><th>LP Delta</th><th>Latency</th><th>Tokens</th><th>Viewer</th></tr></thead>
        <tbody>${summary.records.map(renderRunRow).join("")}</tbody>
      </table>
    </section>
  </main>
</body>
</html>`;
}

function renderAggregateRow(row: RealEvalSummary["aggregate"][number]): string {
  return `<tr><td>${escapeHtml(row.competitorId)}</td><td>${row.runs}</td><td>${row.failedRuns}</td><td>${row.winRate.toFixed(2)}</td><td>${row.averageScore.toFixed(2)}</td><td>${row.weightedObjectiveScore.toFixed(2)}</td><td>${row.averageStrategicProgressScore.toFixed(2)}</td><td>${row.averageResourceScore.toFixed(2)}</td><td>${row.averageAdaptationScore.toFixed(2)}</td><td>${row.averagePlanConsistencyScore.toFixed(2)}</td><td>${row.averageRiskManagementScore.toFixed(2)}</td><td>${row.averageExecutionPenalty.toFixed(2)}</td><td>${row.averageDecisions.toFixed(1)}</td><td>${row.averageLpDelta.toFixed(0)}</td><td>${row.modelErrorRate.toFixed(2)}</td><td>${row.averageLatencyMs.toFixed(0)} ms</td><td>${row.averageTokenCount === null ? "" : row.averageTokenCount.toFixed(0)}</td></tr>`;
}

function renderRunRow(record: RealEvalSummary["records"][number]): string {
  const viewer = record.viewerPath ? `<a href="${escapeHtml(record.viewerPath)}">viewer</a>` : "";
  return `<tr><td>${escapeHtml(record.score.competitorId ?? competitorIdFor(record.score.agentId, record.score.model))}</td><td>${escapeHtml(record.score.scenarioId)}</td><td>${escapeHtml(record.score.status ?? "completed")}</td><td>${escapeHtml(record.score.family)}</td><td>${record.score.won ? "yes" : "no"}</td><td>${record.score.objectiveScore.toFixed(2)}</td><td>${(record.score.components?.strategicProgressScore ?? record.score.objectiveScore).toFixed(2)}</td><td>${(record.score.components?.planConsistencyScore ?? 0).toFixed(2)}</td><td>${record.score.decisionsTaken}</td><td>${record.score.finalLpDelta}</td><td>${record.score.latencyMs} ms</td><td>${record.score.tokenCount ?? ""}</td><td>${viewer}</td></tr>`;
}

function csvCell(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;");
}

function weightedObjectiveScore(scores: ScenarioScore[]): number {
  const weights: Record<string, number> = {
    lethal: 0.15,
    interruption: 0.15,
    resource: 0.15,
    smoke: 0.05,
    "setup-payoff": 0.12,
    "resource-grind": 0.12,
    "bait-interruption": 0.12,
    "delayed-lethal": 0.12,
    recovery: 0.12,
    "defensive-planning": 0.12,
  };
  const presentFamilies = Object.keys(weights).filter((family) =>
    scores.some((score) => score.family === family),
  );
  const totalWeight = presentFamilies.reduce((sum, family) => sum + (weights[family] ?? 0), 0);
  if (totalWeight === 0) return 0;
  return (
    presentFamilies.reduce((sum, family) => {
      const familyScores = scores.filter((score) => score.family === family);
      return sum + average(familyScores.map((score) => score.objectiveScore)) * (weights[family] ?? 0);
    }, 0) / totalWeight
  );
}
