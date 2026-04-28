import { createRoot } from "react-dom/client";
import { Link, Outlet, RouterProvider, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  applyAction,
  chooseHighestPriority,
  getLegalActions,
  parseYdk,
  runPlaytest,
  snapshot,
  startPlaytest,
  type PlaytestEvaluation,
  type PlaytestSession,
  type PlaytestSnapshot,
} from "../playtest/index.js";
import type { CardSummary, PlaytestAction, PlaytestLogEntry } from "../engine/index.js";
import cardBackUrl from "../../assets/card-back.webp";
import "./styles.css";

interface CardImageInfo {
  small: string;
  large: string;
}

interface ToastMessage {
  id: number;
  title: string;
  message: string;
  tone: "default" | "success" | "warning" | "error";
}

interface ZoomCard {
  name: string;
  image: string;
}

const AUTO_DECK_KEY = "duelDeckStudio.autoDeck.v1";

const starterYdk = `#created by Duel Deck Studio
#deck Dark Magical Blast - TCG Branded DM
#main
46986414
46986414
38033121
97631303
97631303
97631303
7084129
7084129
7084129
12266229
12266229
12266229
30603688
3078380
74677422
68468459
68468459
14558127
14558127
14558127
23020408
23020408
23020408
47222536
47222536
47222536
95477924
95477924
96729612
96729612
59514116
1784686
11827244
6172122
44362883
44362883
24224830
65681983
48680970
48680970
#extra
50237654
50237654
41721210
85059922
37818794
73452089
84433295
44146295
70534340
87746184
24915933
96471335
44405066
8264361
29301450
!side`;

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
    if (!zoomCard) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setZoomCard(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [zoomCard]);

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
    <main className="min-h-screen px-3 py-4 text-[#f3ead2] sm:px-5 lg:px-7">
      <div className="mx-auto flex max-w-[1800px] flex-col gap-4">
        <header className="tcg-panel flex flex-col gap-4 rounded-lg px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="font-['Cinzel'] text-xs uppercase tracking-[0.28em] text-[#d2b166]/80">Duel Deck Studio</p>
            <h1 className="font-['Cinzel'] text-2xl font-bold text-[#fff7dc] sm:text-3xl">Goldfish Playtest Arena</h1>
          </div>
          <nav className="flex flex-wrap items-center gap-2 text-sm">
            <Link to="/playtest.html" className="rounded border border-[#d2b166]/40 bg-[#d2b166]/10 px-3 py-2 text-[#fff7dc]">Playtest</Link>
            <a href="./index.html" className="rounded border border-white/10 px-3 py-2 text-[#e5d7b8] hover:border-[#d2b166]/40">Deck Builder</a>
          </nav>
        </header>

        <section className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_340px]">
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
          />

          <GameBoard
            view={view}
            imageRevision={imageRevision}
            cardImages={cardImages.current}
            onZoom={setZoomCard}
          />

          <SidePanel view={view} onApplyAction={apply} />
        </section>
      </div>

      <ToastStack toasts={toasts} />
      {zoomCard ? <CardZoom card={zoomCard} onClose={() => setZoomCard(null)} /> : null}
    </main>
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
}) {
  return (
    <aside className="tcg-panel rounded-lg p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-['Cinzel'] text-lg font-bold">Deck Input</h2>
        <span className="rounded bg-[#d2b166]/12 px-2 py-1 text-xs font-semibold text-[#f4dc9c]">{props.deckCount} / {props.extraCount}</span>
      </div>
      <div className="flex gap-2">
        <button className="action-button rounded px-3 py-2 text-sm font-semibold" type="button" onClick={props.onLoadBuilderDeck}>From Builder</button>
        <button className="action-button rounded px-3 py-2 text-sm font-semibold" type="button" onClick={props.onLoadIncludedDeck}>Sample</button>
      </div>
      <textarea
        className="mt-3 h-56 w-full resize-y rounded border border-[#d2b166]/20 bg-black/45 p-3 font-mono text-xs leading-5 text-[#f5ead0] outline-none focus:border-[#d2b166]/60"
        spellCheck={false}
        value={props.ydkText}
        onChange={(event) => props.onYdkTextChange(event.target.value)}
      />

      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="col-span-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#c7b98f]">
          Seed
          <input
            className="mt-1 w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm normal-case tracking-normal text-[#fff7dc] outline-none focus:border-[#d2b166]/60"
            value={props.seed}
            onChange={(event) => props.onSeedChange(event.target.value)}
          />
        </label>
        <NumberInput label="Hand" min={1} max={10} value={props.handSize} onChange={props.onHandSizeChange} />
        <NumberInput label="Max Actions" min={1} max={40} value={props.maxActions} onChange={props.onMaxActionsChange} />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <button className="rounded bg-[#d2b166] px-3 py-2 text-sm font-bold text-[#141007] shadow-lg shadow-black/30" type="button" onClick={props.onStart}>Draw Hand</button>
        <button className="action-button rounded px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-45" type="button" onClick={props.onStep} disabled={!props.hasSession}>Step</button>
        <button className="action-button rounded px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-45" type="button" onClick={props.onAuto} disabled={!props.hasSession}>Auto</button>
      </div>
    </aside>
  );
}

