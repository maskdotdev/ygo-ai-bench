import { copyDuelActivityCounts } from "#duel/activity.js";
import { copyBattleWindowState } from "#duel/battle-window-state.js";
import { continuousEffectAffectsCard } from "#duel/continuous-effects.js";
import { shouldContinueTriggerSelection } from "#duel/effect-activation.js";
import { pendingTriggerBucketsForState } from "#duel/trigger-buckets.js";
import type { DuelCardInstance, DuelPromptState, DuelState, PlayerId, PublicChainLink, PublicDuelCard, PublicDuelState, TriggerOrderPromptState } from "#duel/types.js";
import { copyLuaPromptResumeValues, isLuaOptionPromptDecision } from "#lua/host-types.js";

export function queryPublicState({ state }: { state: DuelState }): PublicDuelState {
  const windowKind = currentPublicWindowKind(state);
  const pendingTriggerBuckets = pendingTriggerBucketsForState(state);
  return {
    id: state.id,
    status: state.status,
    ...(state.winner === undefined ? {} : { winner: state.winner }),
    ...(state.winReason === undefined ? {} : { winReason: state.winReason }),
    turn: state.turn,
    turnPlayer: state.turnPlayer,
    phase: state.phase,
    ...(state.waitingFor === undefined ? {} : { waitingFor: state.waitingFor }),
    actionWindowId: state.actionWindowId,
    actionWindowToken: state.actionWindowToken,
    ...(windowKind === undefined ? {} : { windowKind }),
    ...(state.prompt === undefined ? {} : { prompt: copyPrompt(state.prompt) }),
    ...(state.luaOperationPrompt === undefined ? {} : { luaOperationPrompt: { chainLink: copyPublicChainLink(state.luaOperationPrompt.chainLink), prompt: copyLuaOperationPromptDecision(state.luaOperationPrompt.prompt) } }),
    ...triggerOrderPromptState(state, pendingTriggerBuckets),
    players: {
      0: { ...state.players[0] },
      1: { ...state.players[1] },
    },
    cards: state.cards.map((card) => toPublicCard(state, card)).sort((a, b) => a.controller - b.controller || a.location.localeCompare(b.location) || a.sequence - b.sequence),
    chain: state.chain.map(copyPublicChainLink),
    pendingTriggers: state.pendingTriggers.map(copyPendingTrigger),
    pendingTriggerBuckets,
    activityCounts: copyDuelActivityCounts(state.activityCounts),
    attacksDeclared: [...state.attacksDeclared],
    attackCanceledUids: [...state.attackCanceledUids],
    attackedTargetUids: [...state.attackedTargetUids],
    battlePairs: state.battlePairs.map((pair) => ({ ...pair })),
    attackPasses: [...state.attackPasses],
    damagePasses: [...state.damagePasses],
    ...(state.battleStep === undefined ? {} : { battleStep: state.battleStep }),
    ...(state.battleWindow === undefined ? {} : { battleWindow: copyBattleWindowState(state.battleWindow) }),
    positionsChanged: [...state.positionsChanged],
    log: state.log.map((entry) => ({ ...entry })),
  };
}

function triggerOrderPromptState(state: DuelState, buckets: PublicDuelState["pendingTriggerBuckets"]): { triggerOrderPrompt: TriggerOrderPromptState } | Record<string, never> {
  if (state.prompt || !shouldContinueTriggerSelection(state)) return {};
  const activeBucket = buckets[0];
  if (!activeBucket || activeBucket.triggerIds.length < 2) return {};
  return {
    triggerOrderPrompt: {
      id: `${state.actionWindowId}:${activeBucket.triggerBucket}:${activeBucket.player}`,
      type: "orderTriggers",
      player: activeBucket.player,
      triggerBucket: activeBucket.triggerBucket,
      triggerIds: [...activeBucket.triggerIds],
    },
  };
}

function currentPublicWindowKind(state: DuelState): PublicDuelState["windowKind"] {
  if (state.status !== "awaiting" || state.waitingFor === undefined) return undefined;
  if (state.prompt) return "prompt";
  if (shouldContinueTriggerSelection(state)) return "triggerBucket";
  if (state.chain.length) return "chainResponse";
  if (state.pendingBattle) return "battle";
  return "open";
}

