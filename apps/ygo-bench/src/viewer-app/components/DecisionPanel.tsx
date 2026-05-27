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
