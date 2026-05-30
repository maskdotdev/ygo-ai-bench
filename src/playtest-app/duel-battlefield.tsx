import cardBackUrl from "../../assets/card-back.webp";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import type { DuelAction, DuelLocation, DuelLogEntry, PlayerId, PublicDuelCard, PublicDuelState } from "#duel/types.js";
import type { DuelLegalActionGroup } from "#duel/legal-action-groups.js";
import { duelActionPlacementInstruction, duelActionPresentation } from "./duel-action-presenter.js";
import { duelActionAnchorUids, duelActionUiGroupLabel, duelActionUiKey } from "./duel-action-anchors.js";
import { duelBattlefieldActionView } from "./duel-battlefield-actions.js";
import { duelPromptView, splitPromptGroups } from "./duel-prompt-view.js";
import { duelTriggerOrderView } from "./duel-trigger-order-view.js";
import type { CardImageInfo } from "./ui.js";

function opposite(player: PlayerId): PlayerId {
  return player === 0 ? 1 : 0;
}

function cardsInZone(state: PublicDuelState, player: PlayerId, location: DuelLocation): PublicDuelCard[] {
  return state.cards
    .filter((card) => card.controller === player && card.location === location)
    .sort((a, b) => a.sequence - b.sequence);
}

export function isDuelCardVisibleToPlayer(card: PublicDuelCard, viewer: PlayerId): boolean {
  if (card.controller === viewer && card.location === "hand") return true;
  if (card.controller === viewer && (card.location === "monsterZone" || card.location === "spellTrapZone" || card.location === "fieldZone")) return true;
  if (card.owner === viewer && card.location === "extraDeck") return true;
  if (card.faceUp) return true;
  if (card.location === "graveyard") return true;
  if (card.location === "banished" && card.faceUp) return true;
  return card.revealedToPlayers?.includes(viewer) ?? false;
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

type CardActionGlow = "none" | "activation" | "summonSet";

function cardActionGlowClass(glow: CardActionGlow): string {
  switch (glow) {
    case "activation":
      return "ring-2 ring-yellow-300 drop-shadow-[0_0_10px_rgba(250,204,21,0.65)]";
    case "summonSet":
      return "ring-2 ring-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.6)]";
    case "none":
      return "";
  }
}

function cardActionGlow(actions: readonly DuelAction[] | undefined): CardActionGlow {
  if (!actions?.length) return "none";
  if (actions.some(isActivationAction)) return "activation";
  if (actions.some(isSummonOrSetAction)) return "summonSet";
  return "activation";
}

function isActivationAction(action: DuelAction): boolean {
  return action.type === "activateEffect" || action.type === "activateTrigger";
}

function isSummonOrSetAction(action: DuelAction): boolean {
  return action.type === "normalSummon" ||
    action.type === "tributeSummon" ||
    action.type === "tributeSet" ||
    action.type === "setMonster" ||
    action.type === "setSpellTrap" ||
    action.type === "fusionSummon" ||
    action.type === "synchroSummon" ||
    action.type === "xyzSummon" ||
    action.type === "linkSummon" ||
    action.type === "ritualSummon" ||
    action.type === "pendulumSummon" ||
    action.type === "specialSummonProcedure" ||
    action.type === "flipSummon";
}

function ZoneRow(props: {
  player: PlayerId;
  location: DuelLocation;
  cards: PublicDuelCard[];
  images: Map<string, CardImageInfo>;
  onCardClick: (card: PublicDuelCard, event: MouseEvent) => void;
  onEmptyZoneClick: (player: PlayerId, location: DuelLocation, sequence: number) => void;
  emptyHint: string;
  cardGlowForUid: (uid: string) => CardActionGlow;
  emptyZoneIsTarget?: (player: PlayerId, location: DuelLocation, sequence: number) => boolean;
}) {
  const bySequence = new Map(props.cards.map((card) => [card.sequence, card]));
  const slots = Array.from({ length: 5 }, (_, i) => bySequence.get(i));
  const hasEmptyTarget = slots.some((card, i) => !card && props.emptyZoneIsTarget?.(props.player, props.location, i));
  return (
    <div className={`duel-zone-row ${hasEmptyTarget ? "duel-zone-row--targeting" : ""}`}>
      {slots.map((card, i) => {
        const isEmptyTarget = !card && props.emptyZoneIsTarget?.(props.player, props.location, i);
        const glow = card ? props.cardGlowForUid(card.uid) : "none";
        return (
        <div
          key={i}
          className={`duel-mat-slot ${isEmptyTarget ? "duel-mat-slot--target" : ""} ${cardActionGlowClass(glow)}`}
        >
          <div className="duel-mat-slot-inner">
            {card ? (
              <button
                type="button"
                className="duel-card-hitbox"
                title={glow !== "none" ? `${card.name} - click for actions, Shift+click to zoom` : card.name}
                onClick={(event) => props.onCardClick(card, event)}
              >
                <DuelCardFace card={card} images={props.images} />
                {card.overlayCount > 0 ? (
                  <span className="duel-overlay-count">
                    {card.overlayCount}
                  </span>
                ) : null}
              </button>
            ) : isEmptyTarget ? (
              <button
                type="button"
                className="duel-empty-target"
                onClick={() => props.onEmptyZoneClick(props.player, props.location, i)}
              >
                Zone {i + 1}
              </button>
            ) : (
              <span className="duel-zone-label">{props.emptyHint}</span>
            )}
          </div>
        </div>
        );
      })}
    </div>
  );
}

function SingleZoneSlot(props: {
  label: string;
  card: PublicDuelCard | undefined;
  images: Map<string, CardImageInfo>;
  onCardClick: (card: PublicDuelCard, event: MouseEvent) => void;
  cardGlowForUid: (uid: string) => CardActionGlow;
}) {
  const glow = props.card ? props.cardGlowForUid(props.card.uid) : "none";
  return (
    <div className={`duel-mat-slot ${cardActionGlowClass(glow)}`}>
      <div className="duel-mat-slot-inner">
        {props.card ? (
          <button
            type="button"
            className="duel-card-hitbox"
            title={glow !== "none" ? `${props.card.name} - click for actions, Shift+click to zoom` : props.card.name}
            onClick={(event) => props.onCardClick(props.card!, event)}
          >
            <DuelCardFace card={props.card} images={props.images} />
          </button>
        ) : (
          <span className="duel-zone-label">{props.label}</span>
        )}
      </div>
    </div>
  );
}

function StaticMatSlot(props: { label: string; tone?: string }) {
  return (
    <div className={`duel-mat-slot duel-mat-slot--static ${props.tone ? `duel-mat-slot--${props.tone}` : ""}`}>
      <div className="duel-mat-slot-inner">
        <span className="duel-zone-label">{props.label}</span>
      </div>
    </div>
  );
}

function DuelCardFace(props: { card: PublicDuelCard; images: Map<string, CardImageInfo> }) {
  const img = props.images.get(props.card.code);
  const url = img?.small || img?.large;
  const unknownFaceDown = !props.card.faceUp && props.card.location !== "hand";

  if (unknownFaceDown || (props.card.location === "hand" && url === undefined && !props.card.faceUp)) {
    return <img className="duel-card-face" src={cardBackUrl} alt="" />;
  }

  if (url) {
    return <img className="duel-card-face" src={url} alt={props.card.name} loading="lazy" />;
  }

  return (
    <div className="duel-card-fallback">
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
  onOpen?: () => void;
  align: "top" | "bottom";
  cardGlowForUid: (uid: string) => CardActionGlow;
}) {
  if (props.hidden) {
    return (
      <button
        type="button"
        className="flex h-[min(9vh,56px)] items-center justify-center gap-2 rounded-md border border-[#d4af37]/15 px-2 transition-colors hover:border-[#d4af37]/40 hover:bg-[#d4af37]/8"
        onClick={props.onOpen}
      >
        <div className="relative h-[min(7vh,44px)] w-[min(6vw,34px)]">
          <img className="h-full w-full rounded-md border border-slate-600 object-contain shadow-lg" src={cardBackUrl} alt="" />
          <span className="absolute -bottom-1 -right-1 rounded-md bg-slate-900/90 px-1.5 py-0.5 text-[11px] font-black tabular-nums text-white shadow">
            {props.cards.length}
          </span>
        </div>
        <span className="text-[11px] font-medium text-white/45">in hand</span>
      </button>
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
          const glow = props.cardGlowForUid(card.uid);
          return (
            <button
              key={card.uid}
              type="button"
              style={{ zIndex: index + 1, marginLeft: index === 0 ? 0 : -10 }}
              className={`relative h-[min(9.5vh,58px)] w-[min(8.5vw,42px)] shrink-0 rounded-md border border-slate-600 shadow-md transition-transform hover:scale-105 ${rot} ${cardActionGlowClass(glow)} ring-offset-0`}
              title={glow !== "none" ? `${card.name} — click for actions, Shift+click to zoom` : card.name}
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
  rotated?: boolean;
  tone?: "deck" | "extra" | "graveyard" | "banished";
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      className={`duel-mat-slot duel-pile-slot ${props.tone ? `duel-pile-slot--${props.tone}` : ""} ${props.rotated ? "duel-mat-slot--rotated" : ""}`}
      aria-label={`${props.label}${props.count === undefined ? "" : `, ${props.count} cards`}`}
      onClick={() => !props.disabled && props.onOpen()}
    >
      <div className="duel-mat-slot-inner">
        <span className="duel-zone-label">{props.label}</span>
        {props.count !== undefined && props.count > 0 ? (
          <div className="duel-pile-card">
            {props.faceDown ? (
              <img className="duel-card-face" src={cardBackUrl} alt="" />
            ) : props.topCard ? (
              <DuelCardFace card={props.topCard} images={props.images} />
            ) : null}
            <span className="duel-pile-count">
              {props.count}
            </span>
          </div>
        ) : (
          <span className="duel-pile-icon">{props.icon}</span>
        )}
      </div>
    </button>
  );
}

export interface DuelPileView {
  title: string;
  icon: string;
  player: PlayerId;
  location: DuelLocation;
  cards: PublicDuelCard[];
}

export interface DuelBattlefieldProps {
  state: PublicDuelState;
  viewer: PlayerId;
  cardImages: Map<string, CardImageInfo>;
  onCardInspect: (card: PublicDuelCard) => void;
  onViewPile: (pile: DuelPileView) => void;
  /** When set, legal responses are chosen from the field (cyan ring). Shift+click always zooms. */
  legalActions?: readonly DuelAction[];
  legalActionGroups?: readonly DuelLegalActionGroup[];
  onPlayAction?: (action: DuelAction) => void;
}

type ActionFlyout = { card: PublicDuelCard; actions: DuelAction[]; anchorX: number; anchorY: number };
type PendingZonePlacement = {
  action: Extract<DuelAction, { summonSequence?: number } | { spellTrapSequence?: number }>;
  card: PublicDuelCard;
  player: PlayerId;
  location: "monsterZone" | "spellTrapZone";
};

function CardActionFlyout(props: {
  flyout: ActionFlyout;
  images: Map<string, CardImageInfo>;
  cardsByUid: ReadonlyMap<string, PublicDuelCard>;
  cardVisible: boolean;
  onPick: (action: DuelAction) => void;
  onInspect: () => void;
  onClose: () => void;
}) {
  const { flyout } = props;
  const image = props.images.get(flyout.card.code);
  const imageUrl = props.cardVisible ? image?.large || image?.small : undefined;
  const cardName = props.cardVisible ? flyout.card.name : "Hidden card";

  return createPortal(
    <>
      <button type="button" className="fixed inset-0 z-[100] cursor-default bg-black/45" aria-label="Dismiss" onClick={props.onClose} />
      <div
        className="fixed left-1/2 top-1/2 z-[110] grid max-h-[min(92dvh,720px)] w-[min(94vw,760px)] -translate-x-1/2 -translate-y-1/2 grid-cols-1 overflow-hidden rounded-xl border border-cyan-500/40 bg-slate-900/95 shadow-2xl backdrop-blur-md sm:grid-cols-[minmax(220px,320px)_1fr]"
        role="dialog"
        aria-modal
        aria-labelledby="card-action-flyout-title"
      >
        <div className="border-b border-cyan-500/20 bg-slate-950/70 p-3 sm:border-b-0 sm:border-r">
          <div className="mx-auto aspect-[59/86] max-h-[min(42dvh,460px)] w-full max-w-[260px] overflow-hidden rounded-lg border border-slate-600 bg-slate-950 shadow-[0_18px_40px_rgba(0,0,0,0.45)]">
            {imageUrl ? (
              <img className="h-full w-full object-contain" src={imageUrl} alt={flyout.card.name} />
            ) : !props.cardVisible ? (
              <img className="h-full w-full object-contain" src={cardBackUrl} alt="" />
            ) : (
              <DuelCardFace card={flyout.card} images={props.images} />
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-col p-3">
          <div className="mb-3 border-b border-cyan-500/20 pb-3">
            <p id="card-action-flyout-title" className="text-sm font-bold leading-snug text-white sm:text-base">{cardName}</p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-300/70">
              {props.cardVisible ? `${flyout.card.kind} · choose an action` : "face-down information hidden by rules"}
            </p>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {flyout.actions.map((action) => {
              const presentation = duelActionPresentation(action, { card: flyout.card, cardVisible: props.cardVisible, cardsByUid: props.cardsByUid });
              return (
                <button
                  key={duelActionUiKey(action)}
                  type="button"
                  className={`action-button duel-action-choice duel-action-choice--${presentation.tone} w-full rounded-lg px-4 py-4 text-left`}
                  onClick={() => props.onPick(action)}
                >
                  <span className="duel-action-choice-head">
                    <span className="duel-action-choice-badge">{presentation.badge}</span>
                    <span className="duel-action-choice-title">{presentation.title}</span>
                  </span>
                  <span className="duel-action-choice-detail">{presentation.detail}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-cyan-500/20 pt-3">
            <button
              type="button"
              className="rounded-md border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/5"
              onClick={props.onClose}
            >
              Cancel
            </button>
            {props.cardVisible ? (
              <button
                type="button"
                className="rounded-md border border-cyan-500/25 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/10"
                onClick={props.onInspect}
              >
                Full zoom
              </button>
            ) : (
              <span className="rounded-md border border-slate-700 px-3 py-2 text-center text-xs font-semibold text-slate-500">Hidden</span>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}

export function DuelBattlefield(props: DuelBattlefieldProps) {
  const { state, viewer } = props;
  const [flyout, setFlyout] = useState<ActionFlyout | null>(null);
  const [pendingZonePlacement, setPendingZonePlacement] = useState<PendingZonePlacement | null>(null);
  const opponent = opposite(viewer);
  const hideOppHand = true;

  const { byUid: actionByUid, orphanGroups } = useMemo(() => {
    const legal = props.legalActions ?? [];
    return duelBattlefieldActionView(state, viewer, legal, props.legalActionGroups, hideOppHand);
  }, [hideOppHand, props.legalActionGroups, props.legalActions, state, viewer]);

  const cardGlowForUid = useCallback((uid: string) => cardActionGlow(actionByUid.get(uid)), [actionByUid]);
  const cardsByUid = useMemo(() => new Map(state.cards.map((card) => [card.uid, card])), [state.cards]);
  const emptyZoneIsTarget = useCallback((player: PlayerId, location: DuelLocation, _sequence: number) => (
    pendingZonePlacement !== null && player === pendingZonePlacement.player && location === pendingZonePlacement.location
  ), [pendingZonePlacement]);
  const handleEmptyZoneClick = useCallback((player: PlayerId, location: DuelLocation, sequence: number) => {
    if (!pendingZonePlacement || player !== pendingZonePlacement.player || location !== pendingZonePlacement.location) return;
    const action = pendingZonePlacement.location === "monsterZone"
      ? { ...pendingZonePlacement.action, summonSequence: sequence }
      : { ...pendingZonePlacement.action, spellTrapSequence: sequence };
    props.onPlayAction?.(action as DuelAction);
    setPendingZonePlacement(null);
  }, [pendingZonePlacement, props]);

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
    if (!pendingZonePlacement) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPendingZonePlacement(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingZonePlacement]);

  useEffect(() => {
    setFlyout(null);
    setPendingZonePlacement(null);
  }, [props.legalActions]);

  const triggerOrderLabel = triggerOrderPromptLabel(state);
  const splitOrphanGroups = splitPromptGroups(state.prompt, orphanGroups);
  const promptView = duelPromptView(state.prompt, splitOrphanGroups.promptGroups, state.luaOperationPrompt);
  const globalOrphanGroups = splitOrphanGroups.globalGroups;
  const triggerOrderView = duelTriggerOrderView(state.triggerOrderPrompt, props.legalActionGroups);
  const placementInstruction = pendingZonePlacement
    ? duelActionPlacementInstruction(pendingZonePlacement.action, pendingZonePlacement.location, {
      card: pendingZonePlacement.card,
      cardVisible: isDuelCardVisibleToPlayer(pendingZonePlacement.card, viewer),
      cardsByUid,
    })
    : undefined;

  const oppMz = cardsInZone(state, opponent, "monsterZone");
  const oppSt = cardsInZone(state, opponent, "spellTrapZone");
  const oppField = cardsInZone(state, opponent, "fieldZone")[0];
  const oppHand = cardsInZone(state, opponent, "hand");
  const oppGy = cardsInZone(state, opponent, "graveyard");
  const oppX = cardsInZone(state, opponent, "extraDeck");
  const oppBan = cardsInZone(state, opponent, "banished");
  const oppDeckCards = cardsInZone(state, opponent, "deck");
  const oppDeck = oppDeckCards.length;

  const myMz = cardsInZone(state, viewer, "monsterZone");
  const mySt = cardsInZone(state, viewer, "spellTrapZone");
  const myField = cardsInZone(state, viewer, "fieldZone")[0];
  const myHand = cardsInZone(state, viewer, "hand");
  const myGy = cardsInZone(state, viewer, "graveyard");
  const myX = cardsInZone(state, viewer, "extraDeck");
  const myBan = cardsInZone(state, viewer, "banished");
  const myDeckCards = cardsInZone(state, viewer, "deck");
  const myDeck = myDeckCards.length;

  const oppLp = state.players[opponent]?.lifePoints ?? 8000;
  const myLp = state.players[viewer]?.lifePoints ?? 8000;

  return (
    <>
    <div className="duel-arena">
      <div className="duel-arena-stage">
        <div className="duel-player-band duel-player-band--opponent">
          <div className="duel-player-meta">
            <span>Opponent - P{opponent + 1}</span>
            <strong>{oppLp}</strong>
            <small>LP</small>
          </div>
          <HandFan
            cards={oppHand}
            images={props.cardImages}
            hidden={hideOppHand}
            onCardClick={handleCardInteraction}
            onOpen={() => props.onViewPile({ title: `Hand (opponent P${opponent + 1})`, icon: "H", player: opponent, location: "hand", cards: oppHand })}
            align="top"
            cardGlowForUid={cardGlowForUid}
          />
        </div>

        <div className="duel-mat-shell">
          <div className="duel-mat" aria-label="Duel field">
            <div className="duel-mat-row duel-mat-row--opponent">
              <SidePile
                label="Deck Zone"
                count={oppDeck}
                faceDown
                images={props.cardImages}
                icon="D"
                disabled={oppDeckCards.length === 0}
                tone="deck"
                onOpen={() => props.onViewPile({ title: `Deck (opponent P${opponent + 1})`, icon: "D", player: opponent, location: "deck", cards: oppDeckCards })}
              />
              <ZoneRow
                cards={oppSt}
                player={opponent}
                location="spellTrapZone"
                images={props.cardImages}
                onCardClick={handleCardInteraction}
                onEmptyZoneClick={handleEmptyZoneClick}
                emptyHint="Spell & Trap"
                cardGlowForUid={cardGlowForUid}
                emptyZoneIsTarget={emptyZoneIsTarget}
              />
              <SidePile
                label="Extra Deck Zone"
                count={oppX.length}
                faceDown
                images={props.cardImages}
                icon="ED"
                disabled={oppX.length === 0}
                tone="extra"
                onOpen={() => props.onViewPile({ title: `Extra Deck (opponent P${opponent + 1})`, icon: "ED", player: opponent, location: "extraDeck", cards: oppX })}
              />
            </div>

            <div className="duel-mat-row duel-mat-row--opponent">
              <SidePile
                label="Graveyard"
                count={oppGy.length}
                topCard={oppGy[oppGy.length - 1]}
                images={props.cardImages}
                icon="GY"
                disabled={oppGy.length === 0}
                tone="graveyard"
                onOpen={() => props.onViewPile({ title: `Graveyard (opponent P${opponent + 1})`, icon: "GY", player: opponent, location: "graveyard", cards: oppGy })}
              />
              <ZoneRow
                cards={oppMz}
                player={opponent}
                location="monsterZone"
                images={props.cardImages}
                onCardClick={handleCardInteraction}
                onEmptyZoneClick={handleEmptyZoneClick}
                emptyHint="Monster"
                cardGlowForUid={cardGlowForUid}
                emptyZoneIsTarget={emptyZoneIsTarget}
              />
              <SingleZoneSlot
                label="Field Card Zone"
                card={oppField}
                images={props.cardImages}
                onCardClick={handleCardInteraction}
                cardGlowForUid={cardGlowForUid}
              />
            </div>

            <div className="duel-mat-center-row">
              <SidePile
                label="Banished Zone"
                count={oppBan.length}
                topCard={oppBan[oppBan.length - 1]}
                images={props.cardImages}
                icon="X"
                disabled={oppBan.length === 0}
                rotated
                tone="banished"
                onOpen={() => props.onViewPile({ title: `Banished (opponent P${opponent + 1})`, icon: "X", player: opponent, location: "banished", cards: oppBan })}
              />
              <div className="duel-mat-spacer" />
              <StaticMatSlot label="Extra Monster Zone" tone="emz" />
              <div className="duel-mat-spacer" />
              <StaticMatSlot label="Extra Monster Zone" tone="emz" />
              <div className="duel-mat-spacer" />
              <SidePile
                label="Banished Zone"
                count={myBan.length}
                topCard={myBan[myBan.length - 1]}
                images={props.cardImages}
                icon="X"
                disabled={myBan.length === 0}
                tone="banished"
                onOpen={() => props.onViewPile({ title: `Banished (you P${viewer + 1})`, icon: "X", player: viewer, location: "banished", cards: myBan })}
              />
            </div>

            <div className="duel-mat-row">
              <SingleZoneSlot
                label="Field Card Zone"
                card={myField}
                images={props.cardImages}
                onCardClick={handleCardInteraction}
                cardGlowForUid={cardGlowForUid}
              />
              <ZoneRow
                cards={myMz}
                player={viewer}
                location="monsterZone"
                images={props.cardImages}
                onCardClick={handleCardInteraction}
                onEmptyZoneClick={handleEmptyZoneClick}
                emptyHint="Monster"
                cardGlowForUid={cardGlowForUid}
                emptyZoneIsTarget={emptyZoneIsTarget}
              />
              <SidePile
                label="Graveyard"
                count={myGy.length}
                topCard={myGy[myGy.length - 1]}
                images={props.cardImages}
                icon="GY"
                disabled={myGy.length === 0}
                tone="graveyard"
                onOpen={() => props.onViewPile({ title: `Graveyard (you P${viewer + 1})`, icon: "GY", player: viewer, location: "graveyard", cards: myGy })}
              />
            </div>

            <div className="duel-mat-row">
              <SidePile
                label="Extra Deck Zone"
                count={myX.length}
                faceDown
                images={props.cardImages}
                icon="ED"
                disabled={myX.length === 0}
                tone="extra"
                onOpen={() => props.onViewPile({ title: `Extra Deck (you P${viewer + 1})`, icon: "ED", player: viewer, location: "extraDeck", cards: myX })}
              />
              <ZoneRow
                cards={mySt}
                player={viewer}
                location="spellTrapZone"
                images={props.cardImages}
                onCardClick={handleCardInteraction}
                onEmptyZoneClick={handleEmptyZoneClick}
                emptyHint="Spell & Trap"
                cardGlowForUid={cardGlowForUid}
                emptyZoneIsTarget={emptyZoneIsTarget}
              />
              <SidePile
                label="Deck Zone"
                count={myDeck}
                faceDown
                images={props.cardImages}
                icon="D"
                disabled={myDeckCards.length === 0}
                tone="deck"
                onOpen={() => props.onViewPile({ title: `Deck (you P${viewer + 1})`, icon: "D", player: viewer, location: "deck", cards: myDeckCards })}
              />
            </div>
          </div>

          <div className="duel-command-tray">
            <div className="duel-status-pill">
              <span>Turn {state.turn}</span>
              <span>{state.phase}</span>
              {state.chain.length > 0 ? <b>Chain {state.chain.length}</b> : null}
              {state.prompt ? <b>Prompt</b> : null}
              {triggerOrderLabel ? <b>Order</b> : null}
            </div>
            {triggerOrderLabel ? (
              <div className="duel-response-note duel-response-note--order">
                {triggerOrderLabel}
              </div>
            ) : null}
            {placementInstruction ? (
              <div className="duel-response-rail duel-response-rail--placement">
                <div className="duel-response-copy duel-response-copy--placement">
                  <p>{placementInstruction.title}</p>
                  <small>{placementInstruction.detail}</small>
                </div>
                <button
                  type="button"
                  className="duel-response-button duel-response-button--cancel"
                  onClick={() => setPendingZonePlacement(null)}
                >
                  <span className="line-clamp-2">Cancel</span>
                </button>
              </div>
            ) : null}
            {triggerOrderView && props.onPlayAction && !pendingZonePlacement ? (
              <div className="duel-response-rail duel-response-rail--order">
                <div className="duel-response-copy">
                  <p>{triggerOrderView.label}</p>
                  <small>{triggerOrderView.detail}</small>
                </div>
                {triggerOrderView.groups.flatMap((group) =>
                  group.actions.map((action) => (
                    <button
                      key={`trigger-order-${group.key}-${duelActionUiKey(action)}`}
                      type="button"
                      className="duel-response-button"
                      onClick={() => props.onPlayAction?.(action)}
                    >
                      <span className="line-clamp-2">{duelActionPresentation(action, { cardsByUid }).title}</span>
                    </button>
                  )),
                )}
              </div>
            ) : null}
            {promptView && props.onPlayAction && !pendingZonePlacement ? (
              <div className="duel-response-rail duel-response-rail--prompt">
                <div className="duel-response-copy">
                  <p>{promptView.label}</p>
                  <small>{promptView.detail}</small>
                </div>
                {promptView.choices.map((choice) => (
                  <button
                    key={`prompt-${duelActionUiKey(choice.action)}`}
                    type="button"
                    className="duel-response-button"
                    onClick={() => props.onPlayAction?.(choice.action)}
                  >
                    <span className="line-clamp-2">{duelActionPresentation(choice.action, { cardsByUid }).title}</span>
                  </button>
                ))}
                {!promptView.choices.length ? promptView.groups.flatMap((group) =>
                  group.actions.map((action) => (
                    <button
                      key={`prompt-${group.key}-${duelActionUiKey(action)}`}
                      type="button"
                      className="duel-response-button"
                      onClick={() => props.onPlayAction?.(action)}
                      >
                        <span className="line-clamp-2">{duelActionPresentation(action, { cardsByUid }).title}</span>
                      </button>
                    )),
                ) : null}
              </div>
            ) : null}
            {globalOrphanGroups.length > 0 && !pendingZonePlacement && props.onPlayAction ? (
              <div className="duel-response-rail duel-response-rail--global">
                {globalOrphanGroups.map((group) => (
                  <div key={group.key} className="duel-response-group">
                    <span>{duelActionUiGroupLabel(group)}</span>
                    {group.actions.map((action) => (
                      <button
                        key={`orphan-${group.key}-${duelActionUiKey(action)}`}
                        type="button"
                        className="duel-response-button"
                        onClick={() => props.onPlayAction?.(action)}
                      >
                        <span className="line-clamp-2">{duelActionPresentation(action, { cardsByUid }).title}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="duel-player-band duel-player-band--player">
          <div className="duel-player-meta">
            <span>You - P{viewer + 1}</span>
            <strong>{myLp}</strong>
            <small>LP</small>
          </div>
          <HandFan
            cards={myHand}
            images={props.cardImages}
            hidden={false}
            onCardClick={handleCardInteraction}
            onOpen={() => props.onViewPile({ title: `Hand (you P${viewer + 1})`, icon: "H", player: viewer, location: "hand", cards: myHand })}
            align="bottom"
            cardGlowForUid={cardGlowForUid}
          />
        </div>
      </div>
    </div>
    {flyout && props.onPlayAction ? (
      <CardActionFlyout
        flyout={flyout}
        images={props.cardImages}
        cardsByUid={cardsByUid}
        cardVisible={isDuelCardVisibleToPlayer(flyout.card, viewer)}
        onPick={(action) => {
          if (isMonsterZoneSummonAction(action)) {
            setPendingZonePlacement({ action, card: flyout.card, player: action.player, location: "monsterZone" });
          } else if (isSpellTrapZonePlacementAction(action, flyout.card)) {
            setPendingZonePlacement({ action, card: flyout.card, player: action.player, location: "spellTrapZone" });
          } else {
            props.onPlayAction?.(action);
          }
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

function isMonsterZoneSummonAction(action: DuelAction): action is Extract<DuelAction, { summonSequence?: number }> {
  return action.type === "normalSummon" ||
    action.type === "tributeSummon" ||
    action.type === "tributeSet" ||
    action.type === "fusionSummon" ||
    action.type === "synchroSummon" ||
    action.type === "xyzSummon" ||
    action.type === "linkSummon" ||
    action.type === "ritualSummon" ||
    action.type === "setMonster" ||
    action.type === "specialSummonProcedure";
}

function isSpellTrapZonePlacementAction(action: DuelAction, card: PublicDuelCard): action is Extract<DuelAction, { spellTrapSequence?: number }> {
  if (card.location !== "hand" || (card.kind !== "spell" && card.kind !== "trap")) return false;
  if (isFieldSpell(card)) return false;
  return action.type === "setSpellTrap" || action.type === "activateEffect";
}

function isFieldSpell(card: PublicDuelCard): boolean {
  return card.kind === "spell" && ((card.typeFlags ?? 0) & 0x80000) !== 0;
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
