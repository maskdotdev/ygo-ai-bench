import fengari from "fengari";
import type { DuelSession } from "#duel/types.js";

const { lua } = fengari;

export function readCardDataByCode(L: unknown, session: DuelSession, index: number): ReturnType<DuelSession["cardReader"]> | undefined {
  if (!lua.lua_isnumber(L, index) && !lua.lua_isstring(L, index)) return undefined;
  const code = String(lua.lua_isnumber(L, index) ? lua.lua_tointeger(L, index) : lua.lua_tojsstring(L, index));
  return session.cardReader(code);
}

export function cardTypeFlags(data: ReturnType<DuelSession["cardReader"]>): number {
  if (!data) return 0;
  if (data.typeFlags !== undefined) return data.typeFlags;
  if (data.kind === "spell") return 0x2;
  if (data.kind === "trap") return 0x4;
  return 0x1;
}
