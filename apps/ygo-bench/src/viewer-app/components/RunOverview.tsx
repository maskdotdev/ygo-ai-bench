import type { ReplayFrame, RunDetails } from "../types";

export function RunOverview({ details, frames }: { details: RunDetails; frames: ReplayFrame[] }) {
  const score = details.score;
  const decisions = frames.filter((entry) => entry.frame.type === "decision");
  const events = frames.filter((entry) => entry.frame.type === "event");
  const lastDecision = decisions.at(-1)?.frame;
  const firstDecision = decisions[0]?.frame;
  const finalState = details.reducedState;
  const p0 = finalState?.players[0];
  const p1 = finalState?.players[1];

  return (
    <section className="panel run-overview">
      <div className="section-head">
        <h2>Run Brief</h2>
        <span>{score.won ? "win" : "not won"}</span>
      </div>
      <div className="brief-grid">
        <Brief label="Scenario" value={score.scenarioId} />
        <Brief label="Agent" value={score.agentId} />
        <Brief label="Family" value={score.family} />
        <Brief label="Score" value={score.objectiveScore.toFixed(3)} />
        <Brief label="Decisions" value={String(score.decisionsTaken)} />
        <Brief label="LP delta" value={String(score.finalLpDelta)} />
      </div>
      <div className="run-story">
        <p>
          {score.agentId} played {score.decisionsTaken} engine prompts in a {score.family} scenario and finished with {score.finalLpDelta >= 0 ? "+" : ""}
          {score.finalLpDelta} LP delta.
        </p>
        <p>
          The trace contains {events.length} public events and {decisions.length} model decisions. {score.invalidJson + score.illegalActions + score.modelErrors === 0 ? "No invalid model output was recorded." : "Model output errors were recorded."}
        </p>
      </div>
      <div className="brief-grid">
        <Brief label="Opening choice" value={firstDecision?.chosen?.actionId ?? "n/a"} />
        <Brief label="Final choice" value={lastDecision?.chosen?.actionId ?? "n/a"} />
        <Brief label="Player 0 LP" value={p0 ? String(p0.lp) : "n/a"} />
        <Brief label="Player 1 LP" value={p1 ? String(p1.lp) : "n/a"} />
      </div>
      {lastDecision?.chosen?.reason ? (
        <div className="decision-callout">
          <span>Last model reason</span>
          <p>{lastDecision.chosen.reason}</p>
        </div>
      ) : null}
    </section>
  );
}

function Brief({ label, value }: { label: string; value: string }) {
  return (
    <div className="brief">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
