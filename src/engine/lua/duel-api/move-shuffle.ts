import { createRng } from "#engine/rng.js";
import type { DuelCardInstance, DuelSession } from "#duel/types.js";

export function shuffleLuaMoveCards(session: DuelSession, cards: DuelCardInstance[]): DuelCardInstance[] {
  const rng = createRng(`${session.state.seed}:shuffle-set:${session.state.randomCounter}`);
  session.state.randomCounter += 1;
  const shuffled = [...cards];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  return shuffled;
}
