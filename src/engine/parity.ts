import {
  applyResponse,
  createDuel,
  getLegalActions,
  loadDecks,
  queryPublicState,
  startDuel,
  type CreateDuelOptions,
} from "./duel-core.js";
import type { DuelAction, DuelCardReader, DuelLocation, PlayerId, ScriptedDuelFixture, ScriptedDuelStep, ScriptedResponseSelector } from "./duel-types.js";

export interface ParityRunOptions extends CreateDuelOptions {
  cardReader?: DuelCardReader;
}

export interface ParityFailure {
  fixture: string;
  message: string;
}

export interface ParityRunResult {
  ok: boolean;
  failures: ParityFailure[];
}

export function runScriptedDuelFixture(fixture: ScriptedDuelFixture, options: ParityRunOptions = {}): ParityRunResult {
  const session = createDuel({ ...fixture.options, ...options });
  loadDecks(session, fixture.decks);
  startDuel(session);

  const failures: ParityFailure[] = [];
  for (const step of fixture.responses) {
    const legal = getLegalActions(session, step.player);
    const response = resolveScriptedStep(step, legal, queryPublicState(session).cards);
    if (!response) {
      failures.push({ fixture: fixture.name, message: `No legal response matched ${describeStep(step)}` });
      break;
    }
    const result = applyResponse(session, response);
    if (!result.ok) {
      failures.push({ fixture: fixture.name, message: result.error ?? `Rejected ${response.type}` });
      break;
    }
  }

  const state = queryPublicState(session);
  if (fixture.expected.phase && state.phase !== fixture.expected.phase) {
    failures.push({ fixture: fixture.name, message: `Expected phase ${fixture.expected.phase}, got ${state.phase}` });
  }
  if (fixture.expected.turn && state.turn !== fixture.expected.turn) {
    failures.push({ fixture: fixture.name, message: `Expected turn ${fixture.expected.turn}, got ${state.turn}` });
  }
  for (const [location, expectedCodes] of Object.entries(fixture.expected.locations ?? {}) as [DuelLocation, string[]][]) {
    const actualCodes = state.cards.filter((card) => card.location === location).map((card) => card.code);
    for (const code of expectedCodes) {
      if (!actualCodes.includes(code)) failures.push({ fixture: fixture.name, message: `Expected ${code} in ${location}` });
    }
  }
  for (const expectedLog of fixture.expected.logIncludes ?? []) {
    if (!state.log.some((entry) => entry.detail.includes(expectedLog) || entry.action.includes(expectedLog))) {
      failures.push({ fixture: fixture.name, message: `Expected log containing ${expectedLog}` });
    }
  }

  return { ok: failures.length === 0, failures };
}

export function makeResponseSelector(type: ScriptedDuelStep["type"], player: PlayerId, selector: Omit<ScriptedResponseSelector, "type" | "player"> = {}): ScriptedResponseSelector {
  return { type, player, ...selector };
}

function resolveScriptedStep(step: ScriptedDuelStep, legal: DuelAction[], cards: { uid: string; code: string; location: DuelLocation }[]): DuelAction | undefined {
  if (isConcreteResponse(step) && legal.some((action) => sameAction(action, step))) return step;
  const selector = step as ScriptedResponseSelector;
  const matches = legal.filter((action) => {
    if (action.type !== selector.type || action.player !== selector.player) return false;
    if (selector.uid && "uid" in action && action.uid !== selector.uid) return false;
    if (selector.attackerUid) {
      if (action.type !== "declareAttack" || action.attackerUid !== selector.attackerUid) return false;
    }
    if (selector.targetUid) {
      if (action.type !== "declareAttack" || action.targetUid !== selector.targetUid) return false;
    }
    if (selector.effectId) {
      if (!("effectId" in action) || action.effectId !== selector.effectId) return false;
    }
    if (selector.triggerId) {
      if (!("triggerId" in action) || action.triggerId !== selector.triggerId) return false;
    }
    if (selector.labelIncludes && !action.label.includes(selector.labelIncludes)) return false;
    if (selector.code || selector.location) {
      if (!("uid" in action)) return false;
      const card = cards.find((candidate) => candidate.uid === action.uid);
      if (!card) return false;
      if (selector.code && card.code !== selector.code) return false;
      if (selector.location && card.location !== selector.location) return false;
    }
    return true;
  });
  return matches[selector.occurrence ?? 0];
}

function isConcreteResponse(step: ScriptedDuelStep): step is DuelAction {
  if (step.type === "changePhase") return "phase" in step && "label" in step;
  return "label" in step && (!("uid" in step) || typeof step.uid === "string");
}

function sameAction(action: DuelAction, response: DuelAction): boolean {
  if (action.type !== response.type || action.player !== response.player) return false;
  if ("uid" in action && "uid" in response && action.uid !== response.uid) return false;
  if (action.type === "activateEffect" && response.type === "activateEffect" && action.effectId !== response.effectId) return false;
  if (action.type === "activateTrigger" && response.type === "activateTrigger" && action.triggerId !== response.triggerId) return false;
  if (action.type === "declineTrigger" && response.type === "declineTrigger" && action.triggerId !== response.triggerId) return false;
  if (action.type === "declareAttack" && response.type === "declareAttack" && action.attackerUid !== response.attackerUid) return false;
  if (action.type === "declareAttack" && response.type === "declareAttack" && action.targetUid !== response.targetUid) return false;
  if (action.type === "changePhase" && response.type === "changePhase" && action.phase !== response.phase) return false;
  return true;
}

function describeStep(step: ScriptedDuelStep): string {
  const detail = [
    `type=${step.type}`,
    `player=${step.player}`,
    "code" in step && step.code ? `code=${step.code}` : undefined,
    "uid" in step && step.uid ? `uid=${step.uid}` : undefined,
    "attackerUid" in step && step.attackerUid ? `attackerUid=${step.attackerUid}` : undefined,
    "targetUid" in step && step.targetUid ? `targetUid=${step.targetUid}` : undefined,
    "effectId" in step && step.effectId ? `effectId=${step.effectId}` : undefined,
    "triggerId" in step && step.triggerId ? `triggerId=${step.triggerId}` : undefined,
    "location" in step && step.location ? `location=${step.location}` : undefined,
  ].filter(Boolean);
  return detail.join(" ");
}
