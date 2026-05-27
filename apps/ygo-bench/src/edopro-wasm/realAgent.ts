import { chooseOpenAiLegalAction } from "../agents/openaiAgent.js";
import type { RealLegalAction } from "./legalActions.js";
import type { RealNormalizedEvent, RealReducedState } from "./normalizedEvents.js";
import type { OcgMessage, OcgRuntime } from "./ocgTypes.js";
import type { RealScenario } from "./realScenario.js";

export type RealAgentId = "random" | "greedy" | "oracle" | "openai";

export interface RealAgentChoice {
  action: RealLegalAction;
  reason: string;
  invalidJson: number;
  illegalActions: number;
  modelErrors: number;
  tokenCount: number | null;
  observation: RealModelObservation;
  rawError?: string | undefined;
}

export interface RealModelObservation {
  scenarioId: string;
  player: 0 | 1;
  turn: number;
  phase: string;
  prompt: {
    type: string;
    player: 0 | 1;
  };
  you: RealPlayerObservation;
  opponent: RealPlayerObservation;
  legalActions: Array<{
    id: string;
    type: string;
    label: string;
    attack?: number;
  }>;
  recentEvents: string[];
}

interface RealPlayerObservation {
  lp: number;
  handCount: number;
  deckCount: number;
  monsters: Array<{ name: string; code?: number; sequence: number; revealed: boolean }>;
  spellsTraps: Array<{ name: string; code?: number; sequence: number; revealed: boolean }>;
  graveyard: Array<{ name: string; code: number }>;
  banished: Array<{ name: string; code: number }>;
}

export async function chooseRealAgentAction(args: {
  agentId: RealAgentId;
  scenario: RealScenario;
  state: RealReducedState;
  prompt: OcgMessage | undefined;
  promptTypeName: string;
  legalActions: RealLegalAction[];
  recentEvents: RealNormalizedEvent[];
  model?: string;
}): Promise<RealAgentChoice> {
  const observation = buildRealModelObservation(args);
  if (args.agentId === "random") {
    const action = args.legalActions[Math.floor(Math.random() * args.legalActions.length)] ?? args.legalActions[0]!;
    return { action, reason: `random selected ${action.label}`, invalidJson: 0, illegalActions: 0, modelErrors: 0, tokenCount: null, observation };
  }
  if (args.agentId === "greedy" || args.agentId === "oracle") {
    const action = chooseGreedyAction(args.legalActions);
    return { action, reason: `${args.agentId} selected ${action.label}`, invalidJson: 0, illegalActions: 0, modelErrors: 0, tokenCount: null, observation };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for --agent openai");
  try {
    const decision = await chooseOpenAiLegalAction({
      apiKey,
      model: args.model ?? process.env.YGO_BENCH_OPENAI_MODEL ?? "gpt-4o-mini",
      observationText: renderRealObservationJson(observation),
      legalActionIds: args.legalActions.map((action) => action.id),
    });
    const action = args.legalActions.find((candidate) => candidate.id === decision.actionId);
    if (!action) {
      const fallback = args.legalActions[0]!;
      return {
        action: fallback,
        reason: `openai returned illegal action ${decision.actionId}; fell back to ${fallback.id}`,
        invalidJson: 0,
        illegalActions: 1,
        modelErrors: 0,
        tokenCount: decision.tokenCount,
        observation,
      };
    }
    return { action, reason: decision.reason, invalidJson: 0, illegalActions: 0, modelErrors: 0, tokenCount: decision.tokenCount, observation };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallback = args.legalActions[0]!;
    return {
      action: fallback,
      reason: `openai failed (${message}); fell back to ${fallback.id}`,
      invalidJson: isJsonFailure(error) ? 1 : 0,
      illegalActions: message.includes("illegal action id") ? 1 : 0,
      modelErrors: 1,
      tokenCount: null,
      observation,
      rawError: message,
    };
  }
}

export function buildRealModelObservation(args: {
  scenario: RealScenario;
  state: RealReducedState;
  prompt: OcgMessage | undefined;
  promptTypeName: string;
  legalActions: RealLegalAction[];
  recentEvents: RealNormalizedEvent[];
}): RealModelObservation {
  const player = args.prompt?.player === 1 ? 1 : 0;
  const opponent = player === 0 ? 1 : 0;
  return {
    scenarioId: args.scenario.id,
    player,
    turn: args.state.turn,
    phase: args.state.phase,
    prompt: {
      type: args.promptTypeName,
      player,
    },
    you: playerObservation(args.state, player, true),
    opponent: playerObservation(args.state, opponent, false),
    legalActions: args.legalActions.map((action) => ({
      id: action.id,
      type: action.type,
      label: action.label,
      ...(typeof action.attack === "number" ? { attack: action.attack } : {}),
    })),
    recentEvents: args.recentEvents.slice(-12).map((event) => event.text),
  };
}

export function renderRealObservationJson(observation: RealModelObservation): string {
  return JSON.stringify(observation, null, 2);
}

function chooseGreedyAction(actions: RealLegalAction[]): RealLegalAction {
  return (
    actions.find((action) => action.type === "select_card") ??
    actions.find((action) => action.type === "attack") ??
    actions.find((action) => action.type === "normal_summon") ??
    actions.find((action) => action.type === "to_battle") ??
    actions.find((action) => action.type === "end_phase") ??
    actions[0]!
  );
}

function playerObservation(state: RealReducedState, player: 0 | 1, isSelf: boolean): RealPlayerObservation {
  const view = state.players[player];
  return {
    lp: view.lp,
    handCount: view.handCount,
    deckCount: view.deckCount,
    monsters: view.monsters.map((card) => publicCardView(card, isSelf)),
    spellsTraps: view.spellsTraps.map((card) => publicCardView(card, isSelf)),
    graveyard: view.graveyard.map((card) => ({ name: card.name, code: card.code })),
    banished: view.banished.map((card) => ({ name: card.name, code: card.code })),
  };
}

function publicCardView(
  card: { name: string; code: number; sequence: number; position?: number | undefined },
  isSelf: boolean,
): { name: string; code?: number; sequence: number; revealed: boolean } {
  const revealed = isSelf || !isFaceDown(card.position);
  return {
    name: revealed ? card.name : "Set card",
    ...(revealed ? { code: card.code } : {}),
    sequence: card.sequence,
    revealed,
  };
}

function isFaceDown(position: number | undefined): boolean {
  return typeof position === "number" && (position & 0x8) !== 0;
}

function isJsonFailure(error: unknown): boolean {
  return error instanceof SyntaxError || (error instanceof Error && error.message.includes("Model response must include"));
}
