import type { DuelEventPayload } from "#duel/event-history.js";
import type { DuelEffectContext, PlayerId } from "#duel/types.js";

export interface LuaEventPayloadHostState {
  activeLuaEffectId?: number | undefined;
  activeContext?: DuelEffectContext | undefined;
}

export function luaEffectReasonPayload(hostState: LuaEventPayloadHostState, eventReason: number, eventReasonPlayer: PlayerId): DuelEventPayload {
  const payload: DuelEventPayload = { eventReason, eventReasonPlayer };
  if (hostState.activeContext?.source) payload.eventReasonCardUid = hostState.activeContext.source.uid;
  const effectId = Number(hostState.activeContext?.chainLink?.effectId.match(/^lua-(\d+)/)?.[1] ?? hostState.activeLuaEffectId);
  if (Number.isFinite(effectId)) payload.eventReasonEffectId = effectId;
  return payload;
}
