import type { EvalCompetitor, EvalView, RunDetails, RunIndexItem, SuiteSummary, TraceFrame } from "../types";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return (await response.json()) as T;
}

export function listRuns(): Promise<RunIndexItem[]> {
  return getJson<RunIndexItem[]>("/api/runs");
}

export function getRun(id: string): Promise<RunDetails> {
  return getJson<RunDetails>(`/api/runs/${encodeURIComponent(id)}`);
}

export function getRunTrace(id: string): Promise<TraceFrame[]> {
  return getJson<TraceFrame[]>(`/api/runs/${encodeURIComponent(id)}/trace`);
}

export async function getRunTranscript(id: string): Promise<string> {
  const response = await fetch(`/api/runs/${encodeURIComponent(id)}/transcript`);
  if (!response.ok) return "";
  return response.text();
}

export function listSummaries(): Promise<string[]> {
  return getJson<string[]>("/api/summaries");
}

export function getSummary(id: string): Promise<SuiteSummary> {
  return getJson<SuiteSummary>(`/api/summaries/${encodeURIComponent(id)}`);
}

export function listEvals(): Promise<EvalView[]> {
  return getJson<EvalView[]>("/api/evals");
}

export async function createEval(body: {
  suitePath: string;
  competitors: EvalCompetitor[];
  runsPerScenario: number;
  maxDecisions: number;
  viewer: boolean;
}): Promise<EvalView> {
  const response = await fetch("/api/evals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  return (await response.json()) as EvalView;
}

export function getEval(id: string): Promise<EvalView> {
  return getJson<EvalView>(`/api/evals/${encodeURIComponent(id)}`);
}

export async function cancelEval(id: string): Promise<EvalView> {
  const response = await fetch(`/api/evals/${encodeURIComponent(id)}/cancel`, { method: "POST" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  return (await response.json()) as EvalView;
}
