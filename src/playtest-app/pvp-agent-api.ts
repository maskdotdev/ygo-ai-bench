import { applyPvpAction } from "./pvp-apply-action.js";
import { copyDuelAction } from "#duel/action-copy.js";
import { getGroupedDuelLegalActions, getLegalActions, queryPublicState } from "#duel/core.js";
import { duelActionUiGroupLabel } from "./duel-action-anchors.js";
import { duelPromptView } from "./duel-prompt-view.js";
import { duelTriggerOrderView } from "./duel-trigger-order-view.js";
import type {
  ApplyDuelResponseResult,
  CardPosition,
  DuelAction,
  DuelActionWindowKind,
  DuelCardKind,
  DuelLocation,
  DuelPhase,
  DuelSession,
  DuelStatus,
  PlayerId,
  PublicDuelCard,
  PublicDuelState,
} from "#duel/types.js";

export type PvpAgentActionType = DuelAction["type"];

export interface PvpAgentObservation {
  duelId: string;
  player: PlayerId;
  status: DuelStatus;
  turn: number;
  turnPlayer: PlayerId;
  phase: DuelPhase;
  waitingFor?: PlayerId;
  windowKind?: DuelActionWindowKind;
  lifePoints: Record<PlayerId, number>;
  zones: PvpAgentZoneState;
  chain: PvpAgentChainLink[];
  prompt?: PvpAgentPrompt;
  triggerOrder?: PvpAgentTriggerOrder;
  legalActions: PvpAgentLegalAction[];
  actionGroups: PvpAgentActionGroup[];
  logTail: PublicDuelState["log"];
}

export interface PvpAgentZoneState {
  self: PvpAgentPlayerZones;
  opponent: PvpAgentPlayerZones;
}

export interface PvpAgentPlayerZones {
  player: PlayerId;
  hand: PvpAgentCardView[];
  monsterZone: (PvpAgentCardView | null)[];
  spellTrapZone: (PvpAgentCardView | null)[];
  fieldZone: PvpAgentCardView | null;
  graveyard: PvpAgentCardView[];
  banished: PvpAgentCardView[];
  extraDeck: PvpAgentPileView;
  deck: PvpAgentPileView;
}

export interface PvpAgentPileView {
  count: number;
  cards?: PvpAgentCardView[];
}

export interface PvpAgentCardView {
  uid: string;
  code?: string;
  name?: string;
  kind?: DuelCardKind;
  typeFlags?: number;
  owner: PlayerId;
  controller: PlayerId;
  location: DuelLocation;
  sequence: number;
  position: CardPosition;
  faceUp: boolean;
  overlayCount: number;
  counters?: Record<number, number>;
  revealed: boolean;
}

export interface PvpAgentCardRef {
  uid: string;
  code?: string;
  name?: string;
  location?: DuelLocation;
  sequence?: number;
}

export interface PvpAgentLegalAction {
  id: string;
  type: PvpAgentActionType;
  player: PlayerId;
  label: string;
  source?: PvpAgentCardRef;
  anchors: PvpAgentCardRef[];
  placement?: PvpAgentPlacementRequirement;
  params: PvpAgentActionParamSchema;
  windowId?: number;
  windowKind?: DuelActionWindowKind;
  windowToken?: string;
  raw: DuelAction;
}

export interface PvpAgentPlacementRequirement {
  kind: "monsterZone" | "spellTrapZone" | "fieldZone";
  player: PlayerId;
  allowedSequences: number[];
  required: boolean;
}

export interface PvpAgentActionParamSchema {
  requiresSummonSequence?: boolean;
  requiresSpellTrapSequence?: boolean;
  acceptsSummonUids?: boolean;
}

export interface PvpAgentActionParams {
  summonSequence?: number;
  spellTrapSequence?: number;
  summonUids?: string[];
}

export interface PvpAgentActionGroup {
  key: string;
  label: string;
  actionIds: string[];
}

