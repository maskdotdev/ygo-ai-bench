import { describe, expect, it } from "vitest";
import { createDuel, loadDecks, restoreDuel, serializeDuel, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import { cards } from "./full-duel-engine-fixtures.js";

describe("duel snapshot pending-window overlap validation", () => {
  it("rejects prompts that overlap battle windows before restore", () => {
    const session = createDuel({ seed: 616, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["100"] }, 1: { main: ["400"] } });
    startDuel(session);
    const attackerUid = serializeDuel(session).state.cards[0]!.uid;
    const snapshot = battleWindowSnapshot(attackerUid, serializeDuel(session));
    snapshot.state.prompt = { id: "overlap-prompt", type: "selectYesNo", player: 1 };

    expect(() => restoreDuel(snapshot, createCardReader(cards))).toThrow("Malformed duel snapshot: state.prompt must not overlap battleWindow");
  });

});

function battleWindowSnapshot(attackerUid: string, snapshot: ReturnType<typeof serializeDuel>): ReturnType<typeof serializeDuel> {
  snapshot.state.phase = "battle";
  snapshot.state.status = "awaiting";
  snapshot.state.waitingFor = 1;
  snapshot.state.battleStep = "attack";
  snapshot.state.attacksDeclared = [attackerUid];
  snapshot.state.currentAttack = { attackerUid };
  snapshot.state.pendingBattle = { attackerUid };
  snapshot.state.battleWindow = { id: 1, kind: "attackNegationResponse", step: "attack", attackerUid, responsePlayer: 1, attackNegated: false };
  return snapshot;
}
