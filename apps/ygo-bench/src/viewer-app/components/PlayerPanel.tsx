import type { RealReducedPlayer } from "../types";
import { Zone } from "./Zone";

export function PlayerPanel({ player, index, active }: { player: RealReducedPlayer; index: 0 | 1; active: boolean }) {
  return (
    <section className={`player-panel ${active ? "active-player" : ""}`}>
      <div className="player-head">
        <h3>Player {index}</h3>
        <strong>{player.lp} LP</strong>
      </div>
      <div className="compact-stats">
        <span>Hand {player.handCount}</span>
        <span>Deck {player.deckCount}</span>
        <span>Extra {player.extraDeckCount}</span>
      </div>
      <div className="zone-grid">
        {player.hand ? <Zone label="Hand" cards={player.hand} /> : null}
        <Zone label="Monsters" cards={player.monsters} />
        <Zone label="Spells / Traps" cards={player.spellsTraps} />
        <Zone label="Graveyard" cards={player.graveyard} />
        <Zone label="Banished" cards={player.banished} />
      </div>
    </section>
  );
}