export interface PvpAgentPrompt {
  id: string;
  player: PlayerId;
  kind: "selectOption" | "selectYesNo";
  label: string;
  detail: string;
  choices: PvpAgentPromptChoice[];
}

export interface PvpAgentPromptChoice {
  id: string;
  actionId: string;
  label: string;
  value: number | boolean;
  description?: number;
  descriptionList?: number[];
}

export interface PvpAgentTriggerOrder {
  id: string;
  player: PlayerId;
  label: string;
  detail: string;
  actionIds: string[];
}

export interface PvpAgentChainLink {
  id: string;
  chainIndex: number;
  player: PlayerId;
  sourceUid: string;
  effectId: string;
  targetUids?: string[];
}

export interface ApplyPvpAgentActionResult {
  ok: boolean;
  observation: PvpAgentObservation;
  appliedAction?: DuelAction;
  error?: string;
}

export interface PvpAgentReplayStep {
  player: PlayerId;
  actionId: string;
  params?: PvpAgentActionParams;
  observationHash?: string;
}

export interface PvpAgentReplayResult {
  ok: boolean;
  failedStep?: number;
  error?: string;
  observation: PvpAgentObservation;
  appliedActions: DuelAction[];
}

export interface PvpAgentPolicy {
  chooseAction(observation: PvpAgentObservation): PvpAgentDecision | undefined | Promise<PvpAgentDecision | undefined>;
}

export interface PvpAgentDecision {
  actionId: string;
  params?: PvpAgentActionParams;
}

export interface PvpAgentRunOptions {
  maxSteps?: number;
}

export interface PvpAgentRunResult {
  ok: boolean;
  steps: PvpAgentReplayStep[];
  observation: PvpAgentObservation;
  error?: string;
}

export function observePvpAgent(session: DuelSession, player: PlayerId): PvpAgentObservation {
  const state = queryPublicState(session);
  const legalActions = getLegalActions(session, player);
  const agentActions = legalActions.map((action) => toAgentAction(state, action, player));
  const legalGroups = getGroupedDuelLegalActions(session, player);
  const groups = legalGroups.map((group) => ({
    key: group.key,
    label: duelActionUiGroupLabel(group),
    actionIds: group.actions
      .map((action) => agentActions.find((candidate) => sameActionShape(candidate.raw, action))?.id)
      .filter((id): id is string => id !== undefined),
  })).filter((group) => group.actionIds.length > 0);
  const uiGroups = legalGroups.map((group) => ({
    ...group,
    label: duelActionUiGroupLabel(group),
    actions: group.actions.map(copyDuelAction),
  }));
  const promptView = duelPromptView(state.prompt, uiGroups, state.luaOperationPrompt);
  const prompt = promptView ? toAgentPrompt(promptView, agentActions) : undefined;
  const triggerOrderView = duelTriggerOrderView(state.triggerOrderPrompt, legalGroups);
  const triggerOrder = triggerOrderView ? {
    id: state.triggerOrderPrompt?.id ?? `trigger-order:${state.actionWindowId}`,
    player: state.triggerOrderPrompt?.player ?? player,
    label: triggerOrderView.label,
    detail: triggerOrderView.detail,
    actionIds: triggerOrderView.groups.flatMap((group) => group.actions.map((action) => agentActions.find((candidate) => sameActionShape(candidate.raw, action))?.id).filter((id): id is string => id !== undefined)),
  } : undefined;

  return {
    duelId: state.id,
    player,
    status: state.status,
    turn: state.turn,
    turnPlayer: state.turnPlayer,
    phase: state.phase,
    ...(state.waitingFor === undefined ? {} : { waitingFor: state.waitingFor }),
    ...(state.windowKind === undefined ? {} : { windowKind: state.windowKind }),
    lifePoints: { 0: state.players[0].lifePoints, 1: state.players[1].lifePoints },
    zones: agentZones(state, player),
    chain: state.chain.map((link) => ({
      id: link.id,
      chainIndex: link.chainIndex ?? 0,
      player: link.player,
      sourceUid: link.sourceUid,
      effectId: link.effectId,
      ...(link.targetUids === undefined ? {} : { targetUids: [...link.targetUids] }),
    })),
    ...(prompt === undefined ? {} : { prompt }),
    ...(triggerOrder === undefined ? {} : { triggerOrder }),
    legalActions: agentActions,
    actionGroups: groups,
    logTail: state.log.slice(-20),
  };
}

