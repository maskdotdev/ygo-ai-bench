import { cardRegistry } from "#cards/definitions.js";
import { buildDarkMagicianEffects } from "#cards/dark-magician-scripts.js";
import { applyAction as engineApplyAction, getLegalActions as engineGetLegalActions, publicState, startSession, type EngineSession } from "#engine/core.js";
import type { ApplyResult, PlaytestAction, PublicGameState } from "#engine/types.js";

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
  evaluation: PlaytestEvaluation;
}

export type ChooseAction = (input: {
  state: PublicGameState;
  legalActions: PlaytestAction[];
  evaluation: PlaytestEvaluation;
}) => PlaytestAction | undefined;

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
    evaluation: evaluatePlaytest(session),
  };
}

export function getLegalActions(session: PlaytestSession): PlaytestAction[] {
  return engineGetLegalActions(session.engine);
}

export function applyAction(session: PlaytestSession, action: PlaytestAction): ApplyResult {
  const result = engineApplyAction(session.engine, action);
  return {
    ...result,
    state: publicState(session.engine),
    legalActions: getLegalActions(session),
  };
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

export function chooseHighestPriority({ legalActions }: Parameters<ChooseAction>[0]): PlaytestAction | undefined {
  return legalActions.find((action) => action.type !== "end");
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
