import type { SuiteSummary } from "../types";

export function SuiteSummaryView({ summary, onSelectRun }: { summary: SuiteSummary; onSelectRun: (id: string) => void }) {
  return (
    <section className="panel suite-panel">
      <div className="section-head">
        <h2>Suite Summary</h2>
        <span>{new Date(summary.generatedAt).toLocaleString()}</span>
      </div>
      <div className="summary-grid">
        {summary.aggregate.map((row) => (
          <div className="score-card" key={competitorLabel(row)}>
            <span>{competitorLabel(row)}</span>
            <strong>{summaryScore(row).toFixed(3)}</strong>
            <small>
              win {percent(row.winRate)} | plan {number(row.averagePlanConsistencyScore, 2)} | failed {row.failedRuns ?? 0}
            </small>
          </div>
        ))}
      </div>
      <div className="heat-table">
        {summary.records.slice(0, 60).map((record) => (
          <button
            key={`${competitorLabelFromScore(record.score)}-${record.score.scenarioId}-${record.runDir}`}
            onClick={() => onSelectRun(record.runDir.split("/").pop() ?? record.runDir)}
            title={record.runDir}
          >
            <span>{record.score.scenarioId.replace("real-", "")}</span>
            <b>{competitorLabelFromScore(record.score)}</b>
            <strong>{number(record.score.objectiveScore, 2)}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}

function summaryScore(row: SuiteSummary["aggregate"][number]): number {
  return row.weightedObjectiveScore ?? row.averageScore ?? 0;
}

function competitorLabel(row: SuiteSummary["aggregate"][number]): string {
  return row.competitorId ?? (row.model ? `${row.agentId}:${row.model}` : row.agentId);
}

function competitorLabelFromScore(score: SuiteSummary["records"][number]["score"]): string {
  return score.competitorId ?? (score.model ? `${score.agentId}:${score.model}` : score.agentId);
}

function percent(value: number | undefined): string {
  return `${(((value ?? 0) * 100)).toFixed(0)}%`;
}

function number(value: number | undefined, digits: number): string {
  return (value ?? 0).toFixed(digits);
}
