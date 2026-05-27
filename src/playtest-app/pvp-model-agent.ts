import { applyPvpAgentAction, observePvpAgent } from "./pvp-agent-api.js";
import { buildAgentHistoryEntry, compactHistoryForModel, type PvpAgentHistoryEntry, type PvpModelHistoryView } from "./pvp-agent-history.js";
import type {
  PvpAgentActionParamSchema,
  PvpAgentActionParams,
  PvpAgentActionType,
  PvpAgentCardRef,
  PvpAgentLegalAction,
  PvpAgentObservation,
  PvpAgentPlacementRequirement,
} from "./pvp-agent-api.js";
import type { DuelSession, PlayerId } from "#duel/types.js";

export interface PvpAgentMemory {
  plan?: string;
  knownOpponentCards: string[];
  suspectedOpponentCards: string[];
  usedResources: string[];
  threats: string[];
  goals: string[];
}

export interface PvpModelTurnInput {
  seat: PlayerId;
  observation: PvpAgentObservation;
  history: PvpModelHistoryView;
  memory: PvpAgentMemory;
  legalActions: PvpModelLegalActionView[];
}

export interface PvpModelLegalActionView {
  id: string;
  type: PvpAgentActionType;
  label: string;
  source?: PvpAgentCardRef;
  placement?: PvpAgentPlacementRequirement;
  params: PvpAgentActionParamSchema;
}

export interface PvpModelDecision {
  actionId: string;
  params?: PvpAgentActionParams;
  memory: PvpAgentMemory;
  reason: string;
}

export interface PvpModelClient {
  chooseAction(input: PvpModelTurnInput): Promise<PvpModelDecision>;
}

export interface PvpModelRunError {
  step: number;
  player: PlayerId;
  error: string;
}

export interface PvpModelRunResult {
  ok: boolean;
  history: PvpAgentHistoryEntry[];
  memories: Record<PlayerId, PvpAgentMemory>;
  finalObservation: PvpAgentObservation;
  errors: PvpModelRunError[];
}

export interface PvpModelMatchInput {
  session: DuelSession;
  agents: Record<PlayerId, PvpModelClient>;
  maxSteps?: number;
  recentHistoryLimit?: number;
}

const maxMemoryTextLength = 800;
const maxMemoryItems = 24;

export function emptyAgentMemory(): PvpAgentMemory {
  return {
    knownOpponentCards: [],
    suspectedOpponentCards: [],
    usedResources: [],
    threats: [],
    goals: [],
  };
}

export function legalActionsForModel(observation: PvpAgentObservation): PvpModelLegalActionView[] {
  return observation.legalActions.map((action) => ({
    id: action.id,
    type: action.type,
    label: action.label,
    ...(action.source === undefined ? {} : { source: { ...action.source } }),
    ...(action.placement === undefined ? {} : { placement: { ...action.placement, allowedSequences: [...action.placement.allowedSequences] } }),
    params: { ...action.params },
  }));
}

export function validateModelDecision(observation: PvpAgentObservation, decision: PvpModelDecision): { ok: true; memory: PvpAgentMemory } | { ok: false; error: string } {
  if (!decision || typeof decision.actionId !== "string" || !decision.actionId) return { ok: false, error: "Model decision requires actionId" };
  const action = observation.legalActions.find((candidate) => candidate.id === decision.actionId);
  if (!action) return { ok: false, error: `Model selected non-legal actionId ${decision.actionId}` };
  const params = decision.params ?? {};
  if (action.placement?.required) {
    if (action.placement.kind === "monsterZone") {
      if (params.summonSequence === undefined) return { ok: false, error: `${action.type} requires summonSequence` };
      if (!action.placement.allowedSequences.includes(params.summonSequence)) return { ok: false, error: `summonSequence ${params.summonSequence} is not legal` };
    }
    if (action.placement.kind === "spellTrapZone") {
      if (params.spellTrapSequence === undefined) return { ok: false, error: `${action.type} requires spellTrapSequence` };
      if (!action.placement.allowedSequences.includes(params.spellTrapSequence)) return { ok: false, error: `spellTrapSequence ${params.spellTrapSequence} is not legal` };
    }
  }
  if (params.summonUids !== undefined && action.type !== "pendulumSummon") return { ok: false, error: `${action.type} does not accept summonUids` };
  const memory = sanitizeAgentMemory(decision.memory);
  return { ok: true, memory };
}