export function applyPvpAgentAction(session: DuelSession, player: PlayerId, actionId: string, params: PvpAgentActionParams = {}): ApplyPvpAgentActionResult {
  const observation = observePvpAgent(session, player);
  const action = observation.legalActions.find((candidate) => candidate.id === actionId);
  if (!action) return { ok: false, observation, error: `No legal action ${actionId} for player ${player}` };
  const materialized = materializeAgentAction(action, params);
  if (!materialized.ok) return { ok: false, observation, error: materialized.error };
  const result = applyPvpAction(session, materialized.action);
  return {
    ok: result.ok,
    observation: observePvpAgent(session, result.state.waitingFor ?? player),
    ...(result.ok ? { appliedAction: materialized.action } : {}),
    ...(result.error === undefined ? {} : { error: result.error }),
  };
}

export function replayPvpAgentActions(session: DuelSession, steps: readonly PvpAgentReplayStep[]): PvpAgentReplayResult {
  const appliedActions: DuelAction[] = [];
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]!;
    const before = observePvpAgent(session, step.player);
    if (step.observationHash !== undefined && observationHash(before) !== step.observationHash) {
      return { ok: false, failedStep: i, error: "Observation hash mismatch", observation: before, appliedActions };
    }
    const result = applyPvpAgentAction(session, step.player, step.actionId, step.params);
    if (!result.ok) return { ok: false, failedStep: i, error: result.error ?? "Agent action failed", observation: result.observation, appliedActions };
    if (result.appliedAction) appliedActions.push(result.appliedAction);
  }
  const lastPlayer = steps.at(-1)?.player ?? 0;
  return { ok: true, observation: observePvpAgent(session, lastPlayer), appliedActions };
}

export async function runPvpAgentLoop(session: DuelSession, agents: Record<PlayerId, PvpAgentPolicy>, options: PvpAgentRunOptions = {}): Promise<PvpAgentRunResult> {
  const maxSteps = options.maxSteps ?? 200;
  const steps: PvpAgentReplayStep[] = [];
  let player: PlayerId = session.state.waitingFor ?? session.state.turnPlayer;
  for (let i = 0; i < maxSteps; i += 1) {
    const observation = observePvpAgent(session, player);
    if (observation.status === "ended") return { ok: true, steps, observation };
    const policy = agents[player];
    if (!policy) return { ok: false, steps, observation, error: `No agent policy for player ${player}` };
    const decision = await policy.chooseAction(observation);
    if (!decision) return { ok: false, steps, observation, error: `Agent ${player} did not choose an action` };
    steps.push({ player, actionId: decision.actionId, ...(decision.params === undefined ? {} : { params: decision.params }), observationHash: observationHash(observation) });
    const result = applyPvpAgentAction(session, player, decision.actionId, decision.params);
    if (!result.ok) return { ok: false, steps, observation: result.observation, error: result.error ?? "Agent action failed" };
    player = result.observation.waitingFor ?? result.observation.turnPlayer;
  }
  return { ok: false, steps, observation: observePvpAgent(session, player), error: `Agent loop exceeded ${maxSteps} steps` };
}

export const firstLegalPvpAgentPolicy: PvpAgentPolicy = {
  chooseAction(observation) {
    const action = observation.legalActions[0];
    if (!action) return undefined;
    const params = defaultParamsForAction(action);
    return { actionId: action.id, ...(params === undefined ? {} : { params }) };
  },
};

export function observationHash(observation: PvpAgentObservation): string {
  return stableStringify({
    duelId: observation.duelId,
    player: observation.player,
    status: observation.status,
    turn: observation.turn,
    phase: observation.phase,
    waitingFor: observation.waitingFor,
    zones: observation.zones,
    legalActionIds: observation.legalActions.map((action) => action.id),
  });
}

