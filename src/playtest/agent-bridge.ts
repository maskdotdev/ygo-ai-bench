import { applyAction, chooseHighestPriority, evaluatePlaytest, getLegalActions, runPlaytest, snapshot, startPlaytest, type PlaytestSession, type StartPlaytestOptions } from "#playtest/api.js";
import { parseYdk } from "#playtest/ydk.js";
import type { PlaytestAction } from "#engine/types.js";

export interface SerializedDeckStateLike {
  deck?: {
    main?: Record<string, number>;
    extra?: Record<string, number>;
    side?: Record<string, number>;
  };
}

export interface AgentStartOptions {
  deck?: string[] | Record<string, number> | SerializedDeckStateLike;
  extraDeck?: string[] | Record<string, number>;
  ydk?: string;
  seed?: string | number;
  handSize?: number;
}

export interface PlaytestAgent {
  status(): { version: number; sessions: number; activeSessionId: string | null };
  start(options: AgentStartOptions): ReturnType<typeof snapshot>;
  state(sessionId?: string): ReturnType<typeof snapshot>;
  legalActions(sessionId?: string): PlaytestAction[];
  action(action: PlaytestAction, sessionId?: string): ReturnType<typeof applyAction>;
  autoRun(options?: { sessionId?: string; maxActions?: number }): ReturnType<typeof snapshot>;
  evaluate(sessionId?: string): ReturnType<typeof evaluatePlaytest>;
  clear(sessionId?: string): { ok: boolean; sessions: number; activeSessionId: string | null };
}

export function createPlaytestAgent(defaultDeck?: SerializedDeckStateLike): PlaytestAgent {
  const sessions = new Map<string, PlaytestSession>();
  let activeSessionId: string | null = null;

  const getSession = (sessionId = activeSessionId): PlaytestSession => {
    if (!sessionId) throw new Error("No active playtest session");
    const session = sessions.get(sessionId);
    if (!session) throw new Error(`Unknown playtest session ${sessionId}`);
    return session;
  };

  const remember = (session: PlaytestSession) => {
    const id = session.engine.state.id;
    sessions.set(id, session);
    activeSessionId = id;
    return snapshot(session);
  };

  return {
    status() {
      return { version: 1, sessions: sessions.size, activeSessionId };
    },
    start(options) {
      return remember(startPlaytest(toStartOptions(options, defaultDeck)));
    },
    state(sessionId) {
      return snapshot(getSession(sessionId));
    },
    legalActions(sessionId) {
      return getLegalActions(getSession(sessionId));
    },
    action(action, sessionId) {
      return applyAction(getSession(sessionId), action);
    },
    autoRun(options = {}) {
      return runPlaytest(getSession(options.sessionId), chooseHighestPriority, options.maxActions ?? 20);
    },
    evaluate(sessionId) {
      return evaluatePlaytest(getSession(sessionId));
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

export function toStartOptions(options: AgentStartOptions, defaultDeck?: SerializedDeckStateLike): StartPlaytestOptions {
  if (options.ydk) {
    const parsed = parseYdk(options.ydk);
    return withRunOptions({ deck: parsed.main, extraDeck: parsed.extra }, options);
  }

  const source = options.deck ?? defaultDeck;
  if (!source) throw new Error("A deck, serialized deck state, or YDK text is required");

  if (Array.isArray(source)) {
    return withRunOptions({ deck: source, extraDeck: expandZone(options.extraDeck) }, options);
  }

  if (isSerializedDeck(source)) {
    return withRunOptions({
      deck: expandZone(source.deck?.main),
      extraDeck: expandZone(source.deck?.extra),
    }, options);
  }

  return withRunOptions({
    deck: expandZone(source),
    extraDeck: expandZone(options.extraDeck),
  }, options);
}

function withRunOptions(base: { deck: string[]; extraDeck?: string[] }, options: AgentStartOptions): StartPlaytestOptions {
  return {
    deck: base.deck,
    extraDeck: base.extraDeck ?? [],
    ...(options.seed === undefined ? {} : { seed: options.seed }),
    ...(options.handSize === undefined ? {} : { handSize: options.handSize }),
  };
}

function expandZone(zone: string[] | Record<string, number> | undefined): string[] {
  if (!zone) return [];
  if (Array.isArray(zone)) return zone.map(String);
  return Object.entries(zone).flatMap(([id, count]) => Array.from({ length: Math.max(0, Number(count) || 0) }, () => String(id)));
}

function isSerializedDeck(value: unknown): value is SerializedDeckStateLike {
  return Boolean(value && typeof value === "object" && "deck" in value);
}
