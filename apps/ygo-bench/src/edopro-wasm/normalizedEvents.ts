import type { CardDatabase } from "./cardDb.js";
import type { OcgMessage, OcgRuntime } from "./ocgTypes.js";

export type RealPhaseName = "DRAW" | "STANDBY" | "MAIN1" | "BATTLE" | "MAIN2" | "END" | "UNKNOWN";

export interface RealCardView {
  code: number;
  name: string;
  controller: 0 | 1;
  location: string;
  sequence: number;
  position?: number | undefined;
}

export interface RealNormalizedEvent {
  frame: number;
  type: "event";
  event: string;
  player?: 0 | 1 | undefined;
  turn: number;
  phase: RealPhaseName;
  text: string;
  card?: {
    code: number;
    name: string;
  } | undefined;
  from?: string;
  to?: string;
  payload?: unknown;
}

export interface RealReducedPlayer {
  lp: number;
  handCount: number;
  monsters: RealCardView[];
  spellsTraps: RealCardView[];
  graveyard: RealCardView[];
  banished: RealCardView[];
  deckCount: number;
}

export interface RealReducedState {
  turn: number;
  phase: RealPhaseName;
  winner: 0 | 1 | null;
  players: [RealReducedPlayer, RealReducedPlayer];
}

export function initialRealReducedState(): RealReducedState {
  return {
    turn: 0,
    phase: "UNKNOWN",
    winner: null,
    players: [initialPlayer(), initialPlayer()],
  };
}

export function normalizeMessages(args: {
  messages: OcgMessage[];
  ocg: OcgRuntime;
  cardDb: CardDatabase;
  state: RealReducedState;
  nextFrame: () => number;
}): RealNormalizedEvent[] {
  const events: RealNormalizedEvent[] = [];
  for (const message of args.messages) {
    const event = normalizeMessage(message, args.ocg, args.cardDb, args.state, args.nextFrame());
    applyRealEvent(args.state, event);
    events.push(event);
  }
  return events;
}

export function applyRealEvent(state: RealReducedState, event: RealNormalizedEvent): void {
  state.turn = event.turn;
  state.phase = event.phase;
  if (event.event === "LP_UPDATE" && isRecord(event.payload)) {
    const player = toPlayer(event.payload.player);
    const lp = typeof event.payload.lp === "number" ? event.payload.lp : undefined;
    if (player !== null && lp !== undefined) state.players[player].lp = lp;
  }
  if (event.event === "DRAW" && event.player !== undefined && isRecord(event.payload)) {
    const count = typeof event.payload.count === "number" ? event.payload.count : 0;
    state.players[event.player].handCount += count;
    state.players[event.player].deckCount = Math.max(0, state.players[event.player].deckCount - count);
  }
  if (event.event === "CARD_MOVED" && isRecord(event.payload)) {
    moveCardInReducedState(state, event.payload, event.card?.name);
  }
  if (event.event === "WIN" && event.player !== undefined) state.winner = event.player;
}

function normalizeMessage(
  message: OcgMessage,
  ocg: OcgRuntime,
  cardDb: CardDatabase,
  state: RealReducedState,
  frame: number,
): RealNormalizedEvent {
  const eventBase = {
    frame,
    type: "event" as const,
    turn: state.turn,
    phase: state.phase,
  };

  if (message.type === ocg.OcgMessageType.NEW_TURN) {
    const player = toPlayer(message.player);
    return {
      ...eventBase,
      event: "NEW_TURN",
      player: player ?? undefined,
      turn: state.turn + 1,
      text: player === null ? "New turn." : `Turn ${state.turn + 1}: Player ${player}.`,
    };
  }

  if (message.type === ocg.OcgMessageType.NEW_PHASE) {
    const phase = phaseName(message.phase);
    return {
      ...eventBase,
      event: "NEW_PHASE",
      phase,
      text: `Phase changed to ${phase}.`,
      payload: { phase: message.phase },
    };
  }

  if (message.type === ocg.OcgMessageType.DRAW) {
    const player = toPlayer(message.player);
    const drawn = Array.isArray(message.drawn) ? message.drawn : [];
    return {
      ...eventBase,
      event: "DRAW",
      player: player ?? undefined,
      text: player === null ? `Drew ${drawn.length} card(s).` : `Player ${player} drew ${drawn.length} card(s).`,
      payload: { count: drawn.length, cards: drawn },
    };
  }

  if (message.type === ocg.OcgMessageType.MOVE) {
    const code = typeof message.card === "number" ? message.card : 0;
    const from = locString(message.from);
    const to = locString(message.to);
    return {
      ...eventBase,
      event: "CARD_MOVED",
      player: toPlayer(locationRecord(message.to)?.controller) ?? undefined,
      text: `${cardName(code, cardDb)} moved from ${from} to ${to}.`,
      card: { code, name: cardName(code, cardDb) },
      from,
      to,
      payload: message,
    };
  }

  if (message.type === ocg.OcgMessageType.LPUPDATE) {
    const player = toPlayer(message.player);
    const lp = typeof message.lp === "number" ? message.lp : undefined;
    return {
      ...eventBase,
      event: "LP_UPDATE",
      player: player ?? undefined,
      text: player === null || lp === undefined ? "LP updated." : `Player ${player} LP became ${lp}.`,
      payload: { player, lp },
    };
  }

  if (message.type === ocg.OcgMessageType.DAMAGE) {
    const player = toPlayer(message.player);
    const amount = typeof message.amount === "number" ? message.amount : 0;
    return {
      ...eventBase,
      event: "DAMAGE",
      player: player ?? undefined,
      text: player === null ? `${amount} damage.` : `Player ${player} took ${amount} damage.`,
      payload: message,
    };
  }

  if (message.type === ocg.OcgMessageType.ATTACK) {
    return {
      ...eventBase,
      event: "ATTACK",
      text: "Attack declared.",
      payload: message,
    };
  }

  if (message.type === ocg.OcgMessageType.SUMMONING || message.type === ocg.OcgMessageType.SUMMONED) {
    const code = typeof message.code === "number" ? message.code : 0;
    return {
      ...eventBase,
      event: message.type === ocg.OcgMessageType.SUMMONING ? "SUMMONING" : "SUMMONED",
      player: toPlayer(message.controller) ?? undefined,
      card: code ? { code, name: cardName(code, cardDb) } : undefined,
      text: code ? `${cardName(code, cardDb)} was summoned.` : "A monster was summoned.",
      payload: message,
    };
  }

  if (message.type === ocg.OcgMessageType.WIN) {
    const player = toPlayer(message.player);
    return {
      ...eventBase,
      event: "WIN",
      player: player ?? undefined,
      text: player === null ? "Duel ended." : `Player ${player} won.`,
      payload: message,
    };
  }

  return {
    ...eventBase,
    event: String(ocg.OcgMessageType[message.type] ?? message.type).toUpperCase(),
    player: toPlayer(message.player) ?? undefined,
    text: `${String(ocg.OcgMessageType[message.type] ?? message.type)}.`,
    payload: message,
  };
}

