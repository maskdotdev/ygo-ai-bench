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
          <div className="score-card" key={row.agentId}>
            <span>{row.agentId}</span>
            <strong>{summaryScore(row).toFixed(3)}</strong>
            <small>win {percent(row.winRate)} | avg {number(row.averageDecisions, 1)} decisions</small>
          </div>
        ))}
      </div>
      <div className="heat-table">
        {summary.records.slice(0, 60).map((record) => (
          <button
            key={`${record.score.agentId}-${record.score.scenarioId}-${record.runDir}`}
            onClick={() => onSelectRun(record.runDir.split("/").pop() ?? record.runDir)}
            title={record.runDir}
          >
            <span>{record.score.scenarioId.replace("real-", "")}</span>
            <b>{record.score.agentId}</b>
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

function percent(value: number | undefined): string {
  return `${(((value ?? 0) * 100)).toFixed(0)}%`;
}

function number(value: number | undefined, digits: number): string {
  return (value ?? 0).toFixed(digits);
}
