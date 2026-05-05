import fengari from "fengari";
import { pushCardTable } from "#lua/card-api.js";
import type { DuelCardData, DuelCardInstance, DuelSession, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installDuelTokenApi(L: unknown, session: DuelSession): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    if (session.state.status === "ended") {
      lua.lua_pushnil(state);
      return 1;
    }
    const player = normalizePlayer(lua.lua_isnumber(state, 1) ? lua.lua_tointeger(state, 1) : session.state.turnPlayer);
    const code = String(lua.lua_isnumber(state, 2) ? lua.lua_tointeger(state, 2) : 0);
    const token = createToken(session, player, code);
    pushCardTable(state, token.uid);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("CreateToken"));
}

function createToken(session: DuelSession, player: PlayerId, code: string): DuelCardInstance {
  const data = tokenData(session, code);
  const token: DuelCardInstance = {
    uid: `lua-token-${player}-${code}-${session.state.cards.length}`,
    code,
    name: data.name,
    kind: "monster",
    owner: player,
    controller: player,
    location: "hand",
    sequence: nextSequence(session, player),
    position: "faceDown",
    overlayUids: [],
    faceUp: false,
    data,
  };
  session.state.cards.push(token);
  return token;
}

function tokenData(session: DuelSession, code: string): DuelCardData {
  const data = session.cardReader(code);
  if (data) return { ...data, kind: "monster" };
  return { code, name: `Token ${code}`, kind: "monster", typeFlags: 0x4000_0001 };
}

function nextSequence(session: DuelSession, player: PlayerId): number {
  const hand = session.state.cards.filter((card) => card.controller === player && card.location === "hand");
  return hand.length === 0 ? 0 : Math.max(...hand.map((card) => card.sequence)) + 1;
}

function normalizePlayer(value: number): PlayerId {
  return value === 1 ? 1 : 0;
}
