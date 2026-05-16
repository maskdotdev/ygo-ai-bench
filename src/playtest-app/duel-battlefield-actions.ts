import type { DuelAction, PlayerId, PublicDuelState } from "#duel/types.js";
import type { DuelLegalActionGroup } from "#duel/legal-action-groups.js";
import { copyDuelAction } from "#duel/action-copy.js";
import { orphanDuelActionGroups, partitionDuelActionsByAnchor, type DuelActionUiGroup } from "./duel-action-anchors.js";

export interface DuelBattlefieldActionView {
  byUid: Map<string, DuelAction[]>;
  orphanGroups: DuelActionUiGroup[];
}

export function duelBattlefieldActionView(
  state: PublicDuelState,
  viewer: PlayerId,
  legalActions: readonly DuelAction[],
  legalActionGroups: readonly DuelLegalActionGroup[] | undefined,
  hideOpponentHand = true,
): DuelBattlefieldActionView {
  const opponent = viewer === 0 ? 1 : 0;
  const raw = partitionDuelActionsByAnchor(legalActions);
  const interactiveUids = visibleInteractiveUids(state, viewer, opponent, hideOpponentHand);
  const byUid = new Map<string, DuelAction[]>();
  for (const [uid, actions] of raw.byUid) {
    if (interactiveUids.has(uid)) byUid.set(uid, actions.map(copyDuelAction));
  }
  return {
    byUid,
    orphanGroups: orphanDuelActionGroups(legalActions, legalActionGroups, interactiveUids),
  };
}

export function visibleDuelBattlefieldActions(view: DuelBattlefieldActionView): DuelAction[] {
  const out: DuelAction[] = [];
  const seen = new Set<string>();
  for (const actions of view.byUid.values()) {
    for (const action of actions) {
      const key = JSON.stringify(action);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(action);
    }
  }
  for (const group of view.orphanGroups) {
    for (const action of group.actions) {
      const key = JSON.stringify(action);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(action);
    }
  }
  return out;
}

function visibleInteractiveUids(
  state: PublicDuelState,
  viewer: PlayerId,
  opponent: PlayerId,
  hideOpponentHand: boolean,
): ReadonlySet<string> {
  const uids = new Set<string>();
  for (const card of state.cards) {
    const visibleHand =
      (card.location === "hand" && card.controller === viewer) ||
      (card.location === "hand" && card.controller === opponent && !hideOpponentHand);
    const onField = card.location === "monsterZone" || card.location === "spellTrapZone";
    if (visibleHand || onField) uids.add(card.uid);
  }
  return uids;
}
