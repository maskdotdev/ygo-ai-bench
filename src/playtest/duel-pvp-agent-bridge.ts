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
import { copyDuelAction } from "#duel/action-copy.js";
import type { LuaScriptHost, LuaScriptSource } from "#lua/host.js";
import type { LuaPromptResumeValue } from "#lua/host-types.js";
import type { LuaSnapshotRestoreResult } from "#lua/snapshot.js";
import type { ApplyDuelResponseResult, DuelAction, DuelCardReader, DuelPromptState, DuelResponse, DuelSession, PlayerId, SerializedDuel } from "#duel/types.js";
import { parseYdk } from "#playtest/ydk.js";
import { getBrowserDuelCardReader } from "../playtest-app/duel-pvp-card-reader.js";
import { duelBattlefieldActionView, visibleDuelBattlefieldActions } from "../playtest-app/duel-battlefield-actions.js";
import { copyDuelLegalActionGroup, duelActionUiGroupLabel, type DuelActionUiGroup } from "../playtest-app/duel-action-anchors.js";
import { runDuelBattlefieldScript, type DuelBattlefieldActionSelector, type DuelBattlefieldScriptRuntime } from "../playtest-app/duel-battlefield-script.js";
import { duelPromptView, type DuelPromptView } from "../playtest-app/duel-prompt-view.js";
import { copyDuelTriggerOrderView, duelTriggerOrderView, type DuelTriggerOrderView } from "../playtest-app/duel-trigger-order-view.js";

export interface DuelPvpAgentStartOptions {
  player0Ydk: string;
  player1Ydk: string;
  seed?: string | number;
  handSize?: number;
}

export interface DuelPvpAgentOptions {
  cardReader?: DuelCardReader;
  luaScriptSource?: LuaScriptSource;
  luaRuntime?: DuelPvpAgentLuaRuntime;
}

