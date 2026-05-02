import { isNoTributeSummonAllowed } from "#duel/no-tribute.js";
import type { DuelSession, PlayerId } from "#duel/types.js";

export function isNoTributePlayerAffected(session: DuelSession, player: PlayerId): boolean {
  return isNoTributeSummonAllowed(session.state, player);
}
