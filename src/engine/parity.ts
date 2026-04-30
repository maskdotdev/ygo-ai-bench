import {
  applyResponse,
  createDuel,
  getLegalActions,
  loadDecks,
  moveDuelCard,
  queryPublicState,
  registerEffect,
  startDuel,
  type CreateDuelOptions,
} from "#duel/core.js";
import type {
  DuelAction,
  DuelCardReader,
  DuelLocation,
  DuelSession,
  PlayerId,
  ScriptedDuelFixture,
  ScriptedDuelStep,
  ScriptedFixtureEffect,
  ScriptedFixtureMove,
  ScriptedResponseSelector,
} from "#duel/types.js";

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
  applyFixtureSetup(session, fixture.setup?.moveCards ?? [], failures, fixture.name);
  applyFixtureEffects(session, fixture.setup?.effects ?? [], failures, fixture.name);
  if (failures.length) return { ok: false, failures };
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
  for (const [player, expectedLifePoints] of Object.entries(fixture.expected.lifePoints ?? {}) as [string, number][]) {
    const actualLifePoints = state.players[Number(player) as PlayerId]?.lifePoints;
    if (actualLifePoints !== expectedLifePoints) failures.push({ fixture: fixture.name, message: `Expected player ${player} LP ${expectedLifePoints}, got ${actualLifePoints}` });
  }
  if (fixture.expected.pendingBattle !== undefined && Boolean(session.state.pendingBattle) !== fixture.expected.pendingBattle) {
    failures.push({ fixture: fixture.name, message: `Expected pendingBattle ${fixture.expected.pendingBattle}, got ${Boolean(session.state.pendingBattle)}` });
  }
  if (fixture.expected.currentAttack !== undefined && Boolean(session.state.currentAttack) !== fixture.expected.currentAttack) {
    failures.push({ fixture: fixture.name, message: `Expected currentAttack ${fixture.expected.currentAttack}, got ${Boolean(session.state.currentAttack)}` });
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
    if (selector.tributeUids) {
      if (action.type !== "tributeSummon" || !sameStringSet(action.tributeUids, selector.tributeUids)) return false;
    }
    if (selector.materialUids) {
      if (
        (action.type !== "fusionSummon" && action.type !== "synchroSummon" && action.type !== "xyzSummon" && action.type !== "linkSummon" && action.type !== "ritualSummon") ||
        !sameStringSet(action.materialUids, selector.materialUids)
      ) {
        return false;
      }
    }
    if (selector.position) {
      if (action.type !== "changePosition" || action.position !== selector.position) return false;
    }
    if (selector.phase) {
      if (action.type !== "changePhase" || action.phase !== selector.phase) return false;
    }
    if (selector.attackerUid) {
      if (action.type !== "declareAttack" || action.attackerUid !== selector.attackerUid) return false;
    }
    if (selector.targetUid) {
      if (action.type !== "declareAttack" || action.targetUid !== selector.targetUid) return false;
    }
    if (selector.promptId) {
      if (!("promptId" in action) || action.promptId !== selector.promptId) return false;
    }
    if (selector.option !== undefined) {
      if (action.type !== "selectOption" || action.option !== selector.option) return false;
    }
    if (selector.yes !== undefined) {
      if (action.type !== "selectYesNo" || action.yes !== selector.yes) return false;
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

function applyFixtureEffects(session: DuelSession, effects: ScriptedFixtureEffect[], failures: ParityFailure[], fixture: string): void {
  for (const effect of effects) {
    const cards = queryPublicState(session).cards.filter((card) => {
      if (card.controller !== effect.player || card.code !== effect.code) return false;
      return effect.location === undefined || card.location === effect.location;
    });
    const source = cards[effect.occurrence ?? 0];
    if (!source) {
      failures.push({ fixture, message: `Setup could not find effect source ${effect.code} for player ${effect.player}` });
      return;
    }
    registerEffect(session, {
      id: effect.id,
      sourceUid: source.uid,
      controller: effect.player,
      event: effect.event,
      range: effect.range,
      ...(effect.oncePerTurn === undefined ? {} : { oncePerTurn: effect.oncePerTurn }),
      ...(effect.property === undefined ? {} : { property: effect.property }),
      operation(ctx) {
        if (effect.logMessage) ctx.log(effect.logMessage);
      },
    });
  }
}

function applyFixtureSetup(session: DuelSession, moves: ScriptedFixtureMove[], failures: ParityFailure[], fixture: string): void {
  for (const move of moves) {
    const cards = queryPublicState(session).cards.filter((card) => {
      if (card.controller !== move.player || card.code !== move.code) return false;
      return move.from === undefined || card.location === move.from;
    });
    const card = cards[move.occurrence ?? 0];
    if (!card) {
      failures.push({ fixture, message: `Setup could not find ${move.code} for player ${move.player}` });
      return;
    }
    const moved = moveDuelCard(session.state, card.uid, move.to, move.controller);
    if (move.position) moved.position = move.position;
  }
}

function sameAction(action: DuelAction, response: DuelAction): boolean {
  if (action.type !== response.type || action.player !== response.player) return false;
  if ("uid" in action && "uid" in response && action.uid !== response.uid) return false;
  if (action.type === "activateEffect" && response.type === "activateEffect" && action.effectId !== response.effectId) return false;
  if (action.type === "activateTrigger" && response.type === "activateTrigger" && action.triggerId !== response.triggerId) return false;
  if (action.type === "declineTrigger" && response.type === "declineTrigger" && action.triggerId !== response.triggerId) return false;
  if (action.type === "selectOption" && response.type === "selectOption" && (action.promptId !== response.promptId || action.option !== response.option)) return false;
  if (action.type === "selectYesNo" && response.type === "selectYesNo" && (action.promptId !== response.promptId || action.yes !== response.yes)) return false;
  if (action.type === "tributeSummon" && response.type === "tributeSummon" && !sameStringSet(action.tributeUids, response.tributeUids)) return false;
  if (action.type === "fusionSummon" && response.type === "fusionSummon" && !sameStringSet(action.materialUids, response.materialUids)) return false;
  if (action.type === "synchroSummon" && response.type === "synchroSummon" && !sameStringSet(action.materialUids, response.materialUids)) return false;
  if (action.type === "xyzSummon" && response.type === "xyzSummon" && !sameStringSet(action.materialUids, response.materialUids)) return false;
  if (action.type === "linkSummon" && response.type === "linkSummon" && !sameStringSet(action.materialUids, response.materialUids)) return false;
  if (action.type === "ritualSummon" && response.type === "ritualSummon" && !sameStringSet(action.materialUids, response.materialUids)) return false;
  if (action.type === "changePosition" && response.type === "changePosition" && action.position !== response.position) return false;
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
    "tributeUids" in step && step.tributeUids ? `tributeUids=${step.tributeUids.join(",")}` : undefined,
    "materialUids" in step && step.materialUids ? `materialUids=${step.materialUids.join(",")}` : undefined,
    "position" in step && step.position ? `position=${step.position}` : undefined,
    "phase" in step && step.phase ? `phase=${step.phase}` : undefined,
    "attackerUid" in step && step.attackerUid ? `attackerUid=${step.attackerUid}` : undefined,
    "targetUid" in step && step.targetUid ? `targetUid=${step.targetUid}` : undefined,
    "promptId" in step && step.promptId ? `promptId=${step.promptId}` : undefined,
    "option" in step && step.option !== undefined ? `option=${step.option}` : undefined,
    "yes" in step && step.yes !== undefined ? `yes=${step.yes}` : undefined,
    "effectId" in step && step.effectId ? `effectId=${step.effectId}` : undefined,
    "triggerId" in step && step.triggerId ? `triggerId=${step.triggerId}` : undefined,
    "location" in step && step.location ? `location=${step.location}` : undefined,
  ].filter(Boolean);
  return detail.join(" ");
}

function sameStringSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}
