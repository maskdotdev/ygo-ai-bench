import type { PlaySessionView } from "../types";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export function listPlaySessions(): Promise<PlaySessionView[]> {
  return requestJson<PlaySessionView[]>("/api/play/sessions");
}

export function createPlaySession(body: {
  scenarioPath: string;
  humanPlayer: 0 | 1;
  opponentAgent: "openai" | "greedy" | "random";
  model?: string;
  maxDecisions: number;
}): Promise<PlaySessionView> {
  return requestJson<PlaySessionView>("/api/play/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function submitPlayAction(sessionId: string, actionId: string): Promise<PlaySessionView> {
  return requestJson<PlaySessionView>(`/api/play/sessions/${encodeURIComponent(sessionId)}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ actionId }),
  });
}

export function concedePlaySession(sessionId: string): Promise<PlaySessionView> {
  return requestJson<PlaySessionView>(`/api/play/sessions/${encodeURIComponent(sessionId)}/concede`, { method: "POST" });
}
