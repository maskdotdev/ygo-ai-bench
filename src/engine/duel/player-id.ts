import type { PlayerId } from "#duel/types.js";

export function otherPlayer(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}
