import type { DuelEffectContext, DuelSession } from "#duel/types.js";

export interface LuaQueryTargetState {
  activeTargetUids: string[] | undefined;
  activeContext: DuelEffectContext | undefined;
}

export function effectiveTargetUids(session: DuelSession, hostState: LuaQueryTargetState): string[] {
  if (hostState.activeTargetUids?.length) return hostState.activeTargetUids;
  if (hostState.activeContext?.chainLink) return hostState.activeContext.targetUids;
  const chainTargetUids = session.state.chain[session.state.chain.length - 1]?.targetUids;
  return chainTargetUids ?? [];
}

export function changeTargetCard(hostState: LuaQueryTargetState, uids: string[]): void {
  if (hostState.activeTargetUids) hostState.activeTargetUids.splice(0, hostState.activeTargetUids.length, ...uids);
  if (hostState.activeContext) hostState.activeContext.setTargets(uids);
  const link = hostState.activeContext?.chainLink;
  if (!link) return;
  if (uids.length) link.targetUids = [...uids];
  else delete link.targetUids;
}