export async function runPvpModelMatch(input: PvpModelMatchInput): Promise<PvpModelRunResult> {
  const maxSteps = input.maxSteps ?? 120;
  const recentHistoryLimit = input.recentHistoryLimit ?? 16;
  const history: PvpAgentHistoryEntry[] = [];
  const memories: Record<PlayerId, PvpAgentMemory> = { 0: emptyAgentMemory(), 1: emptyAgentMemory() };
  const errors: PvpModelRunError[] = [];
  let player: PlayerId = input.session.state.waitingFor ?? input.session.state.turnPlayer;

  for (let step = 0; step < maxSteps; step += 1) {
    const before = observePvpAgent(input.session, player);
    if (before.status === "ended") return { ok: true, history, memories, finalObservation: before, errors };
    const client = input.agents[player];
    const modelInput: PvpModelTurnInput = {
      seat: player,
      observation: before,
      history: compactHistoryForModel({ history, player, currentTurn: before.turn, recentLimit: recentHistoryLimit }),
      memory: memories[player],
      legalActions: legalActionsForModel(before),
    };
    const decision = await client.chooseAction(modelInput);
    const validation = validateModelDecision(before, decision);
    if (!validation.ok) {
      const error = { step, player, error: validation.error };
      errors.push(error);
      return { ok: false, history, memories, finalObservation: before, errors };
    }

    const action = before.legalActions.find((candidate) => candidate.id === decision.actionId);
    const result = applyPvpAgentAction(input.session, player, decision.actionId, decision.params);
    const after = result.observation;
    history.push(buildAgentHistoryEntry({ step, before, after, action, decision, result }));
    if (!result.ok) {
      errors.push({ step, player, error: result.error ?? "Engine rejected model decision" });
      return { ok: false, history, memories, finalObservation: after, errors };
    }
    memories[player] = validation.memory;
    player = after.waitingFor ?? after.turnPlayer;
  }

  const finalObservation = observePvpAgent(input.session, player);
  errors.push({ step: maxSteps, player, error: `Model match exceeded ${maxSteps} steps` });
  return { ok: false, history, memories, finalObservation, errors };
}

export const placementAwareModelClient: PvpModelClient = {
  async chooseAction(input) {
    const action = input.legalActions.find((candidate) => candidate.type !== "changePhase" && candidate.type !== "endTurn") ?? input.legalActions[0];
    if (!action) return { actionId: "", memory: input.memory, reason: "No legal actions available." };
    const params = defaultParams(action);
    return { actionId: action.id, ...(params === undefined ? {} : { params }), memory: input.memory, reason: "Choose the first legal action with required placement." };
  },
};

export const passWhenPossibleModelClient: PvpModelClient = {
  async chooseAction(input) {
    const action = input.legalActions.find((candidate) => candidate.type === "passChain" || candidate.type === "passAttack" || candidate.type === "passDamage") ?? input.legalActions[0];
    if (!action) return { actionId: "", memory: input.memory, reason: "No legal actions available." };
    const params = defaultParams(action);
    return { actionId: action.id, ...(params === undefined ? {} : { params }), memory: input.memory, reason: "Pass if possible, otherwise choose the first action." };
  },
};

export function memoryUpdatingModelClient(update: Partial<PvpAgentMemory>): PvpModelClient {
  return {
    async chooseAction(input) {
      const action = input.legalActions[0];
      if (!action) return { actionId: "", memory: sanitizeAgentMemory({ ...input.memory, ...update }), reason: "No legal actions available." };
      const params = defaultParams(action);
      return {
        actionId: action.id,
        ...(params === undefined ? {} : { params }),
        memory: sanitizeAgentMemory({ ...input.memory, ...update }),
        reason: "Choose first legal action and update memory.",
      };
    },
  };
}

function defaultParams(action: PvpModelLegalActionView): PvpAgentActionParams | undefined {
  if (!action.placement?.required) return undefined;
  const first = action.placement.allowedSequences[0];
  if (first === undefined) return undefined;
  if (action.placement.kind === "monsterZone") return { summonSequence: first };
  if (action.placement.kind === "spellTrapZone") return { spellTrapSequence: first };
  return undefined;
}

function sanitizeAgentMemory(memory: PvpAgentMemory | undefined): PvpAgentMemory {
  const plan = trimText(memory?.plan);
  return {
    ...(plan === undefined ? {} : { plan }),
    knownOpponentCards: trimList(memory?.knownOpponentCards),
    suspectedOpponentCards: trimList(memory?.suspectedOpponentCards),
    usedResources: trimList(memory?.usedResources),
    threats: trimList(memory?.threats),
    goals: trimList(memory?.goals),
  };
}

function trimList(values: readonly string[] | undefined): string[] {
  return (values ?? []).filter((value) => typeof value === "string").slice(0, maxMemoryItems).flatMap((value) => {
    const trimmed = trimText(value);
    return trimmed === undefined ? [] : [trimmed];
  });
}

function trimText(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, maxMemoryTextLength);
  return trimmed ? trimmed : undefined;
}
