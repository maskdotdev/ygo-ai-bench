import fengari from "fengari";

export { installAuxApi } from "#lua/aux-api.js";
export { installConstants } from "#lua/basic-constants-api.js";

const { lua, lauxlib, to_luastring } = fengari;

export function installDebugApi(L: unknown, messages: string[]): void {
  lua.lua_newtable(L);
  lua.lua_pushcfunction(L, (state: unknown) => {
    const message = lua.lua_isstring(state, 1) ? lua.lua_tojsstring(state, 1) : "";
    messages.push(message);
    return 0;
  });
  lua.lua_setfield(L, -2, to_luastring("Message"));
  lua.lua_setglobal(L, to_luastring("Debug"));
}

export function installBitApi(L: unknown): void {
  lua.lua_newtable(L);
  pushBitFunction(L, "band", (state) => foldBitArgs(state, (left, right) => left & right));
  pushBitFunction(L, "bor", (state) => foldBitArgs(state, (left, right) => left | right));
  pushBitFunction(L, "bxor", (state) => foldBitArgs(state, (left, right) => left ^ right));
  pushBitFunction(L, "lshift", (state) => pushBitInteger(state, readBitInteger(state, 1) << readBitShift(state, 2)));
  pushBitFunction(L, "rshift", (state) => pushBitInteger(state, readBitInteger(state, 1) >> readBitShift(state, 2)));
  pushBitFunction(L, "bnot", (state) => pushBitInteger(state, ~readBitInteger(state, 1)));
  pushBitFunction(L, "extract", pushBitExtract);
  pushBitFunction(L, "replace", pushBitReplace);
  lua.lua_setglobal(L, to_luastring("bit"));
}

function pushBitFunction(L: unknown, name: string, fn: (state: unknown) => number): void {
  lua.lua_pushcfunction(L, fn);
  lua.lua_setfield(L, -2, to_luastring(name));
}

function foldBitArgs(L: unknown, op: (left: bigint, right: bigint) => bigint): number {
  const top = lua.lua_gettop(L);
  let value = readBitInteger(L, 1);
  for (let index = 2; index <= top; index += 1) value = op(value, readBitInteger(L, index));
  return pushBitInteger(L, value);
}

function pushBitExtract(L: unknown): number {
  const args = readBitFieldArgs(L, 2);
  if (typeof args === "number") return args;
  const value = (readBitInteger(L, 1) >> BigInt(args.field)) & args.mask;
  return pushBitInteger(L, value);
}

function pushBitReplace(L: unknown): number {
  const args = readBitFieldArgs(L, 3);
  if (typeof args === "number") return args;
  const value = readBitInteger(L, 1);
  const replacement = readBitInteger(L, 2);
  return pushBitInteger(L, (value & ~(args.mask << BigInt(args.field))) | ((replacement & args.mask) << BigInt(args.field)));
}

function readBitFieldArgs(L: unknown, fieldIndex: number): { field: number; mask: bigint } | number {
  const field = Number(readBitInteger(L, fieldIndex));
  const widthIndex = fieldIndex + 1;
  const width = lua.lua_isnumber(L, widthIndex) ? Number(readBitInteger(L, widthIndex)) : 1;
  if (field < 0) return lauxlib.luaL_error(L, to_luastring("field cannot be negative"));
  if (width <= 0) return lauxlib.luaL_error(L, to_luastring("width must be positive"));
  if (field + width > 64) return lauxlib.luaL_error(L, to_luastring("trying to access non-existent bits"));
  return { field, mask: ~(-1n << BigInt(width)) };
}

function readBitInteger(L: unknown, index: number): bigint {
  return lua.lua_isnumber(L, index) ? BigInt(Math.trunc(lua.lua_tointeger(L, index))) : 0n;
}

function readBitShift(L: unknown, index: number): bigint {
  return BigInt(Number(readBitInteger(L, index)));
}

function pushBitInteger(L: unknown, value: bigint): number {
  lua.lua_pushinteger(L, Number(value));
  return 1;
}
