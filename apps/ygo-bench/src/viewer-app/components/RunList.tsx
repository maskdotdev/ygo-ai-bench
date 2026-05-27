import { useMemo, useState } from "react";
import type { RunIndexItem } from "../types";

export function RunList(props: { runs: RunIndexItem[]; selectedRunId: string | null; onSelectRun: (id: string) => void }) {
  const [agent, setAgent] = useState("all");
  const [family, setFamily] = useState("all");
  const filtered = useMemo(
    () =>
      props.runs.filter((run) => {
        if (agent !== "all" && run.agentId !== agent) return false;
        if (family !== "all" && run.family !== family) return false;
        return true;
      }),
    [agent, family, props.runs],
  );
  const agents = unique(props.runs.map((run) => run.agentId));
  const families = unique(props.runs.map((run) => run.family));

  return (
    <section className="panel run-list">
      <div className="section-head">
        <h2>Runs</h2>
        <span>{filtered.length}</span>
      </div>
      <div className="filters">
        <select value={agent} onChange={(event) => setAgent(event.target.value)}>
          <option value="all">All agents</option>
          {agents.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select value={family} onChange={(event) => setFamily(event.target.value)}>
          <option value="all">All families</option>
          {families.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      <div className="run-stack">
        {filtered.map((run) => (
          <button
            className={`run-row ${props.selectedRunId === run.id ? "active" : ""}`}
            key={run.id}
            onClick={() => props.onSelectRun(run.id)}
          >
            <span className="run-title">{run.scenarioId}</span>
            <span>{run.agentId}</span>
            <span>{run.family}</span>
            <strong>{run.score.toFixed(2)}</strong>
            {run.modelErrors || run.invalidJson || run.illegalActions ? <b className="warning-dot">!</b> : null}
          </button>
        ))}
      </div>
    </section>
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)].filter(Boolean).sort();
}
