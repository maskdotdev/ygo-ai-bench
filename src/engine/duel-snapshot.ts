import { copyDuelActivityCounts } from "./duel-activity.js";
import { fallbackCardReader } from "./duel-card-reader.js";
import type {
  DuelCardInstance,
  DuelCardReader,
  DuelPromptState,
  DuelSession,
  DuelState,
  PublicDuelCard,
  PublicDuelState,
  SerializedDuel,
} from "./duel-types.js";

export function queryPublicState(session: DuelSession): PublicDuelState {
  const state = session.state;
  return {
    id: state.id,
    status: state.status,
    turn: state.turn,
    turnPlayer: state.turnPlayer,
    phase: state.phase,
    ...(state.waitingFor === undefined ? {} : { waitingFor: state.waitingFor }),
    ...(state.prompt === undefined ? {} : { prompt: copyPrompt(state.prompt) }),
    players: {
      0: { ...state.players[0] },
      1: { ...state.players[1] },
    },
    cards: state.cards.map(toPublicCard).sort((a, b) => a.controller - b.controller || a.location.localeCompare(b.location) || a.sequence - b.sequence),
    chain: state.chain.map(copyChainLink),
    pendingTriggers: state.pendingTriggers.map((trigger) => ({ ...trigger })),
    activityCounts: copyDuelActivityCounts(state.activityCounts),
    attacksDeclared: [...state.attacksDeclared],
    positionsChanged: [...state.positionsChanged],
    log: state.log.map((entry) => ({ ...entry })),
  };
}

export function serializeDuel(session: DuelSession): SerializedDuel {
  return {
    version: 1,
    state: {
      ...session.state,
      players: {
        0: { ...session.state.players[0] },
        1: { ...session.state.players[1] },
      },
      cards: session.state.cards.map((card) => ({ ...card, data: { ...card.data }, overlayUids: [...card.overlayUids] })),
      effects: [],
      chain: session.state.chain.map(copyChainLink),
      chainPasses: [...session.state.chainPasses],
      pendingTriggers: session.state.pendingTriggers.map((trigger) => ({ ...trigger })),
      usedCountKeys: [...session.state.usedCountKeys],
      flagEffects: session.state.flagEffects.map((flag) => ({ ...flag })),
      activityCounts: copyDuelActivityCounts(session.state.activityCounts),
      attacksDeclared: [...session.state.attacksDeclared],
      positionsChanged: [...session.state.positionsChanged],
      ...(session.state.currentAttack === undefined ? {} : { currentAttack: { ...session.state.currentAttack } }),
      ...(session.state.prompt === undefined ? {} : { prompt: copyPrompt(session.state.prompt) }),
      log: session.state.log.map((entry) => ({ ...entry })),
    },
  };
}

export function restoreDuel(snapshot: SerializedDuel, cardReader: DuelCardReader = fallbackCardReader): DuelSession {
  if (snapshot.version !== 1) throw new Error(`Unsupported duel snapshot version ${snapshot.version}`);
  return {
    cardReader,
    state: {
      ...snapshot.state,
      players: {
        0: { ...snapshot.state.players[0] },
        1: { ...snapshot.state.players[1] },
      },
      cards: snapshot.state.cards.map((card) => ({ ...card, data: { ...card.data }, overlayUids: [...card.overlayUids] })),
      effects: [],
      chain: snapshot.state.chain.map(copyChainLink),
      chainPasses: [...snapshot.state.chainPasses],
      pendingTriggers: snapshot.state.pendingTriggers.map((trigger) => ({ ...trigger })),
      usedCountKeys: [...snapshot.state.usedCountKeys],
      flagEffects: snapshot.state.flagEffects.map((flag) => ({ ...flag })),
      activityCounts: copyDuelActivityCounts(snapshot.state.activityCounts),
      attacksDeclared: [...snapshot.state.attacksDeclared],
      positionsChanged: [...snapshot.state.positionsChanged],
      ...(snapshot.state.currentAttack === undefined ? {} : { currentAttack: { ...snapshot.state.currentAttack } }),
      ...(snapshot.state.prompt === undefined ? {} : { prompt: copyPrompt(snapshot.state.prompt) }),
      log: snapshot.state.log.map((entry) => ({ ...entry })),
    },
  };
}

function copyChainLink(link: DuelState["chain"][number]): DuelState["chain"][number] {
  return { ...link, ...(link.targetUids === undefined ? {} : { targetUids: [...link.targetUids] }) };
}

function copyPrompt(prompt: DuelPromptState): DuelPromptState {
  if (prompt.type === "selectOption") return { ...prompt, options: [...prompt.options] };
  return { ...prompt };
}

function toPublicCard(card: DuelCardInstance): PublicDuelCard {
  return {
    uid: card.uid,
    code: card.code,
    name: card.name,
    kind: card.kind,
    owner: card.owner,
    controller: card.controller,
    location: card.location,
    sequence: card.sequence,
    position: card.position,
    faceUp: card.faceUp,
    overlayCount: card.overlayUids.length,
  };
}
