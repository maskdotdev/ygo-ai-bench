import fengari from "fengari";
import { installCardAdjacentApi } from "#lua/card-adjacent-api.js";
import { installCardArchetypeApi } from "#lua/card-archetype-api.js";
import { installCardBattleApi } from "#lua/card-battle-api.js";
import { installCardCodeApi } from "#lua/card-code-api.js";
import { installCardColumnApi } from "#lua/card-column-api.js";
import { installCardControlApi } from "#lua/card-control-api.js";
import { installCardCounterApi } from "#lua/card-counter-api.js";
import { installCardEffectRegistrationApi } from "#lua/card-effect-registration-api.js";
import { installCardEffectQueryApi } from "#lua/card-effect-query-api.js";
import { installCardEffectCopyApi } from "#lua/card-effect-copy-api.js";
import { installCardEffectResetApi } from "#lua/card-effect-reset-api.js";
import { installCardEquipApi } from "#lua/card-equip-api.js";
import { installCardFlagApi } from "#lua/card-flag-api.js";
import { installCardLinkApi } from "#lua/card-link-api.js";
import { installCardLinkedApi } from "#lua/card-linked-api.js";
import { installCardMaterialApi } from "#lua/card-material-api.js";
import { installCardMoveAbilityApi } from "#lua/card-move-ability-api.js";
import { installCardOverlayApi } from "#lua/card-overlay-api.js";
import { installCardPreviousStateApi } from "#lua/card-previous-state-api.js";
import { installCardReasonApi } from "#lua/card-reason-api.js";
import { installCardRelationApi } from "#lua/card-relation-api.js";
import { installCardRushApi } from "#lua/card-rush-api.js";
import { installCardStatApi } from "#lua/card-stat-api.js";
import { installCardStateApi } from "#lua/card-state-api.js";
import { installCardStatusApi } from "#lua/card-status-api.js";
import { installCardSummonApi } from "#lua/card-summon-api.js";
import { installCardSummonPredicateApi } from "#lua/card-summon-predicate-api.js";
import { installCardTableApi, pushCardTable } from "#lua/card-table-api.js";
import { installCardTypePredicateApi } from "#lua/card-type-predicate-api.js";
import type { DuelCardInstance, DuelEffectDefinition, DuelSession } from "#duel/types.js";
import type { LuaCardApiEffectRecord, LuaCardApiState } from "#lua/card-api-types.js";

const { lua, to_luastring } = fengari;

export type { LuaCardApiEffectRecord, LuaCardApiState } from "#lua/card-api-types.js";
export { cardFieldId } from "#duel/card-field-id.js";
export { pushCardTable } from "#lua/card-table-api.js";

export function installCardApi<EffectRecord extends LuaCardApiEffectRecord>(
  L: unknown,
  session: DuelSession,
  hostState: LuaCardApiState<EffectRecord>,
  toDuelEffect: (card: DuelCardInstance, luaEffect: EffectRecord, state: unknown) => DuelEffectDefinition,
): void {
  lua.lua_newtable(L);
  installCardEffectRegistrationApi(L, session, hostState, toDuelEffect);
  installCardEffectCopyApi(L, session, hostState);
  installCardEffectResetApi(L, session);
  installCardTableApi(L);
  installCardCodeApi(L, session, hostState);
  installCardStatApi(L, session, hostState);
  installCardBattleApi(L, session, hostState);
  installCardLinkApi(L, session);
  installCardReasonApi(L, session, hostState);
  installCardStatusApi(L, session, hostState);
  installStateHelpers(L, session, hostState);
  installCardFlagApi(L, session);
  lua.lua_setglobal(L, to_luastring("Card"));
}

function installStateHelpers<EffectRecord extends LuaCardApiEffectRecord>(L: unknown, session: DuelSession, hostState: LuaCardApiState<EffectRecord>): void {
  installCardStateApi(L, session);
  installCardOverlayApi(L, session, hostState);
  installCardEquipApi(L, session, hostState);
  installCardCounterApi(L, session, hostState);
  installCardRushApi(L, session, hostState);
  installCardTypePredicateApi(L, session);
  installCardLinkedApi(L, session);
  installCardArchetypeApi(L, session, hostState);
  installCardAdjacentApi(L, session, hostState);
  installCardPreviousStateApi(L, session, hostState);
  installCardColumnApi(L, session);
  installCardControlApi(L, session);
  installCardSummonApi(L, session);
  installCardMoveAbilityApi(L, session, hostState);
  installCardRelationApi(L, session, hostState);
  installCardEffectQueryApi(L, session, hostState);
  installCardSummonPredicateApi(L, session, hostState);
  installCardMaterialApi(L, session);
}
