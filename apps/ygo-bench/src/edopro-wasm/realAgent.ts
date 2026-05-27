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
  if (observation.player === 1) {
    const action = chooseScriptedOpponentAction(args.legalActions);
    return { action, reason: `scripted opponent selected ${action.label}`, invalidJson: 0, illegalActions: 0, modelErrors: 0, tokenCount: null, observation };
  }
  if (args.agentId === "random") {
    const action = args.legalActions[Math.floor(Math.random() * args.legalActions.length)] ?? args.legalActions[0]!;
    return { action, reason: `random selected ${action.label}`, invalidJson: 0, illegalActions: 0, modelErrors: 0, tokenCount: null, observation };
  }
  if (args.agentId === "greedy" || args.agentId === "oracle") {
    const action = args.agentId === "oracle" ? chooseOracleAction(args) : chooseGreedyAction(args.legalActions);
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
    recentEvents: args.recentEvents.slice(-12).map((event) => renderRecentEventForPlayer(event, player)),
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

function chooseOracleAction(args: {
  scenario: RealScenario;
  state: RealReducedState;
  prompt: OcgMessage | undefined;
  legalActions: RealLegalAction[];
}): RealLegalAction {
  const { scenario, legalActions: actions } = args;
  const player = args.prompt?.player === 1 ? 1 : 0;
  const hasMonster = args.state.players[player].monsters.length > 0;
  const forcedFollowUp = actions.find((action) =>
    ["select_place", "select_card", "select_position", "select_option", "yes"].includes(action.type),
  );
  if (forcedFollowUp) return forcedFollowUp;

  if (scenario.scoring?.preferredActionTypes?.includes("set_spell_trap")) {
    const trapSet = actions.find((action) => action.type === "set_spell_trap");
    if (trapSet) return trapSet;
  }

  const response = actions.find((action) => action.type === "respond");
  if (response) return response;

  const attack = highestAttackAction(actions.filter((action) => action.type === "attack"));
  if (attack) return attack;

  const summon = highestAttackAction(actions.filter((action) => action.type === "normal_summon"));
  if (!hasMonster && summon) return summon;

  const battle = actions.find((action) => action.type === "to_battle");
  if (battle) return battle;

  if (summon) return summon;

  const preferred = actions.find((action) => scenario.scoring?.preferredActionTypes?.includes(action.type));
  if (preferred) return preferred;

  return chooseGreedyAction(actions);
}

function chooseScriptedOpponentAction(actions: RealLegalAction[]): RealLegalAction {
  const forcedFollowUp = actions.find((action) =>
    ["select_place", "select_card", "select_position", "select_option", "yes"].includes(action.type),
  );
  if (forcedFollowUp) return forcedFollowUp;

  return (
    actions.find((action) => action.type === "decline_chain") ??
    actions.find((action) => action.type === "end_phase") ??
    actions.find((action) => action.type === "to_main2") ??
    actions.find((action) => action.type === "to_battle") ??
    lowestAttackAction(actions.filter((action) => action.type === "normal_summon")) ??
    actions[0]!
  );
}

function highestAttackAction(actions: RealLegalAction[]): RealLegalAction | undefined {
  if (actions.length === 0) return undefined;
  return actions.reduce((best, action) => ((action.attack ?? -1) > (best.attack ?? -1) ? action : best), actions[0]!);
}

function lowestAttackAction(actions: RealLegalAction[]): RealLegalAction | undefined {
  if (actions.length === 0) return undefined;
  return actions.reduce((best, action) => ((action.attack ?? Number.POSITIVE_INFINITY) < (best.attack ?? Number.POSITIVE_INFINITY) ? action : best), actions[0]!);
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

function renderRecentEventForPlayer(event: RealNormalizedEvent, player: 0 | 1): string {
  if (event.event !== "CARD_MOVED" || !event.card || !isRecord(event.payload)) return event.text;

  const from = eventLocation(event.payload.from);
  const to = eventLocation(event.payload.to);
  const hidden =
    isHiddenLocationForPlayer(from, player) ||
    isHiddenLocationForPlayer(to, player) ||
    (to?.controller !== player && isFaceDown(to?.position));
  if (!hidden) return event.text;

  return event.text.replaceAll(event.card.name, "a hidden card");
}

function isHiddenLocationForPlayer(location: EventLocation | null, player: 0 | 1): boolean {
  if (!location || location.controller === player) return false;
  return location.location === 1 || location.location === 2 || location.location === 64;
}

interface EventLocation {
  controller: 0 | 1;
  location: number;
  position?: number | undefined;
}

function eventLocation(value: unknown): EventLocation | null {
  if (!isRecord(value) || typeof value.location !== "number") return null;
  const controller = value.controller === 1 ? 1 : value.controller === 0 ? 0 : null;
  if (controller === null) return null;
  return {
    controller,
    location: value.location,
    position: typeof value.position === "number" ? value.position : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isJsonFailure(error: unknown): boolean {
  return error instanceof SyntaxError || (error instanceof Error && error.message.includes("Model response must include"));
}
