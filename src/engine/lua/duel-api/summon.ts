import fengari from "fengari";
import {
  applyResponse,
  fusionSummonDuelCard,
  linkSummonDuelCard,
  ritualSummonDuelCard,
  synchroSummonDuelCard,
  xyzSummonDuelCard,
} from "#duel/core.js";
import { readCardUid, readGroupUids } from "#lua/api-utils.js";
import type { DuelSession } from "#duel/types.js";

const { lua, to_luastring } = fengari;

type LuaSummonType = "FusionSummon" | "SynchroSummon" | "XyzSummon" | "LinkSummon" | "RitualSummon";

export interface LuaDuelSummonApiHostState {
  operatedUids: string[];
}

export function installDuelSummonApi(L: unknown, session: DuelSession, hostState: LuaDuelSummonApiHostState): void {
  pushBasicSummonHelper(L, "Summon", session, hostState, "normalSummon");
  pushBasicSummonHelper(L, "MSet", session, hostState, "setMonster");
  pushBasicSummonHelper(L, "SSet", session, hostState, "setSpellTrap");
  pushSummonHelper(L, "FusionSummon", session, hostState, "FusionSummon");
  pushSummonHelper(L, "SynchroSummon", session, hostState, "SynchroSummon");
  pushSummonHelper(L, "XyzSummon", session, hostState, "XyzSummon");
  pushSummonHelper(L, "LinkSummon", session, hostState, "LinkSummon");
  pushSummonHelper(L, "RitualSummon", session, hostState, "RitualSummon");
}

function pushBasicSummonHelper(L: unknown, fieldName: string, session: DuelSession, hostState: LuaDuelSummonApiHostState, type: "normalSummon" | "setMonster" | "setSpellTrap"): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushBasicSummonResult(state, session, hostState, type));
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function pushSummonHelper(L: unknown, fieldName: string, session: DuelSession, hostState: LuaDuelSummonApiHostState, summonType: LuaSummonType): void {
  lua.lua_pushcfunction(L, (state: unknown) => pushLuaSummonResult(state, session, hostState, summonType));
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function pushBasicSummonResult(L: unknown, session: DuelSession, hostState: LuaDuelSummonApiHostState, type: "normalSummon" | "setMonster" | "setSpellTrap"): number {
  const targetUid = readFirstCardOrGroupUid(L, 1);
  const target = targetUid ? session.state.cards.find((candidate) => candidate.uid === targetUid) : undefined;
  if (!target) {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  const result = applyResponse(session, { type, player: target.controller, uid: target.uid, label: basicSummonLabel(type, target.name) });
  setOperatedUids(hostState, result.ok ? [target.uid] : []);
  lua.lua_pushinteger(L, result.ok ? 1 : 0);
  return 1;
}

function basicSummonLabel(type: "normalSummon" | "setMonster" | "setSpellTrap", name: string): string {
  if (type === "normalSummon") return `Normal Summon ${name}`;
  return `Set ${name}`;
}

function pushLuaSummonResult(L: unknown, session: DuelSession, hostState: LuaDuelSummonApiHostState, summonType: LuaSummonType): number {
  const targetUid = readCardUid(L, 1);
  const materialUids = readCardOrGroupUids(L, 2);
  const target = targetUid ? session.state.cards.find((candidate) => candidate.uid === targetUid) : undefined;
  if (!target) {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
    return 1;
  }
  try {
    if (summonType === "FusionSummon") fusionSummonDuelCard(session.state, target.controller, target.uid, materialUids);
    else if (summonType === "SynchroSummon") synchroSummonDuelCard(session.state, target.controller, target.uid, materialUids);
    else if (summonType === "XyzSummon") xyzSummonDuelCard(session.state, target.controller, target.uid, materialUids);
    else if (summonType === "LinkSummon") linkSummonDuelCard(session.state, target.controller, target.uid, materialUids);
    else ritualSummonDuelCard(session.state, target.controller, target.uid, materialUids);
    setOperatedUids(hostState, [target.uid]);
    lua.lua_pushinteger(L, 1);
  } catch {
    setOperatedUids(hostState, []);
    lua.lua_pushinteger(L, 0);
  }
  return 1;
}

function readFirstCardOrGroupUid(L: unknown, index: number): string | undefined {
  return readCardUid(L, index) ?? readGroupUids(L, index)[0];
}

function readCardOrGroupUids(L: unknown, index: number): string[] {
  const cardUid = readCardUid(L, index);
  return cardUid ? [cardUid] : readGroupUids(L, index);
}

function setOperatedUids(hostState: LuaDuelSummonApiHostState, uids: string[]): void {
  hostState.operatedUids.splice(0, hostState.operatedUids.length, ...uids);
}
