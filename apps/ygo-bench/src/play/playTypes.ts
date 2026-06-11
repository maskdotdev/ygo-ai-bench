import type { ScenarioScore } from "../core/types.js";
import type { RealLegalAction } from "../edopro-wasm/legalActions.js";
import type { RealNormalizedEvent, RealReducedState } from "../edopro-wasm/normalizedEvents.js";
import type { RealAgentId } from "../edopro-wasm/realAgent.js";

export type PlayStatus = "starting" | "waiting_for_human" | "thinking" | "running" | "finished" | "error";
export type PlayOpponentAgent = Extract<RealAgentId, "openai" | "greedy" | "random">;

export interface PublicLegalAction {
  id: string;
  type: string;
  label: string;
  cardCode?: number;
  attack?: number;
}

export interface PlayPrompt {
  type: string;
  player: 0 | 1;
}

export interface PlaySessionView {
  id: string;
  scenarioId: string;
  humanPlayer: 0 | 1;
  opponentAgent: PlayOpponentAgent;
  model?: string;
  status: PlayStatus;
  currentPrompt?: PlayPrompt;
  legalActions: PublicLegalAction[];
  reducedState: RealReducedState;
  timeline: Array<RealNormalizedEvent | Record<string, unknown>>;
  lastOpponentDecision?: {
    actionId: string;
    label: string;
    reason: string;
    tokenCount: number | null;
  };
  score?: ScenarioScore;
  runDir: string;
  error?: string;
}

export interface PlaySessionCreateRequest {
  scenarioPath?: string;
  humanPlayer?: 0 | 1;
  opponentAgent?: PlayOpponentAgent;
  model?: string;
  maxDecisions?: number;
}

export function publicLegalAction(action: RealLegalAction): PublicLegalAction {
  return {
    id: action.id,
    type: action.type,
    label: action.label,
    ...(typeof action.cardCode === "number" ? { cardCode: action.cardCode } : {}),
    ...(typeof action.attack === "number" ? { attack: action.attack } : {}),
  };
}
