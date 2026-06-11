import type { SuiteSummary } from "../types";

export function AgentComparison({ summary }: { summary: SuiteSummary }) {
  const max = Math.max(...summary.aggregate.map((row) => summaryScore(row)), 0.01);
  return (
    <section className="panel">
      <div className="section-head">
        <h2>Agent Separation</h2>
        <span>{summary.suiteId}</span>
      </div>
      <div className="bar-list">
        {summary.aggregate.map((row) => (
          <div className="bar-row" key={competitorLabel(row)}>
            <div>
              <strong>{competitorLabel(row)}</strong>
              <span>
                WR {(row.winRate * 100).toFixed(0)}% | plan {number(row.averagePlanConsistencyScore, 2)}
              </span>
            </div>
            <div className="bar-track">
              <div className="bar-fill" style={{ width: `${(summaryScore(row) / max) * 100}%` }} />
            </div>
            <b>{summaryScore(row).toFixed(3)}</b>
          </div>
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

function number(value: number | undefined, digits: number): string {
  return (value ?? 0).toFixed(digits);
}