export interface DuelPvpAgentLuaRuntime {
  createLuaScriptHost(session: DuelSession, source: LuaScriptSource): LuaScriptHost;
  restoreDuelWithLuaScripts(snapshot: SerializedDuel, source: LuaScriptSource, cardReader: DuelCardReader): LuaSnapshotRestoreResult;
  getLuaRestoreLegalActions(restored: LuaSnapshotRestoreResult, player: PlayerId): DuelAction[];
  getLuaRestoreLegalActionGroups(restored: LuaSnapshotRestoreResult, player: PlayerId): ReturnType<typeof getGroupedDuelLegalActions>;
  applyLuaRestoreResponse(restored: LuaSnapshotRestoreResult, response: DuelResponse): ApplyDuelResponseResult;
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
  triggerOrder?: DuelTriggerOrderView;
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
  triggerOrder?: DuelTriggerOrderView;
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

interface DuelPvpSessionRecord {
  session: DuelSession;
  luaRestore?: {
    restore: LuaSnapshotRestoreResult;
    runtime: DuelPvpAgentLuaRuntime;
  };
}

export function createDuelPvpAgent(agentOptions: DuelPvpAgentOptions = {}): DuelPvpAgent {
  const sessions = new Map<string, DuelPvpSessionRecord>();
  let activeSessionId: string | null = null;
  const cardReader = agentOptions.cardReader ?? getBrowserDuelCardReader();

  const getRecord = (sessionId = activeSessionId): DuelPvpSessionRecord => {
    if (!sessionId) throw new Error("No active duel session");
    const record = sessions.get(sessionId);
    if (!record) throw new Error(`Unknown duel session ${sessionId}`);
    return record;
  };

  const getSession = (sessionId = activeSessionId): DuelSession => getRecord(sessionId).session;

  const remember = (record: DuelPvpSessionRecord) => {
    const id = record.session.state.id;
    sessions.set(id, record);
    activeSessionId = id;
    return duelSnapshot(record);
  };

  return {
    status() {
      return { version: 1, sessions: sessions.size, activeSessionId };
    },
    start(options) {
      return remember(startAgentDuel(options, cardReader, agentOptions.luaScriptSource, agentOptions.luaRuntime));
    },
    state(sessionId) {
      return duelSnapshot(getRecord(sessionId));
    },
    serialize(sessionId) {
      return serializeDuel(getSession(sessionId));
    },
    restore(snapshot) {
      return remember(restoreAgentDuel(snapshot, cardReader, agentOptions.luaScriptSource, agentOptions.luaRuntime));
    },
    legalActions(player, sessionId) {
      const record = getRecord(sessionId);
      return recordLegalActions(record, player ?? queryPublicState(record.session).waitingFor ?? 0).map(copyDuelAction);
    },
    visibleBattlefield(player, sessionId) {
      const record = getRecord(sessionId);
      return visibleBattlefieldView(record, player ?? queryPublicState(record.session).waitingFor ?? 0);
    },
    action(action, sessionId) {
      return copyApplyResponseResult(applyAgentResponse(getRecord(sessionId), action));
    },
    autoRunVisible(options = {}) {
      return autoRunVisibleBattlefield(getRecord(options.sessionId), options);
    },
    runVisibleScript(steps, sessionId) {
      const record = getRecord(sessionId);
      return runDuelBattlefieldScript(record.session, steps, pvpAgentBattlefieldScriptRuntime(record));
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

function startAgentDuel(
  options: DuelPvpAgentStartOptions,
  cardReader: DuelCardReader,
  luaScriptSource: LuaScriptSource | undefined,
  luaRuntime: DuelPvpAgentLuaRuntime | undefined,
): DuelPvpSessionRecord {
  const player0 = parseYdk(options.player0Ydk);
  const player1 = parseYdk(options.player1Ydk);
  const session = createDuel({
    seed: options.seed ?? Date.now(),
    startingHandSize: options.handSize ?? 5,
    cardReader,
  });
  loadDecks(session, {
    0: { main: player0.main, extra: player0.extra },
    1: { main: player1.main, extra: player1.extra },
  });
  startDuel(session);
  if (luaScriptSource && luaRuntime) registerAgentLuaScripts(session, [...player0.main, ...player0.extra, ...player1.main, ...player1.extra], luaScriptSource, luaRuntime);
  return { session };
}

function restoreAgentDuel(
  snapshot: unknown,
  cardReader: DuelCardReader,
  luaScriptSource: LuaScriptSource | undefined,
  luaRuntime: DuelPvpAgentLuaRuntime | undefined,
): DuelPvpSessionRecord {
  if (!luaScriptSource || !luaRuntime) return { session: restoreDuel(snapshot, cardReader) };
  const restored = luaRuntime.restoreDuelWithLuaScripts(snapshot as SerializedDuel, luaScriptSource, cardReader);
  return { session: restored.session, luaRestore: { restore: restored, runtime: luaRuntime } };
}

function registerAgentLuaScripts(session: DuelSession, codes: readonly string[], source: LuaScriptSource, luaRuntime: DuelPvpAgentLuaRuntime): void {
  const host = luaRuntime.createLuaScriptHost(session, source);
  for (const code of [...new Set(codes.map(String).filter(Boolean))].sort()) host.loadCardScript(code, source);
  host.registerInitialEffectsDetailed();
  host.runStartupEffects();
}

function applyAgentResponse(record: DuelPvpSessionRecord, action: unknown): ApplyDuelResponseResult {
  if (record.luaRestore?.runtime) return record.luaRestore.runtime.applyLuaRestoreResponse(record.luaRestore.restore, action as DuelResponse);
  return applyResponse(record.session, action);
}

function recordLegalActions(record: DuelPvpSessionRecord, player: PlayerId): DuelAction[] {
  if (record.luaRestore?.runtime) return record.luaRestore.runtime.getLuaRestoreLegalActions(record.luaRestore.restore, player);
  return getLegalActions(record.session, player);
}

function recordLegalActionGroups(record: DuelPvpSessionRecord, player: PlayerId) {
  if (record.luaRestore?.runtime) return record.luaRestore.runtime.getLuaRestoreLegalActionGroups(record.luaRestore.restore, player);
  return getGroupedDuelLegalActions(record.session, player);
}

function pvpAgentBattlefieldScriptRuntime(record: DuelPvpSessionRecord): DuelBattlefieldScriptRuntime {
  return {
    getLegalActions(_session, player) {
      return recordLegalActions(record, player);
    },
    getGroupedLegalActions(_session, player) {
      return recordLegalActionGroups(record, player);
    },
    applyResponse(_session, action) {
      return applyAgentResponse(record, action);
    },
  };
}

function duelSnapshot(record: DuelPvpSessionRecord) {
  const session = record.session;
  const state = queryPublicState(session);
  const player = state.waitingFor ?? 0;
  const legalActions = recordLegalActions(record, player).map(copyDuelAction);
  return {
    ok: true,
    sessionId: state.id,
    state,
    legalActions,
    legalActionGroups: recordLegalActionGroups(record, player).map(copyUiGroup),
    visibleBattlefield: visibleBattlefieldView(record, player),
  };
}

function visibleBattlefieldView(record: DuelPvpSessionRecord, player: PlayerId): DuelPvpVisibleView {
  const session = record.session;
  const state = queryPublicState(session);
  const legalActions = recordLegalActions(record, player);
  const legalGroups = recordLegalActionGroups(record, player);
  const view = duelBattlefieldActionView(
    state,
    player,
    legalActions,
    legalGroups,
  );
  const groups = view.orphanGroups.map(copyUiGroup);
  const prompt = duelPromptView(state.prompt, groups, state.luaOperationPrompt);
  const triggerOrder = duelTriggerOrderView(state.triggerOrderPrompt, legalGroups);
  return {
    player,
    actions: visibleDuelBattlefieldActions(view).map(copyDuelAction),
    groups,
    ...(prompt === undefined ? {} : { prompt: copyPromptView(prompt) }),
    ...(triggerOrder === undefined ? {} : { triggerOrder: copyDuelTriggerOrderView(triggerOrder) }),
  };
}

function autoRunVisibleBattlefield(
  record: DuelPvpSessionRecord,
  options: DuelPvpVisibleAutoRunOptions,
): DuelPvpVisibleAutoRunResult {
  const session = record.session;
  const maxActions = Math.max(0, Math.floor(options.maxActions ?? 20));
  const steps: DuelPvpVisibleAutoRunStep[] = [];
  for (let index = 0; index < maxActions; index += 1) {
    const state = queryPublicState(session);
    if (state.status !== "awaiting") return visibleAutoRunResult(record, options.player ?? state.waitingFor ?? 0, steps, "finished");
    const player = options.player ?? state.waitingFor ?? 0;
    const view = visibleBattlefieldView(record, player);
    const action = view.actions[0];
    if (!action) return visibleAutoRunResult(record, player, steps, "noVisibleActions");
    const result = applyAgentResponse(record, action);
    steps.push({ index, player, action: copyDuelAction(action) });
    if (!result.ok) return visibleAutoRunResult(record, player, steps, "rejected", result.error);
  }
  const state = queryPublicState(session);
  return visibleAutoRunResult(record, options.player ?? state.waitingFor ?? 0, steps, "maxActions");
}

function visibleAutoRunResult(
  record: DuelPvpSessionRecord,
  player: PlayerId,
  steps: DuelPvpVisibleAutoRunStep[],
  reason: DuelPvpVisibleAutoRunResult["reason"],
  failure?: string,
): DuelPvpVisibleAutoRunResult {
  const session = record.session;
  const view = visibleBattlefieldView(record, player);
  return {
    ok: reason !== "rejected",
    reason,
    state: queryPublicState(session),
    steps: steps.map((step) => ({ ...step, action: copyDuelAction(step.action) })),
    ...(failure === undefined ? {} : { failure }),
    visibleActions: view.actions,
    visibleGroups: view.groups,
    ...(view.prompt === undefined ? {} : { prompt: copyPromptView(view.prompt) }),
    ...(view.triggerOrder === undefined ? {} : { triggerOrder: copyDuelTriggerOrderView(view.triggerOrder) }),
  };
}

function copyApplyResponseResult(result: ApplyDuelResponseResult): ApplyDuelResponseResult {
  return {
    ...result,
    legalActions: result.legalActions.map(copyDuelAction),
    legalActionGroups: result.legalActionGroups.map(copyDuelLegalActionGroup),
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
    prompt: copyPromptState(prompt.prompt),
    ...(prompt.luaPrompt === undefined ? {} : { luaPrompt: copyLuaPrompt(prompt.luaPrompt) }),
    choices: prompt.choices.map(copyPromptChoice),
    groups: prompt.groups.map(copyUiGroup),
  };
}

function copyPromptChoice(choice: DuelPromptView["choices"][number]): DuelPromptView["choices"][number] {
  if (choice.type === "selectOption") {
    return {
      ...choice,
      action: copyDuelAction(choice.action) as typeof choice.action,
      ...(choice.descriptionList === undefined ? {} : { descriptionList: [...choice.descriptionList] }),
      ...(choice.luaReturnValues === undefined ? {} : { luaReturnValues: choice.luaReturnValues.map(copyLuaPromptResumeValue) }),
    };
  }
  return { ...choice, action: copyDuelAction(choice.action) as typeof choice.action };
}

function copyPromptState(prompt: DuelPromptState): DuelPromptState {
  if (prompt.type === "selectOption") {
    return {
      ...prompt,
      options: [...prompt.options],
      ...(prompt.descriptions === undefined ? {} : { descriptions: [...prompt.descriptions] }),
      ...(prompt.descriptionLists === undefined ? {} : { descriptionLists: prompt.descriptionLists.map((descriptions) => [...descriptions]) }),
    };
  }
  return { ...prompt };
}

function copyLuaPrompt(prompt: NonNullable<DuelPromptView["luaPrompt"]>): NonNullable<DuelPromptView["luaPrompt"]> {
  if ("options" in prompt) {
    return {
      ...prompt,
      options: [...prompt.options],
      descriptions: [...prompt.descriptions],
      ...(prompt.descriptionLists === undefined ? {} : { descriptionLists: prompt.descriptionLists.map((descriptions) => [...descriptions]) }),
      ...(prompt.returnValues === undefined ? {} : { returnValues: prompt.returnValues.map((values) => values.map(copyLuaPromptResumeValue)) }),
    };
  }
  return { ...prompt };
}

function copyLuaPromptResumeValue(value: LuaPromptResumeValue): LuaPromptResumeValue {
  return typeof value === "object" ? { ...value } : value;
}
