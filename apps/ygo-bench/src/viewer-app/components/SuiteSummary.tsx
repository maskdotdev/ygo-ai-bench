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
            <strong>{row.weightedObjectiveScore.toFixed(3)}</strong>
            <small>win {(row.winRate * 100).toFixed(0)}% | avg {row.averageDecisions.toFixed(1)} decisions</small>
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
            <strong>{record.score.objectiveScore.toFixed(2)}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}
