import { useEffect, useMemo, useState } from "react";
import { cancelEval, createEval, listEvals } from "../../api/client";
import type { EvalCompetitor, EvalView as EvalViewType } from "../../types";

export function EvalView({ onSelectRun }: { onSelectRun: (id: string) => void }) {
  const [evals, setEvals] = useState<EvalViewType[]>([]);
  const [current, setCurrent] = useState<EvalViewType | null>(null);
  const [suitePath, setSuitePath] = useState("suites/long-horizon-v1.json");
  const [competitors, setCompetitors] = useState("greedy,random");
  const [runsPerScenario, setRunsPerScenario] = useState(1);
  const [maxDecisions, setMaxDecisions] = useState(120);
  const [viewer, setViewer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listEvals()
      .then((items) => {
        setEvals(items);
        setCurrent(items[0] ?? null);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!current) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/evals/${encodeURIComponent(current.id)}/live`);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data) as { type?: string; eval?: EvalViewType };
      if (message.type === "eval" && message.eval) {
        setCurrent(message.eval);
        setEvals((items) => [message.eval!, ...items.filter((item) => item.id !== message.eval!.id)]);
      }
    });
    return () => socket.close();
  }, [current?.id]);

  const aggregate = current?.summary?.aggregate ?? [];
  const progressPercent = useMemo(() => {
    if (!current || current.progress.total === 0) return 0;
    return Math.round((current.progress.completed / current.progress.total) * 100);
  }, [current]);

  async function startEval() {
    setBusy(true);
    setError(null);
    try {
      const next = await createEval({
        suitePath,
        competitors: parseCompetitors(competitors),
        runsPerScenario,
        maxDecisions,
        viewer,
      });
      setCurrent(next);
      setEvals((items) => [next, ...items.filter((item) => item.id !== next.id)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function cancelCurrent() {
    if (!current) return;
    setBusy(true);
    setError(null);
    try {
      setCurrent(await cancelEval(current.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="eval-layout">
      <aside className="panel eval-setup">
        <div className="section-head">
          <h2>Eval</h2>
          <span>{current?.status ?? "idle"}</span>
        </div>
        <label htmlFor="eval-suite-path">
          Suite
          <input id="eval-suite-path" value={suitePath} onChange={(event) => setSuitePath(event.target.value)} />
        </label>
        <label htmlFor="eval-competitors">
          Competitors
          <textarea id="eval-competitors" value={competitors} onChange={(event) => setCompetitors(event.target.value)} rows={4} />
        </label>
        <div className="inline-controls">
          <label htmlFor="eval-runs">
            Runs
            <input id="eval-runs" type="number" min={1} max={20} value={runsPerScenario} onChange={(event) => setRunsPerScenario(Number(event.target.value))} />
          </label>
          <label htmlFor="eval-max-decisions">
            Max decisions
            <input id="eval-max-decisions" type="number" min={1} max={400} value={maxDecisions} onChange={(event) => setMaxDecisions(Number(event.target.value))} />
          </label>
        </div>
        <label className="check-row" htmlFor="eval-write-viewer">
          <input id="eval-write-viewer" type="checkbox" checked={viewer} onChange={(event) => setViewer(event.target.checked)} />
          Write legacy viewer files
        </label>
        <button className="primary-action" disabled={busy} onClick={startEval}>
          Start Eval
        </button>
        {current?.status === "queued" || current?.status === "running" ? (
          <button className="secondary-action" disabled={busy} onClick={cancelCurrent}>
            Cancel Eval
          </button>
        ) : null}
        {error ? <p className="error-banner">{error}</p> : null}
        <div className="run-stack">
          {evals.map((item) => (
            <button key={item.id} className={`run-row ${item.id === current?.id ? "active" : ""}`} onClick={() => setCurrent(item)}>
              <span className="run-title">{item.request.suitePath.split("/").pop()}</span>
              <span>{item.status}</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="eval-main">
        {current ? (
          <>
            <section className="panel">
              <div className="section-head">
                <h2>{current.id}</h2>
                <span>{progressPercent}%</span>
              </div>
              <div className="eval-progress">
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${progressPercent}%` }} />
                </div>
                <small>
                  {current.progress.completed} / {current.progress.total || "?"} runs | {current.request.competitors.map(labelCompetitor).join(", ")}
                </small>
              </div>
              {current.error ? <p className="error-banner">{current.error}</p> : null}
            </section>

            <section className="panel">
              <div className="section-head">
                <h2>Leaderboard</h2>
                <span>{aggregate.length} competitors</span>
              </div>
              <div className="leaderboard-table">
                <div className="leaderboard-head">
                  <span>Competitor</span>
                  <span>Score</span>
                  <span>Plan</span>
                  <span>Risk</span>
                  <span>Penalty</span>
                  <span>Failed</span>
                </div>
                {aggregate.map((row) => (
                  <div className="leaderboard-row" key={row.competitorId ?? row.agentId}>
                    <strong>{row.competitorId ?? row.agentId}</strong>
                    <span>{number(row.weightedObjectiveScore ?? row.averageScore)}</span>
                    <span>{number(row.averagePlanConsistencyScore)}</span>
                    <span>{number(row.averageRiskManagementScore)}</span>
                    <span>{number(row.averageExecutionPenalty)}</span>
                    <span>{row.failedRuns ?? 0}</span>
                  </div>
                ))}
                {aggregate.length === 0 ? <div className="empty-block">Leaderboard appears when the first run completes.</div> : null}
              </div>
            </section>

            <section className="panel">
              <div className="section-head">
                <h2>Run Events</h2>
                <span>{current.events.length}</span>
              </div>
              <div className="timeline-list">
                {current.events
                  .slice(-80)
                  .reverse()
                  .map((event) => (
                    <button key={`${event.runDir}-${event.completed}`} className="timeline-row" onClick={() => onSelectRun(event.runDir.split("/").pop() ?? event.runDir)}>
                      <strong>{event.competitorId}</strong>
                      <small>
                        {event.scenarioId} | {number(event.score)} | {event.status}
                      </small>
                    </button>
                  ))}
              </div>
            </section>
          </>
        ) : (
          <div className="empty-block">Start a long-horizon eval.</div>
        )}
      </main>
    </div>
  );
}

function parseCompetitors(value: string): EvalCompetitor[] {
  return value
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [agentRaw, ...modelParts] = entry.split(":");
      const agentId = agentRaw as EvalCompetitor["agentId"];
      const model = modelParts.join(":") || undefined;
      return {
        agentId,
        ...(model ? { model, competitorId: `${agentId}:${model}` } : { competitorId: agentId }),
      };
    });
}

function labelCompetitor(competitor: EvalCompetitor): string {
  return competitor.competitorId ?? (competitor.model ? `${competitor.agentId}:${competitor.model}` : competitor.agentId);
}

function number(value: number | undefined): string {
  return (value ?? 0).toFixed(3);
}
