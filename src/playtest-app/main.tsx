import { createRoot } from "react-dom/client";
import { Link, Outlet, RouterProvider, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  applyAction,
  chooseHighestPriority,
  getLegalActions,
  runPlaytest,
  snapshot,
  startPlaytest,
} from "#playtest/api.js";
import type { PlaytestEvaluation, PlaytestSession, PlaytestSnapshot } from "#playtest/api.js";
import { parseYdk } from "#playtest/ydk.js";
import type { CardSummary, PlaytestAction } from "#engine/types.js";
import cardBackUrl from "../../assets/card-back.webp";
import {
  CardZoom,
  LogPanel,
  ToastStack,
  cardToneBg,
  getCardTypeClass,
  qualityClass,
  readBuilderDeck,
  starterYdk,
} from "./ui.js";
import type { CardImageInfo, PileView, ToastMessage, ZoomCard } from "./ui.js";
import "./styles.css";

function AppShell() {
  return <Outlet />;
}

function PlaytestArena() {
  const [ydkText, setYdkText] = useState(starterYdk);
  const [seed, setSeed] = useState("dm-goldfish-001");
  const [handSize, setHandSize] = useState(5);
  const [maxActions, setMaxActions] = useState(12);
  const [session, setSession] = useState<PlaytestSession | null>(null);
  const [revision, setRevision] = useState(0);
  const [imageRevision, setImageRevision] = useState(0);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [zoomCard, setZoomCard] = useState<ZoomCard | null>(null);
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [pileView, setPileView] = useState<PileView | null>(null);
  const cardImages = useRef(new Map<string, CardImageInfo>());

  const parsedDeck = useMemo(() => parseYdk(ydkText), [ydkText]);
  const view = useMemo(() => (session ? snapshot(session) : null), [revision, session]);
  const visibleIds = useMemo(() => {
    const cards = [
      ...(view?.state.hand ?? []),
      ...(view?.state.field ?? []),
      ...(view?.state.graveyard ?? []),
      ...(view?.state.banished ?? []),
      ...(view?.state.extraDeck ?? []),
    ];
    return [...new Set([...parsedDeck.main, ...parsedDeck.extra, ...cards.map((card) => card.id)])];
  }, [parsedDeck.extra, parsedDeck.main, view]);

  const notify = useCallback((title: string, message: string, tone: ToastMessage["tone"] = "default") => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current, { id, title, message, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3600);
  }, []);

  const hydrateImagesForIds = useCallback(async (ids: string[]) => {
    const missing = [...new Set(ids.map(String).filter((id) => !cardImages.current.has(id)))];
    if (!missing.length) return;
    try {
      const response = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${missing.join(",")}`);
      if (!response.ok) throw new Error(`YGOPRODeck returned ${response.status}`);
      const payload = await response.json() as {
        data?: Array<{ id: number | string; card_images?: Array<{ image_url?: string; image_url_small?: string }> }>;
      };
      for (const card of payload.data ?? []) {
        const image = card.card_images?.[0];
        if (!image) continue;
        cardImages.current.set(String(card.id), {
          small: image.image_url_small || image.image_url || "",
          large: image.image_url || image.image_url_small || "",
        });
      }
      setImageRevision((current) => current + 1);
    } catch (error) {
      console.warn("Could not hydrate card images", error);
      notify("Card images unavailable", error instanceof Error ? error.message : "Could not fetch card scans.", "warning");
    }
  }, [notify]);

  useEffect(() => {
    void hydrateImagesForIds(visibleIds);
  }, [hydrateImagesForIds, visibleIds]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("source") !== "builder") return;
    const loaded = readBuilderDeck();
    if (!loaded) return;
    setYdkText(loaded.ydk);
    notify("Builder deck loaded", `${loaded.mainCount} Main and ${loaded.extraCount} Extra cards imported.`, "success");
  }, [notify]);

  useEffect(() => {
    if (!zoomCard && !pileView) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setZoomCard(null);
        setPileView(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [zoomCard, pileView]);

  const start = useCallback(() => {
    try {
      const parsed = parseYdk(ydkText);
      void hydrateImagesForIds([...parsed.main, ...parsed.extra]);
      setSession(startPlaytest({
        deck: parsed.main,
        extraDeck: parsed.extra,
        seed: seed || Date.now(),
        handSize,
      }));
      setRevision((current) => current + 1);
      notify("Opening hand drawn", "The dry run is ready for manual or agent actions.", "success");
    } catch (error) {
      notify("Could not start", error instanceof Error ? error.message : "Invalid deck input.", "error");
    }
  }, [handSize, hydrateImagesForIds, notify, seed, ydkText]);

  const apply = useCallback((action: PlaytestAction) => {
    if (!session) return;
    const result = applyAction(session, action);
    setRevision((current) => current + 1);
    if (!result.ok) notify("Action rejected", result.error ?? "The engine rejected that action.", "error");
  }, [notify, session]);

  const step = useCallback(() => {
    if (!session) return;
    const currentView = snapshot(session);
    const action = chooseHighestPriority({
      state: currentView.state,
      legalActions: getLegalActions(session),
      evaluation: currentView.evaluation,
    });
    if (!action || action.type === "end") return;
    const result = applyAction(session, action);
    setRevision((current) => current + 1);
    if (!result.ok) notify("Action rejected", result.error ?? "The engine rejected that action.", "error");
  }, [notify, session]);

  const auto = useCallback(() => {
    if (!session) return;
    runPlaytest(session, chooseHighestPriority, maxActions);
    setRevision((current) => current + 1);
  }, [maxActions, session]);

  const loadIncludedDeck = useCallback(async () => {
    try {
      const response = await fetch("./dark-magical-blast-tcg-branded-dm.ydk");
      if (!response.ok) throw new Error(`Could not load included deck (${response.status})`);
      setYdkText(await response.text());
      notify("Sample deck loaded", "Dark Magical Blast TCG list is ready to test.", "success");
    } catch (error) {
      setYdkText(starterYdk);
      notify("Using embedded sample", error instanceof Error ? error.message : "Could not fetch the deck file.", "warning");
    }
  }, [notify]);

  const loadBuilderDeck = useCallback(() => {
    const loaded = readBuilderDeck();
    if (!loaded) {
      notify("No builder deck", "Build or import a deck on the deck builder page first.", "warning");
      return;
    }
    setYdkText(loaded.ydk);
    notify("Builder deck loaded", `${loaded.mainCount} Main and ${loaded.extraCount} Extra cards imported.`, "success");
  }, [notify]);

  return (
    <main className="relative z-10 min-h-screen px-3 py-4 text-[#f3ead2] sm:px-4 lg:px-6">
      <div className="mx-auto flex max-w-[2000px] flex-col gap-4">
        {/* Header */}
        <header className="tcg-panel flex flex-col gap-4 rounded-xl px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="grid h-11 w-11 place-items-center rounded-lg bg-gradient-to-br from-[#d4af37] to-[#b8962f] text-lg font-bold text-[#0a0c08] shadow-lg shadow-black/30">
              ⚔
            </div>
            <div>
              <p className="font-['Cinzel'] text-[10px] font-semibold uppercase tracking-[0.3em] text-[#d4af37]/70">Duel Deck Studio</p>
              <h1 className="font-['Cinzel'] text-xl font-bold tracking-wide text-[#fff7dc] sm:text-2xl">Goldfish Arena</h1>
            </div>
          </div>
          <nav className="flex flex-wrap items-center gap-3 text-sm">
            <Link to="/playtest.html" className="nav-link rounded-lg px-4 py-2 font-semibold">Playtest</Link>
            <a href="./index.html" className="nav-link-secondary rounded-lg px-4 py-2 font-medium hover:text-[#fff7dc]">Deck Builder</a>
          </nav>
        </header>

        {/* Main Grid with Collapsible Panels */}
        <section className="grid gap-4" style={{ 
          gridTemplateColumns: `${leftPanelOpen ? '320px' : '48px'} minmax(0, 1fr) ${rightPanelOpen ? '340px' : '48px'}`,
          transition: 'grid-template-columns 300ms ease'
        }}>
          {/* Left Panel - Collapsible */}
          <div className="relative">
            {leftPanelOpen ? (
              <ControlPanel
                ydkText={ydkText}
                deckCount={parsedDeck.main.length}
                extraCount={parsedDeck.extra.length}
                seed={seed}
                handSize={handSize}
                maxActions={maxActions}
                hasSession={Boolean(session)}
                onYdkTextChange={setYdkText}
                onSeedChange={setSeed}
                onHandSizeChange={setHandSize}
                onMaxActionsChange={setMaxActions}
                onLoadBuilderDeck={loadBuilderDeck}
                onLoadIncludedDeck={loadIncludedDeck}
                onStart={start}
                onStep={step}
                onAuto={auto}
                onCollapse={() => setLeftPanelOpen(false)}
              />
            ) : (
              <CollapsedPanel 
                side="left" 
                icon="📋" 
                label="Deck" 
                onExpand={() => setLeftPanelOpen(true)} 
              />
            )}
          </div>

          {/* Center - Game Board */}
          <GameBoard
            view={view}
            imageRevision={imageRevision}
            cardImages={cardImages.current}
            onZoom={setZoomCard}
            onViewPile={setPileView}
          />

          {/* Right Panel - Collapsible */}
          <div className="relative">
            {rightPanelOpen ? (
              <SidePanel 
                view={view} 
                onApplyAction={apply} 
                onCollapse={() => setRightPanelOpen(false)}
              />
            ) : (
              <CollapsedPanel 
                side="right" 
                icon="📊" 
                label="Info" 
                onExpand={() => setRightPanelOpen(true)} 
              />
            )}
          </div>
        </section>
      </div>

      <ToastStack toasts={toasts} />
      {zoomCard ? <CardZoom card={zoomCard} onClose={() => setZoomCard(null)} /> : null}
      {pileView ? (
        <PileViewer 
          pile={pileView} 
          cardImages={cardImages.current}
          onZoom={setZoomCard}
          onClose={() => setPileView(null)} 
        />
      ) : null}
    </main>
  );
}

function CollapsedPanel(props: { side: "left" | "right"; icon: string; label: string; onExpand: () => void }) {
  return (
    <button
      className="tcg-panel flex h-full w-full flex-col items-center gap-3 rounded-xl py-6 transition-all hover:border-[#d4af37]/40"
      type="button"
      onClick={props.onExpand}
      title={`Expand ${props.label} panel`}
    >
      <span className="text-xl">{props.icon}</span>
      <span 
        className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#d4af37]/60"
        style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
      >
        {props.label}
      </span>
      <span className="mt-auto text-lg text-[#d4af37]/40">
        {props.side === "left" ? "›" : "‹"}
      </span>
    </button>
  );
}

function ControlPanel(props: {
  ydkText: string;
  deckCount: number;
  extraCount: number;
  seed: string;
  handSize: number;
  maxActions: number;
  hasSession: boolean;
  onYdkTextChange: (value: string) => void;
  onSeedChange: (value: string) => void;
  onHandSizeChange: (value: number) => void;
  onMaxActionsChange: (value: number) => void;
  onLoadBuilderDeck: () => void;
  onLoadIncludedDeck: () => void;
  onStart: () => void;
  onStep: () => void;
  onAuto: () => void;
  onCollapse: () => void;
}) {
  return (
    <aside className="tcg-panel flex flex-col gap-4 rounded-xl p-4">
      {/* Header with collapse button */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#d4af37]/60">Input</p>
          <h2 className="font-['Cinzel'] text-lg font-bold text-[#fff7dc]">Deck List</h2>
        </div>
        <div className="tcg-badge rounded-full px-2.5 py-1 text-xs">
          {props.deckCount}<span className="text-[#d4af37]/50">+</span>{props.extraCount}
        </div>
        <button 
          className="grid h-8 w-8 place-items-center rounded-lg border border-[#d4af37]/20 text-[#d4af37]/60 transition-colors hover:border-[#d4af37]/40 hover:text-[#d4af37]"
          type="button"
          onClick={props.onCollapse}
          title="Collapse panel"
        >
          ‹
        </button>
      </div>

      {/* Load buttons */}
      <div className="flex gap-2">
        <button className="action-button flex-1 rounded-lg px-3 py-2 text-xs font-semibold" type="button" onClick={props.onLoadBuilderDeck}>
          From Builder
        </button>
        <button className="action-button flex-1 rounded-lg px-3 py-2 text-xs font-semibold" type="button" onClick={props.onLoadIncludedDeck}>
          Sample Deck
        </button>
      </div>

      {/* Deck textarea */}
      <textarea
        className="tcg-textarea h-40 w-full resize-y rounded-lg p-3 font-mono text-[11px] leading-relaxed outline-none"
        spellCheck={false}
        placeholder="#main&#10;46986414&#10;..."
        value={props.ydkText}
        onChange={(event) => props.onYdkTextChange(event.target.value)}
      />

      {/* Configuration inputs */}
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#c7b98f]/80">Seed</span>
          <input
            className="tcg-input w-full rounded-lg px-3 py-2 text-sm"
            value={props.seed}
            placeholder="Random seed..."
            onChange={(event) => props.onSeedChange(event.target.value)}
          />
        </label>
        <NumberInput label="Hand Size" min={1} max={10} value={props.handSize} onChange={props.onHandSizeChange} />
        <NumberInput label="Max Actions" min={1} max={40} value={props.maxActions} onChange={props.onMaxActionsChange} />
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-3 gap-2">
        <button className="primary-button rounded-lg px-3 py-2 text-sm" type="button" onClick={props.onStart}>
          Draw Hand
        </button>
        <button 
          className="action-button rounded-lg px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40" 
          type="button" 
          onClick={props.onStep} 
          disabled={!props.hasSession}
        >
          Step
        </button>
        <button 
          className="action-button rounded-lg px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40" 
          type="button" 
          onClick={props.onAuto} 
          disabled={!props.hasSession}
        >
          Auto Run
        </button>
      </div>
    </aside>
  );
}

function NumberInput(props: { label: string; min: number; max: number; value: number; onChange: (value: number) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#c7b98f]/80">{props.label}</span>
      <input
        className="tcg-input w-full rounded-lg px-3 py-2 text-sm"
        type="number"
        min={props.min}
        max={props.max}
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
    </label>
  );
}

function GameBoard(props: {
  view: PlaytestSnapshot | null;
  imageRevision: number;
  cardImages: Map<string, CardImageInfo>;
  onZoom: (card: ZoomCard) => void;
  onViewPile: (pile: PileView) => void;
}) {
  void props.imageRevision;
  const state = props.view?.state;
  const deckCount = state?.deckCount ?? 40;
  
  // Separate field cards by type
  const monsterCards = (state?.field ?? []).filter(c => c.type === "monster" || c.type === "extra");
  const spellTrapCards = (state?.field ?? []).filter(c => c.type === "spell" || c.type === "trap");

  const graveyard = state?.graveyard ?? [];
  const extraDeck = state?.extraDeck ?? [];
  const banished = state?.banished ?? [];
  
  return (
    <section className="tcg-panel rounded-xl p-4">
      {/* Proper Yu-Gi-Oh Field Layout */}
      <div className="duel-field mx-auto flex max-w-[900px] flex-col gap-3">
        
        {/* Row 1: Extra Monster Zones (shared between players) */}
        <div className="flex justify-center gap-3">
          <div className="w-[100px]">
            {/* Spacer for column alignment */}
          </div>
          <FieldSlot label="EMZ" />
          <div className="w-[100px]">
            {/* Spacer for middle */}
          </div>
          <FieldSlot label="EMZ" />
          <div className="w-[100px]">
            {/* Spacer for column alignment */}
          </div>
        </div>

        {/* Row 2: Field Zone + 5 Main Monster Zones + Graveyard */}
        <div className="flex items-center justify-center gap-3">
          {/* Field Zone (Left) */}
          <div className="zone-frame flex h-[146px] w-[100px] flex-col items-center justify-center rounded-lg p-2">
            <span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#d4af37]/40">Field</span>
            <span className="text-lg text-[#d4af37]/30">◇</span>
          </div>
          
          {/* 5 Main Monster Zones */}
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
          
          {/* Graveyard (Right) - Clickable */}
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

        {/* Row 3: Extra Deck + 5 Spell/Trap Zones + Main Deck */}
        <div className="flex items-center justify-center gap-3">
          {/* Extra Deck Zone (Left) - Clickable */}
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
          
          {/* 5 Spell/Trap Zones */}
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
          
          {/* Main Deck Zone (Right) */}
          <div className="zone-frame flex h-[146px] w-[100px] flex-col items-center justify-center rounded-lg p-2">
            <span className="mb-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[#d4af37]/40">Deck</span>
            <div className="relative">
              <img 
                className="w-[70px] rounded border border-[#d4af37]/30 object-contain shadow-lg" 
                src={cardBackUrl} 
                alt="Deck" 
              />
              <span className="pile-counter absolute -bottom-1.5 -right-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold text-white">
                {deckCount}
              </span>
            </div>
          </div>
        </div>

        {/* Row 4: Banished Zone indication - Clickable */}
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

        {/* Divider */}
        <div className="my-2 h-px bg-gradient-to-r from-transparent via-[#d4af37]/30 to-transparent" />

        {/* Hand Zone */}
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
        {props.cards.length > 0 && (
          <span className="tcg-badge rounded-full px-2 py-0.5 text-[10px]">{props.cards.length}</span>
        )}
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
          Draw a hand to begin
        </div>
      )}
    </div>
  );
}

/** Non-interactive pile preview (just shows top card + count) */
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
        <img 
          className={`${sizeClass} rounded border border-[#d4af37]/30 object-contain shadow-lg`}
          src={cardBackUrl} 
          alt="Card stack" 
        />
        <span className={`pile-counter absolute -bottom-1.5 -right-1.5 rounded px-1.5 py-0.5 ${props.tiny ? 'text-[8px]' : 'text-[10px]'} font-bold text-white`}>
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
        <img 
          className={`${sizeClass} rounded border border-[#d4af37]/30 object-contain shadow-lg`}
          src={fullCard} 
          alt={topCard.name} 
          loading="lazy" 
        />
      ) : (
        <div className={`${sizeClass} aspect-[59/86] rounded border border-[#d4af37]/30 bg-[#1a1a12] p-1`}>
          <span className="text-[8px] font-bold text-[#d4af37]/60">{topCard.name}</span>
        </div>
      )}
      <span className={`pile-counter absolute -bottom-1.5 -right-1.5 rounded px-1.5 py-0.5 ${props.tiny ? 'text-[8px]' : 'text-[10px]'} font-bold text-white`}>
        {props.cards.length}
      </span>
    </div>
  );
}