function toAgentAction(state: PublicDuelState, action: DuelAction, viewer: PlayerId): PvpAgentLegalAction {
  const anchors = actionAnchors(state, action, viewer);
  const placement = placementForAction(state, action);
  return {
    id: pvpAgentActionId(action),
    type: action.type,
    player: action.player,
    label: action.label,
    ...(anchors[0] === undefined ? {} : { source: anchors[0] }),
    anchors,
    ...(placement === undefined ? {} : { placement }),
    params: paramsForAction(action, placement),
    ...(action.windowId === undefined ? {} : { windowId: action.windowId }),
    ...(action.windowKind === undefined ? {} : { windowKind: action.windowKind }),
    ...(action.windowToken === undefined ? {} : { windowToken: action.windowToken }),
    raw: copyDuelAction(action),
  };
}

export function pvpAgentActionId(action: DuelAction): string {
  return stableStringify(action);
}

function materializeAgentAction(action: PvpAgentLegalAction, params: PvpAgentActionParams): { ok: true; action: DuelAction } | { ok: false; error: string } {
  const placement = action.placement;
  if (placement?.required) {
    if (placement.kind === "monsterZone") {
      if (params.summonSequence === undefined) return { ok: false, error: `${action.type} requires summonSequence` };
      if (!placement.allowedSequences.includes(params.summonSequence)) return { ok: false, error: `summonSequence ${params.summonSequence} is not legal` };
    }
    if (placement.kind === "spellTrapZone") {
      if (params.spellTrapSequence === undefined) return { ok: false, error: `${action.type} requires spellTrapSequence` };
      if (!placement.allowedSequences.includes(params.spellTrapSequence)) return { ok: false, error: `spellTrapSequence ${params.spellTrapSequence} is not legal` };
    }
  }
  if (params.summonUids !== undefined && action.raw.type !== "pendulumSummon") return { ok: false, error: `${action.type} does not accept summonUids` };
  if (params.summonSequence !== undefined && !isMonsterPlacementAction(action.raw)) return { ok: false, error: `${action.type} does not accept summonSequence` };
  if (params.spellTrapSequence !== undefined && action.raw.type !== "setSpellTrap" && action.raw.type !== "activateEffect") return { ok: false, error: `${action.type} does not accept spellTrapSequence` };
  if (action.raw.type === "pendulumSummon") {
    const summonUids = params.summonUids ?? action.raw.summonUids.slice(0, Math.min(action.raw.maxSummons, action.raw.summonUids.length));
    return { ok: true, action: { ...action.raw, summonUids } };
  }
  if (isMonsterPlacementAction(action.raw)) return { ok: true, action: { ...action.raw, ...(params.summonSequence === undefined ? {} : { summonSequence: params.summonSequence }) } };
  if (action.raw.type === "setSpellTrap" || action.raw.type === "activateEffect") return { ok: true, action: { ...action.raw, ...(params.spellTrapSequence === undefined ? {} : { spellTrapSequence: params.spellTrapSequence }) } };
  return { ok: true, action: copyDuelAction(action.raw) };
}

function defaultParamsForAction(action: PvpAgentLegalAction): PvpAgentActionParams | undefined {
  if (!action.placement?.required) return undefined;
  const first = action.placement.allowedSequences[0];
  if (first === undefined) return undefined;
  if (action.placement.kind === "monsterZone") return { summonSequence: first };
  if (action.placement.kind === "spellTrapZone") return { spellTrapSequence: first };
  return undefined;
}

function paramsForAction(action: DuelAction, placement: PvpAgentPlacementRequirement | undefined): PvpAgentActionParamSchema {
  return {
    ...(placement?.kind === "monsterZone" && placement.required ? { requiresSummonSequence: true } : {}),
    ...(placement?.kind === "spellTrapZone" && placement.required ? { requiresSpellTrapSequence: true } : {}),
    ...(action.type === "pendulumSummon" ? { acceptsSummonUids: true } : {}),
  };
}

