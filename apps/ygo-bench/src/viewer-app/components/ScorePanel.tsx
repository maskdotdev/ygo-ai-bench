import type { ScenarioScore } from "../types";

export function ScorePanel({ score }: { score: ScenarioScore }) {
  return (
    <section className="panel score-panel">
      <div className="section-head">
        <h2>Score</h2>
        <strong>{score.objectiveScore.toFixed(3)}</strong>
      </div>
      <div className="metric-grid">
        <Metric label="Won" value={score.won ? "yes" : "no"} />
        <Metric label="Decisions" value={score.decisionsTaken} />
        <Metric label="LP delta" value={score.finalLpDelta} />
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
