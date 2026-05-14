import cardBackUrl from "../../assets/card-back.webp";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import type { DuelAction, DuelLocation, DuelLogEntry, PlayerId, PublicDuelCard, PublicDuelState } from "#duel/types.js";
import { dedupeDuelActions, duelActionAnchorUids, duelActionUiKey, partitionDuelActionsByAnchor } from "./duel-action-anchors.js";
import type { CardImageInfo } from "./ui.js";

function opposite(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

function cardsInZone(state: PublicDuelState, player: PlayerId, location: DuelLocation): PublicDuelCard[] {
  return state.cards
    .filter((card) => card.controller === player && card.location === location)
    .sort((a, b) => a.sequence - b.sequence);
}

function deckCount(state: PublicDuelState, player: PlayerId): number {
  return state.cards.filter((c) => c.controller === player && c.location === "deck").length;
}

function triggerOrderPromptLabel(state: PublicDuelState): string | undefined {
  const prompt = state.triggerOrderPrompt;
  if (!prompt) return undefined;
  const bucket = state.pendingTriggerBuckets.find(
    (candidate) => candidate.player === prompt.player && candidate.triggerBucket === prompt.triggerBucket,
  );
  const count = bucket?.triggerIds.length ?? prompt.triggerIds.length;
  return `P${prompt.player + 1} choose trigger order (${count})`;
}

/** Zone tile scales with viewport — wider field uses horizontal space like Master Duel. */
const ZONE =
  "relative flex aspect-[59/86] h-[min(14vh,96px)] min-h-[60px] max-h-[110px] w-[min(12vw,66px)] shrink-0 items-center justify-center rounded-md border border-cyan-500/20 bg-slate-900/60 shadow-[inset_0_0_10px_rgba(34,211,238,0.05)] backdrop-blur-sm";

function ZoneRow(props: {
  cards: PublicDuelCard[];
  images: Map<string, CardImageInfo>;
  onCardClick: (card: PublicDuelCard, event: MouseEvent) => void;
  emptyHint: string;
  cardHasLegalActions: (uid: string) => boolean;
}) {
  const slots = Array.from({ length: 5 }, (_, i) => props.cards[i]);
  return (
    <div className="flex w-full max-w-[min(92vw,720px)] items-center justify-center gap-[min(1.2vw,8px)]">
      {slots.map((card, i) => (
        <div
          key={i}
          className={`${ZONE} ${card && props.cardHasLegalActions(card.uid) ? "ring-2 ring-cyan-400 ring-2 drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]" : ""}`}
        >
          {card ? (
            <button
              type="button"
              className="absolute inset-0.5 overflow-hidden rounded"
              title={props.cardHasLegalActions(card.uid) ? `${card.name} — click to play, Shift+click to zoom` : card.name}
              onClick={(event) => props.onCardClick(card, event)}
            >
              <DuelCardFace card={card} images={props.images} />
              {card.overlayCount > 0 ? (
                <span className="absolute bottom-0.5 right-0.5 rounded bg-black/80 px-0.5 text-[8px] font-bold leading-none text-white">
                  {card.overlayCount}
                </span>
              ) : null}
            </button>
          ) : (
            <span className="text-[8px] font-bold uppercase tracking-[0.12em] text-white/15">{props.emptyHint}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function DuelCardFace(props: { card: PublicDuelCard; images: Map<string, CardImageInfo> }) {
  const img = props.images.get(props.card.code);
  const url = img?.small || img?.large;
  const unknownFaceDown = !props.card.faceUp && props.card.location !== "hand";

  if (unknownFaceDown || (props.card.location === "hand" && url === undefined && !props.card.faceUp)) {
    return <img className="h-full w-full object-contain" src={cardBackUrl} alt="" />;
  }

  if (url) {
    return <img className="h-full w-full object-contain" src={url} alt={props.card.name} loading="lazy" />;
  }

  return (
    <div className="flex h-full w-full flex-col justify-between bg-gradient-to-b from-slate-800 to-slate-950 p-1 text-left">
      <span className="line-clamp-3 text-[7px] font-bold leading-tight text-slate-200">{props.card.name}</span>
      <span className="text-[7px] uppercase text-cyan-400/55">{props.card.kind}</span>
    </div>
  );
}

function HandFan(props: {
  cards: PublicDuelCard[];
  images: Map<string, CardImageInfo>;
  hidden: boolean;
  onCardClick: (card: PublicDuelCard, event: MouseEvent) => void;
  align: "top" | "bottom";
  cardHasLegalActions: (uid: string) => boolean;
}) {
  if (props.hidden) {
    return (
      <div className="flex h-[min(9vh,56px)] items-center justify-center gap-2">
        <div className="relative h-[min(7vh,44px)] w-[min(6vw,34px)]">
          <img className="h-full w-full rounded-md border border-slate-600 object-contain shadow-lg" src={cardBackUrl} alt="" />
          <span className="absolute -bottom-1 -right-1 rounded-md bg-slate-900/90 px-1.5 py-0.5 text-[11px] font-black tabular-nums text-white shadow">
            {props.cards.length}
          </span>
        </div>
        <span className="text-[11px] font-medium text-white/45">in hand</span>
      </div>
    );
  }

  if (!props.cards.length) {
    return <div className="flex h-[min(9vh,56px)] items-center justify-center text-[10px] uppercase tracking-[0.2em] text-white/25">No cards</div>;
  }

  const tilt = props.align === "top" ? "rotate-180" : "";

  return (
    <div className={`flex h-[min(10vh,64px)] items-center justify-center ${tilt}`}>
      <div className="flex max-w-[min(96vw,820px)] items-end justify-center px-1">
        {props.cards.map((card, index) => {
          const rot = props.align === "bottom" ? (index % 2 === 0 ? "-rotate-6" : "rotate-6") : index % 2 === 0 ? "rotate-6" : "-rotate-6";
          return (
            <button
              key={card.uid}
              type="button"
              style={{ zIndex: index + 1, marginLeft: index === 0 ? 0 : -10 }}
              className={`relative h-[min(9.5vh,58px)] w-[min(8.5vw,42px)] shrink-0 rounded-md border border-slate-600 shadow-md transition-transform hover:scale-105 ${rot} ${props.cardHasLegalActions(card.uid) ? "ring-2 ring-cyan-400 ring-2 drop-shadow-[0_0_8px_rgba(34,211,238,0.6)] ring-offset-0" : ""}`}
              title={props.cardHasLegalActions(card.uid) ? `${card.name} — click to play, Shift+click to zoom` : card.name}
              onClick={(event) => props.onCardClick(card, event)}
            >
              <DuelCardFace card={card} images={props.images} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SidePile(props: {
  label: string;
  count?: number;
  faceDown?: boolean;
  topCard?: PublicDuelCard | undefined;
  images: Map<string, CardImageInfo>;
  icon: string;
  disabled: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      className="group flex w-10 flex-none flex-col items-center gap-0.5 rounded-md border border-cyan-500/20 bg-slate-900/70 backdrop-blur-sm px-0.5 py-1 transition-colors hover:border-cyan-400/60 hover:bg-slate-800/90 hover:shadow-[0_0_10px_rgba(34,211,238,0.2)] disabled:cursor-default disabled:opacity-40 sm:w-11"
      onClick={() => !props.disabled && props.onOpen()}
    >
      <span className="max-w-full truncate text-[7px] font-bold uppercase tracking-[0.08em] text-white/45">{props.label}</span>
      {props.count !== undefined && props.count > 0 ? (
        <div className="relative aspect-[59/86] w-[2.125rem] sm:w-9">
          {props.faceDown ? (
            <img className="h-full w-full rounded border border-slate-600 object-contain shadow-inner" src={cardBackUrl} alt="" />
          ) : props.topCard ? (
            <div className="h-full w-full overflow-hidden rounded border border-slate-600 shadow-inner">
              <DuelCardFace card={props.topCard} images={props.images} />
            </div>
          ) : null}
          <span className="absolute bottom-0.5 left-1/2 z-10 min-w-[1.1rem] -translate-x-1/2 rounded bg-slate-900/95 px-0.5 py-px text-center text-[9px] font-black tabular-nums leading-none text-white ring-1 ring-cyan-500/30">
            {props.count}
          </span>
        </div>
      ) : (
        <span className="grid h-9 w-7 place-items-center text-base text-white/22">{props.icon}</span>
      )}
    </button>
  );
}

export interface DuelBattlefieldProps {
  state: PublicDuelState;
  viewer: PlayerId;
  cardImages: Map<string, CardImageInfo>;
  onCardInspect: (card: PublicDuelCard) => void;
  onViewPile: (title: string, icon: string, cards: PublicDuelCard[]) => void;
  /** When set, legal responses are chosen from the field (cyan ring). Shift+click always zooms. */
  legalActions?: readonly DuelAction[];
  onPlayAction?: (action: DuelAction) => void;
}

type ActionFlyout = { card: PublicDuelCard; actions: DuelAction[]; anchorX: number; anchorY: number };

function CardActionFlyout(props: {
  flyout: ActionFlyout;
  images: Map<string, CardImageInfo>;
  onPick: (action: DuelAction) => void;
  onInspect: () => void;
  onClose: () => void;
}) {
  const { flyout } = props;
  const vw = typeof window !== "undefined" ? window.innerWidth : 800;
  const vh = typeof window !== "undefined" ? window.innerHeight : 600;
  const left = Math.min(vw - 292, Math.max(10, flyout.anchorX - 140));
  const top = Math.min(vh - 240, Math.max(10, flyout.anchorY + 6));

  return createPortal(
    <>
      <button type="button" className="fixed inset-0 z-[100] cursor-default bg-black/45" aria-label="Dismiss" onClick={props.onClose} />
      <div
        className="fixed z-[110] w-[min(92vw,280px)] rounded-xl border border-cyan-500/40 bg-slate-900/95 p-2 shadow-2xl backdrop-blur-md"
        style={{ left, top }}
        role="dialog"
        aria-modal
        aria-labelledby="card-action-flyout-title"
      >
        <div className="mb-2 flex gap-2 border-b border-cyan-500/20 pb-2">
          <div className="h-12 w-9 shrink-0 overflow-hidden rounded border border-slate-600">
            <DuelCardFace card={flyout.card} images={props.images} />
          </div>
          <div className="min-w-0 flex-1">
            <p id="card-action-flyout-title" className="truncate text-xs font-bold text-white">
              {flyout.card.name}
            </p>
            <p className="text-[10px] text-white/45">Choose an action</p>
          </div>
        </div>
        <div className="max-h-[min(52vh,320px)] space-y-1 overflow-y-auto pr-0.5">
          {flyout.actions.map((action) => (
            <button
              key={duelActionUiKey(action)}
              type="button"
              className="action-button w-full rounded-md px-2 py-2 text-left text-[11px] font-semibold leading-snug"
              onClick={() => props.onPick(action)}
            >
              <span className="line-clamp-4">{action.label}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="mt-2 w-full rounded-md border border-cyan-500/20 py-1.5 text-[10px] font-semibold text-cyan-200/90 hover:bg-white/5"
          onClick={props.onInspect}
        >
          Zoom card (Shift+click next time)
        </button>
      </div>
    </>,
    document.body,
  );
}

export function DuelBattlefield(props: DuelBattlefieldProps) {
  const { state, viewer } = props;
  const [flyout, setFlyout] = useState<ActionFlyout | null>(null);
  const opponent = opposite(viewer);
  const hideOppHand = true;

  const { byUid: actionByUid, orphans } = useMemo(() => {
    const legal = props.legalActions ?? [];
    const raw = partitionDuelActionsByAnchor(legal);
    const interact = new Set<string>();
    for (const card of state.cards) {
      const visibleHand =
        (card.location === "hand" && card.controller === viewer) ||
        (card.location === "hand" && card.controller === opponent && !hideOppHand);
      const onField = card.location === "monsterZone" || card.location === "spellTrapZone";
      if (visibleHand || onField) interact.add(card.uid);
    }
    const byUid = new Map<string, DuelAction[]>();
    for (const [uid, list] of raw.byUid) {
      if (interact.has(uid)) byUid.set(uid, list);
    }
    const unreachable: DuelAction[] = [];
    const seenU = new Set<string>();
    for (const action of legal) {
      const anchors = duelActionAnchorUids(action);
      if (!anchors.length) continue;
      if (!anchors.some((uid) => interact.has(uid))) {
        const k = duelActionUiKey(action);
        if (!seenU.has(k)) {
          seenU.add(k);
          unreachable.push(action);
        }
      }
    }
    return { byUid, orphans: dedupeDuelActions([...raw.orphans, ...unreachable]) };
  }, [hideOppHand, opponent, props.legalActions, state.cards, viewer]);

  const cardHasLegalActions = useCallback((uid: string) => (actionByUid.get(uid)?.length ?? 0) > 0, [actionByUid]);

  const handleCardInteraction = useCallback(
    (card: PublicDuelCard, event: MouseEvent) => {
      if (event.shiftKey) {
        props.onCardInspect(card);
        return;
      }
      const actions = actionByUid.get(card.uid) ?? [];
      if (!actions.length) {
        props.onCardInspect(card);
        return;
      }
      if (!props.onPlayAction) {
        props.onCardInspect(card);
        return;
      }
      if (actions.length === 1) {
        const only = actions[0];
        if (only) props.onPlayAction(only);
        setFlyout(null);
        return;
      }
      const el = event.currentTarget as HTMLElement;
      const r = el.getBoundingClientRect();
      setFlyout({ card, actions, anchorX: r.left + r.width / 2, anchorY: r.bottom });
    },
    [actionByUid, props],
  );

  useEffect(() => {
    if (!flyout) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFlyout(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flyout]);

  useEffect(() => {
    setFlyout(null);
  }, [props.legalActions]);

  const triggerOrderLabel = triggerOrderPromptLabel(state);

  const oppMz = cardsInZone(state, opponent, "monsterZone");
  const oppSt = cardsInZone(state, opponent, "spellTrapZone");
  const oppHand = cardsInZone(state, opponent, "hand");
  const oppGy = cardsInZone(state, opponent, "graveyard");
  const oppX = cardsInZone(state, opponent, "extraDeck");
  const oppBan = cardsInZone(state, opponent, "banished");
  const oppDeck = deckCount(state, opponent);

  const myMz = cardsInZone(state, viewer, "monsterZone");
  const mySt = cardsInZone(state, viewer, "spellTrapZone");
  const myHand = cardsInZone(state, viewer, "hand");
  const myGy = cardsInZone(state, viewer, "graveyard");
  const myX = cardsInZone(state, viewer, "extraDeck");
  const myBan = cardsInZone(state, viewer, "banished");
  const myDeck = deckCount(state, viewer);

  const oppLp = state.players[opponent]?.lifePoints ?? 8000;
  const myLp = state.players[viewer]?.lifePoints ?? 8000;

  return (
    <>
    <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl">
      {/* Mat backdrop + faux perspective */}
      <div
        className="pointer-events-none absolute inset-0 rounded-xl bg-[radial-gradient(ellipse_120%_80%_at_50%_50%,#1e293b_0%,#020617_70%,#000000_100%)]"
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-x-[8%] top-[42%] h-px bg-gradient-to-r from-transparent via-cyan-400/50 to-transparent shadow-[0_0_15px_rgba(34,211,238,0.6)]" aria-hidden />

      <div
        className="relative z-10 flex h-full min-h-0 flex-col px-[min(2vw,12px)] py-1 pb-2"
        style={{ perspective: "1400px" }}
      >
        {/* ----- Opponent half (far) ----- */}
        <div className="flex min-h-0 flex-[1.05] flex-col items-center justify-end gap-1">
          <div className="flex w-full max-w-[900px] items-start justify-between gap-2 px-1">
            <div className="flex min-w-0 flex-1 flex-col items-start">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">Opponent · P{opponent + 1}</span>
              <div className="flex items-baseline gap-1.5">
                <span className="font-sans text-[clamp(1.25rem,4vw,2rem)] font-black tabular-nums leading-none tracking-tight text-white drop-shadow-[0_0_8px_rgba(34,211,238,0.4)]">
                  {oppLp}
                </span>
                <span className="text-[11px] font-semibold text-cyan-300/90">LP</span>
              </div>
            </div>
            <div className="flex shrink-0 flex-nowrap gap-1 pt-1 sm:gap-1.5">
              <SidePile
                label="Extra"
                count={oppX.length}
                faceDown
                images={props.cardImages}
                icon="★"
                disabled={oppX.length === 0}
                onOpen={() => props.onViewPile("Extra (opponent)", "★", oppX)}
              />
              <SidePile
                label="Deck"
                count={oppDeck}
                faceDown
                images={props.cardImages}
                icon="📚"
                disabled={oppDeck === 0}
                onOpen={() => {}}
              />
              <SidePile
                label="GY"
                count={oppGy.length}
                topCard={oppGy[oppGy.length - 1]}
                images={props.cardImages}
                icon="☠"
                disabled={oppGy.length === 0}
                onOpen={() => props.onViewPile("GY (opponent)", "☠", oppGy)}
              />
              <SidePile
                label="Banish"
                count={oppBan.length}
                topCard={oppBan[oppBan.length - 1]}
                images={props.cardImages}
                icon="⊘"
                disabled={oppBan.length === 0}
                onOpen={() => props.onViewPile("Banished (opponent)", "⊘", oppBan)}
              />
            </div>
          </div>

          <HandFan
            cards={oppHand}
            images={props.cardImages}
            hidden={hideOppHand}
            onCardClick={handleCardInteraction}
            align="top"
            cardHasLegalActions={cardHasLegalActions}
          />

          <div className="flex w-full flex-col items-center gap-1 [transform:rotateX(4deg)]">
            <span className="text-[9px] font-bold uppercase tracking-[0.25em] text-white/35">Spell / Trap</span>
            <ZoneRow
              cards={oppSt}
              images={props.cardImages}
              onCardClick={handleCardInteraction}
              emptyHint="S/T"
              cardHasLegalActions={cardHasLegalActions}
            />
            <span className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.25em] text-white/35">Monsters</span>
            <ZoneRow
              cards={oppMz}
              images={props.cardImages}
              onCardClick={handleCardInteraction}
              emptyHint="M"
              cardHasLegalActions={cardHasLegalActions}
            />
          </div>
        </div>

        {/* ----- EMZ + turn strip ----- */}
        <div className="flex shrink-0 flex-col items-center gap-0.5 py-1">
          <div className="flex items-center gap-3">
            <div className={ZONE}>
              <span className="text-[9px] font-bold text-white/20">EMZ</span>
            </div>
            <div className={ZONE}>
              <span className="text-[9px] font-bold text-white/20">EMZ</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 rounded-full border border-cyan-500/20 bg-slate-900/70 backdrop-blur-sm px-3 py-1 text-[10px] text-white/70 shadow-lg backdrop-blur-sm">
            <span className="font-semibold text-cyan-200/90">Turn {state.turn}</span>
            <span className="text-white/35">·</span>
            <span className="font-bold uppercase tracking-[0.12em] text-violet-200/90">{state.phase}</span>
            {state.chain.length > 0 ? (
              <span className="rounded-full bg-amber-500/25 px-2 py-px text-[9px] font-bold text-amber-100">Chain {state.chain.length}</span>
            ) : null}
            {state.prompt ? <span className="rounded-full bg-violet-500/25 px-2 py-px text-[9px] font-bold text-violet-100">Prompt</span> : null}
            {triggerOrderLabel ? <span className="rounded-full bg-fuchsia-500/25 px-2 py-px text-[9px] font-bold text-fuchsia-100">Order</span> : null}
          </div>
          {triggerOrderLabel ? (
            <div className="max-w-[min(96vw,760px)] rounded-lg border border-fuchsia-400/30 bg-fuchsia-950/45 px-3 py-1.5 text-center text-[10px] font-semibold text-fuchsia-50 shadow-lg shadow-fuchsia-950/30">
              {triggerOrderLabel}
            </div>
          ) : null}
          {orphans.length > 0 && props.onPlayAction ? (
            <div className="flex max-w-[min(96vw,860px)] justify-center px-1">
              <div className="flex max-w-full gap-1 overflow-x-auto rounded-lg border border-cyan-500/20 bg-slate-900/60 px-2 py-1.5 [scrollbar-width:thin]">
                <span className="shrink-0 self-center pr-1 text-[8px] font-bold uppercase tracking-[0.12em] text-white/35">Other</span>
                {orphans.map((action) => (
                  <button
                    key={`orphan-${duelActionUiKey(action)}`}
                    type="button"
                    className="shrink-0 rounded-md border border-cyan-500/25 bg-slate-800/80 px-2 py-1 text-left text-[9px] font-semibold leading-tight text-cyan-50/95 hover:border-cyan-400/50 hover:bg-cyan-900/35"
                    onClick={() => props.onPlayAction?.(action)}
                  >
                    <span className="line-clamp-2 max-w-[200px]">{action.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* ----- Player half (near) ----- */}
        <div className="flex min-h-0 flex-[1.15] flex-col items-center justify-start gap-0.5">
          <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-1 overflow-hidden [transform:rotateX(-4deg)]">
            <span className="text-[9px] font-bold uppercase tracking-[0.25em] text-white/35">Monsters</span>
            <ZoneRow
              cards={myMz}
              images={props.cardImages}
              onCardClick={handleCardInteraction}
              emptyHint="M"
              cardHasLegalActions={cardHasLegalActions}
            />
            <span className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.25em] text-white/35">Spell / Trap</span>
            <ZoneRow
              cards={mySt}
              images={props.cardImages}
              onCardClick={handleCardInteraction}
              emptyHint="S/T"
              cardHasLegalActions={cardHasLegalActions}
            />
          </div>

          <div className="shrink-0 pt-0.5">
            <HandFan
              cards={myHand}
              images={props.cardImages}
              hidden={false}
              onCardClick={handleCardInteraction}
              align="bottom"
              cardHasLegalActions={cardHasLegalActions}
            />
          </div>

          <div className="flex w-full max-w-[900px] shrink-0 flex-nowrap items-end justify-between gap-2 px-1 pb-1 pt-1">
            <div className="flex min-w-0 flex-1 flex-col items-start">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-200/70">You · P{viewer + 1}</span>
              <div className="flex items-baseline gap-1.5">
                <span className="font-sans text-[clamp(1.35rem,4.2vw,2.1rem)] font-black tabular-nums leading-none tracking-tight text-white drop-shadow-[0_0_10px_rgba(34,211,238,0.6)]">
                  {myLp}
                </span>
                <span className="text-[11px] font-semibold text-cyan-300/90">LP</span>
              </div>
            </div>
            <div className="flex shrink-0 flex-nowrap gap-1 sm:gap-1.5">
              <SidePile
                label="Extra"
                count={myX.length}
                faceDown
                images={props.cardImages}
                icon="★"
                disabled={myX.length === 0}
                onOpen={() => props.onViewPile("Extra Deck", "★", myX)}
              />
              <SidePile
                label="Deck"
                count={myDeck}
                faceDown
                images={props.cardImages}
                icon="📚"
                disabled={myDeck === 0}
                onOpen={() => {}}
              />
              <SidePile
                label="GY"
                count={myGy.length}
                topCard={myGy[myGy.length - 1]}
                images={props.cardImages}
                icon="☠"
                disabled={myGy.length === 0}
                onOpen={() => props.onViewPile("Graveyard", "☠", myGy)}
              />
              <SidePile
                label="Banish"
                count={myBan.length}
                topCard={myBan[myBan.length - 1]}
                images={props.cardImages}
                icon="⊘"
                disabled={myBan.length === 0}
                onOpen={() => props.onViewPile("Banished", "⊘", myBan)}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
    {flyout && props.onPlayAction ? (
      <CardActionFlyout
        flyout={flyout}
        images={props.cardImages}
        onPick={(action) => {
          props.onPlayAction?.(action);
          setFlyout(null);
        }}
        onInspect={() => {
          props.onCardInspect(flyout.card);
          setFlyout(null);
        }}
        onClose={() => setFlyout(null)}
      />
    ) : null}
    </>
  );
}

export function DuelLogList(props: { entries: DuelLogEntry[] }) {
  return (
    <ol className="max-h-[min(60vh,420px)] space-y-2 overflow-y-auto pr-1">
      {props.entries.length ? (
        props.entries.map((entry, index) => (
          <li key={`${entry.step}-${index}`} className="log-entry grid grid-cols-[28px_minmax(0,1fr)] gap-2 rounded-lg p-2.5">
            <span className="grid h-6 place-items-center rounded-md bg-[#d4af37]/15 text-[10px] font-black text-[#d4af37]">{entry.step}</span>
            <span className="min-w-0">
              <strong className="block truncate text-sm text-white">
                {entry.action}
                {entry.player !== undefined ? ` · P${entry.player + 1}` : ""}
                {entry.card ? ` · ${entry.card}` : ""}
              </strong>
              <small className="block text-xs text-slate-400">{entry.detail}</small>
            </span>
          </li>
        ))
      ) : (
        <li className="empty-state rounded-lg px-4 py-8 text-center text-sm">No events yet</li>
      )}
    </ol>
  );
}
