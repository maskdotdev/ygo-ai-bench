import cardBackUrl from "../../assets/card-back.webp";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import type { DuelAction, DuelLocation, DuelLogEntry, PlayerId, PublicDuelCard, PublicDuelState } from "#duel/types.js";
import type { DuelLegalActionGroup } from "#duel/legal-action-groups.js";
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
    <div className={`flex w-full max-w-[min(92vw,720px)] items-center justify-center gap-[min(1.2vw,8px)] ${hasEmptyTarget ? "relative z-50" : ""}`}>
      {slots.map((card, i) => {
        const isEmptyTarget = !card && props.emptyZoneIsTarget?.(props.player, props.location, i);
        const glow = card ? props.cardGlowForUid(card.uid) : "none";
        return (
        <div
          key={i}
          className={`${ZONE} ${isEmptyTarget ? "z-30" : ""} ${cardActionGlowClass(glow)}`}
        >
          {card ? (
            <button
              type="button"
              className="absolute inset-0.5 overflow-hidden rounded"
              title={glow !== "none" ? `${card.name} — click for actions, Shift+click to zoom` : card.name}
              onClick={(event) => props.onCardClick(card, event)}
            >
              <DuelCardFace card={card} images={props.images} />
              {card.overlayCount > 0 ? (
                <span className="absolute bottom-0.5 right-0.5 rounded bg-black/80 px-0.5 text-[8px] font-bold leading-none text-white">
                  {card.overlayCount}
                </span>
              ) : null}
            </button>
          ) : isEmptyTarget ? (
            <button
              type="button"
              className="absolute inset-0 z-30 rounded-md border border-cyan-300/70 bg-cyan-400/10 text-[8px] font-black uppercase tracking-[0.12em] text-cyan-100 shadow-[0_0_14px_rgba(34,211,238,0.3)]"
              onClick={() => props.onEmptyZoneClick(props.player, props.location, i)}
            >
              Zone {i + 1}
            </button>
          ) : (
            <span className="text-[8px] font-bold uppercase tracking-[0.12em] text-white/15">{props.emptyHint}</span>
          )}
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
    <div className={`${ZONE} ${cardActionGlowClass(glow)}`}>
      {props.card ? (
        <button
          type="button"
          className="absolute inset-0.5 overflow-hidden rounded"
          title={glow !== "none" ? `${props.card.name} — click for actions, Shift+click to zoom` : props.card.name}
          onClick={(event) => props.onCardClick(props.card!, event)}
        >
          <DuelCardFace card={props.card} images={props.images} />
        </button>
      ) : (
        <span className="text-[8px] font-bold uppercase tracking-[0.12em] text-white/15">{props.label}</span>
      )}
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
  cardGlowForUid: (uid: string) => CardActionGlow;
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
  legalActionGroups?: readonly DuelLegalActionGroup[];
  onPlayAction?: (action: DuelAction) => void;
}

type ActionFlyout = { card: PublicDuelCard; actions: DuelAction[]; anchorX: number; anchorY: number };
type PendingZonePlacement = {
  action: Extract<DuelAction, { summonSequence?: number } | { spellTrapSequence?: number }>;
  player: PlayerId;
  location: "monsterZone" | "spellTrapZone";
};

function CardActionFlyout(props: {
  flyout: ActionFlyout;
  images: Map<string, CardImageInfo>;
  onPick: (action: DuelAction) => void;
  onInspect: () => void;
  onClose: () => void;
}) {
  const { flyout } = props;
  const image = props.images.get(flyout.card.code);
  const imageUrl = image?.large || image?.small;

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
            ) : (
              <DuelCardFace card={flyout.card} images={props.images} />
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-col p-3">
          <div className="mb-3 border-b border-cyan-500/20 pb-3">
            <p id="card-action-flyout-title" className="text-sm font-bold leading-snug text-white sm:text-base">{flyout.card.name}</p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-300/70">{flyout.card.kind} · choose an action</p>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {flyout.actions.map((action) => (
              <button
                key={duelActionUiKey(action)}
                type="button"
                className="action-button w-full rounded-lg px-3 py-3 text-left text-xs font-semibold leading-snug sm:text-sm"
                onClick={() => props.onPick(action)}
              >
                <span className="line-clamp-4">{action.label}</span>
              </button>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 border-t border-cyan-500/20 pt-3">
            <button
              type="button"
              className="rounded-md border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-white/5"
              onClick={props.onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-md border border-cyan-500/25 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/10"
              onClick={props.onInspect}
            >
              Full zoom
            </button>
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
    setFlyout(null);
    setPendingZonePlacement(null);
  }, [props.legalActions]);

  const triggerOrderLabel = triggerOrderPromptLabel(state);
  const splitOrphanGroups = splitPromptGroups(state.prompt, orphanGroups);
  const promptView = duelPromptView(state.prompt, splitOrphanGroups.promptGroups, state.luaOperationPrompt);
  const globalOrphanGroups = splitOrphanGroups.globalGroups;
  const triggerOrderView = duelTriggerOrderView(state.triggerOrderPrompt, props.legalActionGroups);

  const oppMz = cardsInZone(state, opponent, "monsterZone");
  const oppSt = cardsInZone(state, opponent, "spellTrapZone");
  const oppField = cardsInZone(state, opponent, "fieldZone")[0];
  const oppHand = cardsInZone(state, opponent, "hand");
  const oppGy = cardsInZone(state, opponent, "graveyard");
  const oppX = cardsInZone(state, opponent, "extraDeck");
  const oppBan = cardsInZone(state, opponent, "banished");
  const oppDeck = deckCount(state, opponent);

  const myMz = cardsInZone(state, viewer, "monsterZone");
  const mySt = cardsInZone(state, viewer, "spellTrapZone");
  const myField = cardsInZone(state, viewer, "fieldZone")[0];
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
            cardGlowForUid={cardGlowForUid}
          />

          <div className="flex w-full flex-col items-center gap-1">
            <span className="text-[9px] font-bold uppercase tracking-[0.25em] text-white/35">Spell / Trap</span>
            <div className="flex w-full items-center justify-center gap-[min(1.2vw,8px)]">
              <SingleZoneSlot
                label="Field"
                card={oppField}
                images={props.cardImages}
                onCardClick={handleCardInteraction}
                cardGlowForUid={cardGlowForUid}
              />
              <ZoneRow
                cards={oppSt}
                player={opponent}
                location="spellTrapZone"
                images={props.cardImages}
                onCardClick={handleCardInteraction}
                onEmptyZoneClick={handleEmptyZoneClick}
                emptyHint="S/T"
                cardGlowForUid={cardGlowForUid}
                emptyZoneIsTarget={emptyZoneIsTarget}
              />
            </div>
            <span className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.25em] text-white/35">Monsters</span>
            <ZoneRow
              cards={oppMz}
              player={opponent}
              location="monsterZone"
              images={props.cardImages}
              onCardClick={handleCardInteraction}
              onEmptyZoneClick={handleEmptyZoneClick}
              emptyHint="M"
              cardGlowForUid={cardGlowForUid}
              emptyZoneIsTarget={emptyZoneIsTarget}
            />
          </div>
        </div>

        {/* ----- EMZ + turn strip ----- */}
        <div className={`flex shrink-0 flex-col items-center gap-0.5 py-1 ${pendingZonePlacement ? "pointer-events-none" : ""}`}>
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
          {triggerOrderView && props.onPlayAction ? (
            <div className="relative z-50 flex max-w-[min(96vw,820px)] justify-center px-1">
              <div className="flex max-w-full gap-1 overflow-x-auto rounded-lg border border-fuchsia-400/35 bg-fuchsia-950/55 px-2.5 py-1.5 shadow-lg shadow-fuchsia-950/30 [scrollbar-width:thin]">
                <div className="min-w-[150px] shrink-0 self-center pr-1">
                  <p className="truncate text-[9px] font-bold uppercase tracking-[0.12em] text-fuchsia-100">{triggerOrderView.label}</p>
                  <p className="truncate text-[10px] font-semibold text-fuchsia-50/65">{triggerOrderView.detail}</p>
                </div>
                {triggerOrderView.groups.flatMap((group) =>
                  group.actions.map((action) => (
                    <button
                      key={`trigger-order-${group.key}-${duelActionUiKey(action)}`}
                      type="button"
                      className="shrink-0 rounded-md border border-fuchsia-300/35 bg-fuchsia-800/65 px-2.5 py-1 text-left text-[10px] font-bold leading-tight text-fuchsia-50 hover:border-fuchsia-200/70 hover:bg-fuchsia-700/75"
                      onClick={() => props.onPlayAction?.(action)}
                    >
                      <span className="line-clamp-2 max-w-[220px]">{action.label}</span>
                    </button>
                  )),
                )}
              </div>
            </div>
          ) : null}
          {promptView && props.onPlayAction ? (
            <div className="relative z-50 flex max-w-[min(96vw,760px)] justify-center px-1">
              <div className="flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-lg border border-violet-400/35 bg-violet-950/55 px-2.5 py-1.5 shadow-lg shadow-violet-950/30">
                <div className="min-w-[140px] max-w-[260px] flex-1">
                  <p className="truncate text-[9px] font-bold uppercase tracking-[0.12em] text-violet-100">{promptView.label}</p>
                  <p className="truncate text-[10px] font-semibold text-violet-50/65">{promptView.detail}</p>
                </div>
                {promptView.choices.map((choice) => (
                  <button
                    key={`prompt-${duelActionUiKey(choice.action)}`}
                    type="button"
                    className="shrink-0 rounded-md border border-violet-300/35 bg-violet-800/65 px-2.5 py-1 text-left text-[10px] font-bold leading-tight text-violet-50 hover:border-violet-200/70 hover:bg-violet-700/75"
                    onClick={() => props.onPlayAction?.(choice.action)}
                  >
                    <span className="line-clamp-2 max-w-[220px]">{choice.action.label}</span>
                  </button>
                ))}
                {!promptView.choices.length ? promptView.groups.flatMap((group) =>
                  group.actions.map((action) => (
                    <button
                      key={`prompt-${group.key}-${duelActionUiKey(action)}`}
                      type="button"
                      className="shrink-0 rounded-md border border-violet-300/35 bg-violet-800/65 px-2.5 py-1 text-left text-[10px] font-bold leading-tight text-violet-50 hover:border-violet-200/70 hover:bg-violet-700/75"
                      onClick={() => props.onPlayAction?.(action)}
                    >
                      <span className="line-clamp-2 max-w-[220px]">{action.label}</span>
                    </button>
                  )),
                ) : null}
              </div>
            </div>
          ) : null}
          {globalOrphanGroups.length > 0 && !pendingZonePlacement && props.onPlayAction ? (
            <div className="relative z-50 flex max-w-[min(96vw,860px)] justify-center px-1">
              <div className="flex max-w-full gap-1 overflow-x-auto rounded-lg border border-cyan-500/20 bg-slate-900/60 px-2 py-1.5 [scrollbar-width:thin]">
                {globalOrphanGroups.map((group) => (
                  <div key={group.key} className="flex shrink-0 items-center gap-1">
                    <span className="shrink-0 self-center pr-1 text-[8px] font-bold uppercase tracking-[0.12em] text-white/35">{duelActionUiGroupLabel(group)}</span>
                    {group.actions.map((action) => (
                      <button
                        key={`orphan-${group.key}-${duelActionUiKey(action)}`}
                        type="button"
                        className="shrink-0 rounded-md border border-cyan-500/25 bg-slate-800/80 px-2 py-1 text-left text-[9px] font-semibold leading-tight text-cyan-50/95 hover:border-cyan-400/50 hover:bg-cyan-900/35"
                        onClick={() => props.onPlayAction?.(action)}
                      >
                        <span className="line-clamp-2 max-w-[200px]">{action.label}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* ----- Player half (near) ----- */}
        <div className="flex min-h-0 flex-[1.15] flex-col items-center justify-start gap-0.5">
          <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-1 overflow-visible">
            <span className="text-[9px] font-bold uppercase tracking-[0.25em] text-white/35">Monsters</span>
            <ZoneRow
              cards={myMz}
              player={viewer}
              location="monsterZone"
              images={props.cardImages}
              onCardClick={handleCardInteraction}
              onEmptyZoneClick={handleEmptyZoneClick}
              emptyHint="M"
              cardGlowForUid={cardGlowForUid}
              emptyZoneIsTarget={emptyZoneIsTarget}
            />
            <span className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.25em] text-white/35">Spell / Trap</span>
            <div className="flex w-full items-center justify-center gap-[min(1.2vw,8px)]">
              <SingleZoneSlot
                label="Field"
                card={myField}
                images={props.cardImages}
                onCardClick={handleCardInteraction}
                cardGlowForUid={cardGlowForUid}
              />
              <ZoneRow
                cards={mySt}
                player={viewer}
                location="spellTrapZone"
                images={props.cardImages}
                onCardClick={handleCardInteraction}
                onEmptyZoneClick={handleEmptyZoneClick}
                emptyHint="S/T"
                cardGlowForUid={cardGlowForUid}
                emptyZoneIsTarget={emptyZoneIsTarget}
              />
            </div>
          </div>

          <div className="shrink-0 pt-0.5">
            <HandFan
              cards={myHand}
              images={props.cardImages}
              hidden={false}
              onCardClick={handleCardInteraction}
              align="bottom"
              cardGlowForUid={cardGlowForUid}
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
          if (isMonsterZoneSummonAction(action)) {
            setPendingZonePlacement({ action, player: action.player, location: "monsterZone" });
          } else if (isSpellTrapZonePlacementAction(action, flyout.card)) {
            setPendingZonePlacement({ action, player: action.player, location: "spellTrapZone" });
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
