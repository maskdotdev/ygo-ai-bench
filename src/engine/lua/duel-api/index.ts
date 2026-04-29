import fengari from "fengari";
import { installDuelActivityApi } from "#lua/duel-api/activity.js";
import { installDuelBattleApi } from "#lua/duel-api/battle.js";
import { installDuelChainApi } from "#lua/duel-api/chain.js";
import { installDuelDeckApi } from "#lua/duel-api/deck.js";
import { installDuelFlagApi } from "#lua/duel-api/flag.js";
import { installDuelLpApi } from "#lua/duel-api/lp.js";
import { installDuelMoveApi } from "#lua/duel-api/move.js";
import { installDuelOperationApi } from "#lua/duel-api/operation.js";
import { installDuelPlayerApi } from "#lua/duel-api/player.js";
import { installDuelPromptApi } from "#lua/duel-api/prompt.js";
import { installDuelQueryApi } from "#lua/duel-api/query.js";
import { installDuelReleaseApi } from "#lua/duel-api/release.js";
import { installDuelSummonApi } from "#lua/duel-api/summon.js";
import { installDuelTurnApi } from "#lua/duel-api/turn.js";
import type { LuaDuelOperationInfo } from "#lua/duel-api/operation.js";
import type { DuelSession } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export interface LuaDuelApiHostState {
  messages: string[];
  activeTargetUids: string[] | undefined;
  operationInfos: LuaDuelOperationInfo[];
  operatedUids: string[];
  selectedUids: string[];
  pushEffectTable: (state: unknown, id: number) => void;
}

export function installDuelApi(L: unknown, session: DuelSession, hostState: LuaDuelApiHostState): void {
  lua.lua_newtable(L);
  installDuelTurnApi(L, session);
  installDuelPromptApi(L, hostState);
  installDuelBattleApi(L, session);
  installDuelChainApi(L, session, hostState);
  installDuelActivityApi(L, session);
  installDuelLpApi(L, session);
  installDuelDeckApi(L, session, hostState);
  installDuelPlayerApi(L, session);
  installDuelMoveApi(L, session, hostState);
  installDuelSummonApi(L, session, hostState);
  installDuelQueryApi(L, session, hostState);
  installDuelReleaseApi(L, session, hostState);
  installDuelOperationApi(L, hostState);
  installDuelFlagApi(L, session);
  lua.lua_setglobal(L, to_luastring("Duel"));
}
