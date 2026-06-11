import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { cardDataPathFromEnv, DEFAULT_REAL_SUITE_PATH, scriptRootFromEnv } from "../edopro-wasm/realDefaults.js";
import { evalRealSuite, type RealEvalCompetitor, type RealEvalSummary } from "../edopro-wasm/realEval.js";
import type { RealAgentId } from "../edopro-wasm/realAgent.js";

export interface EvalCreateRequest {
  suitePath?: string;
  competitors?: RealEvalCompetitor[];
  agentIds?: RealAgentId[];
  runsPerScenario?: number;
  maxDecisions?: number;
  viewer?: boolean;
}

export interface EvalProgressEvent {
  type: "record";
  completed: number;
  total: number;
  scenarioId: string;
  competitorId: string;
  score: number;
  status: string;
  runDir: string;
}

export interface EvalRunView {
  scenarioId: string;
  competitorId: string;
  score: number;
  status: string;
  runDir: string;
  viewerPath?: string;
}

export interface EvalView {
  id: string;
  status: "queued" | "running" | "finished" | "cancelled" | "error";
  request: Required<Pick<EvalCreateRequest, "suitePath" | "runsPerScenario" | "maxDecisions" | "viewer">> & {
    competitors: RealEvalCompetitor[];
  };
  startedAt: string;
  finishedAt?: string;
  progress: {
    completed: number;
    total: number;
  };
  events: EvalProgressEvent[];
  summary?: RealEvalSummary;
  error?: string;
}

export class EvalManager {
  private readonly evals = new Map<string, EvalView>();
  private readonly cancelled = new Set<string>();
  private readonly onChange: (view: EvalView) => void;
  private readonly runRoot: string;

  constructor(options: { runRoot?: string; onChange?: (view: EvalView) => void } = {}) {
    this.runRoot = options.runRoot ?? process.env.YGO_BENCH_RUN_ROOT ?? "benchmark-runs";
    this.onChange = options.onChange ?? (() => {});
  }

  async loadPersisted(): Promise<void> {
    const entries = await safeReaddir(this.evalStoreDir());
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const view = await readJson<EvalView>(join(this.evalStoreDir(), entry.name));
      if (!view || !view.id) continue;
      if (view.status === "queued" || view.status === "running") {
        view.status = "error";
        view.finishedAt = new Date().toISOString();
        view.error = "Eval was interrupted before the UI server restarted.";
      }
      this.evals.set(view.id, view);
      await this.persist(view);
    }
  }

  list(): EvalView[] {
    return [...this.evals.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  get(id: string): EvalView | null {
    return this.evals.get(id) ?? null;
  }

  runs(id: string): EvalRunView[] | null {
    const view = this.evals.get(id);
    if (!view) return null;
    if (view.summary) return view.summary.records.map(evalRunFromRecord);
    return view.events.map((event) => ({
      scenarioId: event.scenarioId,
      competitorId: event.competitorId,
      score: event.score,
      status: event.status,
      runDir: event.runDir,
    }));
  }

  create(request: EvalCreateRequest): EvalView {
    const competitors = normalizeCompetitors(request);
    const view: EvalView = {
      id: `eval-${new Date().toISOString().replaceAll(":", "-")}`,
      status: "queued",
      request: {
        suitePath: request.suitePath ?? DEFAULT_REAL_SUITE_PATH,
        competitors,
        runsPerScenario: request.runsPerScenario ?? 1,
        maxDecisions: request.maxDecisions ?? 120,
        viewer: request.viewer ?? false,
      },
      startedAt: new Date().toISOString(),
      progress: { completed: 0, total: 0 },
      events: [],
    };
    this.evals.set(view.id, view);
    this.notify(view);
    void this.run(view);
    return view;
  }

  cancel(id: string): EvalView {
    const view = this.evals.get(id);
    if (!view) throw new Error(`Unknown eval: ${id}`);
    if (view.status === "queued" || view.status === "running") {
      this.cancelled.add(id);
      view.status = "cancelled";
      view.finishedAt = new Date().toISOString();
      this.notify(view);
    }
    return view;
  }

  private async run(view: EvalView): Promise<void> {
    if (this.cancelled.has(view.id)) return;
    view.status = "running";
    this.notify(view);
    try {
      const summary = await evalRealSuite({
        agentIds: view.request.competitors.map((competitor) => competitor.agentId),
        competitors: view.request.competitors,
        runsPerAgent: view.request.runsPerScenario,
        cardDataPath: cardDataPathFromEnv(),
        scriptRoot: scriptRootFromEnv(),
        runRoot: this.runRoot,
        maxDecisions: view.request.maxDecisions,
        viewer: view.request.viewer,
        suitePath: view.request.suitePath,
        shouldStop: () => this.cancelled.has(view.id),
        onRecord: (record, progress) => {
          view.progress = progress;
          view.events.push({
            type: "record",
            completed: progress.completed,
            total: progress.total,
            scenarioId: record.score.scenarioId,
            competitorId: record.score.competitorId ?? record.score.agentId,
            score: record.score.objectiveScore,
            status: record.score.status ?? "completed",
            runDir: record.runDir,
          });
          this.notify(view);
        },
      });
      view.summary = summary;
      view.progress = { completed: summary.records.length, total: summary.records.length };
      view.status = this.cancelled.has(view.id) ? "cancelled" : "finished";
      view.finishedAt = new Date().toISOString();
      this.notify(view);
    } catch (error) {
      view.status = "error";
      view.error = error instanceof Error ? error.message : String(error);
      view.finishedAt = new Date().toISOString();
      this.notify(view);
    }
  }

  private notify(view: EvalView): void {
    void this.persist(view);
    this.onChange(view);
  }

  private async persist(view: EvalView): Promise<void> {
    const dir = this.evalStoreDir();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${view.id}.json`), JSON.stringify(view, null, 2) + "\n");
  }

  private evalStoreDir(): string {
    return resolve(this.runRoot, "evals");
  }
}

function normalizeCompetitors(request: EvalCreateRequest): RealEvalCompetitor[] {
  if (request.competitors?.length) return request.competitors;
  const agentIds: RealAgentId[] = request.agentIds?.length ? request.agentIds : ["random", "greedy"];
  return agentIds.map((agentId) => ({ agentId, competitorId: agentId }));
}

function evalRunFromRecord(record: RealEvalSummary["records"][number]): EvalRunView {
  return {
    scenarioId: record.score.scenarioId,
    competitorId: record.score.competitorId ?? record.score.agentId,
    score: record.score.objectiveScore,
    status: record.score.status ?? "completed",
    runDir: record.runDir,
    ...(record.viewerPath ? { viewerPath: record.viewerPath } : {}),
  };
}

async function safeReaddir(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}
