import type { ReactNode } from "react";
import type { RunIndexItem } from "../types";

export function AppShell(props: {
  children: ReactNode;
  summaryIds: string[];
  selectedSummaryId: string | null;
  selectedRun: RunIndexItem | null;
  liveStatus: string;
  error: string | null;
  onSelectSummary: (id: string) => void;
}) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">YGO Bench</div>
          <h1>Control Room</h1>
        </div>
        <div className="topbar-metrics">
          <label>
            Suite
            <select value={props.selectedSummaryId ?? ""} onChange={(event) => props.onSelectSummary(event.target.value)}>
              {props.summaryIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <Metric label="Scenario" value={props.selectedRun?.scenarioId ?? "none"} />
          <Metric label="Agent" value={props.selectedRun?.agentId ?? "-"} />
          <Metric label="Score" value={props.selectedRun ? props.selectedRun.score.toFixed(2) : "-"} />
          <Metric label="Trace" value={props.liveStatus} />
        </div>
      </header>
      {props.error ? <div className="error-banner">{props.error}</div> : null}
      <div className="main-grid">{props.children}</div>
    </div>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}
