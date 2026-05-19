import fengari from "fengari";
import { collectDuelTriggerEffects, destroyDuelCard } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { luaEffectReasonPayload } from "#lua/duel-api/event-payload.js";
import { luaMoveBlockedByImmunity, type LuaMoveImmunityHostState } from "#lua/duel-api/move-immunity.js";
import { didMove, movementSnapshot } from "#lua/duel-api/move-card-state.js";
import { readCardOrGroupUids, readMoveReason, readOptionalPlayer, readSingleDestination } from "#lua/duel-api/move-readers.js";
import { uniqueUids } from "#lua/group-uid-utils.js";
import type { DuelCardInstance, DuelEffectContext, DuelEventName, DuelLocation, DuelSession, PlayerId } from "#duel/types.js";

const { lua, to_luastring } = fengari;

interface LuaDestroyHostState extends LuaMoveImmunityHostState {
  operatedUids: string[];
  summonNegatedUids: string[];
  activeContext?: DuelEffectContext | undefined;
}

interface LuaDestroyMoveHelpers {
  beginMoveStep(session: DuelSession, hostState: LuaDestroyHostState): void;
  finishMoveStep(hostState: LuaDestroyHostState, moved: boolean): void;
  assignReasonCard(card: DuelCardInstance, hostState: LuaDestroyHostState): void;
  regroupEvent(session: DuelSession, triggerStart: number, eventName: DuelEventName, eventUids: string[], eventLocation?: DuelLocation): void;
  setOperatedUids(hostState: LuaDestroyHostState, uids: string[]): void;
}

export function pushDestroyHelper(L: unknown, session: DuelSession, hostState: LuaDestroyHostState, helpers: LuaDestroyMoveHelpers): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const moved = destroyCardOrGroup(session, state, hostState, helpers);
    helpers.setOperatedUids(hostState, moved);
    lua.lua_pushinteger(state, moved.length);
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring("Destroy"));
}

function destroyCardOrGroup(session: DuelSession, L: unknown, hostState: LuaDestroyHostState, helpers: LuaDestroyMoveHelpers): string[] {
  if (session.state.status === "ended") return [];
  const reason = readMoveReason(L, 2, duelReason.destroy);
  const destination = readSingleDestination(L, 3) ?? "graveyard";
  const reasonPlayer = readOptionalPlayer(L, 4) ?? hostState.activeContext?.player ?? session.state.turnPlayer;
  const moved: string[] = [];
  helpers.beginMoveStep(session, hostState);
  const triggerStart = session.state.pendingTriggers.length;
  for (const uid of uniqueUids(readCardOrGroupUids(L, 1))) {
    const card = session.state.cards.find((candidate) => candidate.uid === uid);
    if (!card || luaMoveBlockedByImmunity(L, session, hostState, card, reason)) continue;
    if (completeNegatedSummonDestroy(session, card, hostState, helpers, reason ?? duelReason.destroy, reasonPlayer)) {
      moved.push(uid);
      continue;
    }
    const before = movementSnapshot(card);
    try {
      const result = destroyDuelCard(session.state, uid, card.controller, reason, reasonPlayer, destination, luaEffectReasonPayload(hostState, reason ?? duelReason.destroy, reasonPlayer));
      helpers.assignReasonCard(result, hostState);
      if (didMove(result, before)) moved.push(uid);
    } catch {
      // EDOPro-style helpers report the number of moved cards; illegal moves simply fail.
    }
  }
  helpers.finishMoveStep(hostState, moved.length > 0);
  helpers.regroupEvent(session, triggerStart, "moved", moved);
  helpers.regroupEvent(session, triggerStart, "leftField", moved.filter((uid) => session.state.cards.some((card) => card.uid === uid && (card.previousLocation === "monsterZone" || card.previousLocation === "spellTrapZone") && card.location !== "monsterZone" && card.location !== "spellTrapZone")));
  helpers.regroupEvent(session, triggerStart, "destroying", moved);
  helpers.regroupEvent(session, triggerStart, "destroyed", moved);
  helpers.regroupEvent(session, triggerStart, "banished", moved, "banished");
  return moved;
}

function completeNegatedSummonDestroy(
  session: DuelSession,
  card: DuelCardInstance,
  hostState: LuaDestroyHostState,
  helpers: LuaDestroyMoveHelpers,
  reason: number,
  reasonPlayer: PlayerId,
): boolean {
  if (!hostState.summonNegatedUids.includes(card.uid)) return false;
  if (card.location !== "graveyard" || card.previousLocation !== "monsterZone" || (card.reason ?? 0) !== duelReason.disSummon) return false;
  card.reason = reason;
  card.reasonPlayer = reasonPlayer;
  helpers.assignReasonCard(card, hostState);
  collectDuelTriggerEffects(session.state, "destroying", card);
  collectDuelTriggerEffects(session.state, "destroyed", card);
  hostState.summonNegatedUids.splice(0, hostState.summonNegatedUids.length, ...hostState.summonNegatedUids.filter((uid) => uid !== card.uid));
  return true;
}
