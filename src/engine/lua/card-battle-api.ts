import fengari from "fengari";
import { isDuelCardPendingBattleDestroyed } from "#duel/battle.js";
import { isPhaseEntryPrevented } from "#duel/continuous-effects.js";
import { canDuelCardAttack, getDuelAttackableTargets } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { nextAvailableDuelPhase } from "#duel/turn-flow.js";
import { readCardUid } from "#lua/api-utils.js";
import { pushCardTable } from "#lua/card-api.js";
import { readRequestedNumbers } from "#lua/card-code-utils.js";
import { matchingLuaEffects } from "#lua/card-effect-query-api.js";
import { cardTypeFlags } from "#lua/card-stat-api.js";
import { pushGroupTable } from "#lua/group-api.js";
import type { LuaCardApiEffectRecord, LuaCardApiState } from "#lua/card-api-types.js";
import type { CardPosition, DuelCardInstance, DuelEffectContext, DuelEffectDefinition, DuelPhase, DuelSession, DuelState } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installCardBattleApi<EffectRecord extends LuaCardApiEffectRecord>(
  L: unknown,
  session: DuelSession,
  hostState: LuaCardApiState<EffectRecord>,
): void {
  pushBooleanGetter(L, "CanAttack", session, (card) => Boolean(card && canLuaCardAttack(session.state, card)));
  lua.lua_pushcfunction(L, (state: unknown) => pushCanChainAttack(state, session));
  lua.lua_setfield(L, -2, to_luastring("CanChainAttack"));
  pushNumberGetter(L, "GetAttackAnnouncedCount", session, (card) => (card ? session.state.attacksDeclared.filter((uid) => uid === card.uid).length : 0));
  pushBooleanGetter(L, "IsDirectAttacked", session, (card) => Boolean(card && isDirectAttacked(session.state, card)));
  pushBooleanGetter(L, "CanGetPiercingRush", session, (card) => Boolean(card && canGetPiercingRush(session.state, card, hostState)));
  pushNumberGetter(L, "GetBattlePosition", session, (card) => positionMaskFromPosition(card?.battlePosition ?? card?.position));
  lua.lua_pushcfunction(L, (state: unknown) => {
    const card = readCard(state, session);
    const requested = readRequestedNumbers(state, 2);
    const battlePosition = positionMaskFromPosition(card?.battlePosition ?? card?.position);
    lua.lua_pushboolean(state, Boolean(card && requested.some((value) => (battlePosition & value) !== 0)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("IsBattlePosition"));
  pushBooleanGetter(L, "IsBattleDestroyed", session, (card) => Boolean(card && isBattleDestroyed(session.state, card)));
  lua.lua_pushcfunction(L, (state: unknown) => pushBattleTarget(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetBattleTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => pushAttackableTarget(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetAttackableTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => pushIsCanBeBattleTarget(state, session));
  lua.lua_setfield(L, -2, to_luastring("IsCanBeBattleTarget"));
  lua.lua_pushcfunction(L, (state: unknown) => pushBattledGroup(state, session));
  lua.lua_setfield(L, -2, to_luastring("GetBattledGroup"));
  pushNumberGetter(L, "GetBattledGroupCount", session, (card) => battledOpponentUids(session, card).length);
  pushNumberGetter(L, "GetAttackedCount", session, (card) => (card ? session.state.battlePairs.filter((pair) => pair.attackerUid === card.uid).length : 0));
}

function canLuaCardAttack(state: DuelState, card: DuelCardInstance): boolean {
  const attack = state.currentAttack ?? state.pendingBattle;
  if (state.status === "resolving" && attack?.attackerUid === card.uid && card.location === "monsterZone" && !state.attackCanceledUids.includes(card.uid)) return true;
  return canDuelCardAttack(state, card.uid);
}

function isDirectAttacked(state: DuelState, card: DuelCardInstance): boolean {
  const activeAttack = state.currentAttack ?? state.pendingBattle;
  if (activeAttack?.attackerUid === card.uid && activeAttack.targetUid === undefined) return true;
  return state.attacksDeclared.includes(card.uid) && !state.battlePairs.some((pair) => pair.attackerUid === card.uid);
}

function pushNumberGetter(L: unknown, fieldName: string, session: DuelSession, getter: (card: DuelCardInstance | undefined) => number): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushinteger(state, getter(readCard(state, session)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function pushBooleanGetter(L: unknown, fieldName: string, session: DuelSession, getter: (card: DuelCardInstance | undefined) => boolean): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    lua.lua_pushboolean(state, getter(readCard(state, session)));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}

function readCard(L: unknown, session: DuelSession): DuelCardInstance | undefined {
  const uid = readCardUid(L, 1);
  return uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
}

function pushBattleTarget(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const attack = session.state.currentAttack ?? session.state.pendingBattle;
  const targetUid =
    attack && card?.uid === attack.attackerUid
      ? attack.targetUid
      : attack && card?.uid === attack.targetUid
        ? attack.attackerUid
        : battlePairTargetUid(session, card);
  if (!targetUid) lua.lua_pushnil(L);
  else pushCardTable(L, targetUid);
  return 1;
}

function battlePairTargetUid(session: DuelSession, card: DuelCardInstance | undefined): string | undefined {
  if (!card) return undefined;
  for (let i = session.state.battlePairs.length - 1; i >= 0; i--) {
    const pair = session.state.battlePairs[i]!;
    if (pair.attackerUid === card.uid) return pair.targetUid;
    if (pair.targetUid === card.uid) return pair.attackerUid;
  }
  return undefined;
}

function pushAttackableTarget(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const result = card ? getDuelAttackableTargets(session.state, card.uid) : { targets: [], directAttack: false };
  pushGroupTable(L, result.targets.map((target) => target.uid));
  lua.lua_pushboolean(L, result.directAttack);
  return 2;
}

function pushIsCanBeBattleTarget(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const attackerUid = readCardUid(L, 2);
  const attacker = attackerUid ? session.state.cards.find((candidate) => candidate.uid === attackerUid) : undefined;
  lua.lua_pushboolean(L, Boolean(
    card &&
    attacker &&
    card.uid !== attacker.uid &&
    card.location === "monsterZone" &&
    attacker.location === "monsterZone" &&
    card.controller !== attacker.controller,
  ));
  return 1;
}

function pushBattledGroup(L: unknown, session: DuelSession): number {
  pushGroupTable(L, battledOpponentUids(session, readCard(L, session)));
  return 1;
}

function battledOpponentUids(session: DuelSession, card: DuelCardInstance | undefined): string[] {
  if (!card) return [];
  const opponents = session.state.battlePairs.flatMap((pair) => {
    if (pair.attackerUid === card.uid) return [pair.targetUid];
    if (pair.targetUid === card.uid) return [pair.attackerUid];
    return [];
  });
  return [...new Set(opponents)].filter((uid) => session.state.cards.some((candidate) => candidate.uid === uid));
}

function isBattleDestroyed(state: DuelState, card: DuelCardInstance): boolean {
  return isDuelCardPendingBattleDestroyed(state, card.uid) || (card.reason ?? 0) === ((card.reason ?? 0) | duelReason.battle | duelReason.destroy);
}

function pushCanChainAttack(L: unknown, session: DuelSession): number {
  const card = readCard(L, session);
  const requestedAllowance = lua.lua_isnumber(L, 2) ? lua.lua_tointeger(L, 2) : 1;
  const attackCount = card ? session.state.attacksDeclared.filter((uid) => uid === card.uid).length : 0;
  lua.lua_pushboolean(L, Boolean(card && attackCount > 0 && canDuelCardAttack(session.state, card.uid, requestedAllowance)));
  return 1;
}

function canGetPiercingRush<EffectRecord extends LuaCardApiEffectRecord>(state: DuelState, card: DuelCardInstance, hostState: LuaCardApiState<EffectRecord>): boolean {
  if ((cardTypeFlags(card, state) & 0x1) === 0 || !canEnterBattlePhase(state)) return false;
  if (matchingLuaEffects(state, card, 85, hostState).length > 0) return false;
  const pierceEffects = matchingLuaEffects(state, card, 203, hostState);
  return pierceEffects.length === 0 || pierceEffects.some((effect) => (effect.reset?.flags ?? 0) === 0);
}

function canEnterBattlePhase(state: DuelState): boolean {
  return nextAvailableDuelPhase(state, state.turnPlayer, (phase) => canEnterPhase(state, phase)) === "battle";
}

function canEnterPhase(state: DuelState, phase: DuelPhase): boolean {
  if (phase !== "battle" && phase !== "main2" && phase !== "end") return true;
  return !isPhaseEntryPrevented(state, state.turnPlayer, phase, createContinuousPhaseContext(state));
}

function createContinuousPhaseContext(state: DuelState) {
  return (effect: DuelEffectDefinition, source: DuelCardInstance): DuelEffectContext => ({
    duel: state,
    source,
    player: effect.controller,
    checkOnly: true,
    targetUids: [],
    log() {},
    moveCard() {
      throw new Error("Cannot move cards while checking phase entry");
    },
    negateChainLink() {
      return false;
    },
    setTargets() {},
    getTargets() {
      return [];
    },
    setTargetPlayer() {},
    setTargetParam() {},
  });
}

function positionMaskFromPosition(position: CardPosition | undefined): number {
  if (position === "faceUpAttack") return 0x1;
  if (position === "faceUpDefense") return 0x4;
  if (position === "faceDownDefense") return 0x8;
  return 0;
}
