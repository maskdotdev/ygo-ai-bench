import type { ChainLink, DuelCardInstance, DuelEffectDefinition, DuelEventRecord, DuelFlagEffect, DuelLogEntry, DuelPlayerState, DuelState, PendingTrigger, PlayerId } from "#duel/types.js";

export interface DuelStateRollback {
  status: DuelState["status"];
  winner: DuelState["winner"] | undefined;
  winReason: number | undefined;
  actionWindowId: number;
  turn: number;
  turnPlayer: PlayerId;
  phase: DuelState["phase"];
  randomCounter: number;
  players: Record<PlayerId, DuelPlayerState>;
  cards: DuelCardInstance[];
  effects: DuelEffectDefinition[];
  chain: ChainLink[];
  chainPasses: PlayerId[];
  pendingTriggers: PendingTrigger[];
  eventHistory: DuelEventRecord[];
  usedCountKeys: string[];
  flagEffects: DuelFlagEffect[];
  activityCounts: DuelState["activityCounts"];
  activityHistory: DuelState["activityHistory"];
  battleDamage: DuelState["battleDamage"];
  attacksDeclared: string[];
  attackPasses: PlayerId[];
  damagePasses: PlayerId[];
  battleStep: DuelState["battleStep"] | undefined;
  positionsChanged: string[];
  currentAttack: DuelState["currentAttack"] | undefined;
  pendingBattle: DuelState["pendingBattle"] | undefined;
  prompt: DuelState["prompt"] | undefined;
  waitingFor: PlayerId | undefined;
  log: DuelLogEntry[];
}

export function captureDuelState(state: DuelState): DuelStateRollback {
  return {
    status: state.status,
    winner: state.winner,
    winReason: state.winReason,
    actionWindowId: state.actionWindowId,
    turn: state.turn,
    turnPlayer: state.turnPlayer,
    phase: state.phase,
    randomCounter: state.randomCounter,
    players: { 0: { ...state.players[0] }, 1: { ...state.players[1] } },
    cards: state.cards.map((card) => ({ ...card, overlayUids: [...card.overlayUids] })),
    effects: state.effects.map((effect) => ({ ...effect, range: [...effect.range], ...(effect.reset ? { reset: { ...effect.reset } } : {}) })),
    chain: state.chain.map((link) => ({ ...link, ...(link.targetUids ? { targetUids: [...link.targetUids] } : {}) })),
    chainPasses: [...state.chainPasses],
    pendingTriggers: state.pendingTriggers.map((trigger) => ({ ...trigger })),
    eventHistory: state.eventHistory.map((event) => ({ ...event })),
    usedCountKeys: [...state.usedCountKeys],
    flagEffects: state.flagEffects.map((effect) => ({ ...effect })),
    activityCounts: { 0: { ...state.activityCounts[0] }, 1: { ...state.activityCounts[1] } },
    activityHistory: state.activityHistory.map((record) => ({ ...record })),
    battleDamage: { ...state.battleDamage },
    attacksDeclared: [...state.attacksDeclared],
    attackPasses: [...state.attackPasses],
    damagePasses: [...state.damagePasses],
    battleStep: state.battleStep,
    positionsChanged: [...state.positionsChanged],
    currentAttack: state.currentAttack ? { ...state.currentAttack } : undefined,
    pendingBattle: state.pendingBattle
      ? { ...state.pendingBattle, ...(state.pendingBattle.battleDamageOverrides ? { battleDamageOverrides: { ...state.pendingBattle.battleDamageOverrides } } : {}) }
      : undefined,
    prompt: state.prompt ? { ...state.prompt } : undefined,
    waitingFor: state.waitingFor,
    log: state.log.map((entry) => ({ ...entry })),
  };
}

export function restoreDuelState(state: DuelState, rollback: DuelStateRollback): void {
  state.status = rollback.status;
  if (rollback.winner === undefined) delete state.winner;
  else state.winner = rollback.winner;
  if (rollback.winReason === undefined) delete state.winReason;
  else state.winReason = rollback.winReason;
  state.actionWindowId = rollback.actionWindowId;
  state.turn = rollback.turn;
  state.turnPlayer = rollback.turnPlayer;
  state.phase = rollback.phase;
  state.randomCounter = rollback.randomCounter;
  state.players = rollback.players;
  state.cards = rollback.cards;
  state.effects = rollback.effects;
  state.chain = rollback.chain;
  state.chainPasses = rollback.chainPasses;
  state.pendingTriggers = rollback.pendingTriggers;
  state.eventHistory = rollback.eventHistory;
  state.usedCountKeys = rollback.usedCountKeys;
  state.flagEffects = rollback.flagEffects;
  state.activityCounts = rollback.activityCounts;
  state.activityHistory = rollback.activityHistory;
  state.battleDamage = rollback.battleDamage;
  state.attacksDeclared = rollback.attacksDeclared;
  state.attackPasses = rollback.attackPasses;
  state.damagePasses = rollback.damagePasses;
  if (rollback.battleStep) state.battleStep = rollback.battleStep;
  else delete state.battleStep;
  state.positionsChanged = rollback.positionsChanged;
  if (rollback.currentAttack) state.currentAttack = rollback.currentAttack;
  else delete state.currentAttack;
  if (rollback.pendingBattle) state.pendingBattle = rollback.pendingBattle;
  else delete state.pendingBattle;
  if (rollback.prompt) state.prompt = rollback.prompt;
  else delete state.prompt;
  if (rollback.waitingFor !== undefined) state.waitingFor = rollback.waitingFor;
  else delete state.waitingFor;
  state.log = rollback.log;
}
