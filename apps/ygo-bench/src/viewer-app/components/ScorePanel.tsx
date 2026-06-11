import type { ScenarioScore } from "../types";

export function ScorePanel({ score }: { score: ScenarioScore }) {
  return (
    <section className="panel score-panel">
      <div className="section-head">
        <h2>Score</h2>
        <strong>{score.objectiveScore.toFixed(3)}</strong>
      </div>
      {score.scoreRationale ? <p className="notes">{score.scoreRationale}</p> : null}
      <div className="metric-grid">
        <Metric label="Mode" value={score.mode ?? "legacy"} />
        <Metric label="Status" value={score.status ?? "completed"} />
        <Metric label="Competitor" value={score.competitorId ?? score.agentId} />
        <Metric label="Won" value={score.won ? "yes" : "no"} />
        <Metric label="Decisions" value={score.decisionsTaken} />
        <Metric label="LP delta" value={score.finalLpDelta} />
        <Metric label="Progress" value={number(score.components?.strategicProgressScore)} />
        <Metric label="Resource" value={number(score.components?.resourceScore)} />
        <Metric label="Adapt" value={number(score.components?.adaptationScore)} />
        <Metric label="Plan" value={number(score.components?.planConsistencyScore)} />
        <Metric label="Risk" value={number(score.components?.riskManagementScore)} />
        <Metric label="Penalty" value={number(score.components?.executionPenalty)} />
        <Metric label="Win weight" value={number(score.scoreWeights?.win)} />
        <Metric label="Progress weight" value={number(score.scoreWeights?.strategicProgress)} />
        <Metric label="Resource weight" value={number(score.scoreWeights?.resource)} />
        <Metric label="Invalid JSON" value={score.invalidJson} />
        <Metric label="Illegal" value={score.illegalActions} />
        <Metric label="Errors" value={score.modelErrors} />
        <Metric label="Latency" value={`${score.latencyMs} ms`} />
        <Metric label="Tokens" value={score.tokenCount ?? "n/a"} />
      </div>
      {score.notes.length ? <p className="notes">{score.notes.join(" | ")}</p> : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function number(value: number | undefined): string {
  return typeof value === "number" ? value.toFixed(2) : "n/a";
}
