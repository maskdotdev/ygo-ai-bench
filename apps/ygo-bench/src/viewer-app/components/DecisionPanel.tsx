import type { TraceFrame } from "../types";

export function DecisionPanel({ frame }: { frame: TraceFrame | null }) {
  if (!frame || frame.type !== "decision") return <section className="panel decision-panel empty-block">Select a decision frame to inspect legal actions.</section>;
  const chosenId = frame.chosen?.actionId;
  return (
    <section className="panel decision-panel">
      <div className="section-head">
        <h2>Decision</h2>
        <span>Player {frame.player ?? 0}</span>
      </div>
      <div className="chosen-action">
        <span>Chosen</span>
        <strong>{chosenId}</strong>
        <p>{frame.chosen?.reason || "No reason recorded."}</p>
      </div>
      {frame.chosen?.plan ? (
        <div className="chosen-action">
          <span>Plan</span>
          <strong>{frame.chosen.plan.currentGoal || "No current goal"}</strong>
          <p>Horizon: {frame.chosen.plan.horizon || "not stated"}</p>
          <p>Future line: {frame.chosen.plan.futureLine.length === 0 ? "not stated" : frame.chosen.plan.futureLine.join(" -> ")}</p>
          <p>Preserve: {frame.chosen.plan.resourcesToPreserve.length === 0 ? "not stated" : frame.chosen.plan.resourcesToPreserve.join(", ")}</p>
          <p>Risks: {frame.chosen.plan.risks.length === 0 ? "not stated" : frame.chosen.plan.risks.join(", ")}</p>
          <p>Contingency: {frame.chosen.plan.contingency || "not stated"}</p>
        </div>
      ) : null}
      <div className="action-list">
        {(frame.legalActions ?? []).map((action) => (
          <div key={action.id} className={`action-row ${action.id === chosenId ? "chosen" : ""}`}>
            <b>{action.id}</b>
            <span>{action.label}</span>
            <small>{action.type}</small>
          </div>
        ))}
      </div>
    </section>
  );
}
