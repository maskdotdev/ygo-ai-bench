import { sameAction } from "#duel/response-match.js";
import { captureDuelState, restoreDuelState } from "#duel/state-rollback.js";
import { queryPublicState } from "#duel/snapshot.js";
import type {
  ApplyDuelResponseResult,
  DuelAction,
  DuelPhase,
  DuelResponse,
  DuelSession,
  DuelState,
  PlayerId,
} from "#duel/types.js";

export interface DuelResponseHandlers {
  getLegalActions(session: DuelSession, player: PlayerId): DuelAction[];
  normalSummon(state: DuelState, player: PlayerId, uid: string): void;
  tributeSummon(state: DuelState, player: PlayerId, uid: string, tributeUids: string[]): void;
  fusionSummon(state: DuelState, player: PlayerId, uid: string, materialUids: string[]): void;
  synchroSummon(state: DuelState, player: PlayerId, uid: string, materialUids: string[]): void;
  xyzSummon(state: DuelState, player: PlayerId, uid: string, materialUids: string[]): void;
  linkSummon(state: DuelState, player: PlayerId, uid: string, materialUids: string[]): void;
  ritualSummon(state: DuelState, player: PlayerId, uid: string, materialUids: string[]): void;
  specialSummonProcedure(session: DuelSession, player: PlayerId, uid: string, effectId: string): void;
  setMonster(state: DuelState, player: PlayerId, uid: string): void;
  setSpellTrap(state: DuelState, player: PlayerId, uid: string): void;
  activateEffect(session: DuelSession, player: PlayerId, uid: string, effectId: string): void;
  passChain(state: DuelState, player: PlayerId): void;
  resolvePrompt(state: DuelState, response: Extract<DuelResponse, { type: "selectOption" | "selectYesNo" }>): void;
  activateTrigger(session: DuelSession, player: PlayerId, triggerId: string): void;
  declineTrigger(session: DuelSession, player: PlayerId, triggerId: string): void;
  flipSummon(state: DuelState, player: PlayerId, uid: string): void;
  changePosition(state: DuelState, player: PlayerId, uid: string, position: Extract<DuelResponse, { type: "changePosition" }>["position"]): void;
  declareAttack(state: DuelState, player: PlayerId, attackerUid: string, targetUid?: string): void;
  changePhase(state: DuelState, player: PlayerId, phase: DuelPhase): void;
  endTurn(state: DuelState, player: PlayerId): void;
}

export function applyDuelResponse(session: DuelSession, response: DuelResponse, handlers: DuelResponseHandlers): ApplyDuelResponseResult {
  const legal = handlers.getLegalActions(session, response.player);
  const isLegal = legal.some((action) => sameAction(action, response));
  if (!isLegal) return result(session, handlers, false, "Response is not currently legal");

  const rollback = captureDuelState(session.state);
  try {
    dispatchDuelResponse(session, response, handlers);
    session.state.actionWindowId += 1;
    return result(session, handlers, true);
  } catch (error) {
    restoreDuelState(session.state, rollback);
    return result(session, handlers, false, error instanceof Error ? error.message : "Unknown duel engine error");
  }
}

function dispatchDuelResponse(session: DuelSession, response: DuelResponse, handlers: DuelResponseHandlers): void {
  if (response.type === "normalSummon") handlers.normalSummon(session.state, response.player, response.uid);
  else if (response.type === "tributeSummon") handlers.tributeSummon(session.state, response.player, response.uid, response.tributeUids);
  else if (response.type === "fusionSummon") handlers.fusionSummon(session.state, response.player, response.uid, response.materialUids);
  else if (response.type === "synchroSummon") handlers.synchroSummon(session.state, response.player, response.uid, response.materialUids);
  else if (response.type === "xyzSummon") handlers.xyzSummon(session.state, response.player, response.uid, response.materialUids);
  else if (response.type === "linkSummon") handlers.linkSummon(session.state, response.player, response.uid, response.materialUids);
  else if (response.type === "ritualSummon") handlers.ritualSummon(session.state, response.player, response.uid, response.materialUids);
  else if (response.type === "specialSummonProcedure") handlers.specialSummonProcedure(session, response.player, response.uid, response.effectId);
  else if (response.type === "setMonster") handlers.setMonster(session.state, response.player, response.uid);
  else if (response.type === "setSpellTrap") handlers.setSpellTrap(session.state, response.player, response.uid);
  else if (response.type === "activateEffect") handlers.activateEffect(session, response.player, response.uid, response.effectId);
  else if (response.type === "passChain") handlers.passChain(session.state, response.player);
  else if (response.type === "selectOption" || response.type === "selectYesNo") handlers.resolvePrompt(session.state, response);
  else if (response.type === "activateTrigger") handlers.activateTrigger(session, response.player, response.triggerId);
  else if (response.type === "declineTrigger") handlers.declineTrigger(session, response.player, response.triggerId);
  else if (response.type === "flipSummon") handlers.flipSummon(session.state, response.player, response.uid);
  else if (response.type === "changePosition") handlers.changePosition(session.state, response.player, response.uid, response.position);
  else if (response.type === "declareAttack") handlers.declareAttack(session.state, response.player, response.attackerUid, response.targetUid);
  else if (response.type === "changePhase") handlers.changePhase(session.state, response.player, response.phase);
  else if (response.type === "endTurn") handlers.endTurn(session.state, response.player);
}

function result(session: DuelSession, handlers: DuelResponseHandlers, ok: boolean, error?: string): ApplyDuelResponseResult {
  return {
    ok,
    ...(error === undefined ? {} : { error }),
    state: queryPublicState(session),
    legalActions: handlers.getLegalActions(session, session.state.waitingFor ?? session.state.turnPlayer),
  };
}
