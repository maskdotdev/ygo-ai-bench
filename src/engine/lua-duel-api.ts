import fengari from "fengari";
import { installDuelActivityApi } from "./lua-duel-activity-api.js";
import { installDuelBattleApi } from "./lua-duel-battle-api.js";
import { installDuelChainApi } from "./lua-duel-chain-api.js";
import { installDuelDeckApi } from "./lua-duel-deck-api.js";
import { installDuelFlagApi } from "./lua-duel-flag-api.js";
import { installDuelLpApi } from "./lua-duel-lp-api.js";
import { installDuelMoveApi } from "./lua-duel-move-api.js";
import { installDuelOperationApi } from "./lua-duel-operation-api.js";
import { installDuelPlayerApi } from "./lua-duel-player-api.js";
import { installDuelPromptApi } from "./lua-duel-prompt-api.js";
import { installDuelQueryApi } from "./lua-duel-query-api.js";
import { installDuelReleaseApi } from "./lua-duel-release-api.js";
import { installDuelSummonApi } from "./lua-duel-summon-api.js";
import { installDuelTurnApi } from "./lua-duel-turn-api.js";
import type { LuaDuelOperationInfo } from "./lua-duel-operation-api.js";
import type { DuelSession } from "./duel-types.js";

const { lua, to_luastring } = fengari;

export interface LuaDuelApiHostState {
  messages: string[];
  activeTargetUids: string[] | undefined;
  operationInfos: LuaDuelOperationInfo[];
  operatedUids: string[];
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
  installDuelReleaseApi(L, session);
  installDuelOperationApi(L, hostState);
  installDuelFlagApi(L, session);
  lua.lua_setglobal(L, to_luastring("Duel"));
}
