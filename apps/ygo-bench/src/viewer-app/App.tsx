import { useEffect, useMemo, useState } from "react";
import { getRun, getRunTrace, getRunTranscript, getSummary, listRuns, listSummaries } from "./api/client";
import { AgentComparison } from "./components/AgentComparison";
import { AppShell } from "./components/AppShell";
import { ReplayView } from "./components/ReplayView";
import { RunList } from "./components/RunList";
import { SuiteSummaryView } from "./components/SuiteSummary";
import type { RunDetails, RunIndexItem, SuiteSummary, TraceFrame } from "./types";

declare global {
  interface Window {
    __YGO_BENCH_OPEN_RUN__?: string;
  }
}

export function App() {
  const [runs, setRuns] = useState<RunIndexItem[]>([]);
  const [summaryIds, setSummaryIds] = useState<string[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedSummaryId, setSelectedSummaryId] = useState<string | null>(null);
  const [runDetails, setRunDetails] = useState<RunDetails | null>(null);
  const [trace, setTrace] = useState<TraceFrame[]>([]);
  const [transcript, setTranscript] = useState("");
  const [summary, setSummary] = useState<SuiteSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState("offline");

  useEffect(() => {
    Promise.all([listRuns(), listSummaries()])
      .then(([runItems, summaries]) => {
        setRuns(runItems);
        setSummaryIds(summaries);
        setSelectedRunId((current) => current ?? window.__YGO_BENCH_OPEN_RUN__ ?? runItems[0]?.id ?? null);
        setSelectedSummaryId((current) => current ?? summaries[0] ?? null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    if (!selectedRunId) return;
    let cancelled = false;
    const seen = new Set<string>();
    Promise.all([getRun(selectedRunId), getRunTrace(selectedRunId), getRunTranscript(selectedRunId)])
      .then(([details, nextTrace, nextTranscript]) => {
        if (cancelled) return;
        setRunDetails(details);
        for (const frame of nextTrace) seen.add(JSON.stringify(frame));
        setTrace(nextTrace);
        setTranscript(nextTranscript);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/runs/${encodeURIComponent(selectedRunId)}/live`);
    setLiveStatus("connecting");
    socket.addEventListener("open", () => setLiveStatus("live"));
    socket.addEventListener("close", () => setLiveStatus("offline"));
    socket.addEventListener("error", () => setLiveStatus("offline"));
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data) as { type?: string; payload?: TraceFrame };
      if (message.type !== "trace" || !message.payload) return;
      const key = JSON.stringify(message.payload);
      if (seen.has(key)) return;
      seen.add(key);
      setTrace((current) => [...current, message.payload as TraceFrame]);
    });
    return () => {
      cancelled = true;
      socket.close();
    };
  }, [selectedRunId]);

  useEffect(() => {
    if (!selectedSummaryId) return;
    getSummary(selectedSummaryId)
      .then(setSummary)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [selectedSummaryId]);

  const selectedRun = useMemo(() => runs.find((run) => run.id === selectedRunId) ?? null, [runs, selectedRunId]);

  return (
    <AppShell
      summaryIds={summaryIds}
      selectedSummaryId={selectedSummaryId}
      onSelectSummary={setSelectedSummaryId}
      selectedRun={selectedRun}
      liveStatus={liveStatus}
      error={error}
    >
      <aside className="left-rail">
        <RunList runs={runs} selectedRunId={selectedRunId} onSelectRun={setSelectedRunId} />
        {summary ? <AgentComparison summary={summary} /> : <div className="empty-block">No suite summary loaded.</div>}
      </aside>
      <main className="workspace">
        {summary ? <SuiteSummaryView summary={summary} onSelectRun={setSelectedRunId} /> : null}
        {runDetails ? (
          <ReplayView details={runDetails} trace={trace} transcript={transcript} />
        ) : (
          <div className="empty-block">Select a run to inspect its trace.</div>
        )}
      </main>
    </AppShell>
  );
}
