import { cardRegistry } from "#cards/definitions.js";
import { buildDarkMagicianEffects } from "#cards/dark-magician-scripts.js";
import { applyAction as engineApplyAction, getLegalActions as engineGetLegalActions, publicState, startSession, type EngineSession } from "#engine/core.js";
import type { ApplyResult, PlaytestAction, PlaytestLegalActionGroup, PublicGameState } from "#engine/types.js";

export interface StartPlaytestOptions {
  deck: string[];
  extraDeck?: string[];
  seed?: string | number;
  handSize?: number;
}

export interface PlaytestSession {
  engine: EngineSession;
}

export interface PlaytestEvaluation {
  quality: "strong" | "playable" | "thin" | "weak";
  score: number;
  endBoard: string[];
  followUp: string[];
  risks: string[];
}

export interface PlaytestSnapshot {
  ok: boolean;
  sessionId: string;
  state: PublicGameState;
  legalActions: PlaytestAction[];
  legalActionGroups: PlaytestLegalActionGroup[];
  evaluation: PlaytestEvaluation;
}

export type ChooseAction = (input: {
  state: PublicGameState;
  legalActions: PlaytestAction[];
  evaluation: PlaytestEvaluation;
}) => PlaytestAction | undefined;

export interface PlaytestActionSelector {
  type: PlaytestAction["type"];
  uid?: string;
  id?: string;
  effectId?: string;
  labelIncludes?: string;
  occurrence?: number;
}

export interface ScriptedPlaytestResult extends PlaytestSnapshot {
  failedStep?: number;
  failure?: string;
  divergenceGroupKey?: string;
  divergenceGroupLabel?: string;
  divergenceActions?: PlaytestAction[];
}

export function startPlaytest(options: StartPlaytestOptions): PlaytestSession {
  const startOptions = {
    deck: options.deck,
    extraDeck: options.extraDeck ?? [],
    handSize: options.handSize ?? 5,
    cards: cardRegistry,
    effects: buildDarkMagicianEffects(),
    ...(options.seed === undefined ? {} : { seed: options.seed }),
  };
  return {
    engine: startSession(startOptions),
  };
}

export function snapshot(session: PlaytestSession): PlaytestSnapshot {
  const state = publicState(session.engine);
  const legalActions = getLegalActions(session);
  return {
    ok: true,
    sessionId: state.sessionId,
    state,
    legalActions,
    legalActionGroups: groupLegalActions(legalActions),
    evaluation: evaluatePlaytest(session),
  };
}

export function getLegalActions(session: PlaytestSession): PlaytestAction[] {
  return engineGetLegalActions(session.engine);
}

export function groupLegalActions(actions: PlaytestAction[]): PlaytestLegalActionGroup[] {
  const groups = new Map<string, PlaytestLegalActionGroup>();
  for (const action of actions) {
    const key = legalActionGroupKey(action);
    const existing = groups.get(key);
    if (existing) existing.actions.push(copyPlaytestAction(action));
    else groups.set(key, { key, label: legalActionGroupLabel(key), actions: [copyPlaytestAction(action)] });
  }
  return [...groups.values()];
}

function copyPlaytestAction(action: PlaytestAction): PlaytestAction {
  return { ...action };
}

export function applyAction(session: PlaytestSession, action: unknown): ApplyResult {
  const beforeActions = getLegalActions(session);
  const canonicalAction = beforeActions.find((candidate) => samePlaytestAction(candidate, action));
  if (!canonicalAction) {
    return {
      ok: false,
      error: "Action is not currently legal",
      state: publicState(session.engine),
      legalActions: beforeActions,
      legalActionGroups: groupLegalActions(beforeActions),
    };
  }
  const result = engineApplyAction(session.engine, canonicalAction);
  const legalActions = getLegalActions(session);
  return {
    ...result,
    state: publicState(session.engine),
    legalActions,
    legalActionGroups: groupLegalActions(legalActions),
  };
}