/** Modal to view all cards in a pile */
function PileViewer(props: { 
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
        {/* Header */}
        <div className="mb-4 flex items-center justify-between border-b border-[#d4af37]/20 pb-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{props.pile.icon}</span>
            <div>
              <h2 className="font-['Cinzel'] text-xl font-bold text-[#fff7dc]">{props.pile.title}</h2>
              <p className="text-sm text-[#d4af37]/60">{props.pile.cards.length} card{props.pile.cards.length !== 1 ? 's' : ''}</p>
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
        
        {/* Cards Grid */}
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
                    {/* Card position indicator */}
                    <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-[#d4af37]/20 text-[10px] font-bold text-[#d4af37]">
                      {index + 1}
                    </span>
                    
                    {/* Card image */}
                    <div className="aspect-[59/86] w-full overflow-hidden rounded-md border-2 border-[#d4af37]/30 bg-[#0a0c08] shadow-lg transition-all group-hover:border-[#d4af37]/60">
                      {fullCard ? (
                        <img 
                          className="h-full w-full object-contain" 
                          src={fullCard} 
                          alt={card.name} 
                          loading="lazy" 
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center bg-gradient-to-b from-[#1a1815] to-[#0d0c0a] p-1">
                          <span className="text-center text-[9px] font-bold leading-tight text-[#d4af37]/60">{card.name}</span>
                        </div>
                      )}
                    </div>
                    
                    {/* Card name */}
                    <span className="line-clamp-2 text-center text-[10px] font-semibold leading-tight text-[#f3ead2]">
                      {card.name}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex h-40 items-center justify-center text-[#d4af37]/40">
              No cards in this zone
            </div>
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

function SidePanel(props: { view: PlaytestSnapshot | null; onApplyAction: (action: PlaytestAction) => void; onCollapse: () => void }) {
  const playableGroups = props.view?.legalActionGroups
    .map((group) => ({ ...group, actions: group.actions.filter((action) => action.type !== "end") }))
    .filter((group) => group.actions.length > 0) ?? [];
  const playableCount = playableGroups.reduce((total, group) => total + group.actions.length, 0);
  
  return (
    <aside className="flex flex-col gap-4">
      <EvaluationPanel 
        evaluation={props.view?.evaluation ?? null} 
        normalSummonUsed={props.view?.state.normalSummonUsed ?? false} 
        onCollapse={props.onCollapse}
      />
      
      {/* Legal Actions */}
      <section className="tcg-panel rounded-xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#d4af37]/60">Available</p>
            <h2 className="font-['Cinzel'] text-base font-bold text-[#fff7dc]">Legal Actions</h2>
          </div>
          <span className="tcg-badge rounded-full px-2.5 py-1 text-xs">{playableCount}</span>
        </div>
        <div className="flex max-h-48 flex-col gap-2 overflow-y-auto pr-1">
          {playableGroups.length ? playableGroups.map((group) => (
            <div key={group.key} className="flex flex-col gap-1.5">
              <div className="px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[#d4af37]/55">{group.label}</div>
              {group.actions.map((action) => (
                <button 
                  key={`${action.type}-${action.uid}-${action.label}`} 
                  className="action-button rounded-lg px-3 py-2.5 text-left text-sm font-semibold" 
                  type="button" 
                  onClick={() => props.onApplyAction(action)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )) : (
            <div className="empty-state rounded-lg px-4 py-8 text-center text-sm">
              No legal actions available
            </div>
          )}
        </div>
      </section>
      
      <LogPanel log={props.view?.state.log ?? []} />
    </aside>
  );
}

function EvaluationPanel(props: { evaluation: PlaytestEvaluation | null; normalSummonUsed: boolean; onCollapse: () => void }) {
  const score = props.evaluation?.score ?? 0;
  const quality = props.evaluation?.quality ?? "waiting";
  const circumference = 264;
  const offset = circumference - circumference * Math.min(score / 10, 1);
  
  return (
    <section className="tcg-panel rounded-xl p-4">
      {/* Header with collapse button */}
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#d4af37]/60">Analysis</p>
          <h2 className="font-['Cinzel'] text-base font-bold text-[#fff7dc]">Hand Evaluation</h2>
        </div>
        <button 
          className="grid h-8 w-8 place-items-center rounded-lg border border-[#d4af37]/20 text-[#d4af37]/60 transition-colors hover:border-[#d4af37]/40 hover:text-[#d4af37]"
          type="button"
          onClick={props.onCollapse}
          title="Collapse panel"
        >
          ›
        </button>
      </div>
      
      <div className="flex items-center gap-4">
        {/* Score Ring */}
        <div className="relative size-20 shrink-0">
          <svg viewBox="0 0 96 96" className="score-ring -rotate-90">
            <circle cx="48" cy="48" r="42" stroke="rgba(212, 175, 55, 0.15)" strokeWidth="8" fill="none" />
            <circle 
              cx="48" cy="48" r="42" 
              stroke="#d4af37" 
              strokeWidth="8" 
              strokeLinecap="round" 
              strokeDasharray={circumference} 
              strokeDashoffset={offset} 
              fill="none" 
            />
          </svg>
          <span className="absolute inset-0 grid place-items-center font-['Cinzel'] text-2xl font-black text-[#fff7dc]">{score}</span>
        </div>
        
        {/* Quality info */}
        <div className="flex-1">
          <span className={`inline-flex rounded-lg px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${qualityClass(quality)}`}>
            {quality}
          </span>
          <p className="mt-2 text-sm text-[#d9cda7]">
            {props.normalSummonUsed ? "Normal summon used" : "Normal summon ready"}
          </p>
        </div>
      </div>
      
      {/* Risks */}
      <ul className="mt-4 space-y-2">
        {(props.evaluation?.risks.length ? props.evaluation.risks : ["Start a duel to evaluate this hand."]).map((risk) => (
          <li key={risk} className="risk-item rounded-lg px-3 py-2.5 text-sm text-[#eadfc2]">
            {risk}
          </li>
        ))}
      </ul>
    </section>
  );
}

const rootRoute = createRootRoute({ component: AppShell });
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: PlaytestArena,
});
const playtestRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/playtest.html",
  component: PlaytestArena,
});
const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute, playtestRoute]) });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root") as HTMLElement).render(<RouterProvider router={router} />);
