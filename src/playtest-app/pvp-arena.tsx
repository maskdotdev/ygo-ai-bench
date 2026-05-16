import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, queryPublicState, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardReader, DuelSession, PlayerId, PublicDuelCard, PublicDuelState } from "#duel/types.js";
import { parseYdk } from "#playtest/ydk.js";
import { getBrowserDuelCardReader } from "./duel-pvp-card-reader.js";
import type { BrowserDuelCardDataCache, BrowserDuelCardDataPreloadResult } from "./duel-pvp-card-reader.js";
import { DuelBattlefield, DuelLogList } from "./duel-battlefield.js";
import { runDuelBattlefieldScript, type DuelBattlefieldActionSelector, type DuelBattlefieldScriptResult } from "./duel-battlefield-script.js";
import { CardZoom, ToastStack, readBuilderDeck, starterYdk } from "./ui.js";
import type { CardImageInfo, ToastMessage } from "./ui.js";

const NO_LEGAL_ACTIONS: DuelAction[] = [];

export const pvpVisibleBattleFixtureYdk = `#created by Duel Deck Studio
#deck Visible Battle Fixture
#main
7084129
#extra
!side`;

export const pvpVisibleBattleFixtureScript: readonly DuelBattlefieldActionSelector[] = [
  { player: 0, type: "normalSummon", labelIncludes: "Magician's Rod" },
  { player: 0, type: "changePhase", phase: "battle", windowKind: "open" },
  { player: 0, type: "declareAttack", labelIncludes: "Direct attack", directAttack: true },
  { player: 1, type: "passAttack", groupLabel: "Attack Response" },
  { player: 0, type: "passAttack", groupLabel: "Attack Response" },
  { player: 1, type: "passDamage", groupLabel: "Damage Step Response" },
  { player: 0, type: "passDamage", groupLabel: "Damage Step Response" },
  { player: 1, type: "passDamage", groupLabel: "Damage Step Response" },
  { player: 0, type: "passDamage", groupLabel: "Damage Step Response" },
  { player: 1, type: "passDamage", groupLabel: "Damage Step Response" },
  { player: 0, type: "passDamage", groupLabel: "Damage Step Response" },
  { player: 1, type: "passDamage", groupLabel: "Damage Step Response" },
  { player: 0, type: "passDamage", groupLabel: "Damage Step Response" },
  { player: 1, type: "passDamage", groupLabel: "Damage Step Response" },
  { player: 0, type: "passDamage", groupLabel: "Damage Step Response" },
];

export interface BootstrapPvpDuelOptions {
  cardReader?: DuelCardReader;
}

export interface BootstrapPvpDuelWithCardDataOptions extends BootstrapPvpDuelOptions {
  cardDataCache: BrowserDuelCardDataCache;
}

export interface BootstrapPvpDuelWithCardDataResult {
  session: DuelSession;
  preload: BrowserDuelCardDataPreloadResult;
}

export function bootstrapPvpDuel(
  p0Text: string,
  p1Text: string,
  seed: string | number,
  handSize: number,
  options: BootstrapPvpDuelOptions = {},
): DuelSession {
  const p0 = parseYdk(p0Text);
  const p1 = parseYdk(p1Text);
  const session = createDuel({
    seed,
    startingHandSize: handSize,
    cardReader: options.cardReader ?? getBrowserDuelCardReader(),
  });
  loadDecks(session, {
    0: { main: p0.main, extra: p0.extra },
    1: { main: p1.main, extra: p1.extra },
  });
  startDuel(session);
  return session;
}

export async function bootstrapPvpDuelWithCardData(
  p0Text: string,
  p1Text: string,
  seed: string | number,
  handSize: number,
  options: BootstrapPvpDuelWithCardDataOptions,
): Promise<BootstrapPvpDuelWithCardDataResult> {
  const p0 = parseYdk(p0Text);
  const p1 = parseYdk(p1Text);
  const preload = await options.cardDataCache.preload([...p0.main, ...p0.extra, ...p1.main, ...p1.extra]);
  const session = bootstrapPvpDuel(p0Text, p1Text, seed, handSize, {
    cardReader: options.cardReader ?? options.cardDataCache.reader,
  });
  return { session, preload };
}

export function runPvpArenaVisibleScript(
  session: DuelSession,
  steps: readonly DuelBattlefieldActionSelector[],
): DuelBattlefieldScriptResult {
  return runDuelBattlefieldScript(session, steps);
}

