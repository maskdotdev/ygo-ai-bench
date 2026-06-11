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

export interface ScenarioScore {
  mode?: "mock-eval" | "long-horizon-eval" | "human-vs-agent";
  suiteId?: string;
  scenarioId: string;
  agentId: string;
  model?: string;
  competitorId?: string;
  runIndex?: number;
  seed?: string;
  status?: "completed" | "failed" | "unsupported-prompt" | "model-error" | "timeout";
  family: string;
  won: boolean;
  winner?: 0 | 1 | null;
  turnsTaken: number;
  decisionsTaken: number;
  illegalActions: number;
  invalidJson: number;
  modelErrors: number;
  repeatedActions: number;
  finalLpDelta: number;
  objectiveScore: number;
  components?: {
    winScore: number;
    strategicProgressScore: number;
    resourceScore: number;
    adaptationScore: number;
    planConsistencyScore: number;
    riskManagementScore: number;
    executionPenalty: number;
    overallScore: number;
  };
  scoreWeights?: Record<string, number>;
  scoreRationale?: string;
  promptCoverage?: {
    seen: Record<string, number>;
    handled: Record<string, number>;
    unsupported: Record<string, number>;
    autoResponses: Record<string, number>;
    fallbackActions: number;
  };
  latencyMs: number;
  tokenCount: number | null;
  notes: string[];
}

export interface RunDetails {
  run: RunIndexItem;
  score: ScenarioScore;
  metadata: unknown;
  reducedState: RealReducedState | null;
  artifacts: {
    trace: string;
    score: string;
    metadata?: string;
    transcript?: string;
    viewer?: string;
  };
}

export interface SuiteSummary {
  suiteId: string;
  generatedAt: string;
  records: Array<{
    score: ScenarioScore;
    runDir: string;
    viewerPath?: string;
  }>;
  scores: ScenarioScore[];
  aggregate: Array<{
    competitorId?: string;
    agentId: string;
    model?: string;
    runs: number;
    completedRuns?: number;
    failedRuns?: number;
    winRate: number;
    averageScore: number;
    weightedObjectiveScore?: number;
    averageStrategicProgressScore?: number;
    averageResourceScore?: number;
    averageAdaptationScore?: number;
    averagePlanConsistencyScore?: number;
    averageRiskManagementScore?: number;
    averageExecutionPenalty?: number;
    averageDecisions: number;
    averageLpDelta: number;
    modelErrorRate: number;
    averageLatencyMs: number;
    averageTokenCount: number | null;
  }>;
}

export interface EvalCompetitor {
  agentId: "random" | "greedy" | "oracle" | "openai";
  model?: string;
  competitorId?: string;
}

export interface EvalView {
  id: string;
  status: "queued" | "running" | "finished" | "cancelled" | "error";
  request: {
    suitePath: string;
    competitors: EvalCompetitor[];
    runsPerScenario: number;
    maxDecisions: number;
    viewer: boolean;
  };
  startedAt: string;
  finishedAt?: string;
  progress: {
    completed: number;
    total: number;
  };
  events: Array<{
    type: "record";
    completed: number;
    total: number;
    scenarioId: string;
    competitorId: string;
    score: number;
    status: string;
    runDir: string;
  }>;
  summary?: SuiteSummary;
  error?: string;
}

export interface RealCardView {
  code: number;
  name: string;
  controller: 0 | 1;
  location: string;
  sequence: number;
  position?: number;
}

export interface RealReducedPlayer {
  lp: number;
  handCount: number;
  hand?: RealCardView[];
  monsters: RealCardView[];
  spellsTraps: RealCardView[];
  graveyard: RealCardView[];
  banished: RealCardView[];
  deckCount: number;
  extraDeckCount: number;
}

export interface RealReducedState {
  turn: number;
  phase: string;
  winner: 0 | 1 | null;
  players: [RealReducedPlayer, RealReducedPlayer];
}

export interface TraceFrame {
  type: string;
  frame?: number;
  turn?: number;
  phase?: string;
  event?: string;
  text?: string;
  typeName?: string;
  reducedState?: RealReducedState;
  observation?: Record<string, unknown>;
  legalActions?: Array<{ id: string; type: string; label: string; attack?: number }>;
  chosen?: {
    actionId: string;
    reason: string;
    tokenCount?: number | null;
    plan?: {
      horizon: string;
      currentGoal: string;
      futureLine: string[];
      resourcesToPreserve: string[];
      risks: string[];
      contingency: string;
    };
  };
  lineQuality?: number | null;
  error?: string;
  player?: 0 | 1;
}

export interface ReplayFrame {
  index: number;
  frame: TraceFrame;
  state: RealReducedState | null;
}

export interface PlaySessionView {
  id: string;
  scenarioId: string;
  humanPlayer: 0 | 1;
  opponentAgent: "openai" | "greedy" | "random";
  model?: string;
  status: "starting" | "waiting_for_human" | "thinking" | "running" | "finished" | "error";
  currentPrompt?: { type: string; player: 0 | 1 };
  legalActions: Array<{ id: string; type: string; label: string; cardCode?: number; attack?: number }>;
  reducedState: RealReducedState;
  timeline: TraceFrame[];
  lastOpponentDecision?: { actionId: string; label: string; reason: string; tokenCount: number | null };
  score?: ScenarioScore;
  runDir: string;
  error?: string;
}