function NumberInput(props: { label: string; min: number; max: number; value: number; onChange: (value: number) => void }) {
  return (
    <label className="text-xs font-semibold uppercase tracking-[0.16em] text-[#c7b98f]">
      {props.label}
      <input
        className="mt-1 w-full rounded border border-white/10 bg-black/40 px-3 py-2 text-sm normal-case tracking-normal text-[#fff7dc] outline-none focus:border-[#d2b166]/60"
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
}) {
  void props.imageRevision;
  const state = props.view?.state;
  const deckCount = state?.deckCount ?? 40;
  return (
    <section className="tcg-panel min-h-[720px] rounded-lg p-4">
      <div className="grid min-h-[688px] grid-cols-[118px_minmax(0,1fr)_118px] gap-3">
        <ZoneColumn title="Banished">
          <Pile cards={state?.banished ?? []} emptyLabel="RFG" images={props.cardImages} onZoom={props.onZoom} />
        </ZoneColumn>

        <div className="flex min-w-0 flex-col justify-between gap-4">
          <PlaymatField cards={state?.field ?? []} images={props.cardImages} onZoom={props.onZoom} />
          <HandZone cards={state?.hand ?? []} images={props.cardImages} onZoom={props.onZoom} />
        </div>

        <div className="grid grid-rows-2 gap-3">
          <DeckPile count={deckCount} />
          <ZoneColumn title="Extra">
            <Pile cards={state?.extraDeck ?? []} emptyLabel="ED" faceDown images={props.cardImages} onZoom={props.onZoom} />
          </ZoneColumn>
        </div>
      </div>
    </section>
  );
}

function ZoneColumn(props: { title: string; children: ReactNode }) {
  return (
    <div className="zone-frame flex min-h-0 flex-col rounded-lg p-3">
      <span className="mb-2 text-xs font-bold uppercase tracking-[0.22em] text-[#c7b98f]/85">{props.title}</span>
      <div className="flex min-h-0 flex-1 items-center justify-center">{props.children}</div>
    </div>
  );
}

function PlaymatField(props: { cards: CardSummary[]; images: Map<string, CardImageInfo>; onZoom: (card: ZoomCard) => void }) {
  const monsterCards = props.cards.slice(0, 5);
  const spellCards = props.cards.slice(5, 10);
  return (
    <div className="zone-frame min-h-[390px] rounded-lg p-4">
      <div className="grid h-full grid-rows-2 gap-4">
        <FieldRow cards={monsterCards} kind="Monster" images={props.images} onZoom={props.onZoom} />
        <FieldRow cards={spellCards} kind="Spell / Trap" images={props.images} onZoom={props.onZoom} />
      </div>
    </div>
  );
}

