import {
  applyResponse,
  createDuel,
  getLegalActions,
  loadDecks,
  queryPublicState,
  startDuel,
  type CreateDuelOptions,
} from "./duel-core.js";
import type { DuelCardReader, DuelLocation, PlayerId, ScriptedDuelFixture } from "./duel-types.js";

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
  for (const response of fixture.responses) {
    const legal = getLegalActions(session, response.player);
    if (!legal.some((action) => action.type === response.type)) {
      failures.push({ fixture: fixture.name, message: `No legal ${response.type} response for player ${response.player}` });
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

export function makeResponseSelector(type: ScriptedDuelFixture["responses"][number]["type"], player: PlayerId) {
  return { type, player };
}
