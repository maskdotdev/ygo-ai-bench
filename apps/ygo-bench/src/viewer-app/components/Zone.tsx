import type { RealCardView } from "../types";
import { CardTile } from "./CardTile";

export function Zone({ label, cards }: { label: string; cards: RealCardView[] }) {
  return (
    <div className="zone">
      <div className="zone-head">
        <span>{label}</span>
        <b>{cards.length}</b>
      </div>
      <div className="zone-body">
        {cards.length === 0 ? <span className="muted">Empty</span> : cards.map((card) => <CardTile key={`${card.code}-${card.location}-${card.sequence}`} card={card} />)}
      </div>
    </div>
  );
}
