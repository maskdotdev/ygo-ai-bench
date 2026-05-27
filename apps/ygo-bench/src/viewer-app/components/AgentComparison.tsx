import type { SuiteSummary } from "../types";

export function AgentComparison({ summary }: { summary: SuiteSummary }) {
  const max = Math.max(...summary.aggregate.map((row) => row.weightedObjectiveScore), 0.01);
  return (
    <section className="panel">
      <div className="section-head">
        <h2>Agent Separation</h2>
        <span>{summary.suiteId}</span>
      </div>
      <div className="bar-list">
        {summary.aggregate.map((row) => (
          <div className="bar-row" key={row.agentId}>
            <div>
              <strong>{row.agentId}</strong>
              <span>WR {(row.winRate * 100).toFixed(0)}%</span>
            </div>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(row.weightedObjectiveScore / max) * 100}%` }} />
            </div>
            <b>{row.weightedObjectiveScore.toFixed(3)}</b>
          </div>
        ))}
      </div>
    </section>
  );
}
