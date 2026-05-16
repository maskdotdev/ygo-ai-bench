import {
  applyResponse,
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions,
  loadDecks,
  queryPublicState,
  restoreDuel,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import type { DuelAction, DuelSession, PlayerId, SerializedDuel } from "#duel/types.js";
import { parseYdk } from "#playtest/ydk.js";
import { getBrowserDuelCardReader } from "../playtest-app/duel-pvp-card-reader.js";
import { duelBattlefieldActionView, visibleDuelBattlefieldActions } from "../playtest-app/duel-battlefield-actions.js";
import { duelActionUiGroupLabel, type DuelActionUiGroup } from "../playtest-app/duel-action-anchors.js";
import { runDuelBattlefieldScript, type DuelBattlefieldActionSelector } from "../playtest-app/duel-battlefield-script.js";
import { duelPromptView, type DuelPromptView } from "../playtest-app/duel-prompt-view.js";

export interface DuelPvpAgentStartOptions {
  player0Ydk: string;
  player1Ydk: string;
  seed?: string | number;
  handSize?: number;
}

export interface DuelPvpVisibleAutoRunOptions {
  sessionId?: string;
  player?: PlayerId;
  maxActions?: number;
}

export interface DuelPvpVisibleView {
  player: PlayerId;
  actions: DuelAction[];
  groups: DuelActionUiGroup[];
  prompt?: DuelPromptView;
}

export interface DuelPvpVisibleAutoRunStep {
  index: number;
  player: PlayerId;
  action: DuelAction;
}

export interface DuelPvpVisibleAutoRunResult {
  ok: boolean;
  reason: "maxActions" | "noVisibleActions" | "rejected" | "finished";
  state: ReturnType<typeof queryPublicState>;
  steps: DuelPvpVisibleAutoRunStep[];
  failure?: string;
  visibleActions: DuelAction[];
  visibleGroups: DuelActionUiGroup[];
  prompt?: DuelPromptView;
}

export interface DuelPvpAgent {
  status(): { version: number; sessions: number; activeSessionId: string | null };
  start(options: DuelPvpAgentStartOptions): ReturnType<typeof duelSnapshot>;
  state(sessionId?: string): ReturnType<typeof duelSnapshot>;
  serialize(sessionId?: string): SerializedDuel;
  restore(snapshot: unknown): ReturnType<typeof duelSnapshot>;
  legalActions(player?: PlayerId, sessionId?: string): DuelAction[];
  visibleBattlefield(player?: PlayerId, sessionId?: string): DuelPvpVisibleView;
  action(action: unknown, sessionId?: string): ReturnType<typeof applyResponse>;
  autoRunVisible(options?: DuelPvpVisibleAutoRunOptions): DuelPvpVisibleAutoRunResult;
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
    serialize(sessionId) {
      return serializeDuel(getSession(sessionId));
    },
    restore(snapshot) {
      return remember(restoreDuel(snapshot, getBrowserDuelCardReader()));
    },
    legalActions(player, sessionId) {
      const session = getSession(sessionId);
      return getLegalActions(session, player ?? queryPublicState(session).waitingFor ?? 0).map(copyDuelAction);
    },
    visibleBattlefield(player, sessionId) {
      const session = getSession(sessionId);
      return visibleBattlefieldView(session, player ?? queryPublicState(session).waitingFor ?? 0);
    },
    action(action, sessionId) {
      return applyResponse(getSession(sessionId), action);
    },
    autoRunVisible(options = {}) {
      return autoRunVisibleBattlefield(getSession(options.sessionId), options);
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
  const groups = view.orphanGroups.map(copyUiGroup);
  const prompt = duelPromptView(state.prompt, groups);
  return {
    player,
    actions: visibleDuelBattlefieldActions(view).map(copyDuelAction),
    groups,
    ...(prompt === undefined ? {} : { prompt: copyPromptView(prompt) }),
  };
}

function autoRunVisibleBattlefield(
  session: DuelSession,
  options: DuelPvpVisibleAutoRunOptions,
): DuelPvpVisibleAutoRunResult {
  const maxActions = Math.max(0, Math.floor(options.maxActions ?? 20));
  const steps: DuelPvpVisibleAutoRunStep[] = [];
  for (let index = 0; index < maxActions; index += 1) {
    const state = queryPublicState(session);
    if (state.status !== "awaiting") return visibleAutoRunResult(session, options.player ?? state.waitingFor ?? 0, steps, "finished");
    const player = options.player ?? state.waitingFor ?? 0;
    const view = visibleBattlefieldView(session, player);
    const action = view.actions[0];
    if (!action) return visibleAutoRunResult(session, player, steps, "noVisibleActions");
    const result = applyResponse(session, action);
    steps.push({ index, player, action: copyDuelAction(action) });
    if (!result.ok) return visibleAutoRunResult(session, player, steps, "rejected", result.error);
  }
  const state = queryPublicState(session);
  return visibleAutoRunResult(session, options.player ?? state.waitingFor ?? 0, steps, "maxActions");
}

function visibleAutoRunResult(
  session: DuelSession,
  player: PlayerId,
  steps: DuelPvpVisibleAutoRunStep[],
  reason: DuelPvpVisibleAutoRunResult["reason"],
  failure?: string,
): DuelPvpVisibleAutoRunResult {
  const view = visibleBattlefieldView(session, player);
  return {
    ok: reason !== "rejected",
    reason,
    state: queryPublicState(session),
    steps: steps.map((step) => ({ ...step, action: copyDuelAction(step.action) })),
    ...(failure === undefined ? {} : { failure }),
    visibleActions: view.actions,
    visibleGroups: view.groups,
    ...(view.prompt === undefined ? {} : { prompt: copyPromptView(view.prompt) }),
  };
}

function copyUiGroup(group: DuelActionUiGroup): DuelActionUiGroup {
  return {
    ...group,
    label: duelActionUiGroupLabel(group),
    actions: group.actions.map(copyDuelAction),
  };
}

function copyPromptView(prompt: DuelPromptView): DuelPromptView {
  return {
    ...prompt,
    groups: prompt.groups.map(copyUiGroup),
  };
}

function copyDuelAction(action: DuelAction): DuelAction {
  return { ...action };
}