function copyPublicChainLink(link: DuelState["chain"][number]): PublicChainLink {
  const { operationOverride: _operationOverride, ...publicLink } = link;
  return {
    ...publicLink,
    ...(link.targetUids === undefined ? {} : { targetUids: [...link.targetUids] }),
    ...(link.targetFieldIds === undefined ? {} : { targetFieldIds: [...link.targetFieldIds] }),
    ...(link.operationInfos === undefined ? {} : { operationInfos: copyOperationInfos(link.operationInfos) }),
    ...(link.possibleOperationInfos === undefined ? {} : { possibleOperationInfos: copyOperationInfos(link.possibleOperationInfos) }),
    ...(link.eventUids === undefined ? {} : { eventUids: [...link.eventUids] }),
    ...(link.eventPreviousState === undefined ? {} : { eventPreviousState: { ...link.eventPreviousState } }),
    ...(link.eventCurrentState === undefined ? {} : { eventCurrentState: { ...link.eventCurrentState } }),
    ...(link.effectLabels === undefined ? {} : { effectLabels: [...link.effectLabels] }),
    ...(link.effectLabelObjectUids === undefined ? {} : { effectLabelObjectUids: [...link.effectLabelObjectUids] }),
  };
}

function copyOperationInfos(infos: NonNullable<DuelState["chain"][number]["operationInfos"]>): NonNullable<DuelState["chain"][number]["operationInfos"]> {
  return infos.map((info) => ({
    category: typeof info.category === "number" && Number.isFinite(info.category) ? info.category : 0,
    targetUids: Array.isArray(info.targetUids) ? [...info.targetUids] : [],
    count: typeof info.count === "number" && Number.isFinite(info.count) ? info.count : 0,
    player: info.player === 1 ? 1 : 0,
    parameter: typeof info.parameter === "number" && Number.isFinite(info.parameter) ? info.parameter : 0,
  }));
}

function copyPendingTrigger(trigger: DuelState["pendingTriggers"][number]): DuelState["pendingTriggers"][number] {
  return {
    ...trigger,
    ...(trigger.eventUids === undefined ? {} : { eventUids: [...trigger.eventUids] }),
    ...(trigger.eventPreviousState === undefined ? {} : { eventPreviousState: { ...trigger.eventPreviousState } }),
    ...(trigger.eventCurrentState === undefined ? {} : { eventCurrentState: { ...trigger.eventCurrentState } }),
    ...(trigger.effectLabelObjectUids === undefined ? {} : { effectLabelObjectUids: [...trigger.effectLabelObjectUids] }),
  };
}

function copyPrompt(prompt: DuelPromptState): DuelPromptState {
  if (prompt.type === "selectOption") return { ...prompt, options: [...prompt.options], ...(prompt.descriptions === undefined ? {} : { descriptions: [...prompt.descriptions] }), ...(prompt.descriptionLists === undefined ? {} : { descriptionLists: prompt.descriptionLists.map((descriptions) => [...descriptions]) }) };
  return { ...prompt };
}

function copyLuaOperationPromptDecision(prompt: NonNullable<DuelState["luaOperationPrompt"]>["prompt"]): NonNullable<DuelState["luaOperationPrompt"]>["prompt"] {
  if (isLuaOptionPromptDecision(prompt)) return { ...prompt, options: [...prompt.options], descriptions: [...prompt.descriptions], ...(prompt.descriptionLists === undefined ? {} : { descriptionLists: prompt.descriptionLists.map((descriptions) => [...descriptions]) }), ...(prompt.returnValues === undefined ? {} : { returnValues: prompt.returnValues.map(copyLuaPromptResumeValues) }), ...(prompt.revealedUids === undefined ? {} : { revealedUids: [...prompt.revealedUids] }) };
  return { ...prompt, ...(prompt.revealedUids === undefined ? {} : { revealedUids: [...prompt.revealedUids] }) };
}

function toPublicCard(state: DuelState, card: DuelCardInstance): PublicDuelCard {
  const revealedToPlayers = publicVisibilityPlayers(state, card);
  return {
    uid: card.uid,
    code: card.code,
    name: card.name,
    ...(card.data.description === undefined ? {} : { description: card.data.description }),
    ...(card.data.effectTexts === undefined ? {} : { effectTexts: [...card.data.effectTexts] }),
    kind: card.kind,
    ...(card.data.typeFlags === undefined ? {} : { typeFlags: card.data.typeFlags }),
    owner: card.owner,
    controller: card.controller,
    location: card.location,
    sequence: card.sequence,
    position: card.position,
    faceUp: card.faceUp,
    overlayCount: card.overlayUids.length,
    ...(card.counters ? { counters: { ...card.counters } } : {}),
    ...(revealedToPlayers.length ? { revealedToPlayers } : {}),
  };
}

function publicVisibilityPlayers(state: DuelState, card: DuelCardInstance): PlayerId[] {
  if (card.location !== "hand") return [];
  for (const effect of state.effects) {
    if (effect.event !== "continuous" || effect.code !== 160) continue;
    const source = state.cards.find((candidate) => candidate.uid === effect.sourceUid);
    if (!source || !continuousEffectAffectsCard(effect, source, card)) continue;
    return [0, 1];
  }
  return [];
}
