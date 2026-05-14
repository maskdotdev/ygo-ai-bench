import type { CardSummary } from "#engine/types.js";
import type { PlaytestSnapshot } from "#playtest/api.js";
import cardBackUrl from "../../assets/card-back.webp";
import { cardToneBg, getCardTypeClass } from "./ui.js";
import type { CardImageInfo, PileView, ZoomCard } from "./ui.js";

export function GameBoard(props: {
  view: PlaytestSnapshot | null;
  imageRevision: number;
  cardImages: Map<string, CardImageInfo>;
  onZoom: (card: ZoomCard) => void;
  onViewPile: (pile: PileView) => void;
  /** Override outer frame (default matches Goldfish panel). */
  surfaceClassName?: string;
}) {
  void props.imageRevision;
  const surface = props.surfaceClassName ?? "tcg-panel rounded-xl p-4";
  const state = props.view?.state;
  const deckCount = state?.deckCount ?? 40;

  const monsterCards = (state?.field ?? []).filter((c) => c.type === "monster" || c.type === "extra");
  const spellTrapCards = (state?.field ?? []).filter((c) => c.type === "spell" || c.type === "trap");

  const graveyard = state?.graveyard ?? [];
  const extraDeck = state?.extraDeck ?? [];
  const banished = state?.banished ?? [];

  return (
    <section className={surface}>
      <div className="duel-field mx-auto flex max-w-[900px] flex-col gap-3">
        <div className="flex justify-center gap-3">
          <div className="w-[100px]" />
          <FieldSlot label="EMZ" />
          <div className="w-[100px]" />
          <FieldSlot label="EMZ" />
          <div className="w-[100px]" />
        </div>

        <div className="flex items-center justify-center gap-3">
          <div className="zone-frame flex h-[146px] w-[100px] flex-col items-center justify-center rounded-lg p-2">
            <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#d4af37]/40">Field</span>
            <span className="text-lg text-[#d4af37]/30">◇</span>
          </div>

          {Array.from({ length: 5 }, (_, i) => {
            const card = monsterCards[i];
            return (
              <div key={`mz-${i}`} className="field-slot flex h-[146px] w-[100px] items-center justify-center rounded-lg">
                {card ? (
                  <div className="w-[85px]">
                    <GameCard card={card} images={props.cardImages} onZoom={props.onZoom} />
                  </div>
                ) : (
                  <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#d4af37]/25">Monster</span>
                )}
              </div>
            );
          })}

          <button
            type="button"
            className="zone-frame zone-clickable flex h-[146px] w-[100px] flex-col items-center justify-center rounded-lg p-2"
            onClick={() => graveyard.length > 0 && props.onViewPile({ title: "Graveyard", icon: "☠", cards: graveyard })}
            disabled={graveyard.length === 0}
          >
            <span className="mb-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[#d4af37]/40">GY</span>
            {graveyard.length > 0 ? (
              <PilePreview cards={graveyard} images={props.cardImages} small />
            ) : (
              <span className="text-lg text-[#d4af37]/30">☠</span>
            )}
          </button>
        </div>

        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            className="zone-frame zone-clickable flex h-[146px] w-[100px] flex-col items-center justify-center rounded-lg p-2"
            onClick={() => extraDeck.length > 0 && props.onViewPile({ title: "Extra Deck", icon: "★", cards: extraDeck })}
            disabled={extraDeck.length === 0}
          >
            <span className="mb-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[#d4af37]/40">Extra</span>
            {extraDeck.length > 0 ? (
              <PilePreview cards={extraDeck} images={props.cardImages} faceDown small />
            ) : (
              <span className="text-lg text-[#d4af37]/30">★</span>
            )}
          </button>

          {Array.from({ length: 5 }, (_, i) => {
            const card = spellTrapCards[i];
            return (
              <div key={`st-${i}`} className="field-slot flex h-[146px] w-[100px] items-center justify-center rounded-lg">
                {card ? (
                  <div className="w-[85px]">
                    <GameCard card={card} images={props.cardImages} onZoom={props.onZoom} />
                  </div>
                ) : (
                  <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#d4af37]/25">S/T</span>
                )}
              </div>
            );
          })}

          <div className="zone-frame flex h-[146px] w-[100px] flex-col items-center justify-center rounded-lg p-2">
            <span className="mb-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[#d4af37]/40">Deck</span>
            <div className="relative">
              <img className="w-[70px] rounded border border-[#d4af37]/30 object-contain shadow-lg" src={cardBackUrl} alt="Deck" />
              <span className="pile-counter absolute -bottom-1.5 -right-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold text-white">
                {deckCount}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-1">
          <button
            type="button"
            className="flex items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-[#d4af37]/10 disabled:cursor-default disabled:hover:bg-transparent"
            onClick={() => banished.length > 0 && props.onViewPile({ title: "Banished", icon: "⊘", cards: banished })}
            disabled={banished.length === 0}
          >
            <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#d4af37]/40">Banished:</span>
            {banished.length > 0 ? (
              <div className="flex items-center gap-2">
                <PilePreview cards={banished} images={props.cardImages} tiny />
                <span className="text-xs text-[#d4af37]/60">({banished.length})</span>
              </div>
            ) : (
              <span className="text-xs text-[#d4af37]/30">Empty</span>
            )}
          </button>
        </div>

        <div className="my-2 h-px bg-gradient-to-r from-transparent via-[#d4af37]/30 to-transparent" />

        <HandZone cards={state?.hand ?? []} images={props.cardImages} onZoom={props.onZoom} />
      </div>
    </section>
  );
}

