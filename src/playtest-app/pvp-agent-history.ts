import type {
  ApplyPvpAgentActionResult,
  PvpAgentActionParams,
  PvpAgentCardRef,
  PvpAgentCardView,
  PvpAgentLegalAction,
  PvpAgentObservation,
} from "./pvp-agent-api.js";
import type { CardPosition, DuelLocation, DuelPhase, PlayerId } from "#duel/types.js";

export interface PvpAgentHistoryEntry {
  step: number;
  turn: number;
  phase: DuelPhase;
  player: PlayerId;
  actionId: string;
  actionType: string;
  label: string;
  params?: PvpAgentActionParams;
  source?: PvpAgentCardRef;
  result: "ok" | "rejected";
  error?: string;
  publicDelta: PvpPublicDelta[];
  chainDepthBefore: number;
  chainDepthAfter: number;
}

export type PvpPublicDelta =
  | { type: "move"; uid: string; name?: string; from: PvpCardPlace; to: PvpCardPlace }
  | { type: "lp"; player: PlayerId; from: number; to: number }
  | { type: "phase"; from: DuelPhase; to: DuelPhase }
  | { type: "turn"; from: number; to: number; turnPlayer: PlayerId }
  | { type: "chain"; from: number; to: number }
  | { type: "prompt"; player: PlayerId; kind: string; id: string }
  | { type: "log"; action: string; player?: PlayerId; card?: string; detail: string };

export interface PvpCardPlace {
  controller: PlayerId;
  location: DuelLocation;
  sequence: number;
  position?: CardPosition;
  faceUp?: boolean;
}

export interface PvpModelDecisionLike {
  actionId: string;
  params?: PvpAgentActionParams;
}

export interface PvpModelHistoryView {
  currentTurn: PvpAgentHistoryEntry[];
  recent: PvpAgentHistoryEntry[];
  summary?: string;
}

export function buildAgentHistoryEntry(input: {
  step: number;
  before: PvpAgentObservation;
  after: PvpAgentObservation;
  action: PvpAgentLegalAction | undefined;
  decision: PvpModelDecisionLike;
  result: ApplyPvpAgentActionResult;
}): PvpAgentHistoryEntry {
  return {
    step: input.step,
    turn: input.before.turn,
    phase: input.before.phase,
    player: input.before.player,
    actionId: input.decision.actionId,
    actionType: input.action?.type ?? "unknown",
    label: input.action?.label ?? "",
    ...(input.decision.params === undefined ? {} : { params: copyParams(input.decision.params) }),
    ...(input.action?.source === undefined ? {} : { source: { ...input.action.source } }),
    result: input.result.ok ? "ok" : "rejected",
    ...(input.result.error === undefined ? {} : { error: input.result.error }),
    publicDelta: diffAgentObservations(input.before, input.after),
    chainDepthBefore: input.before.chain.length,
    chainDepthAfter: input.after.chain.length,
  };
}

export function diffAgentObservations(before: PvpAgentObservation, after: PvpAgentObservation): PvpPublicDelta[] {
  const deltas: PvpPublicDelta[] = [];
  for (const player of [0, 1] as const) {
    const beforeLp = before.lifePoints[player];
    const afterLp = after.lifePoints[player];
    if (beforeLp !== afterLp) deltas.push({ type: "lp", player, from: beforeLp, to: afterLp });
  }
  if (before.phase !== after.phase) deltas.push({ type: "phase", from: before.phase, to: after.phase });
  if (before.turn !== after.turn || before.turnPlayer !== after.turnPlayer) deltas.push({ type: "turn", from: before.turn, to: after.turn, turnPlayer: after.turnPlayer });
  if (before.chain.length !== after.chain.length) deltas.push({ type: "chain", from: before.chain.length, to: after.chain.length });
  if (!before.prompt && after.prompt) deltas.push({ type: "prompt", player: after.prompt.player, kind: after.prompt.kind, id: after.prompt.id });

  const beforeCards = visibleCardMap(before);
  const afterCards = visibleCardMap(after);
  for (const [uid, afterCard] of afterCards) {
    const beforeCard = beforeCards.get(uid);
    if (!beforeCard) continue;
    const from = cardPlace(beforeCard);
    const to = cardPlace(afterCard);
    if (placesDiffer(from, to)) {
      deltas.push({
        type: "move",
        uid,
        ...(afterCard.name ?? beforeCard.name ? { name: afterCard.name ?? beforeCard.name } : {}),
        from,
        to,
      });
    }
  }

  const beforeLogKeys = new Set(before.logTail.map(logKey));
  for (const entry of after.logTail) {
    if (beforeLogKeys.has(logKey(entry))) continue;
    deltas.push({
      type: "log",
      action: entry.action,
      ...(entry.player === undefined ? {} : { player: entry.player }),
      ...(entry.card === undefined ? {} : { card: entry.card }),
      detail: entry.detail,
    });
  }
  return deltas;
}