function samePlaytestAction(a: PlaytestAction, b: unknown): b is PlaytestAction {
  if (!isRecord(b) || typeof b.type !== "string") return false;
  if (a.type !== b.type) return false;
  if (a.type === "end" && b.type === "end") return true;
  if ("uid" in a && (!("uid" in b) || a.uid !== b.uid)) return false;
  if (a.type === "activateEffect" && b.type === "activateEffect" && a.effectId !== b.effectId) return false;
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function runPlaytest(session: PlaytestSession, chooseAction: ChooseAction, maxActions = 20): PlaytestSnapshot {
  for (let index = 0; index < maxActions; index += 1) {
    const state = publicState(session.engine);
    const legalActions = getLegalActions(session).filter((action) => action.type !== "end");
    if (!legalActions.length) break;
    const selected = chooseAction({ state, legalActions, evaluation: evaluatePlaytest(session) });
    if (!selected || selected.type === "end") break;
    const result = applyAction(session, selected);
    if (!result.ok) break;
  }
  return snapshot(session);
}

export function runScriptedPlaytest(session: PlaytestSession, steps: PlaytestActionSelector[]): ScriptedPlaytestResult {
  for (let index = 0; index < steps.length; index += 1) {
    const selector = steps[index]!;
    const state = publicState(session.engine);
    const legalActions = getLegalActions(session);
    const action = selectPlaytestAction(selector, legalActions, state);
    if (!action) return scriptedPlaytestResult(session, index, `No legal action matched ${describePlaytestSelector(selector)}`);
    const result = applyAction(session, action);
    if (!result.ok) return scriptedPlaytestResult(session, index, result.error ?? `Rejected ${describePlaytestSelector(selector)}`);
  }
  return snapshot(session);
}

function scriptedPlaytestResult(session: PlaytestSession, failedStep: number, failure: string): ScriptedPlaytestResult {
  const view = snapshot(session);
  const group = view.legalActionGroups[0];
  return {
    ...view,
    ok: false,
    failedStep,
    failure,
    ...(group === undefined ? {} : { divergenceGroupKey: group.key, divergenceGroupLabel: group.label }),
    divergenceActions: view.legalActions.map(copyPlaytestAction),
  };
}

export function chooseHighestPriority({ legalActions }: Parameters<ChooseAction>[0]): PlaytestAction | undefined {
  return legalActions.find((action) => action.type !== "end");
}

function selectPlaytestAction(selector: PlaytestActionSelector, legalActions: PlaytestAction[], state: PublicGameState): PlaytestAction | undefined {
  const matches = legalActions.filter((action) => playtestActionMatchesSelector(action, selector, state));
  return matches[selector.occurrence ?? 0];
}

function playtestActionMatchesSelector(action: PlaytestAction, selector: PlaytestActionSelector, state: PublicGameState): boolean {
  if (action.type !== selector.type) return false;
  if (selector.uid !== undefined && "uid" in action && action.uid !== selector.uid) return false;
  if (selector.effectId !== undefined && (!("effectId" in action) || action.effectId !== selector.effectId)) return false;
  if (selector.labelIncludes !== undefined && !action.label.includes(selector.labelIncludes)) return false;
  if (selector.id !== undefined) {
    if (!("uid" in action)) return false;
    const card = [...state.hand, ...state.field, ...state.graveyard, ...state.banished, ...state.extraDeck].find((candidate) => candidate.uid === action.uid);
    if (card?.id !== selector.id) return false;
  }
  return true;
}

function describePlaytestSelector(selector: PlaytestActionSelector): string {
  return [
    `type=${selector.type}`,
    selector.uid ? `uid=${selector.uid}` : undefined,
    selector.id ? `id=${selector.id}` : undefined,
    selector.effectId ? `effectId=${selector.effectId}` : undefined,
    selector.labelIncludes ? `labelIncludes=${selector.labelIncludes}` : undefined,
  ].filter(Boolean).join(" ");
}

function legalActionGroupKey(action: PlaytestAction): string {
  if (action.type === "normalSummon") return "summon";
  if (action.type === "activateEffect") return "effect";
  if (action.type === "setSpellTrap") return "set";
  return "turn";
}

function legalActionGroupLabel(key: string): string {
  if (key === "summon") return "Summon";
  if (key === "effect") return "Effects";
  if (key === "set") return "Set";
  return "Turn";
}

export function evaluatePlaytest(session: PlaytestSession): PlaytestEvaluation {
  const state = publicState(session.engine);
  const field = state.field.map((card) => card.name);
  const hand = state.hand.map((card) => card.name);
  const log = state.log.map((entry) => entry.action);
  let score = 0;

  score += field.some((name) => name === "Dark Magician") ? 2 : 0;
  score += field.some((name) => name.includes("Dark Magician") && name !== "Dark Magician") ? 3 : 0;
  score += log.includes("search") || log.includes("excavateAdd") ? 2 : 0;
  score += log.includes("fusionSummon") ? 3 : 0;
  score += hand.some((name) => name.includes("Eternal Soul") || name.includes("Dark Magical Circle")) ? 1 : 0;

  const risks: string[] = [];
  if (!state.normalSummonUsed && !field.length) risks.push("No summon committed to the field.");
  if (!log.includes("search") && !log.includes("excavateAdd")) risks.push("No search or card selection resolved.");
  if (!field.some((name) => name.includes("Dark Magician"))) risks.push("No Dark Magician engine body reached the field.");

  return {
    quality: score >= 8 ? "strong" : score >= 5 ? "playable" : score >= 3 ? "thin" : "weak",
    score,
    endBoard: field,
    followUp: hand.filter((name) => /Dark|Magician|Soul|Circle|Secrets|Timaeus/.test(name)),
    risks,
  };
}
