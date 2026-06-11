import { copyBattleWindowState } from "#duel/battle-window-state.js";
import type { ChainLimit, ChainLink, DuelBattlePair, DuelCardData, DuelCardInstance, DuelEffectDefinition, DuelEventRecord, DuelFlagEffect, DuelLogEntry, DuelPlayerState, DuelPromptState, DuelState, PendingTrigger, PlayerId, SkippedDuelPhase } from "#duel/types.js";
import { copyLuaPromptResumeValues, isLuaOptionPromptDecision } from "#lua/host-types.js";

export interface DuelStateRollback {
  status: DuelState["status"];
  winner: DuelState["winner"] | undefined;
  winReason: number | undefined;
  actionWindowId: number;
  actionWindowToken: string;
  turn: number;
  turnPlayer: PlayerId;
  phase: DuelState["phase"];
  randomCounter: number;
  lastDiceResults: number[];
  lastCoinResults: number[];
  players: Record<PlayerId, DuelPlayerState>;
  cards: DuelCardInstance[];
  effects: DuelEffectDefinition[];
  chain: ChainLink[];
  chainLimits: ChainLimit[];
  chainPasses: PlayerId[];
  pendingTriggers: PendingTrigger[];
  eventHistory: DuelEventRecord[];
  usedCountKeys: string[];
  flagEffects: DuelFlagEffect[];
  duelTypeFlags: number;
  globalFlags: number;
  unofficialProcEnabled: boolean;
  shuffleCheckDisabled: boolean;
  skippedPhases: SkippedDuelPhase[];
  activityCounts: DuelState["activityCounts"];
  activityHistory: DuelState["activityHistory"];
  phaseActivity: boolean;
  battleDamage: DuelState["battleDamage"];
  attackCostPaid: number;
  attacksDeclared: string[];
  attackCanceledUids: string[];
  attackedTargetUids: string[];
  battlePairs: DuelBattlePair[];
  attackPasses: PlayerId[];
  damagePasses: PlayerId[];
  battleStep: DuelState["battleStep"] | undefined;
  battleWindow: DuelState["battleWindow"] | undefined;
  positionsChanged: string[];
  currentAttack: DuelState["currentAttack"] | undefined;
  pendingBattle: DuelState["pendingBattle"] | undefined;
  prompt: DuelState["prompt"] | undefined;
  luaOperationPrompt: DuelState["luaOperationPrompt"] | undefined;
  waitingFor: PlayerId | undefined;
  log: DuelLogEntry[];
}

