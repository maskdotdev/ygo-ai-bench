import { useEffect, useMemo, useState } from "react";
import { BoardView } from "../BoardView";
import type { PlaySessionView } from "../../types";
import { concedePlaySession, createPlaySession, listPlaySessions, submitPlayAction } from "../../state/playClient";

export function PlayView() {
  const [sessions, setSessions] = useState<PlaySessionView[]>([]);
  const [session, setSession] = useState<PlaySessionView | null>(null);
  const [scenarioPath, setScenarioPath] = useState("scenarios/real/smoke-duel.json");
  const [opponentAgent, setOpponentAgent] = useState<"openai" | "greedy" | "random">("greedy");
  const [model, setModel] = useState("gpt-4o-mini");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listPlaySessions()
      .then((items) => {
        setSessions(items);
        setSession(items[0] ?? null);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!session) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/play/sessions/${encodeURIComponent(session.id)}/live`);
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data) as { type?: string; session?: PlaySessionView };
      if (message.type === "session" && message.session) setSession(message.session);
    });
    return () => socket.close();
  }, [session?.id]);

  const actionsByType = useMemo(() => {
    const groups = new Map<string, PlaySessionView["legalActions"]>();
    for (const action of session?.legalActions ?? []) {
      const group = groups.get(action.type) ?? [];
      group.push(action);
      groups.set(action.type, group);
    }
    return [...groups.entries()];
  }, [session?.legalActions]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const next = await createPlaySession({ scenarioPath, humanPlayer: 0, opponentAgent, model, maxDecisions: 80 });
      setSession(next);
      setSessions((current) => [next, ...current.filter((item) => item.id !== next.id)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function choose(actionId: string) {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      setSession(await submitPlayAction(session.id, actionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function concede() {
    if (!session) return;
    setSession(await concedePlaySession(session.id));
  }

  return (
    <div className="play-layout">
      <aside className="panel play-setup">
        <div className="section-head">
          <h2>Play</h2>
          <span>{session?.status ?? "idle"}</span>
        </div>
        <label>
          Scenario
          <input value={scenarioPath} onChange={(event) => setScenarioPath(event.target.value)} />
        </label>
        <label>
          Opponent
          <select value={opponentAgent} onChange={(event) => setOpponentAgent(event.target.value as "openai" | "greedy" | "random")}>
            <option value="greedy">greedy</option>
            <option value="random">random</option>
            <option value="openai">openai</option>
          </select>
        </label>
        <label>
          Model
          <input value={model} onChange={(event) => setModel(event.target.value)} />
        </label>
        <button className="primary-action" disabled={busy} onClick={start}>
          Start
        </button>
        {session && session.status !== "finished" ? (
          <button className="secondary-action" disabled={busy} onClick={concede}>
            Concede
          </button>
        ) : null}
        {error ? <p className="error-banner">{error}</p> : null}
        <div className="run-stack">
          {sessions.map((item) => (
            <button key={item.id} className={`run-row ${item.id === session?.id ? "active" : ""}`} onClick={() => setSession(item)}>
              <span className="run-title">{item.scenarioId}</span>
              <span>{item.status}</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="play-main">
        {session ? (
          <>
            <section className="replay-toolbar">
              <h2>{session.scenarioId}</h2>
              <div className="topbar-metrics">
                <span>Human P{session.humanPlayer}</span>
                <span>{session.opponentAgent}</span>
                <span>{session.runDir.split("/").slice(-1)[0]}</span>
              </div>
            </section>
            <BoardView state={session.reducedState} player={session.currentPrompt?.player} />
            <section className="lower-grid">
              <div className="panel">
                <div className="section-head">
                  <h2>Legal Actions</h2>
                  <span>{session.currentPrompt?.type ?? "none"}</span>
                </div>
                {session.status === "waiting_for_human" ? (
                  <div className="action-list">
                    {actionsByType.map(([type, actions]) => (
                      <div key={type} className="action-group">
                        <b>{type}</b>
                        {actions.map((action) => (
                          <button key={action.id} className="action-row" disabled={busy} onClick={() => choose(action.id)}>
                            <span>{action.id}</span>
                            <strong>{action.label}</strong>
                            <small>{action.type}</small>
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-block">{session.status === "thinking" ? "Opponent is thinking." : "No human prompt is active."}</div>
                )}
              </div>
              <div className="panel">
                <div className="section-head">
                  <h2>Opponent</h2>
                  <span>{session.lastOpponentDecision?.tokenCount ?? "no"} tokens</span>
                </div>
                {session.lastOpponentDecision ? (
                  <div className="chosen-action">
                    <strong>{session.lastOpponentDecision.label}</strong>
                    <p>{session.lastOpponentDecision.reason}</p>
                  </div>
                ) : (
                  <div className="empty-block">No opponent decision yet.</div>
                )}
              </div>
            </section>
            {session.score ? (
              <section className="panel">
                <div className="section-head">
                  <h2>Artifacts</h2>
                  <span>{session.score.won ? "win" : "loss"}</span>
                </div>
                <div className="artifact-links">
                  <a href={`/api/runs/${encodeURIComponent(runId(session.runDir))}/trace/raw`}>Trace</a>
                  <a href={`/api/runs/${encodeURIComponent(runId(session.runDir))}/score`}>Score</a>
                  <a href={`/api/runs/${encodeURIComponent(runId(session.runDir))}/metadata`}>Metadata</a>
                  <a href={`/api/play/sessions/${encodeURIComponent(session.id)}/transcript`}>Transcript</a>
                </div>
              </section>
            ) : null}
            <section className="panel">
              <div className="section-head">
                <h2>Timeline</h2>
                <span>{session.timeline.length} events</span>
              </div>
              <div className="timeline-list">
                {session.timeline
                  .slice(-40)
                  .reverse()
                  .map((frame, index) => (
                    <div key={index} className="timeline-row">
                      <strong>{frame.event ?? frame.type}</strong>
                      <small>{frame.text ?? frame.chosen?.reason ?? ""}</small>
                    </div>
                  ))}
              </div>
            </section>
          </>
        ) : (
          <div className="empty-block">Start a play session.</div>
        )}
      </main>
    </div>
  );
}

function runId(runDir: string): string {
  return runDir.split("/").filter(Boolean).slice(-1)[0] ?? runDir;
}