export function PvpArena() {
  const [session] = useState<DuelSession>(() => bootstrapPvpDuel(starterYdk, starterYdk, Date.now(), 5));
  const [revision, setRevision] = useState(0);
  const publicState = useMemo((): PublicDuelState => queryPublicState(session), [session, revision]);

  const [viewer, setViewer] = useState<PlayerId>(0);
  const [deckP0, setDeckP0] = useState(starterYdk);
  const [deckP1, setDeckP1] = useState(starterYdk);
  const [seedDraft, setSeedDraft] = useState("random");
  const [handSizeDraft, setHandSizeDraft] = useState(5);
  const [menuOpen, setMenuOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [zoomCard, setZoomCard] = useState<{ name: string; image: string } | null>(null);
  const [pileModal, setPileModal] = useState<{ title: string; icon: string; cards: PublicDuelCard[] } | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [imageRevision, setImageRevision] = useState(0);
  const cardImages = useRef(new Map<string, CardImageInfo>());

  const notify = useCallback((title: string, message: string, tone: ToastMessage["tone"] = "default") => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current, { id, title, message, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 3800);
  }, []);

  const visibleCodes = useMemo(() => {
    const codes = new Set<string>();
    for (const card of publicState.cards) codes.add(card.code);
    return [...codes];
  }, [publicState.cards]);

  const hydrateImages = useCallback(async (codes: string[]) => {
    const missing = [...new Set(codes.filter((code) => !cardImages.current.has(code)))];
    if (!missing.length) return;
    try {
      const response = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${missing.join(",")}`);
      if (!response.ok) throw new Error(`YGOPRODeck ${response.status}`);
      const payload = (await response.json()) as {
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
      console.warn(error);
      notify("Card images", error instanceof Error ? error.message : "Fetch failed", "warning");
    }
  }, [notify]);

  useEffect(() => {
    void hydrateImages(visibleCodes);
  }, [hydrateImages, visibleCodes]);

  useEffect(() => {
    if (!zoomCard && !pileModal && !menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setZoomCard(null);
        setPileModal(null);
        setMenuOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomCard, pileModal, menuOpen]);

  const restartDuel = useCallback(() => {
    try {
      const seed = seedDraft.trim().toLowerCase() === "random" || !seedDraft.trim() ? Date.now() : seedDraft;
      const next = bootstrapPvpDuel(deckP0, deckP1, seed, handSizeDraft);
      session.state = next.state;
      session.cardReader = next.cardReader;
      setRevision((current) => current + 1);
      setMenuOpen(false);
      notify("Duel started", "Two-player duel (DuelSession).", "success");
    } catch (error) {
      notify("Could not start", error instanceof Error ? error.message : "Invalid deck", "error");
    }
  }, [deckP0, deckP1, handSizeDraft, notify, seedDraft, session]);

  const runVisibleFixture = useCallback(() => {
    try {
      const next = bootstrapPvpDuel(pvpVisibleBattleFixtureYdk, pvpVisibleBattleFixtureYdk, "pvp-visible-fixture", 1);
      session.state = next.state;
      session.cardReader = next.cardReader;
      const result = runPvpArenaVisibleScript(session, pvpVisibleBattleFixtureScript);
      setViewer(0);
      setRevision((current) => current + 1);
      if (!result.ok) {
        notify("Fixture diverged", result.failure ?? `Step ${result.failedStep ?? "?"}`, "error");
        return;
      }
      notify("Fixture complete", "Visible battle script resolved.", "success");
    } catch (error) {
      notify("Fixture failed", error instanceof Error ? error.message : "Visible script failed.", "error");
    }
  }, [notify, session]);

  const apply = useCallback(
    (action: DuelAction) => {
      const result = applyResponse(session, action);
      setRevision((current) => current + 1);
      if (!result.ok) {
        notify("Action blocked", result.error ?? "Illegal response.", "error");
        return;
      }
      if (result.state.status === "ended") {
        const w = result.state.winner;
        const label = w === "draw" ? "Draw game" : `Player ${(w as PlayerId) + 1} wins`;
        notify("Duel finished", label, "success");
      }
    },
    [notify, session],
  );

  const waiting = publicState.waitingFor;
  const legalActions = useMemo((): readonly DuelAction[] => {
    if (publicState.status !== "awaiting" || waiting === undefined) return NO_LEGAL_ACTIONS;
    return getLegalActions(session, waiting);
  }, [publicState.status, session, waiting, revision]);
  const legalActionGroups = useMemo(() => {
    if (publicState.status !== "awaiting" || waiting === undefined) return [];
    return getGroupedDuelLegalActions(session, waiting);
  }, [publicState.status, session, waiting, revision]);

  const inspectCard = useCallback((card: PublicDuelCard) => {
    const image = cardImages.current.get(card.code);
    const url = image?.large || image?.small;
    if (url) setZoomCard({ name: card.name, image: url });
  }, [imageRevision]);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-slate-950 text-slate-200">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-cyan-500/30 bg-slate-900/90 shadow-[0_0_15px_rgba(34,211,238,0.1)] px-3 py-1.5 backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-2">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#d4af37] to-[#9a7b2c] text-sm font-bold text-[#0a0c08]">⚔</div>
          <div className="min-w-0">
            <p className="font-sans text-[9px] font-bold uppercase tracking-[0.22em] text-cyan-400/80">Duel Deck Studio</p>
            <h1 className="truncate font-sans text-base font-bold leading-tight text-white drop-shadow-[0_0_5px_rgba(34,211,238,0.3)]">Two-player duel</h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className={`rounded-md px-2 py-1 text-[11px] font-semibold ${viewer === 0 ? "bg-cyan-500/20 text-cyan-100 border border-cyan-500/30 shadow-[0_0_8px_rgba(34,211,238,0.2)]" : "bg-slate-800/50 text-slate-400 border border-slate-700/50"}`}
            onClick={() => setViewer(0)}
          >
            Seat P1
          </button>
          <button
            type="button"
            className={`rounded-md px-2 py-1 text-[11px] font-semibold ${viewer === 1 ? "bg-cyan-500/20 text-cyan-100 border border-cyan-500/30 shadow-[0_0_8px_rgba(34,211,238,0.2)]" : "bg-slate-800/50 text-slate-400 border border-slate-700/50"}`}
            onClick={() => setViewer(1)}
          >
            Seat P2
          </button>
          <button
            type="button"
            className={`rounded-md px-2 py-1 text-[11px] font-semibold ${logOpen ? "bg-cyan-500/20 text-cyan-100 border border-cyan-500/30 shadow-[0_0_8px_rgba(34,211,238,0.2)]" : "bg-slate-800/50 text-slate-400 border border-slate-700/50"}`}
            onClick={() => setLogOpen((open) => !open)}
          >
            Log
          </button>
          <button type="button" className="rounded-md bg-black/40 px-2 py-1 text-[11px] font-semibold text-slate-400 hover:bg-cyan-500/15 hover:text-cyan-200" onClick={() => setMenuOpen(true)}>
            Decks
          </button>
          <button type="button" className="rounded-md bg-black/40 px-2 py-1 text-[11px] font-semibold text-slate-400 hover:bg-cyan-500/15 hover:text-cyan-200" onClick={runVisibleFixture}>
            Fixture
          </button>
        </div>
      </header>

      {publicState.status === "ended" ? (
        <div className="shrink-0 border-b border-cyan-500/30 bg-slate-900/80 px-3 py-1.5 text-center font-sans text-sm font-bold text-cyan-50 shadow-[0_4px_12px_rgba(0,0,0,0.5)] backdrop-blur-md">
          {publicState.winner === "draw"
            ? "Match drawn"
            : publicState.winner !== undefined
              ? `Player ${publicState.winner + 1} wins`
              : "Duel ended"}
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <main className="h-full min-h-0 overflow-hidden px-2 pb-2 pt-1 sm:px-3">
          <div className="mx-auto flex h-full max-w-[960px] flex-col overflow-hidden rounded-xl border border-cyan-500/20 bg-slate-900/60 px-2 py-1.5 backdrop-blur-md shadow-[0_0_15px_rgba(0,0,0,0.6)]">
            <p className="shrink-0 truncate text-center text-[10px] leading-tight text-slate-400">
              <span className="font-semibold text-cyan-400">DuelSession</span> · P{waiting !== undefined ? waiting + 1 : "—"}
              {publicState.status !== "awaiting" ? ` · ${publicState.status}` : ""}
            </p>
            <div className="min-h-0 flex-1 overflow-hidden pt-1">
              <DuelBattlefield
                key={imageRevision}
                state={publicState}
                viewer={viewer}
                cardImages={cardImages.current}
                onCardInspect={inspectCard}
                onViewPile={(title, icon, cards) => setPileModal({ title, icon, cards })}
                legalActions={legalActions}
                legalActionGroups={legalActionGroups}
                onPlayAction={apply}
              />
            </div>
          </div>
        </main>

      </div>

      {logOpen ? (
        <aside className="fixed inset-y-0 right-0 z-30 flex w-[min(100vw,400px)] flex-col border-l border-slate-700 bg-slate-950/95 p-4 shadow-2xl backdrop-blur-md">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-sans text-base font-bold text-white tracking-wide">Duel log</h2>
            <button type="button" className="rounded-lg px-2 py-1 text-sm text-cyan-400 hover:bg-slate-800" onClick={() => setLogOpen(false)}>
              Close
            </button>
          </div>
          <DuelLogList entries={publicState.log} />
        </aside>
      ) : null}

      {menuOpen ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/80 backdrop-blur-sm p-4" onClick={() => setMenuOpen(false)}>
          <div className="bg-slate-900 border border-slate-700 shadow-[0_0_30px_rgba(0,0,0,0.8)] text-slate-200 max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <h2 className="font-sans text-xl font-bold text-white tracking-wide">Decks</h2>
            <p className="mt-2 text-sm text-slate-400">
              Player 1 goes first. Built-in card text uses the shipped registry; unknown IDs use minimal stubs. Images load from YGOPRODeck by passcode.
            </p>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Player 1 (.ydk)</span>
                <textarea className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-slate-300 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 h-36 font-mono text-[11px]" spellCheck={false} value={deckP0} onChange={(event) => setDeckP0(event.target.value)} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Player 2 (.ydk)</span>
                <textarea className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-slate-300 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 h-36 font-mono text-[11px]" spellCheck={false} value={deckP1} onChange={(event) => setDeckP1(event.target.value)} />
              </label>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Seed</span>
                <input className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-slate-300 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 rounded-lg px-3 py-2 text-sm" value={seedDraft} placeholder="random" onChange={(event) => setSeedDraft(event.target.value)} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Opening hand</span>
                <input
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-slate-300 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 rounded-lg px-3 py-2 text-sm"
                  type="number"
                  min={1}
                  max={10}
                  value={handSizeDraft}
                  onChange={(event) => setHandSizeDraft(Number(event.target.value))}
                />
              </label>
            </div>

            <button
              type="button"
              className="border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors mt-4 w-full rounded-lg py-2 text-sm font-semibold"
              onClick={() => {
                const loaded = readBuilderDeck();
                if (!loaded) {
                  notify("No deck in storage", "Save a deck from the builder first.", "warning");
                  return;
                }
                setDeckP0(loaded.ydk);
                notify("Loaded", `Player 1 ← builder (${loaded.mainCount}+${loaded.extraCount})`, "success");
              }}
            >
              Load builder → Player 1
            </button>

            <button
              type="button"
              className="border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors mt-3 w-full rounded-lg py-2 text-sm font-semibold"
              onClick={() => {
                const loaded = readBuilderDeck();
                if (!loaded) {
                  notify("No deck in storage", "Save a deck from the builder first.", "warning");
                  return;
                }
                setDeckP1(loaded.ydk);
                notify("Loaded", `Player 2 ← builder (${loaded.mainCount}+${loaded.extraCount})`, "success");
              }}
            >
              Load builder → Player 2
            </button>

            <button type="button" className="bg-cyan-600 text-white hover:bg-cyan-500 shadow-[0_0_15px_rgba(34,211,238,0.4)] transition-all mt-5 w-full rounded-xl py-3 text-base font-bold" onClick={restartDuel}>
              Restart duel with these decks
            </button>
          </div>
        </div>
      ) : null}

      {pileModal ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/80 backdrop-blur-sm p-4" onClick={() => setPileModal(null)}>
          <div className="bg-slate-900 border border-slate-700 shadow-[0_0_30px_rgba(0,0,0,0.8)] text-slate-200 relative max-h-[85vh] w-full max-w-[900px] overflow-y-auto rounded-xl p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between border-b border-slate-700 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{pileModal.icon}</span>
                <h2 className="font-sans text-xl font-bold text-white tracking-wide">{pileModal.title}</h2>
              </div>
              <button type="button" className="text-2xl text-cyan-400" onClick={() => setPileModal(null)}>
                ×
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 md:grid-cols-6">
              {pileModal.cards.map((card, index) => {
                const image = cardImages.current.get(card.code);
                const url = image?.large || image?.small;
                const cardTypeClass =
                  card.kind === "spell" ? "spell-card" : card.kind === "trap" ? "trap-card" : card.kind === "extra" ? "extra-card" : "";
                return (
                  <button
                    key={`${card.uid}-${index}`}
                    type="button"
                    className={`rounded-lg p-1 text-left transition-colors hover:bg-slate-800 ${cardTypeClass}`}
                    onClick={() => url && setZoomCard({ name: card.name, image: url })}
                  >
                    <div className="aspect-[59/86] w-full overflow-hidden rounded border border-slate-700 bg-slate-950">
                      {url ? (
                        <img className="h-full w-full object-contain" src={url} alt={card.name} loading="lazy" />
                      ) : (
                        <div className="flex h-full items-center justify-center p-1 text-center text-[9px] font-bold text-cyan-400/70">{card.name}</div>
                      )}
                    </div>
                    <span className="line-clamp-2 text-[10px] text-slate-300">{card.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      <ToastStack toasts={toasts} />
      {zoomCard ? <CardZoom card={zoomCard} onClose={() => setZoomCard(null)} /> : null}
    </div>
  );
}
