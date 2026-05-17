import fengari from "fengari";
import { isFieldZoneDisabled } from "#duel/disabled-field-zones.js";
import { readCardUid } from "#lua/api-utils.js";
import type { DuelCardInstance, DuelSession, DuelState, PlayerId } from "#duel/types.js";
import type { LuaCardApiEffectRecord, LuaCardApiState } from "#lua/card-api-types.js";

const { lua, to_luastring } = fengari;

export function installCardAdjacentApi<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): void {
  pushBooleanGetter(L, "CheckAdjacent", session, (card) => Boolean(card && hasAdjacentMonsterZone(session.state, card)));
  lua.lua_pushcfunction(L, (state: unknown) => pushSelectAdjacent(state, session));
  lua.lua_setfield(L, -2, to_luastring("SelectAdjacent"));
  lua.lua_pushcfunction(L, (state: unknown) => pushMoveAdjacent(state, session, hostState));
  lua.lua_setfield(L, -2, to_luastring("MoveAdjacent"));
}

function pushBooleanGetter(L: unknown, fieldName: string, session: DuelSession, getter: (card: DuelCardInstance | undefined) => boolean): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, getter(readCard(state, session)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function pushSelectAdjacent(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const sequence = firstOpenAdjacentMonsterSequence(session.state, card);
  if (sequence === undefined) {
    lua.lua_pushnil(L);
    return 1;
  }
  lua.lua_pushinteger(L, sequence);
  return 1;
}

function pushMoveAdjacent<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): number {
  if (session.state.status === "ended") {
    hostState.operatedUids?.splice(0, hostState.operatedUids.length);
    return 0;
  }
  const card = readCard(L, session);
  const sequence = firstOpenAdjacentMonsterSequence(session.state, card);
  if (!card || sequence === undefined) return 0;
  card.sequence = sequence;
  hostState.operatedUids?.splice(0, hostState.operatedUids.length, card.uid);
  return 0;
}

function firstOpenAdjacentMonsterSequence(state: DuelState, card: DuelCardInstance | undefined): number | undefined {
  if (!card || card.location !== "monsterZone" || card.sequence < 0 || card.sequence > 4) return undefined;
  for (const sequence of [card.sequence - 1, card.sequence + 1]) {
    if (sequence >= 0 && sequence <= 4 && isMonsterSequenceOpen(state, card.controller, sequence)) return sequence;
  }
  return undefined;
}

function hasAdjacentMonsterZone(state: DuelState, card: DuelCardInstance): boolean {
  if (card.location !== "monsterZone" || card.sequence > 4) return false;
  return [card.sequence - 1, card.sequence + 1].some(
    (sequence) =>
      sequence >= 0 &&
      sequence <= 4 &&
      !isFieldZoneDisabled(state, card.controller, "monsterZone", sequence) &&
      !state.cards.some((candidate) => candidate.controller === card.controller && candidate.location === "monsterZone" && candidate.sequence === sequence),
  );
}

function isMonsterSequenceOpen(state: DuelState, player: PlayerId, sequence: number): boolean {
  return !isFieldZoneDisabled(state, player, "monsterZone", sequence) && !state.cards.some((card) => card.controller === player && card.location === "monsterZone" && card.sequence === sequence);
}

function readCard(L: unknown, session: DuelSession): DuelCardInstance | undefined {
  const uid = readCardUid(L, 1);
  return uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
}
