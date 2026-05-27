import { chooseOpenAiLegalAction } from "../agents/openaiAgent.js";
import type { RealLegalAction } from "./legalActions.js";
import type { RealNormalizedEvent, RealReducedState } from "./normalizedEvents.js";
import type { OcgMessage, OcgRuntime } from "./ocgTypes.js";
import type { RealScenario } from "./realScenario.js";

export type RealAgentId = "random" | "greedy" | "openai";

export interface RealAgentChoice {
  action: RealLegalAction;
  reason: string;
  invalidJson: number;
  illegalActions: number;
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
  }>;
  recentEvents: string[];
}

interface RealPlayerObservation {
  lp: number;
  handCount: number;
  deckCount: number;
  monsters: Array<{ name: string; code: number; sequence: number }>;
  spellsTraps: Array<{ name: string; code: number; sequence: number }>;
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
}): Promise<RealAgentChoice> {
  const observation = buildRealModelObservation(args);
  if (args.agentId === "random") {
    const action = args.legalActions[Math.floor(Math.random() * args.legalActions.length)] ?? args.legalActions[0]!;
    return { action, reason: `random selected ${action.label}`, invalidJson: 0, illegalActions: 0, observation };
  }
  if (args.agentId === "greedy") {
    const action = chooseGreedyAction(args.legalActions);
    return { action, reason: `greedy selected ${action.label}`, invalidJson: 0, illegalActions: 0, observation };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for --agent openai");
  try {
    const decision = await chooseOpenAiLegalAction({
      apiKey,
      model: process.env.YGO_BENCH_OPENAI_MODEL ?? "gpt-4o-mini",
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
        observation,
      };
    }
    return { action, reason: decision.reason, invalidJson: 0, illegalActions: 0, observation };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const fallback = args.legalActions[0]!;
    return {
      action: fallback,
      reason: `openai failed (${message}); fell back to ${fallback.id}`,
      invalidJson: isJsonFailure(error) ? 1 : 0,
      illegalActions: message.includes("illegal action id") ? 1 : 0,
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
    you: playerObservation(args.state, player),
    opponent: playerObservation(args.state, opponent),
    legalActions: args.legalActions.map((action) => ({
      id: action.id,
      type: action.type,
      label: action.label,
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

function playerObservation(state: RealReducedState, player: 0 | 1): RealPlayerObservation {
  const view = state.players[player];
  return {
    lp: view.lp,
    handCount: view.handCount,
    deckCount: view.deckCount,
    monsters: view.monsters.map((card) => ({ name: card.name, code: card.code, sequence: card.sequence })),
    spellsTraps: view.spellsTraps.map((card) => ({ name: card.name, code: card.code, sequence: card.sequence })),
    graveyard: view.graveyard.map((card) => ({ name: card.name, code: card.code })),
    banished: view.banished.map((card) => ({ name: card.name, code: card.code })),
  };
}

function isJsonFailure(error: unknown): boolean {
  return error instanceof SyntaxError || (error instanceof Error && error.message.includes("Model response must include"));
}
