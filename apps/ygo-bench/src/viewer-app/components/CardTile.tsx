import type { RealCardView } from "../types";

export function CardTile({ card }: { card: RealCardView }) {
  return (
    <div className="card-tile" title={`${card.name} (${card.code})`}>
      <strong>{card.name}</strong>
      <span>
        {card.location} #{card.sequence}
      </span>
    </div>
  );
}
