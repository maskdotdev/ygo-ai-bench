import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { ScenarioScore } from "../core/types.js";

export interface RunIndexItem {
  id: string;
  path: string;
  scenarioId: string;
  agentId: string;
  family: string;
  score: number;
  won: boolean;
  decisions: number;
  modelErrors: number;
  invalidJson: number;
  illegalActions: number;
  tokenCount: number | null;
  latencyMs: number;
  createdAt?: string;
}

export interface RunDetails {
  run: RunIndexItem;
  score: ScenarioScore;
  metadata: unknown;
  reducedState: unknown;
  artifacts: {
    trace: string;
    score: string;
    metadata?: string;
    transcript?: string;
    viewer?: string;
  };
}

export async function listRunArtifacts(root = "benchmark-runs"): Promise<RunIndexItem[]> {
  const rootPath = resolve(root);
  const entries = await safeReaddir(rootPath);
  const runs: RunIndexItem[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runDir = join(rootPath, entry.name);
    const score = await readJson<ScenarioScore>(join(runDir, "final-score.json"));
    if (!score) continue;
    const createdAt = timestampFromRunId(entry.name) ?? (await safeMtime(runDir));
    runs.push({
      id: entry.name,
      path: runDir,
      scenarioId: score.scenarioId,
      agentId: score.agentId,
      family: score.family ?? "unknown",
      score: score.objectiveScore,
      won: score.won,
      decisions: score.decisionsTaken,
      modelErrors: score.modelErrors ?? 0,
      invalidJson: score.invalidJson,
      illegalActions: score.illegalActions,
      tokenCount: score.tokenCount ?? null,
      latencyMs: score.latencyMs ?? 0,
      ...(createdAt ? { createdAt } : {}),
    });
  }
  return runs.sort((a, b) => (b.createdAt ?? b.id).localeCompare(a.createdAt ?? a.id));
}

export async function getRunArtifact(id: string, root = "benchmark-runs"): Promise<RunDetails | null> {
  const runDir = await resolveRunDir(id, root);
  if (!runDir) return null;
  const score = await readJson<ScenarioScore>(join(runDir, "final-score.json"));
  if (!score) return null;
  const [metadata, reducedState, runs] = await Promise.all([readJson(join(runDir, "metadata.json")), readJson(join(runDir, "reduced-state.json")), listRunArtifacts(root)]);
  const run = runs.find((candidate) => candidate.id === basename(runDir));
  if (!run) return null;
  return {
    run,
    score,
    metadata,
    reducedState,
    artifacts: {
      trace: `/api/runs/${encodeURIComponent(run.id)}/trace/raw`,
      score: `/api/runs/${encodeURIComponent(run.id)}/score`,
      ...(metadata ? { metadata: `/api/runs/${encodeURIComponent(run.id)}/metadata` } : {}),
      transcript: `/api/runs/${encodeURIComponent(run.id)}/transcript`,
      viewer: `/api/runs/${encodeURIComponent(run.id)}/legacy-viewer`,
    },
  };
}

export async function listSummaryArtifacts(root = "benchmark-runs"): Promise<string[]> {
  const rootPath = resolve(root);
  const entries = await safeReaddir(rootPath);
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith("-summary.json"))
    .map((entry) => entry.name.replace(/-summary\.json$/, ""))
    .sort();
}

export async function readSummaryArtifact(id: string, root = "benchmark-runs"): Promise<unknown | null> {
  if (!isSafeId(id)) return null;
  return readJson(resolve(root, `${id}-summary.json`));
}

export async function readRunTrace(id: string, root = "benchmark-runs"): Promise<unknown[] | null> {
  const runDir = await resolveRunDir(id, root);
  if (!runDir) return null;
  const raw = await safeRead(join(runDir, "trace.jsonl"));
  if (raw === null) return null;
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown);
}

export async function readRunFile(id: string, file: "trace.jsonl" | "final-score.json" | "metadata.json" | "model-transcript.md" | "viewer.html", root = "benchmark-runs"): Promise<string | null> {
  const runDir = await resolveRunDir(id, root);
  if (!runDir) return null;
  return safeRead(join(runDir, file));
}

export async function resolveRunDir(id: string, root = "benchmark-runs"): Promise<string | null> {
  if (!isSafeId(id)) return null;
  const rootPath = resolve(root);
  const runDir = resolve(rootPath, id);
  if (!runDir.startsWith(`${rootPath}/`) && runDir !== rootPath) return null;
  try {
    const info = await stat(runDir);
    return info.isDirectory() ? runDir : null;
  } catch {
    return null;
  }
}

function isSafeId(id: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(id);
}

async function readJson<T = unknown>(path: string): Promise<T | null> {
  const raw = await safeRead(path);
  if (raw === null) return null;
  return JSON.parse(raw) as T;
}

async function safeRead(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

async function safeReaddir(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function safeMtime(path: string): Promise<string | undefined> {
  try {
    return (await stat(path)).mtime.toISOString();
  } catch {
    return undefined;
  }
}

function timestampFromRunId(id: string): string | undefined {
  const match = /^real-run-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z)-/.exec(id);
  const value = match?.[1];
  return value ? value.replace(/T(\d{2})-(\d{2})-(\d{2})\./, "T$1:$2:$3.") : undefined;
}
