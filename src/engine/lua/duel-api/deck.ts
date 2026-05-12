import fengari from "fengari";
import {
  canDuelPlayerDiscardDeck,
  canDuelPlayerDiscardHand,
  canDuelPlayerDraw,
  collectDuelGroupedTriggerEffects,
  drawDuelCards,
  sendDuelCardToGraveyard,
} from "#duel/core.js";
import { getCards, moveDuelCard } from "#duel/card-state.js";
import { duelReason } from "#duel/reasons.js";
import { pushCardTable } from "#lua/card-api.js";
import { pushGroupTable } from "#lua/group-api.js";
import { locationsFromMask, readCardUid, readGroupUids, readOptionalFunctionRef, releaseOptionalFunctionRef } from "#lua/api-utils.js";
import { luaEffectReasonPayload } from "#lua/duel-api/event-payload.js";
import { markLuaOperationTimingBoundary, regroupLuaOperationEvent, type LuaOperationTimingBoundaryHostState } from "#lua/duel-api/move.js";
import { shuffle } from "#engine/rng.js";
import type { DuelEventPayload } from "#duel/event-history.js";
import type { DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

type LuaFilterArgs = { start: number; count: number };

export interface LuaDuelDeckApiHostState extends LuaOperationTimingBoundaryHostState {
  messages: string[];
  operatedUids: string[];
}

export function installDuelDeckApi(L: unknown, session: DuelSession, hostState: LuaDuelDeckApiHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const count = Math.max(0, lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 1);
    lua.lua_pushboolean(state, canDuelPlayerDraw(session.state, player, count));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsPlayerCanDraw"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, session.state.options.drawPerTurn);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetDrawCount"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, session.state.options.startingHandSize);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetStartingHand"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const count = Math.max(0, lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 1);
    lua.lua_pushboolean(state, canDuelPlayerDiscardDeck(session.state, player, count));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsPlayerCanDiscardDeck"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const count = Math.max(0, lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 1);
    lua.lua_pushboolean(state, canDuelPlayerDiscardDeck(session.state, player, count));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsPlayerCanDiscardDeckAsCost"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const count = Math.max(0, lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 1);
    lua.lua_pushboolean(state, canDuelPlayerDiscardHand(session.state, player, count));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsPlayerCanDiscardHand"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (session.state.status === "ended") {
      setOperatedUids(hostState, []);
      lua.lua_pushinteger(state, 0);
      return 1;
    }
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const count = lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 1;
    const reason = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : duelReason.effect;
    const reasonPlayer = hostState.activeContext?.player ?? session.state.turnPlayer;
    const drawUids = topDeckUids(session, player, count);
    if (drawUids.length > 0) markLuaOperationTimingBoundary(session, hostState);
    const drawn = drawDuelCards(session.state, player, count, "Lua draw", luaEffectReasonPayload(hostState, reason, reasonPlayer));
    if (drawn > 0 && hostState.activeContext) hostState.activeOperationMoved = true;
    setOperatedUids(hostState, drawUids.slice(0, drawn));
    lua.lua_pushinteger(state, drawn);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Draw"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (session.state.status === "ended") {
      setOperatedUids(hostState, []);
      lua.lua_pushinteger(state, 0);
      return 1;
    }
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const count = Math.max(0, lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 1);
    const reason = lua.lua_isnumber(state, 3) ? lua.lua_tointeger(state, 3) : duelReason.effect;
    const discarded = discardDeckCards(session, hostState, player, count, reason);
    setOperatedUids(hostState, discarded);
    lua.lua_pushinteger(state, discarded.length);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("DiscardDeck"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (session.state.status === "ended") {
      setOperatedUids(hostState, []);
      lua.lua_pushinteger(state, 0);
      return 1;
    }
    const discarded = discardHandCards(session, hostState, state);
    setOperatedUids(hostState, discarded);
    lua.lua_pushinteger(state, discarded.length);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("DiscardHand"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (session.state.status === "ended") {
      setOperatedUids(hostState, []);
      return 0;
    }
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const moved = swapDeckAndGrave(session, hostState, player);
    setOperatedUids(hostState, moved);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("SwapDeckAndGrave"));
  installDeckQueryHelpers(L, session, hostState);
}