function FieldSlot(props: { label: string }) {
  return (
    <div className="field-slot flex h-[146px] w-[100px] items-center justify-center rounded-lg">
      <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#d4af37]/25">{props.label}</span>
    </div>
  );
}

function HandZone(props: { cards: CardSummary[]; images: Map<string, CardImageInfo>; onZoom: (card: ZoomCard) => void }) {
  return (
    <div className="zone-frame min-h-[170px] rounded-xl p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base text-[#d4af37]/60">✋</span>
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#c7b98f]/70">Hand</span>
        </div>
        {props.cards.length > 0 && <span className="tcg-badge rounded-full px-2 py-0.5 text-[10px]">{props.cards.length}</span>}
      </div>
      {props.cards.length ? (
        <div className="flex min-w-0 justify-center gap-3 overflow-x-auto pb-2">
          {props.cards.map((card) => (
            <div key={card.uid} className="w-[90px] shrink-0">
              <GameCard card={card} images={props.images} onZoom={props.onZoom} />
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state flex h-[110px] items-center justify-center rounded-lg text-sm font-semibold uppercase tracking-[0.15em]">
          No cards in hand
        </div>
      )}
    </div>
  );
}

function PilePreview(props: {
  cards: CardSummary[];
  faceDown?: boolean;
  small?: boolean;
  tiny?: boolean;
  images: Map<string, CardImageInfo>;
}) {
  const sizeClass = props.tiny ? "w-[50px]" : props.small ? "w-[70px]" : "w-[88px]";

  if (!props.cards.length) {
    return null;
  }

  if (props.faceDown) {
    return (
      <div className={`relative ${sizeClass}`}>
        <img className={`${sizeClass} rounded border border-[#d4af37]/30 object-contain shadow-lg`} src={cardBackUrl} alt="Card stack" />
        <span
          className={`pile-counter absolute -bottom-1.5 -right-1.5 rounded px-1.5 py-0.5 ${props.tiny ? "text-[8px]" : "text-[10px]"} font-bold text-white`}
        >
          {props.cards.length}
        </span>
      </div>
    );
  }

  const topCard = props.cards[props.cards.length - 1];
  if (!topCard) return null;

  const image = props.images.get(topCard.id);
  const fullCard = image?.small || image?.large;

  return (
    <div className={`relative ${sizeClass}`}>
      {fullCard ? (
        <img className={`${sizeClass} rounded border border-[#d4af37]/30 object-contain shadow-lg`} src={fullCard} alt={topCard.name} loading="lazy" />
      ) : (
        <div className={`${sizeClass} aspect-[59/86] rounded border border-[#d4af37]/30 bg-[#1a1a12] p-1`}>
          <span className="text-[8px] font-bold text-[#d4af37]/60">{topCard.name}</span>
        </div>
      )}
      <span
        className={`pile-counter absolute -bottom-1.5 -right-1.5 rounded px-1.5 py-0.5 ${props.tiny ? "text-[8px]" : "text-[10px]"} font-bold text-white`}
      >
        {props.cards.length}
      </span>
    </div>
  );
}

export function PileViewer(props: {
  pile: PileView;
  cardImages: Map<string, CardImageInfo>;
  onZoom: (card: ZoomCard) => void;
  onClose: () => void;
}) {
  return (
    <div className="pile-viewer-overlay fixed inset-0 z-40 grid place-items-center p-4" onClick={props.onClose}>
      <div
        className="pile-viewer-frame relative flex max-h-[85vh] w-full max-w-[900px] flex-col rounded-xl p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between border-b border-[#d4af37]/20 pb-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{props.pile.icon}</span>
            <div>
              <h2 className="font-['Cinzel'] text-xl font-bold text-[#fff7dc]">{props.pile.title}</h2>
              <p className="text-sm text-[#d4af37]/60">
                {props.pile.cards.length} card{props.pile.cards.length !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
          <button
            className="grid size-10 place-items-center rounded-full border-2 border-[#d4af37]/50 bg-black/50 text-xl font-bold text-white shadow-lg transition-colors hover:border-[#d4af37] hover:bg-[#d4af37]/20"
            type="button"
            aria-label="Close pile viewer"
            onClick={props.onClose}
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {props.pile.cards.length > 0 ? (
            <div className="grid grid-cols-4 gap-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7">
              {props.pile.cards.map((card, index) => {
                const image = props.cardImages.get(card.id);
                const fullCard = image?.large || image?.small;
                const cardTypeClass = getCardTypeClass(card);

                return (
                  <button
                    key={`${card.uid}-${index}`}
                    type="button"
                    className={`pile-card-item group relative flex flex-col items-center gap-1.5 rounded-lg p-1.5 transition-all hover:bg-[#d4af37]/10 ${cardTypeClass}`}
                    onClick={() => fullCard && props.onZoom({ name: card.name, image: image?.large || fullCard })}
                    title={card.name}
                  >
                    <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-[#d4af37]/20 text-[10px] font-bold text-[#d4af37]">
                      {index + 1}
                    </span>

                    <div className="aspect-[59/86] w-full overflow-hidden rounded-md border-2 border-[#d4af37]/30 bg-[#0a0c08] shadow-lg transition-all group-hover:border-[#d4af37]/60">
                      {fullCard ? (
                        <img className="h-full w-full object-contain" src={fullCard} alt={card.name} loading="lazy" />
                      ) : (
                        <div className="flex h-full items-center justify-center bg-gradient-to-b from-[#1a1815] to-[#0d0c0a] p-1">
                          <span className="text-center text-[9px] font-bold leading-tight text-[#d4af37]/60">{card.name}</span>
                        </div>
                      )}
                    </div>

                    <span className="line-clamp-2 text-center text-[10px] font-semibold leading-tight text-[#f3ead2]">{card.name}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex h-40 items-center justify-center text-[#d4af37]/40">No cards in this zone</div>
          )}
        </div>
      </div>
    </div>
  );
}

function GameCard(props: { card: CardSummary; images: Map<string, CardImageInfo>; onZoom: (card: ZoomCard) => void }) {
  const image = props.images.get(props.card.id);
  const fullCard = image?.large || image?.small;
  const cardTypeClass = getCardTypeClass(props.card);

  if (fullCard) {
    return (
      <button
        className={`card-button ${cardTypeClass}`}
        type="button"
        title={props.card.name}
        onClick={() => props.onZoom({ name: props.card.name, image: image?.large || fullCard })}
      >
        <img className="h-full w-full object-contain" src={fullCard} alt={props.card.name} loading="lazy" />
      </button>
    );
  }

  const fallbackBg = cardToneBg(props.card);
  return (
    <button className={`card-button ${fallbackBg}`} type="button" title={props.card.name}>
      <div className="flex h-full flex-col justify-between p-2 text-left">
        <span className="line-clamp-3 text-[10px] font-black leading-tight text-black">{props.card.name}</span>
        <span className="text-[8px] font-bold uppercase tracking-[0.12em] text-black/60">{props.card.type}</span>
      </div>
    </button>
  );
}
