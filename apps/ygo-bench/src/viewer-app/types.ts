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
  scenarioId: string;
  agentId: string;
  family: string;
  won: boolean;
  turnsTaken: number;
  decisionsTaken: number;
  illegalActions: number;
  invalidJson: number;
  modelErrors: number;
  repeatedActions: number;
  finalLpDelta: number;
  objectiveScore: number;
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
    agentId: string;
    runs: number;
    winRate: number;
    averageScore: number;
    weightedObjectiveScore?: number;
    averageDecisions: number;
    averageLpDelta: number;
    modelErrorRate: number;
    averageLatencyMs: number;
    averageTokenCount: number | null;
  }>;
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
  chosen?: { actionId: string; reason: string; tokenCount?: number | null };
  lineQuality?: number | null;
  error?: string;
  player?: 0 | 1;
}

export interface ReplayFrame {
  index: number;
  frame: TraceFrame;
  state: RealReducedState | null;
}