function placementForAction(state: PublicDuelState, action: DuelAction): PvpAgentPlacementRequirement | undefined {
  if (isMonsterPlacementAction(action)) {
    return { kind: "monsterZone", player: action.player, allowedSequences: openSequences(state, action.player, "monsterZone"), required: true };
  }
  if (action.type === "setSpellTrap" || action.type === "activateEffect") {
    const source = "uid" in action ? state.cards.find((card) => card.uid === action.uid) : undefined;
    if (!source || source.location !== "hand" || (source.kind !== "spell" && source.kind !== "trap")) return undefined;
    if (isFieldSpell(source)) return { kind: "fieldZone", player: action.player, allowedSequences: [5], required: false };
    return { kind: "spellTrapZone", player: action.player, allowedSequences: openSequences(state, action.player, "spellTrapZone"), required: true };
  }
  return undefined;
}

function isMonsterPlacementAction(action: DuelAction): action is Extract<DuelAction, { summonSequence?: number }> {
  return action.type === "normalSummon" ||
    action.type === "tributeSummon" ||
    action.type === "tributeSet" ||
    action.type === "fusionSummon" ||
    action.type === "synchroSummon" ||
    action.type === "xyzSummon" ||
    action.type === "linkSummon" ||
    action.type === "ritualSummon" ||
    action.type === "setMonster" ||
    action.type === "specialSummonProcedure";
}

function openSequences(state: PublicDuelState, player: PlayerId, location: "monsterZone" | "spellTrapZone"): number[] {
  const occupied = new Set(state.cards.filter((card) => card.controller === player && card.location === location).map((card) => card.sequence));
  return [0, 1, 2, 3, 4].filter((sequence) => !occupied.has(sequence));
}

function agentZones(state: PublicDuelState, viewer: PlayerId): PvpAgentZoneState {
  const opponent = viewer === 0 ? 1 : 0;
  return {
    self: playerZones(state, viewer, viewer),
    opponent: playerZones(state, opponent, viewer),
  };
}

function playerZones(state: PublicDuelState, player: PlayerId, viewer: PlayerId): PvpAgentPlayerZones {
  const cards = state.cards.filter((card) => card.controller === player);
  return {
    player,
    hand: cards.filter((card) => card.location === "hand").sort(bySequence).map((card) => agentCard(card, viewer)),
    monsterZone: zoneSlots(cards, "monsterZone", viewer),
    spellTrapZone: zoneSlots(cards, "spellTrapZone", viewer),
    fieldZone: cards.filter((card) => card.location === "fieldZone").sort(bySequence).map((card) => agentCard(card, viewer))[0] ?? null,
    graveyard: cards.filter((card) => card.location === "graveyard").sort(bySequence).map((card) => agentCard(card, viewer)),
    banished: cards.filter((card) => card.location === "banished").sort(bySequence).map((card) => agentCard(card, viewer)),
    extraDeck: pileView(cards.filter((card) => card.location === "extraDeck"), viewer),
    deck: { count: cards.filter((card) => card.location === "deck").length },
  };
}

function zoneSlots(cards: PublicDuelCard[], location: "monsterZone" | "spellTrapZone", viewer: PlayerId): (PvpAgentCardView | null)[] {
  return [0, 1, 2, 3, 4].map((sequence) => {
    const card = cards.find((candidate) => candidate.location === location && candidate.sequence === sequence);
    return card ? agentCard(card, viewer) : null;
  });
}

function pileView(cards: PublicDuelCard[], viewer: PlayerId): PvpAgentPileView {
  const visible = cards.filter((card) => isCardPublic(card, viewer));
  return {
    count: cards.length,
    ...(visible.length === 0 ? {} : { cards: visible.sort(bySequence).map((card) => agentCard(card, viewer)) }),
  };
}