function installDeckQueryHelpers(L: unknown, session: DuelSession, hostState: LuaDuelDeckApiHostState): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const count = Math.max(0, lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 1);
    pushGroupTable(state, topDeckUids(session, player, count));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetDecktopGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const count = Math.max(0, lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 1);
    pushGroupTable(state, deckSegmentUids(session, player, count, "bottom"));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetDeckbottomGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const count = Math.max(0, lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 1);
    pushGroupTable(state, extraDeckSegmentUids(session, player, count));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("GetExtraTopGroup"));
  lua.lua_pushcfunction(L, (state: unknown) => pushGoatConfirm(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("GoatConfirm"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const confirmedUids = readCardOrGroupUids(state, 2);
    const confirmed = confirmedCodes(session, confirmedUids);
    hostState.messages.push(`confirmed ${player}: ${confirmed.join(",")}`);
    collectConfirmedEvent(session, confirmedUids, player);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("ConfirmCards"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const count = Math.max(0, lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 1);
    const confirmedUids = topDeckUids(session, player, count);
    const confirmed = confirmedCodes(session, confirmedUids);
    hostState.messages.push(`confirmed decktop ${player}: ${confirmed.join(",")}`);
    collectConfirmedEvent(session, confirmedUids, player);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("ConfirmDecktop"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const count = Math.max(0, lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 1);
    const confirmedUids = extraDeckSegmentUids(session, player, count);
    const confirmed = confirmedCodes(session, confirmedUids);
    hostState.messages.push(`confirmed extratop ${player}: ${confirmed.join(",")}`);
    collectConfirmedEvent(session, confirmedUids, player);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("ConfirmExtratop"));
  lua.lua_pushcfunction(L, () => {
    if (session.state.status === "ended") return 0;
    session.state.shuffleCheckDisabled = true;
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("DisableShuffleCheck"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (session.state.status === "ended") return 0;
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    shuffleDeck(session, player);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("ShuffleDeck"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (session.state.status === "ended") return 0;
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    shuffleHand(session, player);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("ShuffleHand"));
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (session.state.status === "ended") return 0;
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    shuffleExtra(session, player);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("ShuffleExtra"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSortDeckSegment(state, session, hostState, "top"));
  lua.lua_setfield(L, -2, to_luastring("SortDecktop"));
  lua.lua_pushcfunction(L, (state: unknown) => pushSortDeckSegment(state, session, hostState, "bottom"));
  lua.lua_setfield(L, -2, to_luastring("SortDeckbottom"));
}

function pushGoatConfirm(L: unknown, session: DuelSession, hostState: LuaDuelDeckApiHostState): number {
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const locationMask = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 0;
  const deckUids = (locationMask & 0x01) === 0 ? [] : matchingCardUids(session, player, 0x01);
  const handUids = (locationMask & 0x02) === 0 ? [] : matchingCardUids(session, player, 0x02);
  confirmUids(session, hostState, player, deckUids);
  confirmUids(session, hostState, otherPlayer(player), handUids);
  if (handUids.length > 0) shuffleHand(session, player);
  if (deckUids.length > 0) shuffleDeck(session, player);
  return 0;
}

function confirmUids(session: DuelSession, hostState: LuaDuelDeckApiHostState, player: PlayerId, uids: string[]): void {
  const confirmed = confirmedCodes(session, uids);
  hostState.messages.push(`confirmed ${player}: ${confirmed.join(",")}`);
  collectConfirmedEvent(session, uids, player);
}

function confirmedCodes(session: DuelSession, uids: string[]): string[] {
  return uids.map((uid) => session.state.cards.find((card) => card.uid === uid)?.code).filter((code): code is string => Boolean(code));
}

function collectConfirmedEvent(session: DuelSession, uids: string[], player: PlayerId): void {
  const eventUids = uids.filter((uid) => session.state.cards.some((card) => card.uid === uid));
  if (eventUids.length === 0) return;
  collectDuelGroupedTriggerEffects(session.state, "confirmed", eventCardsFromUids(session, eventUids), { eventCode: 1211, eventPlayer: player, eventValue: eventUids.length, eventUids });
  const handUids = eventUids.filter((uid) => session.state.cards.some((card) => card.uid === uid && card.location === "hand"));
  if (handUids.length > 0) collectDuelGroupedTriggerEffects(session.state, "sentToHandConfirmed", eventCardsFromUids(session, handUids), { eventCode: 1212, eventPlayer: player, eventValue: handUids.length, eventUids: handUids });
}

function eventCardsFromUids(session: DuelSession, uids: string[]): DuelCardInstance[] {
  return uids.map((uid) => session.state.cards.find((card) => card.uid === uid)).filter((card): card is DuelCardInstance => Boolean(card));
}

function pushSortDeckSegment(L: unknown, session: DuelSession, hostState: LuaDuelDeckApiHostState, edge: "top" | "bottom"): number {
  if (session.state.status === "ended") {
    setOperatedUids(hostState, []);
    return 0;
  }
  const deckPlayer = normalizePlayer(lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const count = Math.max(0, lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 1);
  const sorted = deckSegmentUids(session, deckPlayer, count, edge);
  resequenceDeck(session, deckPlayer, sorted, edge);
  setOperatedUids(hostState, sorted);
  return 0;
}

function discardDeckCards(session: DuelSession, hostState: LuaDuelDeckApiHostState, player: PlayerId, count: number, reason: number): string[] {
  if (!canDuelPlayerDiscardDeck(session.state, player, 0)) return [];
  const reasonPlayer = hostState.activeContext?.player ?? session.state.turnPlayer;
  const payload = luaEffectReasonPayload(hostState, reason, reasonPlayer);
  const discarded: string[] = [];
  let triggerStart = session.state.pendingTriggers.length;
  for (const uid of topDeckUids(session, player, count)) {
    try {
      if (discarded.length === 0) {
        markLuaOperationTimingBoundary(session, hostState);
        triggerStart = session.state.pendingTriggers.length;
      }
      sendDuelCardToGraveyard(session.state, uid, player, reason, reasonPlayer, payload);
      discarded.push(uid);
    } catch {
      // EDOPro-style helpers report moved cards; illegal moves simply fail.
    }
  }
  finishDiscardOperation(session, hostState, triggerStart, discarded);
  return discarded;
}

function discardHandCards(session: DuelSession, hostState: LuaDuelDeckApiHostState, L: unknown): string[] {
  const filterRef = readOptionalFunctionRef(L, 2);
  const player = normalizePlayer(lua.lua_isnumber(L, 1) ? lua.lua_tointeger(L, 1) : session.state.turnPlayer);
  const min = Math.max(0, lua.lua_isnumber(L, 3) ? lua.lua_tointeger(L, 3) : 1);
  const max = Math.max(min, lua.lua_isnumber(L, 4) ? lua.lua_tointeger(L, 4) : min);
  const reason = lua.lua_isnumber(L, 5) ? lua.lua_tointeger(L, 5) : duelReason.effect;
  if (!canDuelPlayerDiscardHand(session.state, player, 0)) {
    releaseOptionalFunctionRef(L, filterRef);
    return [];
  }
  const selected = matchingCardUidsWithFilter(L, session, filterRef, player, 0x02, 0, undefined, readFilterArgs(L, 6)).slice(0, max);
  releaseOptionalFunctionRef(L, filterRef);
  if (selected.length < min) return [];
  const reasonPlayer = hostState.activeContext?.player ?? session.state.turnPlayer;
  const payload = luaEffectReasonPayload(hostState, reason, reasonPlayer);
  const discarded: string[] = [];
  let triggerStart = session.state.pendingTriggers.length;
  for (const uid of selected) {
    try {
      if (discarded.length === 0) {
        markLuaOperationTimingBoundary(session, hostState);
        triggerStart = session.state.pendingTriggers.length;
      }
      sendDuelCardToGraveyard(session.state, uid, player, reason, reasonPlayer, payload);
      discarded.push(uid);
    } catch {
      // EDOPro-style helpers report moved cards; illegal moves simply fail.
    }
  }
  finishDiscardOperation(session, hostState, triggerStart, discarded);
  return discarded;
}

function finishDiscardOperation(session: DuelSession, hostState: LuaDuelDeckApiHostState, triggerStart: number, discarded: string[]): void {
  if (discarded.length === 0) return;
  if (hostState.activeContext) hostState.activeOperationMoved = true;
  regroupLuaOperationEvent(session, triggerStart, "sentToGraveyard", discarded, "graveyard");
  regroupLuaOperationEvent(session, triggerStart, "discarded", discarded, "graveyard");
}

function swapDeckAndGrave(session: DuelSession, hostState: LuaDuelDeckApiHostState, player: PlayerId): string[] {
  const deckCards = getCards(session.state, player, "deck");
  const graveCards = getCards(session.state, player, "graveyard");
  if (deckCards.length === 0 && graveCards.length === 0) return [];
  markLuaOperationTimingBoundary(session, hostState);
  const reasonPlayer = hostState.activeContext?.player ?? player;
  const payload = luaEffectReasonPayload(hostState, duelReason.effect, reasonPlayer);
  const moved: string[] = [];
  for (const card of deckCards) {
    moveDuelCard(session.state, card.uid, "graveyard", player, duelReason.effect, reasonPlayer);
    applyReasonPayload(card, payload);
    moved.push(card.uid);
  }
  for (const card of graveCards) {
    moveDuelCard(session.state, card.uid, "deck", player, duelReason.effect, reasonPlayer);
    applyReasonPayload(card, payload);
    moved.push(card.uid);
  }
  for (const [sequence, card] of deckCards.entries()) card.sequence = sequence;
  for (const [sequence, card] of graveCards.entries()) card.sequence = sequence;
  shuffleDeck(session, player);
  if (hostState.activeContext) hostState.activeOperationMoved = true;
  collectSwapDeckAndGraveEvents(session, deckCards, graveCards, payload);
  return moved;
}

function applyReasonPayload(card: DuelCardInstance, payload: DuelEventPayload): void {
  if (payload.eventReasonCardUid !== undefined) card.reasonCardUid = payload.eventReasonCardUid;
  if (payload.eventReasonEffectId !== undefined) card.reasonEffectId = payload.eventReasonEffectId;
}

function collectSwapDeckAndGraveEvents(session: DuelSession, toGraveyard: DuelCardInstance[], toDeck: DuelCardInstance[], payload: DuelEventPayload): void {
  const moved = [...toGraveyard, ...toDeck];
  if (moved.length > 0) collectDuelGroupedTriggerEffects(session.state, "moved", moved, { ...payload, eventUids: moved.map((card) => card.uid) });
  if (toDeck.length > 0) collectDuelGroupedTriggerEffects(session.state, "leftGraveyard", toDeck, { ...payload, eventUids: toDeck.map((card) => card.uid) });
  if (toGraveyard.length > 0) collectDuelGroupedTriggerEffects(session.state, "sentToGraveyard", toGraveyard, { ...payload, eventUids: toGraveyard.map((card) => card.uid) });
  if (toDeck.length > 0) collectDuelGroupedTriggerEffects(session.state, "sentToDeck", toDeck, { ...payload, eventUids: toDeck.map((card) => card.uid) });
}

function topDeckUids(session: DuelSession, player: PlayerId, count: number): string[] {
  return matchingCardUids(session, player, 0x01).slice(0, count);
}

function deckSegmentUids(session: DuelSession, player: PlayerId, count: number, edge: "top" | "bottom"): string[] {
  const deck = matchingCardUids(session, player, 0x01);
  return edge === "top" ? deck.slice(0, count) : deck.slice(Math.max(0, deck.length - count));
}

function extraDeckSegmentUids(session: DuelSession, player: PlayerId, count: number): string[] {
  return session.state.cards
    .filter((card) => card.controller === player && card.location === "extraDeck")
    .sort((left, right) => left.sequence - right.sequence)
    .slice(0, count)
    .map((card) => card.uid);
}

function resequenceDeck(session: DuelSession, player: PlayerId, segmentUids: string[], edge: "top" | "bottom"): void {
  if (segmentUids.length === 0) return;
  const segment = new Set(segmentUids);
  const rest = session.state.cards
    .filter((card) => card.controller === player && card.location === "deck" && !segment.has(card.uid))
    .sort((left, right) => left.sequence - right.sequence);
  const orderedUids = edge === "top" ? [...segmentUids, ...rest.map((card) => card.uid)] : [...rest.map((card) => card.uid), ...segmentUids];
  for (const [sequence, uid] of orderedUids.entries()) {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    if (card) card.sequence = sequence;
  }
}

function shuffleDeck(session: DuelSession, player: PlayerId): void {
  const deckCards = session.state.cards.filter((card) => card.controller === player && card.location === "deck").sort((a, b) => a.sequence - b.sequence);
  const shuffled = shuffle(deckCards, `${session.state.seed}:lua-shuffle:${player}:${session.state.log.length}`);
  for (const [sequence, card] of shuffled.entries()) card.sequence = sequence;
}

function shuffleHand(session: DuelSession, player: PlayerId): void {
  const handCards = session.state.cards.filter((card) => card.controller === player && card.location === "hand").sort((a, b) => a.sequence - b.sequence);
  const shuffled = shuffle(handCards, `${session.state.seed}:lua-shuffle-hand:${player}:${session.state.log.length}`);
  for (const [sequence, card] of shuffled.entries()) card.sequence = sequence;
}

function shuffleExtra(session: DuelSession, player: PlayerId): void {
  const extraCards = session.state.cards.filter((card) => card.controller === player && card.location === "extraDeck").sort((a, b) => a.sequence - b.sequence);
  const shuffled = shuffle(extraCards, `${session.state.seed}:lua-shuffle-extra:${player}:${session.state.log.length}`);
  for (const [sequence, card] of shuffled.entries()) card.sequence = sequence;
}

function readCardOrGroupUids(L: unknown, index: number): string[] {
  const cardUid = readCardUid(L, index);
  return cardUid ? [cardUid] : readGroupUids(L, index);
}

function matchingCardUidsWithFilter(
  L: unknown,
  session: DuelSession,
  filterRef: number | undefined,
  player: PlayerId,
  selfMask: number,
  opponentMask: number,
  excluded: string | undefined,
  args: LuaFilterArgs,
): string[] {
  return fieldGroupUids(session, player, selfMask, opponentMask).filter((uid) => uid !== excluded && cardMatchesFilter(L, uid, filterRef, args));
}

function cardMatchesFilter(L: unknown, uid: string, filterRef: number | undefined, args: LuaFilterArgs): boolean {
  if (filterRef === undefined) return true;
  lua.lua_rawgeti(L, lua.LUA_REGISTRYINDEX, filterRef);
  pushCardTable(L, uid);
  for (let index = 0; index < args.count; index += 1) lua.lua_pushvalue(L, args.start + index);
  const status = lua.lua_pcall(L, 1 + args.count, 1, 0);
  if (status !== lua.LUA_OK) return false;
  const result = lua.lua_toboolean(L, -1);
  lua.lua_pop(L, 1);
  return Boolean(result);
}

function readFilterArgs(L: unknown, start: number): LuaFilterArgs {
  const top = lua.lua_gettop(L);
  return { start, count: Math.max(0, top - start + 1) };
}

function fieldGroupUids(session: DuelSession, player: PlayerId, selfMask: number, opponentMask: number): string[] {
  return [
    ...matchingCardUids(session, player, selfMask),
    ...matchingCardUids(session, otherPlayer(player), opponentMask),
  ];
}

function matchingCardUids(session: DuelSession, player: PlayerId, locationMask: number): string[] {
  const locations = locationsFromMask(locationMask);
  return session.state.cards
    .filter((card) => card.controller === player && locations.includes(card.location))
    .sort((a, b) => a.sequence - b.sequence)
    .map((card) => card.uid);
}

function setOperatedUids(hostState: LuaDuelDeckApiHostState, uids: string[]): void {
  hostState.operatedUids.splice(0, hostState.operatedUids.length, ...uids);
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}

function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}