export function historyForPlayer(history: readonly PvpAgentHistoryEntry[], _player: PlayerId): PvpAgentHistoryEntry[] {
  return history.map(copyHistoryEntry);
}

export function compactHistoryForModel(input: {
  history: readonly PvpAgentHistoryEntry[];
  player: PlayerId;
  currentTurn: number;
  recentLimit?: number;
  summary?: string;
}): PvpModelHistoryView {
  const visibleHistory = historyForPlayer(input.history, input.player);
  const recentLimit = input.recentLimit ?? 16;
  return {
    currentTurn: visibleHistory.filter((entry) => entry.turn === input.currentTurn).map(copyHistoryEntry),
    recent: visibleHistory.slice(-recentLimit).map(copyHistoryEntry),
    ...(input.summary === undefined ? {} : { summary: input.summary }),
  };
}

function visibleCardMap(observation: PvpAgentObservation): Map<string, PvpAgentCardView> {
  const cards = [
    ...playerCards(observation.zones.self),
    ...playerCards(observation.zones.opponent),
  ].filter((card) => card.revealed || card.location !== "hand");
  return new Map(cards.map((card) => [card.uid, card]));
}

function playerCards(zones: PvpAgentObservation["zones"]["self"]): PvpAgentCardView[] {
  return [
    ...zones.hand,
    ...zones.monsterZone.filter((card): card is PvpAgentCardView => card !== null),
    ...zones.spellTrapZone.filter((card): card is PvpAgentCardView => card !== null),
    ...(zones.fieldZone ? [zones.fieldZone] : []),
    ...zones.graveyard,
    ...zones.banished,
    ...(zones.extraDeck.cards ?? []),
  ];
}

function cardPlace(card: PvpAgentCardView): PvpCardPlace {
  return {
    controller: card.controller,
    location: card.location,
    sequence: card.sequence,
    position: card.position,
    faceUp: card.faceUp,
  };
}

function placesDiffer(left: PvpCardPlace, right: PvpCardPlace): boolean {
  return left.controller !== right.controller ||
    left.location !== right.location ||
    left.sequence !== right.sequence ||
    left.position !== right.position ||
    left.faceUp !== right.faceUp;
}

function logKey(entry: PvpAgentObservation["logTail"][number]): string {
  return `${entry.step}:${entry.action}:${entry.player ?? ""}:${entry.card ?? ""}:${entry.detail}`;
}

function copyHistoryEntry(entry: PvpAgentHistoryEntry): PvpAgentHistoryEntry {
  return {
    ...entry,
    ...(entry.params === undefined ? {} : { params: copyParams(entry.params) }),
    ...(entry.source === undefined ? {} : { source: { ...entry.source } }),
    publicDelta: entry.publicDelta.map(copyDelta),
  };
}

function copyParams(params: PvpAgentActionParams): PvpAgentActionParams {
  return {
    ...(params.summonSequence === undefined ? {} : { summonSequence: params.summonSequence }),
    ...(params.spellTrapSequence === undefined ? {} : { spellTrapSequence: params.spellTrapSequence }),
    ...(params.summonUids === undefined ? {} : { summonUids: [...params.summonUids] }),
  };
}

function copyDelta(delta: PvpPublicDelta): PvpPublicDelta {
  if (delta.type === "move") return { ...delta, from: { ...delta.from }, to: { ...delta.to } };
  return { ...delta };
}