function FieldRow(props: { cards: CardSummary[]; kind: string; images: Map<string, CardImageInfo>; onZoom: (card: ZoomCard) => void }) {
  return (
    <div className="grid grid-cols-5 gap-3">
      {Array.from({ length: 5 }, (_, index) => {
        const card = props.cards[index];
        return (
          <div key={`${props.kind}-${index}`} className="flex min-h-[162px] items-center justify-center rounded border border-dashed border-[#d2b166]/18 bg-black/24 p-2">
            {card ? (
              <div className="w-[86px]">
                <GameCard card={card} images={props.images} onZoom={props.onZoom} />
              </div>
            ) : (
              <span className="text-center text-[10px] font-bold uppercase tracking-[0.18em] text-[#c7b98f]/35">{props.kind}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function HandZone(props: { cards: CardSummary[]; images: Map<string, CardImageInfo>; onZoom: (card: ZoomCard) => void }) {
  return (
    <div className="zone-frame min-h-[205px] rounded-lg p-4">
      {props.cards.length ? (
        <div className="flex min-w-0 justify-center gap-3 overflow-x-auto pb-2">
          {props.cards.map((card) => (
            <div key={card.uid} className="w-[96px] shrink-0">
              <GameCard card={card} images={props.images} onZoom={props.onZoom} />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex h-full min-h-[165px] items-center justify-center text-sm font-semibold uppercase tracking-[0.2em] text-[#c7b98f]/45">
          Draw a hand to begin
        </div>
      )}
    </div>
  );
}

function Pile(props: {
  cards: CardSummary[];
  emptyLabel: string;
  faceDown?: boolean;
  images: Map<string, CardImageInfo>;
  onZoom: (card: ZoomCard) => void;
}) {
  if (!props.cards.length) {
    return (
      <div className="flex aspect-[59/86] w-[82px] items-center justify-center rounded border border-dashed border-white/12 bg-black/28 text-xs font-bold uppercase tracking-[0.18em] text-white/24">
        {props.emptyLabel}
      </div>
    );
  }

  if (props.faceDown) {
    return (
      <div className="relative w-[82px]">
        <img className="aspect-[59/86] w-full rounded border border-[#d2b166]/30 object-contain shadow-lg shadow-black/50" src={cardBackUrl} alt={`${props.emptyLabel} stack`} />
        <span className="absolute -bottom-2 -right-2 rounded-md border border-white/20 bg-black/86 px-2 py-1 text-sm font-black text-white shadow-lg">{props.cards.length}</span>
      </div>
    );
  }

  const topCard = props.cards[props.cards.length - 1];
  return topCard ? (
    <div className="relative w-[82px]">
      <GameCard card={topCard} images={props.images} onZoom={props.onZoom} />
      <span className="absolute -bottom-2 -right-2 rounded-md border border-white/20 bg-black/86 px-2 py-1 text-sm font-black text-white shadow-lg">{props.cards.length}</span>
    </div>
  ) : null;
}

function DeckPile(props: { count: number }) {
  return (
    <div className="zone-frame flex min-h-0 flex-col rounded-lg p-3">
      <span className="mb-2 text-xs font-bold uppercase tracking-[0.22em] text-[#c7b98f]/85">Deck</span>
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div className="relative w-[82px]">
          <img className="aspect-[59/86] w-full rounded border border-[#d2b166]/35 object-contain shadow-lg shadow-black/50" src={cardBackUrl} alt="Deck stack" />
          <span className="absolute -bottom-2 -right-2 rounded-md border border-white/20 bg-black/86 px-2 py-1 text-sm font-black text-white shadow-lg">{props.count}</span>
        </div>
      </div>
    </div>
  );
}

function GameCard(props: { card: CardSummary; images: Map<string, CardImageInfo>; onZoom: (card: ZoomCard) => void }) {
  const image = props.images.get(props.card.id);
  const fullCard = image?.large || image?.small;
  const fallbackClass = cardTone(props.card);

  if (fullCard) {
    return (
      <button className="card-button" type="button" title={props.card.name} onClick={() => props.onZoom({ name: props.card.name, image: image?.large || fullCard })}>
        <img className="h-full w-full object-contain" src={fullCard} alt={props.card.name} loading="lazy" />
      </button>
    );
  }

  return (
    <button className={`card-button ${fallbackClass}`} type="button" title={props.card.name}>
      <div className="flex h-full flex-col justify-between p-2 text-left">
        <span className="line-clamp-3 text-xs font-black leading-tight text-black">{props.card.name}</span>
        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-black/70">{props.card.type}</span>
      </div>
    </button>
  );
}

function SidePanel(props: { view: PlaytestSnapshot | null; onApplyAction: (action: PlaytestAction) => void }) {
  const playable = props.view?.legalActions.filter((action) => action.type !== "end") ?? [];
  return (
    <aside className="flex flex-col gap-4">
      <EvaluationPanel evaluation={props.view?.evaluation ?? null} normalSummonUsed={props.view?.state.normalSummonUsed ?? false} />
      <section className="tcg-panel rounded-lg p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-['Cinzel'] text-lg font-bold">Legal Actions</h2>
          <span className="rounded bg-[#d2b166]/12 px-2 py-1 text-xs font-semibold text-[#f4dc9c]">{playable.length}</span>
        </div>
        <div className="flex max-h-56 flex-col gap-2 overflow-y-auto pr-1">
          {playable.length ? playable.map((action) => (
            <button key={`${action.type}-${action.uid}-${action.label}`} className="action-button rounded px-3 py-2 text-left text-sm font-semibold" type="button" onClick={() => props.onApplyAction(action)}>
              {action.label}
            </button>
          )) : (
            <p className="rounded border border-dashed border-white/10 bg-black/25 px-3 py-8 text-center text-sm text-[#c7b98f]/60">No legal actions available.</p>
          )}
        </div>
      </section>
      <LogPanel log={props.view?.state.log ?? []} />
    </aside>
  );
}

function EvaluationPanel(props: { evaluation: PlaytestEvaluation | null; normalSummonUsed: boolean }) {
  const score = props.evaluation?.score ?? 0;
  const quality = props.evaluation?.quality ?? "waiting";
  const circumference = 264;
  const offset = circumference - circumference * Math.min(score / 10, 1);
  return (
    <section className="tcg-panel rounded-lg p-4">
      <div className="flex items-center gap-4">
        <div className="relative size-24">
          <svg viewBox="0 0 96 96" className="-rotate-90">
            <circle cx="48" cy="48" r="42" stroke="rgba(255,255,255,0.12)" strokeWidth="8" fill="none" />
            <circle cx="48" cy="48" r="42" stroke="#d2b166" strokeWidth="8" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} fill="none" />
          </svg>
          <span className="absolute inset-0 grid place-items-center text-2xl font-black text-[#fff7dc]">{score}</span>
        </div>
        <div>
          <span className={`inline-flex rounded px-2 py-1 text-xs font-black uppercase tracking-[0.16em] ${qualityClass(quality)}`}>{quality}</span>
          <p className="mt-2 text-sm text-[#d9cda7]">{props.normalSummonUsed ? "Normal summon used" : "Normal summon ready"}</p>
        </div>
      </div>
      <ul className="mt-4 space-y-2">
        {(props.evaluation?.risks.length ? props.evaluation.risks : ["Start a duel to evaluate this hand."]).map((risk) => (
          <li key={risk} className="rounded border-l-2 border-[#d2b166]/50 bg-black/25 px-3 py-2 text-sm text-[#eadfc2]">{risk}</li>
        ))}
      </ul>
    </section>
  );
}

function LogPanel(props: { log: PlaytestLogEntry[] }) {
  return (
    <section className="tcg-panel rounded-lg p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-['Cinzel'] text-lg font-bold">Playthrough</h2>
        <span className="rounded bg-[#d2b166]/12 px-2 py-1 text-xs font-semibold text-[#f4dc9c]">{props.log.length}</span>
      </div>
      <ol className="max-h-[310px] space-y-2 overflow-y-auto pr-1">
        {props.log.length ? props.log.map((entry) => (
          <li key={`${entry.step}-${entry.action}-${entry.detail}`} className="grid grid-cols-[28px_minmax(0,1fr)] gap-2 rounded bg-black/25 p-2">
            <span className="text-xs font-black text-[#d2b166]">{entry.step}</span>
            <span className="min-w-0">
              <strong className="block truncate text-sm text-[#fff7dc]">{entry.action}{entry.card ? ` · ${entry.card}` : ""}</strong>
              <small className="block text-xs text-[#c7b98f]/78">{entry.detail}</small>
            </span>
          </li>
        )) : (
          <li className="rounded border border-dashed border-white/10 bg-black/25 px-3 py-8 text-center text-sm text-[#c7b98f]/60">Start a duel to see the action log.</li>
        )}
      </ol>
    </section>
  );
}

function CardZoom(props: { card: ZoomCard; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/78 p-4 backdrop-blur-md" onClick={props.onClose}>
      <div className="relative rounded-lg border border-[#d2b166]/35 bg-[#040604] p-4 shadow-2xl shadow-black/70" onClick={(event) => event.stopPropagation()}>
        <button className="absolute -right-3 -top-3 grid size-9 place-items-center rounded-full border border-[#9dbaf5] bg-black text-xl font-bold text-white" type="button" aria-label="Close card preview" onClick={props.onClose}>×</button>
        <img className="max-h-[82vh] w-[min(88vw,430px)] object-contain" src={props.card.image} alt={props.card.name} />
        <p className="mt-3 text-center font-['Cinzel'] text-lg font-bold text-[#fff7dc]">{props.card.name}</p>
      </div>
    </div>
  );
}

function ToastStack(props: { toasts: ToastMessage[] }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
      {props.toasts.map((toast) => (
        <div key={toast.id} className={`rounded border px-4 py-3 shadow-xl shadow-black/40 ${toastClass(toast.tone)}`}>
          <strong className="block text-sm">{toast.title}</strong>
          <small className="block text-xs opacity-85">{toast.message}</small>
        </div>
      ))}
    </div>
  );
}

function readBuilderDeck(): { ydk: string; mainCount: number; extraCount: number } | null {
  const raw = localStorage.getItem(AUTO_DECK_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { deckName?: string; deck?: { main?: Record<string, number>; extra?: Record<string, number>; side?: Record<string, number> } };
    const main = expandZone(parsed.deck?.main);
    const extra = expandZone(parsed.deck?.extra);
    const side = expandZone(parsed.deck?.side);
    if (!main.length && !extra.length) return null;
    return {
      ydk: [
        "#created by Duel Deck Studio",
        `#deck ${parsed.deckName || "Builder Deck"}`,
        "#main",
        ...main,
        "#extra",
        ...extra,
        "!side",
        ...side,
      ].join("\n"),
      mainCount: main.length,
      extraCount: extra.length,
    };
  } catch {
    return null;
  }
}

function expandZone(zone: Record<string, number> | undefined): string[] {
  if (!zone) return [];
  return Object.entries(zone).flatMap(([id, count]) => Array.from({ length: Math.max(0, Number(count) || 0) }, () => id));
}

function cardTone(card: CardSummary): string {
  if (card.type === "spell") return "bg-[#2b8b74]";
  if (card.type === "trap") return "bg-[#9b4677]";
  if (card.type === "extra") return "bg-[#ded6e8]";
  return "bg-[#b98143]";
}

function qualityClass(quality: string): string {
  if (quality === "strong" || quality === "playable") return "bg-emerald-500/18 text-emerald-200";
  if (quality === "thin") return "bg-amber-500/18 text-amber-100";
  if (quality === "weak") return "bg-red-500/18 text-red-100";
  return "bg-white/10 text-white/70";
}

function toastClass(tone: ToastMessage["tone"]): string {
  if (tone === "success") return "border-emerald-300/30 bg-emerald-950/90 text-emerald-50";
  if (tone === "warning") return "border-amber-300/30 bg-amber-950/90 text-amber-50";
  if (tone === "error") return "border-red-300/30 bg-red-950/90 text-red-50";
  return "border-[#d2b166]/30 bg-black/90 text-[#fff7dc]";
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