function moveCardInReducedState(state: RealReducedState, payload: Record<string, unknown>, name: string | undefined): void {
  const code = typeof payload.card === "number" ? payload.card : undefined;
  const from = locationRecord(payload.from);
  const to = locationRecord(payload.to);
  if (code === undefined || !from || !to) return;

  const fromPlayer = toPlayer(from.controller);
  const toPlayerId = toPlayer(to.controller);
  if (fromPlayer !== null) removeCardFromKnownZones(state.players[fromPlayer], code, from.location, from.sequence);
  if (fromPlayer !== null && from.location === 2) state.players[fromPlayer].handCount = Math.max(0, state.players[fromPlayer].handCount - 1);
  if (toPlayerId !== null) {
    if (to.location === 2) state.players[toPlayerId].handCount += 1;
    addCardToKnownZone(state.players[toPlayerId], {
      code,
      name: name ?? `#${code}`,
      controller: toPlayerId,
      location: locationName(to.location),
      sequence: to.sequence,
      position: to.position,
    });
  }
}

function removeCardFromKnownZones(player: RealReducedPlayer, code: number, location: number, sequence: number): void {
  const zone = zoneForLocation(player, location);
  if (!zone) return;
  const index = zone.findIndex((card) => card.code === code && card.sequence === sequence);
  if (index >= 0) zone.splice(index, 1);
}

function addCardToKnownZone(player: RealReducedPlayer, card: RealCardView): void {
  const zone = zoneForLocation(player, numericLocation(card.location));
  if (!zone) return;
  zone.push(card);
}

function zoneForLocation(player: RealReducedPlayer, location: number): RealCardView[] | null {
  if (location === 4) return player.monsters;
  if (location === 8) return player.spellsTraps;
  if (location === 16) return player.graveyard;
  if (location === 32) return player.banished;
  return null;
}

function initialPlayer(): RealReducedPlayer {
  return {
    lp: 8000,
    handCount: 0,
    monsters: [],
    spellsTraps: [],
    graveyard: [],
    banished: [],
    deckCount: 0,
  };
}

function phaseName(phase: unknown): RealPhaseName {
  if (phase === 1) return "DRAW";
  if (phase === 2) return "STANDBY";
  if (phase === 4) return "MAIN1";
  if (phase === 8 || phase === 16 || phase === 32 || phase === 64 || phase === 128) return "BATTLE";
  if (phase === 256) return "MAIN2";
  if (phase === 512) return "END";
  return "UNKNOWN";
}

function locString(value: unknown): string {
  const loc = locationRecord(value);
  if (!loc) return "UNKNOWN";
  return `P${loc.controller}:${locationName(loc.location)}:${loc.sequence}`;
}

function locationRecord(value: unknown): { controller: unknown; location: number; sequence: number; position?: number | undefined } | null {
  if (!isRecord(value) || typeof value.location !== "number" || typeof value.sequence !== "number") return null;
  return {
    controller: value.controller,
    location: value.location,
    sequence: value.sequence,
    position: typeof value.position === "number" ? value.position : undefined,
  };
}

function locationName(location: number): string {
  if (location === 1) return "DECK";
  if (location === 2) return "HAND";
  if (location === 4) return "MZONE";
  if (location === 8) return "SZONE";
  if (location === 16) return "GRAVE";
  if (location === 32) return "BANISHED";
  if (location === 64) return "EXTRA";
  return `LOC_${location}`;
}

function numericLocation(location: string): number {
  if (location === "MZONE") return 4;
  if (location === "SZONE") return 8;
  if (location === "GRAVE") return 16;
  if (location === "BANISHED") return 32;
  return 0;
}

function cardName(code: number, cardDb: CardDatabase): string {
  return cardDb.names.get(code) ?? `#${code}`;
}

function toPlayer(value: unknown): 0 | 1 | null {
  return value === 0 || value === 1 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