export function captureDuelState(state: DuelState): DuelStateRollback {
  return {
    status: state.status,
    winner: state.winner,
    winReason: state.winReason,
    actionWindowId: state.actionWindowId,
    actionWindowToken: state.actionWindowToken,
    turn: state.turn,
    turnPlayer: state.turnPlayer,
    phase: state.phase,
    randomCounter: state.randomCounter,
    lastDiceResults: [...state.lastDiceResults],
    lastCoinResults: [...state.lastCoinResults],
    players: { 0: { ...state.players[0] }, 1: { ...state.players[1] } },
    cards: state.cards.map(copyCard),
    effects: state.effects.map(copyEffect),
    chain: state.chain.map(copyChainLink),
    chainLimits: state.chainLimits.map((limit) => ({ ...limit })),
    chainPasses: [...state.chainPasses],
    pendingTriggers: state.pendingTriggers.map(copyPendingTrigger),
    eventHistory: state.eventHistory.map(copyEventRecord),
    usedCountKeys: [...state.usedCountKeys],
    flagEffects: state.flagEffects.map((effect) => ({ ...effect })),
    duelTypeFlags: state.duelTypeFlags,
    globalFlags: state.globalFlags,
    unofficialProcEnabled: state.unofficialProcEnabled,
    shuffleCheckDisabled: state.shuffleCheckDisabled,
    skippedPhases: state.skippedPhases.map((skip) => ({ ...skip })),
    activityCounts: { 0: { ...state.activityCounts[0] }, 1: { ...state.activityCounts[1] } },
    activityHistory: state.activityHistory.map((record) => ({ ...record })),
    phaseActivity: state.phaseActivity,
    battleDamage: { ...state.battleDamage },
    attackCostPaid: state.attackCostPaid,
    attacksDeclared: [...state.attacksDeclared],
    attackCanceledUids: [...state.attackCanceledUids],
    attackedTargetUids: [...state.attackedTargetUids],
    battlePairs: state.battlePairs.map((pair) => ({ ...pair })),
    attackPasses: [...state.attackPasses],
    damagePasses: [...state.damagePasses],
    battleStep: state.battleStep,
    battleWindow: state.battleWindow ? copyBattleWindowState(state.battleWindow) : undefined,
    positionsChanged: [...state.positionsChanged],
    currentAttack: state.currentAttack ? copyBattleAttack(state.currentAttack) : undefined,
    pendingBattle: state.pendingBattle ? copyPendingBattle(state.pendingBattle) : undefined,
    prompt: state.prompt ? copyPrompt(state.prompt) : undefined,
    luaOperationPrompt: state.luaOperationPrompt ? { chainLink: copyChainLink(state.luaOperationPrompt.chainLink), prompt: copyLuaOperationPromptDecision(state.luaOperationPrompt.prompt) } : undefined,
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
  state.actionWindowToken = rollback.actionWindowToken;
  state.turn = rollback.turn;
  state.turnPlayer = rollback.turnPlayer;
  state.phase = rollback.phase;
  state.randomCounter = rollback.randomCounter;
  state.lastDiceResults = [...rollback.lastDiceResults];
  state.lastCoinResults = [...rollback.lastCoinResults];
  state.players = { 0: { ...rollback.players[0] }, 1: { ...rollback.players[1] } };
  state.cards = rollback.cards.map(copyCard);
  state.effects = rollback.effects.map(copyEffect);
  state.chain = rollback.chain.map(copyChainLink);
  state.chainLimits = rollback.chainLimits.map((limit) => ({ ...limit }));
  state.chainPasses = [...rollback.chainPasses];
  state.pendingTriggers = rollback.pendingTriggers.map(copyPendingTrigger);
  state.eventHistory = rollback.eventHistory.map(copyEventRecord);
  state.usedCountKeys = [...rollback.usedCountKeys];
  state.flagEffects = rollback.flagEffects.map((effect) => ({ ...effect }));
  state.duelTypeFlags = rollback.duelTypeFlags;
  state.globalFlags = rollback.globalFlags;
  state.unofficialProcEnabled = rollback.unofficialProcEnabled;
  state.shuffleCheckDisabled = rollback.shuffleCheckDisabled;
  state.skippedPhases = rollback.skippedPhases.map((skip) => ({ ...skip }));
  state.activityCounts = { 0: { ...rollback.activityCounts[0] }, 1: { ...rollback.activityCounts[1] } };
  state.activityHistory = rollback.activityHistory.map((record) => ({ ...record }));
  state.phaseActivity = rollback.phaseActivity;
  state.battleDamage = { ...rollback.battleDamage };
  state.attackCostPaid = rollback.attackCostPaid;
  state.attacksDeclared = [...rollback.attacksDeclared];
  state.attackCanceledUids = [...rollback.attackCanceledUids];
  state.attackedTargetUids = [...rollback.attackedTargetUids];
  state.battlePairs = rollback.battlePairs.map((pair) => ({ ...pair }));
  state.attackPasses = [...rollback.attackPasses];
  state.damagePasses = [...rollback.damagePasses];
  if (rollback.battleStep) state.battleStep = rollback.battleStep;
  else delete state.battleStep;
  if (rollback.battleWindow) state.battleWindow = copyBattleWindowState(rollback.battleWindow);
  else delete state.battleWindow;
  state.positionsChanged = [...rollback.positionsChanged];
  if (rollback.currentAttack) state.currentAttack = copyBattleAttack(rollback.currentAttack);
  else delete state.currentAttack;
  if (rollback.pendingBattle) state.pendingBattle = copyPendingBattle(rollback.pendingBattle);
  else delete state.pendingBattle;
  if (rollback.prompt) state.prompt = copyPrompt(rollback.prompt);
  else delete state.prompt;
  if (rollback.luaOperationPrompt) state.luaOperationPrompt = { chainLink: copyChainLink(rollback.luaOperationPrompt.chainLink), prompt: copyLuaOperationPromptDecision(rollback.luaOperationPrompt.prompt) };
  else delete state.luaOperationPrompt;
  if (rollback.waitingFor !== undefined) state.waitingFor = rollback.waitingFor;
  else delete state.waitingFor;
  state.log = rollback.log.map((entry) => ({ ...entry }));
}

function copyPrompt(prompt: DuelPromptState): DuelPromptState {
  if (prompt.type === "selectOption") return { ...prompt, options: [...prompt.options], ...(prompt.descriptions === undefined ? {} : { descriptions: [...prompt.descriptions] }), ...(prompt.descriptionLists === undefined ? {} : { descriptionLists: prompt.descriptionLists.map((descriptions) => [...descriptions]) }) };
  return { ...prompt };
}

function copyLuaOperationPromptDecision(prompt: NonNullable<DuelState["luaOperationPrompt"]>["prompt"]): NonNullable<DuelState["luaOperationPrompt"]>["prompt"] {
  if (isLuaOptionPromptDecision(prompt)) return { ...prompt, options: [...prompt.options], descriptions: [...prompt.descriptions], ...(prompt.descriptionLists === undefined ? {} : { descriptionLists: prompt.descriptionLists.map((descriptions) => [...descriptions]) }), ...(prompt.returnValues === undefined ? {} : { returnValues: prompt.returnValues.map(copyLuaPromptResumeValues) }), ...(prompt.revealedUids === undefined ? {} : { revealedUids: [...prompt.revealedUids] }) };
  return { ...prompt, ...(prompt.revealedUids === undefined ? {} : { revealedUids: [...prompt.revealedUids] }) };
}

function copyCard(card: DuelCardInstance): DuelCardInstance {
  return {
    ...card,
    data: copyCardData(card.data),
    overlayUids: [...card.overlayUids],
    ...(card.counters ? { counters: { ...card.counters } } : {}),
    ...(card.counterBuckets ? { counterBuckets: copyCounterBuckets(card.counterBuckets) } : {}),
    ...(card.effectRelationIds ? { effectRelationIds: [...card.effectRelationIds] } : {}),
    ...(card.effectRelationFieldIds ? { effectRelationFieldIds: { ...card.effectRelationFieldIds } } : {}),
    ...(card.cardRelationUids ? { cardRelationUids: [...card.cardRelationUids] } : {}),
    ...(card.cardTargetUids ? { cardTargetUids: [...card.cardTargetUids] } : {}),
    ...(card.summonMaterialUids ? { summonMaterialUids: [...card.summonMaterialUids] } : {}),
    ...(card.previousCodes === undefined ? {} : { previousCodes: [...card.previousCodes] }),
    ...(card.previousSetcodes === undefined ? {} : { previousSetcodes: [...card.previousSetcodes] }),
    ...(card.assumedProperties ? { assumedProperties: { ...card.assumedProperties } } : {}),
    ...(card.uniqueOnField ? { uniqueOnField: { ...card.uniqueOnField } } : {}),
  };
}

function copyCounterBuckets(counterBuckets: NonNullable<DuelCardInstance["counterBuckets"]>): NonNullable<DuelCardInstance["counterBuckets"]> {
  return Object.fromEntries(Object.entries(counterBuckets).map(([counterType, buckets]) => [counterType, { ...buckets }]));
}

function copyCardData(data: DuelCardData): DuelCardData {
  return {
    ...data,
    ...(data.setcodes ? { setcodes: [...data.setcodes] } : {}),
    ...(data.fusionMaterials ? { fusionMaterials: [...data.fusionMaterials] } : {}),
    ...(data.fusionMaterialSetcodes ? { fusionMaterialSetcodes: [...data.fusionMaterialSetcodes] } : {}),
    ...(data.fusionRequiredMaterialPredicates ? { fusionRequiredMaterialPredicates: data.fusionRequiredMaterialPredicates.map((predicate) => ({ ...predicate })) } : {}),
    ...(data.fusionRequiredMaterialSetcodes ? { fusionRequiredMaterialSetcodes: [...data.fusionRequiredMaterialSetcodes] } : {}),
    ...(data.materialSetcodes ? { materialSetcodes: [...data.materialSetcodes] } : {}),
    ...(data.synchroMaterials ? { synchroMaterials: { tuner: data.synchroMaterials.tuner, nonTuners: [...data.synchroMaterials.nonTuners] } } : {}),
    ...(data.xyzMaterials ? { xyzMaterials: [...data.xyzMaterials] } : {}),
    ...(data.linkMaterials ? { linkMaterials: [...data.linkMaterials] } : {}),
    ...(data.ritualMaterials ? { ritualMaterials: [...data.ritualMaterials] } : {}),
    ...(data.listedNames ? { listedNames: [...data.listedNames] } : {}),
    ...(data.fitMonster ? { fitMonster: [...data.fitMonster] } : {}),
    ...(data.effectTexts ? { effectTexts: [...data.effectTexts] } : {}),
  };
}

function copyEffect(effect: DuelEffectDefinition): DuelEffectDefinition {
  return {
    ...effect,
    range: [...effect.range],
    ...(effect.reset ? { reset: { ...effect.reset } } : {}),
    ...(effect.targetRange ? { targetRange: [...effect.targetRange] } : {}),
    ...(effect.hintTiming ? { hintTiming: [...effect.hintTiming] } : {}),
    ...(effect.labelObjectUids ? { labelObjectUids: [...effect.labelObjectUids] } : {}),
  };
}

function copyChainLink(link: ChainLink): ChainLink {
  return {
    ...copyEventPayload(link),
    ...(link.targetUids ? { targetUids: [...link.targetUids] } : {}),
    ...(link.targetFieldIds ? { targetFieldIds: [...link.targetFieldIds] } : {}),
    ...(link.operationInfos ? { operationInfos: copyOperationInfos(link.operationInfos) } : {}),
    ...(link.possibleOperationInfos ? { possibleOperationInfos: copyOperationInfos(link.possibleOperationInfos) } : {}),
  };
}

function copyOperationInfos(infos: NonNullable<ChainLink["operationInfos"]>): NonNullable<ChainLink["operationInfos"]> {
  return infos.map((info) => ({
    category: typeof info.category === "number" && Number.isFinite(info.category) ? info.category : 0,
    targetUids: Array.isArray(info.targetUids) ? [...info.targetUids] : [],
    count: typeof info.count === "number" && Number.isFinite(info.count) ? info.count : 0,
    player: info.player === 1 ? 1 : 0,
    parameter: typeof info.parameter === "number" && Number.isFinite(info.parameter) ? info.parameter : 0,
  }));
}

function copyPendingTrigger(trigger: PendingTrigger): PendingTrigger {
  return copyEventPayload(trigger);
}

function copyEventRecord(event: DuelEventRecord): DuelEventRecord {
  return copyEventPayload(event);
}

function copyEventPayload<T extends ChainLink | PendingTrigger | DuelEventRecord>(payload: T): T {
  return {
    ...payload,
    ...(payload.eventUids ? { eventUids: [...payload.eventUids] } : {}),
    ...("effectLabels" in payload && payload.effectLabels !== undefined ? { effectLabels: [...payload.effectLabels] } : {}),
    ...("effectLabelObjectUids" in payload && payload.effectLabelObjectUids !== undefined ? { effectLabelObjectUids: [...payload.effectLabelObjectUids] } : {}),
    ...(payload.eventPreviousState ? { eventPreviousState: { ...payload.eventPreviousState } } : {}),
    ...(payload.eventCurrentState ? { eventCurrentState: { ...payload.eventCurrentState } } : {}),
  };
}

function copyPendingBattle(pendingBattle: NonNullable<DuelState["pendingBattle"]>): NonNullable<DuelState["pendingBattle"]> {
  return {
    ...copyBattleAttack(pendingBattle),
    ...(pendingBattle.replayPending === undefined ? {} : { replayPending: pendingBattle.replayPending }),
    ...(pendingBattle.battleDamageOverrides === undefined ? {} : { battleDamageOverrides: { ...pendingBattle.battleDamageOverrides } }),
    ...(pendingBattle.resultApplied === undefined ? {} : { resultApplied: pendingBattle.resultApplied }),
    ...(pendingBattle.deferredBattleDestroyed === undefined ? {} : { deferredBattleDestroyed: pendingBattle.deferredBattleDestroyed.map((record) => ({ ...record })) }),
  };
}

function copyBattleAttack<T extends NonNullable<DuelState["currentAttack"]>>(battle: T): T {
  return {
    ...battle,
    ...(battle.replayTargetUids === undefined ? {} : { replayTargetUids: [...battle.replayTargetUids] }),
  };
}
