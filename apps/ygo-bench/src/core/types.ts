export type PlayerId = 0 | 1;

export type PhaseName = "DRAW" | "STANDBY" | "MAIN1" | "BATTLE" | "MAIN2" | "END";

export type LegalActionType =
  | "normal_summon"
  | "activate_effect"
  | "attack"
  | "pass"
  | "respond"
  | "select_card";

export type ScenarioFamily =
  | "lethal"
  | "interruption"
  | "resource"
  | "smoke"
  | "setup-payoff"
  | "resource-grind"
  | "bait-interruption"
  | "delayed-lethal"
  | "recovery"
  | "defensive-planning";

export interface CardRef {
  id: string;
  code: number;
  name: string;
  atk?: number;
  position?: "attack" | "defense" | "set";
  revealed?: boolean;
}

export interface PublicPlayerState {
  lp: number;
  handCount: number;
  revealedHand: CardRef[];
  monsters: CardRef[];
  spellsTraps: CardRef[];
  graveyard: CardRef[];
  banished: CardRef[];
  deckCount: number;
  extraDeckCount: number;
}

export interface PrivatePlayerState {
  hand: CardRef[];
}

export interface PublicDuelState {
  players: [PublicPlayerState, PublicPlayerState];
}

export interface Prompt {
  type: "idle_command" | "chain_response" | "battle_command" | "select_card" | "game_over";
  player: PlayerId;
  message: string;
}

export interface ModelLegalAction {
  id: string;
  type: LegalActionType;
  label: string;
  card?: Pick<CardRef, "id" | "name"> & { zone: string };
}

export interface LegalAction {
  id: string;
  label: string;
  model: ModelLegalAction;
  engineResponse: Uint8Array;
  tags?: string[];
}

export interface TurnEvent {
  frame: number;
  turn: number;
  phase: PhaseName;
  event: string;
  player?: PlayerId;
  text: string;
}

export interface Observation {
  scenarioId: string;
  player: PlayerId;
  turn: number;
  phase: PhaseName;
  prompt: Prompt;
  publicState: PublicDuelState;
  privateState: PrivatePlayerState;
  legalActions: ModelLegalAction[];
  transcript: TurnEvent[];
}

export interface EngineFrame extends TurnEvent {
  type: "engine";
  payload?: unknown;
}

export interface DecisionFrame {
  frame: number;
  type: "decision";
  player: PlayerId;
  observation: Observation;
  legalActions: ModelLegalAction[];
  chosen: AgentDecision;
}

export type TraceFrame = EngineFrame | DecisionFrame;

export interface StepResult {
  observation: Observation;
  reward: number;
  done: boolean;
  info: {
    winner?: PlayerId | null;
    reason?: string;
    chosenAction?: LegalAction;
    engineFrames: EngineFrame[];
  };
}

export interface ScenarioPlayer {
  lp: number;
  deck: CardRef[];
  hand: CardRef[];
  monsters?: CardRef[];
  spellsTraps?: CardRef[];
  graveyard?: CardRef[];
  banished?: CardRef[];
}

export interface ScenarioStep {
  prompt: Prompt;
  actions: Array<Omit<LegalAction, "engineResponse"> & { engineResponse?: number[] }>;
  eventsByAction: Record<string, Array<Omit<EngineFrame, "frame" | "turn" | "phase" | "type">>>;
  rewards?: Record<string, number>;
  winnerByAction?: Record<string, PlayerId | null>;
  doneByAction?: Record<string, boolean>;
}

export interface Scenario {
  id: string;
  name: string;
  family: ScenarioFamily;
  version: string;
  seed: string | number[];
  maxDecisions: number;
  hiddenInfoAssertions?: string[];
  players: [ScenarioPlayer, ScenarioPlayer];
  steps: ScenarioStep[];
  oracle: string[];
}

export interface AgentDecision {
  actionId: string;
  reason: string;
  plan?: StrategyPlan;
}

export interface Agent {
  id: string;
  chooseAction(observation: Observation): Promise<AgentDecision>;
}

export type BenchmarkMode = "mock-eval" | "long-horizon-eval" | "human-vs-agent";

export type RunStatus = "completed" | "failed" | "unsupported-prompt" | "model-error" | "timeout";

export interface StrategyPlan {
  horizon: string;
  currentGoal: string;
  futureLine: string[];
  resourcesToPreserve: string[];
  risks: string[];
  contingency: string;
}

export interface ScoreComponents {
  winScore: number;
  strategicProgressScore: number;
  resourceScore: number;
  adaptationScore: number;
  planConsistencyScore: number;
  riskManagementScore: number;
  executionPenalty: number;
  overallScore: number;
}

export interface PromptCoverage {
  seen: Record<string, number>;
  handled: Record<string, number>;
  unsupported: Record<string, number>;
  autoResponses: Record<string, number>;
  fallbackActions: number;
}

export interface ScenarioScore {
  mode?: BenchmarkMode;
  suiteId?: string;
  scenarioId: string;
  agentId: string;
  model?: string;
  competitorId?: string;
  runIndex?: number;
  seed?: string;
  status?: RunStatus;
  family: ScenarioFamily;
  won: boolean;
  winner?: PlayerId | null;
  turnsTaken: number;
  decisionsTaken: number;
  illegalActions: number;
  invalidJson: number;
  modelErrors: number;
  repeatedActions: number;
  finalLpDelta: number;
  objectiveScore: number;
  components?: ScoreComponents;
  scoreWeights?: Record<string, number>;
  scoreRationale?: string;
  promptCoverage?: PromptCoverage;
  latencyMs: number;
  tokenCount: number | null;
  notes: string[];
}

export function competitorIdFor(agentId: string, model?: string): string {
  return model ? `${agentId}:${model}` : agentId;
}

export function defaultStrategyPlan(reason = ""): StrategyPlan {
  return {
    horizon: "current decision",
    currentGoal: reason || "Choose a legal action.",
    futureLine: [],
    resourcesToPreserve: [],
    risks: [],
    contingency: "",
  };
}
