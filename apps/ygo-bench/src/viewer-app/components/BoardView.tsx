import type { RealReducedState } from "../types";
import { PlayerPanel } from "./PlayerPanel";

export function BoardView({ state, player }: { state: RealReducedState | null; player?: 0 | 1 }) {
  if (!state) return <div className="empty-block">No reduced board state is available for this frame.</div>;
  return (
    <section className="board-panel">
      <div className="board-status">
        <span>Turn {state.turn}</span>
        <b>{state.phase}</b>
        <span>{state.winner === null ? "In progress or capped" : `Winner: Player ${state.winner}`}</span>
      </div>
      <PlayerPanel player={state.players[1]} index={1} active={player === 1} />
      <PlayerPanel player={state.players[0]} index={0} active={player === 0} />
    </section>
  );
}
