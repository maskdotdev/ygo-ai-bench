import type { ChainLink, DuelCardInstance, DuelEffectDefinition, DuelFlagEffect, DuelLogEntry, DuelPlayerState, DuelState, PendingTrigger, PlayerId } from "#duel/types.js";

export interface DuelStateRollback {
  status: DuelState["status"];
  turn: number;
  turnPlayer: PlayerId;
  phase: DuelState["phase"];
  players: Record<PlayerId, DuelPlayerState>;
  cards: DuelCardInstance[];
  effects: DuelEffectDefinition[];
  chain: ChainLink[];
  chainPasses: PlayerId[];
  pendingTriggers: PendingTrigger[];
  usedCountKeys: string[];
  flagEffects: DuelFlagEffect[];
  activityCounts: DuelState["activityCounts"];
  attacksDeclared: string[];
  positionsChanged: string[];
  currentAttack: DuelState["currentAttack"] | undefined;
  prompt: DuelState["prompt"] | undefined;
  waitingFor: PlayerId | undefined;
  log: DuelLogEntry[];
}

export function captureDuelState(state: DuelState): DuelStateRollback {
  return {
    status: state.status,
    turn: state.turn,
    turnPlayer: state.turnPlayer,
    phase: state.phase,
    players: { 0: { ...state.players[0] }, 1: { ...state.players[1] } },
    cards: state.cards.map((card) => ({ ...card, overlayUids: [...card.overlayUids] })),
    effects: state.effects.map((effect) => ({ ...effect, range: [...effect.range], ...(effect.reset ? { reset: { ...effect.reset } } : {}) })),
    chain: state.chain.map((link) => ({ ...link, ...(link.targetUids ? { targetUids: [...link.targetUids] } : {}) })),
    chainPasses: [...state.chainPasses],
    pendingTriggers: state.pendingTriggers.map((trigger) => ({ ...trigger })),
    usedCountKeys: [...state.usedCountKeys],
    flagEffects: state.flagEffects.map((effect) => ({ ...effect })),
    activityCounts: { 0: { ...state.activityCounts[0] }, 1: { ...state.activityCounts[1] } },
    attacksDeclared: [...state.attacksDeclared],
    positionsChanged: [...state.positionsChanged],
    currentAttack: state.currentAttack ? { ...state.currentAttack } : undefined,
    prompt: state.prompt ? { ...state.prompt } : undefined,
    waitingFor: state.waitingFor,
    log: state.log.map((entry) => ({ ...entry })),
  };
}

export function restoreDuelState(state: DuelState, rollback: DuelStateRollback): void {
  state.status = rollback.status;
  state.turn = rollback.turn;
  state.turnPlayer = rollback.turnPlayer;
  state.phase = rollback.phase;
  state.players = rollback.players;
  state.cards = rollback.cards;
  state.effects = rollback.effects;
  state.chain = rollback.chain;
  state.chainPasses = rollback.chainPasses;
  state.pendingTriggers = rollback.pendingTriggers;
  state.usedCountKeys = rollback.usedCountKeys;
  state.flagEffects = rollback.flagEffects;
  state.activityCounts = rollback.activityCounts;
  state.attacksDeclared = rollback.attacksDeclared;
  state.positionsChanged = rollback.positionsChanged;
  if (rollback.currentAttack) state.currentAttack = rollback.currentAttack;
  else delete state.currentAttack;
  if (rollback.prompt) state.prompt = rollback.prompt;
  else delete state.prompt;
  if (rollback.waitingFor !== undefined) state.waitingFor = rollback.waitingFor;
  else delete state.waitingFor;
  state.log = rollback.log;
}
