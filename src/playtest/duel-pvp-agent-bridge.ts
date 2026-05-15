import {
  applyResponse,
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions,
  loadDecks,
  queryPublicState,
  startDuel,
} from "#duel/core.js";
import type { DuelAction, DuelSession, PlayerId } from "#duel/types.js";
import { parseYdk } from "#playtest/ydk.js";
import { getBrowserDuelCardReader } from "../playtest-app/duel-pvp-card-reader.js";
import { duelBattlefieldActionView, visibleDuelBattlefieldActions } from "../playtest-app/duel-battlefield-actions.js";
import { duelActionUiGroupLabel, type DuelActionUiGroup } from "../playtest-app/duel-action-anchors.js";
import { runDuelBattlefieldScript, type DuelBattlefieldActionSelector } from "../playtest-app/duel-battlefield-script.js";

export interface DuelPvpAgentStartOptions {
  player0Ydk: string;
  player1Ydk: string;
  seed?: string | number;
  handSize?: number;
}

export interface DuelPvpVisibleView {
  player: PlayerId;
  actions: DuelAction[];
  groups: DuelActionUiGroup[];
}

export interface DuelPvpAgent {
  status(): { version: number; sessions: number; activeSessionId: string | null };
  start(options: DuelPvpAgentStartOptions): ReturnType<typeof duelSnapshot>;
  state(sessionId?: string): ReturnType<typeof duelSnapshot>;
  legalActions(player?: PlayerId, sessionId?: string): DuelAction[];
  visibleBattlefield(player?: PlayerId, sessionId?: string): DuelPvpVisibleView;
  action(action: unknown, sessionId?: string): ReturnType<typeof applyResponse>;
  runVisibleScript(steps: DuelBattlefieldActionSelector[], sessionId?: string): ReturnType<typeof runDuelBattlefieldScript>;
  clear(sessionId?: string): { ok: boolean; sessions: number; activeSessionId: string | null };
}

export function createDuelPvpAgent(): DuelPvpAgent {
  const sessions = new Map<string, DuelSession>();
  let activeSessionId: string | null = null;

  const getSession = (sessionId = activeSessionId): DuelSession => {
    if (!sessionId) throw new Error("No active duel session");
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`Unknown duel session ${sessionId}`);
    return session;
  };

  const remember = (session: DuelSession) => {
    const id = session.state.id;
    sessions.set(id, session);
    activeSessionId = id;
    return duelSnapshot(session);
  };

  return {
    status() {
      return { version: 1, sessions: sessions.size, activeSessionId };
    },
    start(options) {
      return remember(startAgentDuel(options));
    },
    state(sessionId) {
      return duelSnapshot(getSession(sessionId));
    },
    legalActions(player, sessionId) {
      const session = getSession(sessionId);
      return getLegalActions(session, player ?? queryPublicState(session).waitingFor ?? 0).map(copyDuelAction);
    },
    visibleBattlefield(player, sessionId) {
      return visibleBattlefieldView(getSession(sessionId), player ?? 0);
    },
    action(action, sessionId) {
      return applyResponse(getSession(sessionId), action);
    },
    runVisibleScript(steps, sessionId) {
      return runDuelBattlefieldScript(getSession(sessionId), steps);
    },
    clear(sessionId) {
      if (sessionId) {
        sessions.delete(sessionId);
        if (activeSessionId === sessionId) activeSessionId = sessions.keys().next().value ?? null;
      } else {
        sessions.clear();
        activeSessionId = null;
      }
      return { ok: true, sessions: sessions.size, activeSessionId };
    },
  };
}

function startAgentDuel(options: DuelPvpAgentStartOptions): DuelSession {
  const player0 = parseYdk(options.player0Ydk);
  const player1 = parseYdk(options.player1Ydk);
  const session = createDuel({
    seed: options.seed ?? Date.now(),
    startingHandSize: options.handSize ?? 5,
    cardReader: getBrowserDuelCardReader(),
  });
  loadDecks(session, {
    0: { main: player0.main, extra: player0.extra },
    1: { main: player1.main, extra: player1.extra },
  });
  startDuel(session);
  return session;
}

function duelSnapshot(session: DuelSession) {
  const state = queryPublicState(session);
  const player = state.waitingFor ?? 0;
  const legalActions = getLegalActions(session, player).map(copyDuelAction);
  return {
    ok: true,
    sessionId: state.id,
    state,
    legalActions,
    legalActionGroups: getGroupedDuelLegalActions(session, player).map(copyUiGroup),
    visibleBattlefield: visibleBattlefieldView(session, player),
  };
}

function visibleBattlefieldView(session: DuelSession, player: PlayerId): DuelPvpVisibleView {
  const state = queryPublicState(session);
  const view = duelBattlefieldActionView(
    state,
    player,
    getLegalActions(session, player),
    getGroupedDuelLegalActions(session, player),
  );
  return {
    player,
    actions: visibleDuelBattlefieldActions(view).map(copyDuelAction),
    groups: view.orphanGroups.map(copyUiGroup),
  };
}

function copyUiGroup(group: DuelActionUiGroup): DuelActionUiGroup {
  return {
    ...group,
    label: duelActionUiGroupLabel(group),
    actions: group.actions.map(copyDuelAction),
  };
}

function copyDuelAction(action: DuelAction): DuelAction {
  return { ...action };
}
