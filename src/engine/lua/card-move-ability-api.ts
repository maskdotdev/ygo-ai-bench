import fengari from "fengari";
import { canMoveDuelCardToLocation } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { readCardUid } from "#lua/api-utils.js";
import { canMoveCardToDeckOrExtraAsCost } from "#lua/card-eligibility-api.js";
import type { DuelCardInstance, DuelSession } from "#duel/types.js";

const { lua, to_luastring } = fengari;

export function installCardMoveAbilityApi(L: unknown, session: DuelSession): void {
  pushBooleanGetter(L, "IsAbleToGrave", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "graveyard")));
  pushBooleanGetter(L, "IsAbleToGraveAsCost", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "graveyard", duelReason.cost)));
  pushBooleanGetter(L, "IsAbleToHand", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "hand")));
  pushBooleanGetter(L, "IsAbleToHandAsCost", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "hand", duelReason.cost)));
  pushBooleanGetter(L, "IsAbleToDeck", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "deck")));
  pushBooleanGetter(L, "IsAbleToDeckAsCost", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "deck", duelReason.cost)));
  pushBooleanGetter(L, "IsAbleToDeckOrExtraAsCost", session, (card, uid) => Boolean(card && uid && canMoveCardToDeckOrExtraAsCost(session.state, card, uid)));
  pushBooleanGetter(L, "IsAbleToRemove", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "banished")));
  pushBooleanGetter(L, "IsAbleToRemoveAsCost", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "banished", duelReason.cost)));
  pushBooleanGetter(L, "IsAbleToExtra", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "extraDeck")));
  pushBooleanGetter(L, "IsReleasable", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "graveyard", duelReason.release | duelReason.cost)));
  pushBooleanGetter(L, "IsReleasableByEffect", session, (_, uid) => Boolean(uid && canMoveDuelCardToLocation(session.state, uid, "graveyard", duelReason.release | duelReason.effect)));
  pushBooleanGetter(L, "IsDiscardable", session, (card, uid) => Boolean(card && uid && card.location === "hand" && canMoveDuelCardToLocation(session.state, uid, "graveyard", duelReason.cost)));
}

function pushBooleanGetter(L: unknown, fieldName: string, session: DuelSession, getter: (card: DuelCardInstance | undefined, uid: string | undefined) => boolean): void {
  lua.lua_pushcfunction(L, (state: unknown) => {
    const uid = readCardUid(state, 1);
    const card = uid ? session.state.cards.find((candidate) => candidate.uid === uid) : undefined;
    lua.lua_pushboolean(state, getter(card, uid));
    return 1;
  });
  lua.lua_setfield(L, -2, to_luastring(fieldName));
}
