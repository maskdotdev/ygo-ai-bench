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
    Promise.all([getRun(selectedRunId), getRunTrace(selectedRunId), getRunTranscript(selectedRunId)])
      .then(([details, nextTrace, nextTranscript]) => {
        setRunDetails(details);
        setTrace(nextTrace);
        setTranscript(nextTranscript);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
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
