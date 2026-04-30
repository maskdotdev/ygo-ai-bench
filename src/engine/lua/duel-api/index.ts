import fengari from "fengari";
import { installDuelActivityApi } from "#lua/duel-api/activity.js";
import { installDuelBattleApi } from "#lua/duel-api/battle.js";
import { installDuelChainApi } from "#lua/duel-api/chain.js";
import { installDuelDeckApi } from "#lua/duel-api/deck.js";
import { installDuelEffectApi } from "#lua/duel-api/effect.js";
import { installDuelFlagApi } from "#lua/duel-api/flag.js";
import { installDuelLpApi } from "#lua/duel-api/lp.js";
import { installDuelMoveApi } from "#lua/duel-api/move.js";
import { installDuelOperationApi } from "#lua/duel-api/operation.js";
import { installDuelPlayerApi } from "#lua/duel-api/player.js";
import { installDuelPromptApi } from "#lua/duel-api/prompt.js";
import { installDuelQueryApi } from "#lua/duel-api/query.js";
import { installDuelRandomApi } from "#lua/duel-api/random.js";
import { installDuelReleaseApi } from "#lua/duel-api/release.js";
import { installDuelScriptApi, type LuaDuelScriptApiHostState } from "#lua/duel-api/script.js";
import { installDuelSummonApi } from "#lua/duel-api/summon.js";
import { installDuelTokenApi } from "#lua/duel-api/token.js";
import { installDuelTurnApi } from "#lua/duel-api/turn.js";
import type { LuaDuelOperationInfo } from "#lua/duel-api/operation.js";
import type { DuelEffectContext, DuelSession } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export interface LuaDuelApiHostState extends LuaDuelScriptApiHostState {
  messages: string[];
  activeTargetUids: string[] | undefined;
  activeContext: DuelEffectContext | undefined;
  operationInfos: LuaDuelOperationInfo[];
  possibleOperationInfos: LuaDuelOperationInfo[];
  operatedUids: string[];
  selectedUids: string[];
  pushEffectTable: (state: unknown, id: number) => void;
  getEffectTypeFlags: (id: number) => number | undefined;
  registerEffect: (state: unknown, id: number, player: 0 | 1) => boolean;
}

export function installDuelApi(L: unknown, session: DuelSession, hostState: LuaDuelApiHostState): void {
  lua.lua_newtable(L);
  installDuelTurnApi(L, session);
  installDuelPromptApi(L, session, hostState);
  installDuelBattleApi(L, session);
  installDuelChainApi(L, session, hostState);
  installDuelActivityApi(L, session);
  installDuelLpApi(L, session);
  installDuelDeckApi(L, session, hostState);
  installDuelEffectApi(L, hostState);
  installDuelPlayerApi(L, session, hostState);
  installDuelMoveApi(L, session, hostState);
  installDuelSummonApi(L, session, hostState);
  installDuelQueryApi(L, session, hostState);
  installDuelRandomApi(L, session);
  installDuelReleaseApi(L, session, hostState);
  installDuelOperationApi(L, session, hostState);
  installDuelTokenApi(L, session);
  installDuelFlagApi(L, session);
  installDuelScriptApi(L, hostState);
  lua.lua_setglobal(L, to_luastring("Duel"));
}