function agentCard(card: PublicDuelCard, viewer: PlayerId): PvpAgentCardView {
  const revealed = isCardPublic(card, viewer);
  return {
    uid: card.uid,
    ...(revealed ? { code: card.code, name: card.name, kind: card.kind, ...(card.typeFlags === undefined ? {} : { typeFlags: card.typeFlags }) } : {}),
    owner: card.owner,
    controller: card.controller,
    location: card.location,
    sequence: card.sequence,
    position: card.position,
    faceUp: card.faceUp,
    overlayCount: card.overlayCount,
    ...(card.counters === undefined ? {} : { counters: { ...card.counters } }),
    revealed,
  };
}

function cardRef(card: PublicDuelCard | undefined, viewer: PlayerId): PvpAgentCardRef | undefined {
  if (!card) return undefined;
  const revealed = isCardPublic(card, viewer);
  return {
    uid: card.uid,
    ...(revealed ? { code: card.code, name: card.name } : {}),
    location: card.location,
    sequence: card.sequence,
  };
}

function actionAnchors(state: PublicDuelState, action: DuelAction, viewer: PlayerId): PvpAgentCardRef[] {
  const uids = actionAnchorUids(action);
  return uids.map((uid) => cardRef(state.cards.find((card) => card.uid === uid), viewer)).filter((ref): ref is PvpAgentCardRef => ref !== undefined);
}

function actionAnchorUids(action: DuelAction): string[] {
  if ("uid" in action) {
    if (action.type === "tributeSummon" || action.type === "tributeSet") return [action.uid, ...action.tributeUids];
    if (action.type === "fusionSummon" || action.type === "synchroSummon" || action.type === "xyzSummon" || action.type === "linkSummon" || action.type === "ritualSummon") return [action.uid, ...action.materialUids];
    return [action.uid];
  }
  if (action.type === "pendulumSummon") return [...action.summonUids];
  if (action.type === "declareAttack" || action.type === "replayAttack") return action.targetUid ? [action.attackerUid, action.targetUid] : [action.attackerUid];
  if (action.type === "cancelAttack") return [action.attackerUid];
  return [];
}

function toAgentPrompt(prompt: ReturnType<typeof duelPromptView>, actions: PvpAgentLegalAction[]): PvpAgentPrompt | undefined {
  if (!prompt) return undefined;
  return {
    id: prompt.prompt.id,
    player: prompt.prompt.player,
    kind: prompt.prompt.type,
    label: prompt.label,
    detail: prompt.detail,
    choices: prompt.choices.map((choice) => {
      const action = actions.find((candidate) => sameActionShape(candidate.raw, choice.action));
      return {
        id: `${prompt.prompt.id}:${choice.action.type}:${"option" in choice.action ? choice.action.option : choice.action.yes}`,
        actionId: action?.id ?? pvpAgentActionId(choice.action),
        label: choice.action.label,
        value: choice.type === "selectOption" ? choice.option : choice.yes,
        ...(choice.type === "selectOption" && choice.description !== undefined ? { description: choice.description } : {}),
        ...(choice.type === "selectOption" && choice.descriptionList !== undefined ? { descriptionList: [...choice.descriptionList] } : {}),
        ...(choice.type === "selectYesNo" && choice.description !== undefined ? { description: choice.description } : {}),
      };
    }),
  };
}

function isCardPublic(card: PublicDuelCard, viewer: PlayerId): boolean {
  if (card.controller === viewer && card.location === "hand") return true;
  if (card.faceUp) return true;
  if (card.location === "graveyard" || card.location === "banished") return true;
  return card.revealedToPlayers?.includes(viewer) ?? false;
}

function isFieldSpell(card: PublicDuelCard): boolean {
  return card.kind === "spell" && ((card.typeFlags ?? 0) & 0x80000) !== 0;
}

function bySequence(a: PublicDuelCard, b: PublicDuelCard): number {
  return a.sequence - b.sequence;
}

function sameActionShape(left: DuelAction, right: DuelAction): boolean {
  return pvpAgentActionId(left) === pvpAgentActionId(right);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sortJson(child)]));
  }
  return value;
}
