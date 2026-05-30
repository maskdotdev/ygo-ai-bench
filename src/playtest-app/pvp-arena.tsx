import "../browser-node-shims/process-global.js";
import cardBackUrl from "../../assets/card-back.webp";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, queryPublicState, startDuel } from "#duel/core.js";
import type { ApplyDuelResponseResult, DuelAction, DuelCardReader, DuelLocation, DuelSession, PlayerId, PublicDuelCard, PublicDuelState } from "#duel/types.js";
import type { LuaInitialEffectRegistrationResult, LuaScriptHost, LuaScriptLoadResult } from "#lua/host.js";
import { parseYdk } from "#playtest/ydk.js";
import { createBrowserCdbCardDataLoader, createBrowserCdbJsonManifestLoader, createBrowserCdbJsonRowsLoader, createBrowserDuelCardDataCache, getBrowserDuelCardReader } from "./duel-pvp-card-reader.js";
import type { BrowserCdbRowsManifest, BrowserDuelCardDataCache, BrowserDuelCardDataPreloadResult } from "./duel-pvp-card-reader.js";
import { createBrowserLuaScriptCache, createBrowserLuaScriptFetchLoader, createBrowserLuaScriptManifestLoader } from "./duel-pvp-script-cache.js";
import type { BrowserLuaScriptCache, BrowserLuaScriptManifest, BrowserLuaScriptPreloadResult } from "./duel-pvp-script-cache.js";
import { DuelBattlefield, DuelLogList, isDuelCardVisibleToPlayer } from "./duel-battlefield.js";
import type { DuelPileView } from "./duel-battlefield.js";
import { cleanedDuelActionLabel } from "./duel-action-presenter.js";
import { runDuelBattlefieldScript, runDuelBattlefieldScriptStep, type DuelBattlefieldActionSelector, type DuelBattlefieldScriptResult, type DuelBattlefieldScriptStepResult } from "./duel-battlefield-script.js";
import { duelActionAnchorUids } from "./duel-action-anchors.js";
import { applyPvpAction } from "./pvp-apply-action.js";
import { applyPvpAgentAction, observePvpAgent } from "./pvp-agent-api.js";
import { CardZoom, ToastStack, readBuilderDeck, starterYdk } from "./ui.js";
import type { CardImageInfo, ToastMessage } from "./ui.js";
import { hydrateCardImagesByPasscode } from "./card-images.js";

const NO_LEGAL_ACTIONS: DuelAction[] = [];

export { applyPvpAction };

declare global {
  interface Window {
    __YGO_PVP_AGENT__?: {
      observe(player: PlayerId): unknown;
      act(player: PlayerId, actionId: string, params?: unknown): unknown;
      state(): PublicDuelState;
    };
  }
}

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

export interface BootstrapPvpDuelWithLuaScriptsOptions extends BootstrapPvpDuelOptions {
  luaScriptCache: BrowserLuaScriptCache;
}

export interface BootstrapPvpDuelWithLuaScriptsResult {
  session: DuelSession;
  luaHost: LuaScriptHost;
  scriptPreload: BrowserLuaScriptPreloadResult;
  scriptLoads: LuaScriptLoadResult[];
  scriptRegistrations: LuaInitialEffectRegistrationResult[];
  startupEffectCount: number;
}

export interface BootstrapPvpDuelWithBrowserDataOptions extends BootstrapPvpDuelOptions {
  cardDataCache: BrowserDuelCardDataCache;
  luaScriptCache: BrowserLuaScriptCache;
}

export interface BootstrapPvpDuelWithBrowserDataResult extends BootstrapPvpDuelWithLuaScriptsResult {
  cardPreload: BrowserDuelCardDataPreloadResult;
}

export interface BootstrapPvpDuelWithBrowserAssetsResult extends BootstrapPvpDuelWithBrowserDataResult {
  cardDataManifest: BrowserCdbRowsManifest;
  luaScriptManifest: BrowserLuaScriptManifest;
}

export interface BrowserPvpBootSummary {
  detail: string;
  message: string;
  tone: "success" | "warning";
  missingCards: string[];
  missingScripts: string[];
  registrationFailures: { code: string; uid: string; error?: string }[];
}

export interface BrowserPvpAssetCacheOptions {
  cardRowsEndpoint?: string;
  cardRowsManifestEndpoint?: string;
  scriptBaseUrl?: string;
  scriptManifestUrl?: string;
}

export interface BrowserPvpAssetCaches {
  cardDataCache: BrowserDuelCardDataCache;
  luaScriptCache: BrowserLuaScriptCache;
  loadCardDataManifest(): Promise<BrowserCdbRowsManifest>;
  loadLuaScriptManifest(): Promise<BrowserLuaScriptManifest>;
}

export function createBrowserPvpAssetCaches(options: BrowserPvpAssetCacheOptions = {}): BrowserPvpAssetCaches {
  const cardRowsEndpoint = options.cardRowsEndpoint ?? "./card-data/cdb-rows.json";
  const scriptBaseUrl = options.scriptBaseUrl ?? "./card-scripts";
  const cardRowsLoader = createBrowserCdbJsonRowsLoader({ endpoint: cardRowsEndpoint });
  return {
    cardDataCache: createBrowserDuelCardDataCache(createBrowserCdbCardDataLoader(cardRowsLoader)),
    luaScriptCache: createBrowserLuaScriptCache(createBrowserLuaScriptFetchLoader({ baseUrl: scriptBaseUrl })),
    loadCardDataManifest: createBrowserCdbJsonManifestLoader({
      endpoint: cardRowsEndpoint,
      ...(options.cardRowsManifestEndpoint === undefined ? {} : { manifestEndpoint: options.cardRowsManifestEndpoint }),
    }),
    loadLuaScriptManifest: createBrowserLuaScriptManifestLoader({
      baseUrl: scriptBaseUrl,
      ...(options.scriptManifestUrl === undefined ? {} : { manifestUrl: options.scriptManifestUrl }),
    }),
  };
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

export async function bootstrapPvpDuelWithLuaScripts(
  p0Text: string,
  p1Text: string,
  seed: string | number,
  handSize: number,
  options: BootstrapPvpDuelWithLuaScriptsOptions,
): Promise<BootstrapPvpDuelWithLuaScriptsResult> {
  const codes = pvpDeckCodes(p0Text, p1Text);
  const scriptPreload = await options.luaScriptCache.preloadCardScripts(pvpScriptCodes(codes, options.cardReader));
  const session = bootstrapPvpDuel(p0Text, p1Text, seed, handSize, options);
  const { createLuaScriptHost } = await import("#lua/host.js");
  const luaHost = createLuaScriptHost(session, options.luaScriptCache);
  const scriptLoads = codes.map((code) => luaHost.loadCardScript(code, options.luaScriptCache));
  const scriptRegistrations = luaHost.registerInitialEffectsDetailed();
  const startupEffectCount = luaHost.runStartupEffects();
  return { session, luaHost, scriptPreload, scriptLoads, scriptRegistrations, startupEffectCount };
}

export async function bootstrapPvpDuelWithBrowserData(
  p0Text: string,
  p1Text: string,
  seed: string | number,
  handSize: number,
  options: BootstrapPvpDuelWithBrowserDataOptions,
): Promise<BootstrapPvpDuelWithBrowserDataResult> {
  const codes = pvpDeckCodes(p0Text, p1Text);
  const cardPreload = await options.cardDataCache.preload(codes);
  const cardReader = options.cardReader ?? options.cardDataCache.reader;
  const scriptPreload = await options.luaScriptCache.preloadCardScripts(pvpScriptCodes(codes, cardReader));
  const session = bootstrapPvpDuel(p0Text, p1Text, seed, handSize, {
    cardReader,
  });
  const { createLuaScriptHost } = await import("#lua/host.js");
  const luaHost = createLuaScriptHost(session, options.luaScriptCache);
  const scriptLoads = codes.map((code) => luaHost.loadCardScript(code, options.luaScriptCache));
  const scriptRegistrations = luaHost.registerInitialEffectsDetailed();
  const startupEffectCount = luaHost.runStartupEffects();
  return { session, luaHost, cardPreload, scriptPreload, scriptLoads, scriptRegistrations, startupEffectCount };
}

export async function bootstrapPvpDuelWithBrowserAssets(
  p0Text: string,
  p1Text: string,
  seed: string | number,
  handSize: number,
  options: BrowserPvpAssetCaches,
): Promise<BootstrapPvpDuelWithBrowserAssetsResult> {
  const [cardDataManifest, luaScriptManifest] = await Promise.all([
    options.loadCardDataManifest(),
    options.loadLuaScriptManifest(),
  ]);
  const boot = await bootstrapPvpDuelWithBrowserData(p0Text, p1Text, seed, handSize, options);
  return { ...boot, cardDataManifest, luaScriptManifest };
}

export function summarizeBrowserPvpBoot(boot: BootstrapPvpDuelWithBrowserAssetsResult): BrowserPvpBootSummary {
  const missingCards = [...boot.cardPreload.missing];
  const missingScripts = [...boot.scriptPreload.missing];
  const registrationFailures = boot.scriptRegistrations
    .filter((registration) => !registration.ok && !registration.skipped)
    .map((registration) => ({
      code: registration.code,
      uid: registration.uid,
      ...(registration.error === undefined ? {} : { error: registration.error }),
    }));
  const degraded = missingCards.length > 0 || missingScripts.length > 0 || registrationFailures.length > 0;
  const detail = [
    `Browser data loaded (${boot.cardPreload.loaded.length} cards, ${boot.scriptPreload.loaded.length} scripts`,
    `missing ${missingCards.length}/${missingScripts.length}`,
    `registration failures ${registrationFailures.length}`,
    `manifests ${boot.cardDataManifest.datasRows}/${boot.luaScriptManifest.copiedCount}).`,
  ].join("; ");
  const diagnostics = browserPvpBootDiagnostics(missingCards, missingScripts, registrationFailures);
  return {
    detail,
    message: diagnostics.length ? `${detail} ${diagnostics.join(" ")}` : detail,
    tone: degraded ? "warning" : "success",
    missingCards,
    missingScripts,
    registrationFailures,
  };
}

function browserPvpBootDiagnostics(
  missingCards: readonly string[],
  missingScripts: readonly string[],
  registrationFailures: readonly { code: string; uid: string; error?: string }[],
): string[] {
  const diagnostics: string[] = [];
  if (missingCards.length) diagnostics.push(`Missing cards: ${missingCards.slice(0, 5).join(", ")}${missingCards.length > 5 ? ", ..." : ""}.`);
  if (missingScripts.length) diagnostics.push(`Missing scripts: ${missingScripts.slice(0, 5).join(", ")}${missingScripts.length > 5 ? ", ..." : ""}.`);
  if (registrationFailures.length) {
    diagnostics.push(`Registration failures: ${registrationFailures.slice(0, 3).map((failure) => (
      `${failure.code}${failure.error ? ` (${failure.error.split("\n")[0]})` : ""}`
    )).join(", ")}${registrationFailures.length > 3 ? ", ..." : ""}.`);
  }
  return diagnostics;
}

function revealedCardDetail(session: DuelSession, previousEventCount: number): string | undefined {
  const confirmed = session.state.eventHistory
    .slice(previousEventCount)
    .filter((event) => event.eventName === "confirmed" && event.eventUids !== undefined)
    .at(-1);
  if (!confirmed?.eventUids?.length) return undefined;
  const names = confirmed.eventUids
    .map((uid) => session.state.cards.find((card) => card.uid === uid)?.name)
    .filter((name): name is string => Boolean(name));
  if (!names.length) return undefined;
  return `Revealed ${names.join(", ")}. If no prompt appears, there was no eligible card to add and the deck top was reordered.`;
}

function pvpDeckCodes(p0Text: string, p1Text: string): string[] {
  const p0 = parseYdk(p0Text);
  const p1 = parseYdk(p1Text);
  return [...new Set([...p0.main, ...p0.extra, ...p1.main, ...p1.extra].map(String).filter(Boolean))].sort();
}

function pvpScriptCodes(codes: readonly string[], cardReader: DuelCardReader | undefined): string[] {
  const scriptCodes = new Set(codes.map(String).filter(Boolean));
  if (cardReader) {
    for (const code of codes) {
      const alias = cardReader(String(code))?.alias;
      if (alias && alias !== String(code)) scriptCodes.add(String(alias));
    }
  }
  return [...scriptCodes].sort();
}

export function runPvpArenaVisibleScript(
  session: DuelSession,
  steps: readonly DuelBattlefieldActionSelector[],
): DuelBattlefieldScriptResult {
  return runDuelBattlefieldScript(session, steps);
}

export function runPvpArenaVisibleScriptStep(
  session: DuelSession,
  steps: readonly DuelBattlefieldActionSelector[],
  step: number,
): DuelBattlefieldScriptStepResult {
  return runDuelBattlefieldScriptStep(session, steps, step);
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
  const [zoomCard, setZoomCard] = useState<{ uid?: string; name: string; image: string } | null>(null);
  const [pileModal, setPileModal] = useState<DuelPileView | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [imageRevision, setImageRevision] = useState(0);
  const [visibleFixtureRun, setVisibleFixtureRun] = useState<{ nextStep: number; running: boolean } | null>(null);
  const cardImages = useRef(new Map<string, CardImageInfo>());
  const browserAssetCaches = useRef<BrowserPvpAssetCaches | undefined>(undefined);
  const visibleFixtureTimer = useRef<number | undefined>(undefined);
  const initialBrowserBootStarted = useRef(false);

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
    const result = await hydrateCardImagesByPasscode(missing, cardImages.current);
    if (result.loaded.length > 0) {
      setImageRevision((current) => current + 1);
    }
    if (result.failed.length > 0) {
      console.warn("Could not hydrate some card images", result.failed);
      notify("Card images", `${result.failed.length} card scan${result.failed.length === 1 ? "" : "s"} could not be fetched.`, "warning");
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

  useEffect(() => {
    return () => {
      if (visibleFixtureTimer.current !== undefined) window.clearTimeout(visibleFixtureTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!visibleFixtureRun?.running) return;
    if (visibleFixtureTimer.current !== undefined) return;
    visibleFixtureTimer.current = window.setTimeout(() => {
      visibleFixtureTimer.current = undefined;
      const result = runDuelBattlefieldScriptStep(session, pvpVisibleBattleFixtureScript, visibleFixtureRun.nextStep);
      setRevision((current) => current + 1);
      if (!result.ok) {
        setVisibleFixtureRun(null);
        notify("Fixture diverged", result.failure ?? `Step ${result.failedStep ?? "?"}`, "error");
        return;
      }
      if (result.done) {
        setVisibleFixtureRun(null);
        notify("Fixture complete", "Visible battle script resolved.", "success");
        return;
      }
      setVisibleFixtureRun({ nextStep: result.nextStep, running: true });
    }, 220);
  }, [notify, session, visibleFixtureRun]);

  const restartDuel = useCallback(async () => {
    try {
      const seed = seedDraft.trim().toLowerCase() === "random" || !seedDraft.trim() ? Date.now() : seedDraft;
      let next: DuelSession;
      let detail = "Two-player duel (DuelSession).";
      let startTone: ToastMessage["tone"] = "success";
      try {
        browserAssetCaches.current ??= createBrowserPvpAssetCaches();
        const boot = await bootstrapPvpDuelWithBrowserAssets(deckP0, deckP1, seed, handSizeDraft, browserAssetCaches.current);
        next = boot.session;
        const summary = summarizeBrowserPvpBoot(boot);
        detail = summary.message;
        startTone = summary.tone;
      } catch (error) {
        console.warn("Browser PvP data unavailable", error);
        next = bootstrapPvpDuel(deckP0, deckP1, seed, handSizeDraft);
        startTone = "warning";
        notify("Browser data unavailable", error instanceof Error ? error.message : "Using bundled fallback data.", "warning");
      }
      session.state = next.state;
      session.cardReader = next.cardReader;
      setRevision((current) => current + 1);
      setMenuOpen(false);
      notify(startTone === "warning" ? "Duel started with degraded data" : "Duel started", detail, startTone);
    } catch (error) {
      notify("Could not start", error instanceof Error ? error.message : "Invalid deck", "error");
    }
  }, [deckP0, deckP1, handSizeDraft, notify, seedDraft, session]);

  useEffect(() => {
    if (initialBrowserBootStarted.current) return;
    initialBrowserBootStarted.current = true;
    void restartDuel();
  }, [restartDuel]);

  const agentBridge = useMemo(() => ({
      observe(player: PlayerId) {
        return observePvpAgent(session, player);
      },
      act(player: PlayerId, actionId: string, params?: unknown) {
        const result = applyPvpAgentAction(session, player, actionId, isAgentActionParams(params) ? params : {});
        setRevision((current) => current + 1);
        return result;
      },
      state() {
        return queryPublicState(session);
      },
    }), [session]);

  useEffect(() => {
    window.__YGO_PVP_AGENT__ = agentBridge;
    document.documentElement.dataset.ygoPvpAgent = "ready";
    const onAgentRequest = (event: Event) => {
      const request = (event as CustomEvent).detail;
      const result = handleAgentBridgeRequest(agentBridge, request);
      document.dispatchEvent(new CustomEvent("ygo-pvp-agent-response", { detail: { id: requestId(request), result } }));
    };
    document.addEventListener("ygo-pvp-agent-request", onAgentRequest);
    return () => {
      if (window.__YGO_PVP_AGENT__ === agentBridge) delete window.__YGO_PVP_AGENT__;
      document.removeEventListener("ygo-pvp-agent-request", onAgentRequest);
      if (document.documentElement.dataset.ygoPvpAgent === "ready") delete document.documentElement.dataset.ygoPvpAgent;
    };
  }, [agentBridge]);

  window.__YGO_PVP_AGENT__ = agentBridge;
  document.documentElement.dataset.ygoPvpAgent = "ready";

  const runVisibleFixture = useCallback(() => {
    try {
      if (visibleFixtureTimer.current !== undefined) {
        window.clearTimeout(visibleFixtureTimer.current);
        visibleFixtureTimer.current = undefined;
      }
      const next = bootstrapPvpDuel(pvpVisibleBattleFixtureYdk, pvpVisibleBattleFixtureYdk, "pvp-visible-fixture", 1);
      session.state = next.state;
      session.cardReader = next.cardReader;
      setViewer(0);
      setRevision((current) => current + 1);
      setVisibleFixtureRun({ nextStep: 0, running: true });
      notify("Fixture started", `${pvpVisibleBattleFixtureScript.length} visible actions queued.`, "success");
    } catch (error) {
      setVisibleFixtureRun(null);
      notify("Fixture failed", error instanceof Error ? error.message : "Visible script failed.", "error");
    }
  }, [notify, session]);

  const apply = useCallback(
    (action: DuelAction) => {
      const previousEventCount = session.state.eventHistory.length;
      const result = applyPvpAction(session, action);
      setRevision((current) => current + 1);
      if (!result.ok) {
        notify("Action blocked", result.error ?? "Illegal response.", "error");
        return;
      }
      if (result.state.status === "ended") {
        const w = result.state.winner;
        const label = w === "draw" ? "Draw game" : `Player ${(w as PlayerId) + 1} wins`;
        notify("Duel finished", label, "success");
        return;
      }
      if (action.type === "activateEffect") {
        const actionLabel = cleanedDuelActionLabel(action);
        const revealDetail = revealedCardDetail(session, previousEventCount);
        const detail = result.state.chain.length > 0
          ? `Chain Link ${result.state.chain.length} is pending. Player ${(result.state.waitingFor ?? action.player) + 1} must respond or pass.`
          : result.state.prompt
            ? `Player ${result.state.prompt.player + 1} must answer the prompt.`
            : revealDetail ?? "The effect was applied.";
        notify("Effect activated", `${actionLabel}. ${detail}`, "success");
      } else if (action.type === "passChain" && result.state.prompt) {
        notify("Chain resolved", `Player ${result.state.prompt.player + 1} must answer the prompt.`, "success");
      } else if (action.type === "passChain") {
        const revealDetail = revealedCardDetail(session, previousEventCount);
        if (revealDetail) notify("Chain resolved", revealDetail, "success");
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
    if (!isDuelCardVisibleToPlayer(card, viewer)) {
      notify("Hidden card", hiddenCardReason(card, viewer), "warning");
      return;
    }
    const image = cardImages.current.get(card.code);
    const url = image?.large || image?.small;
    if (url) {
      setZoomCard({ uid: card.uid, name: card.name, image: url });
      return;
    }
    notify("Card image unavailable", `${card.name} is visible, but its scan has not loaded.`, "warning");
  }, [imageRevision, notify, viewer]);

  const zoomActions = useMemo(() => {
    if (!zoomCard) return [];
    const showCurrentDecision = publicState.chain.length > 0 || publicState.prompt !== undefined || publicState.triggerOrderPrompt !== undefined;
    return legalActions.filter((action) => {
      const anchors = duelActionAnchorUids(action);
      if (zoomCard.uid !== undefined && anchors.includes(zoomCard.uid)) return true;
      return showCurrentDecision && anchors.length === 0;
    });
  }, [legalActions, publicState.chain.length, publicState.prompt, publicState.triggerOrderPrompt, zoomCard]);

  const zoomActionTitle = useMemo(() => {
    if (publicState.prompt) return `Player ${publicState.prompt.player + 1} prompt`;
    if (publicState.chain.length > 0 && waiting !== undefined) return `Player ${waiting + 1} chain response`;
    if (publicState.triggerOrderPrompt) return `Player ${publicState.triggerOrderPrompt.player + 1} trigger order`;
    return "Available actions";
  }, [publicState.chain.length, publicState.prompt, publicState.triggerOrderPrompt, waiting]);

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-[#050403] text-[#f3ead2]">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[#d4af37]/25 bg-black/80 px-3 py-1.5 shadow-[0_10px_24px_rgba(0,0,0,0.42)] backdrop-blur-md">
        <div className="flex min-w-0 items-center gap-2">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#d4af37] to-[#9a7b2c] text-sm font-bold text-[#0a0c08]">⚔</div>
          <div className="min-w-0">
            <p className="font-sans text-[9px] font-bold uppercase tracking-[0.22em] text-[#d4af37]/80">Duel Deck Studio</p>
            <h1 className="truncate font-sans text-base font-bold leading-tight text-[#fff7dc] drop-shadow-[0_0_8px_rgba(212,175,55,0.24)]">Two-player duel</h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className={`rounded-md px-2 py-1 text-[11px] font-semibold ${viewer === 0 ? "border border-[#d4af37]/40 bg-[#d4af37]/18 text-[#fff7dc] shadow-[0_0_8px_rgba(212,175,55,0.18)]" : "border border-[#d4af37]/14 bg-black/40 text-[#c7b98f]/70"}`}
            onClick={() => setViewer(0)}
          >
            Seat P1
          </button>
          <button
            type="button"
            className={`rounded-md px-2 py-1 text-[11px] font-semibold ${viewer === 1 ? "border border-[#d4af37]/40 bg-[#d4af37]/18 text-[#fff7dc] shadow-[0_0_8px_rgba(212,175,55,0.18)]" : "border border-[#d4af37]/14 bg-black/40 text-[#c7b98f]/70"}`}
            onClick={() => setViewer(1)}
          >
            Seat P2
          </button>
          <button
            type="button"
            className={`rounded-md px-2 py-1 text-[11px] font-semibold ${logOpen ? "border border-[#d4af37]/40 bg-[#d4af37]/18 text-[#fff7dc] shadow-[0_0_8px_rgba(212,175,55,0.18)]" : "border border-[#d4af37]/14 bg-black/40 text-[#c7b98f]/70"}`}
            onClick={() => setLogOpen((open) => !open)}
          >
            Log
          </button>
          <button type="button" className="rounded-md border border-[#d4af37]/14 bg-black/40 px-2 py-1 text-[11px] font-semibold text-[#c7b98f]/70 hover:bg-[#d4af37]/12 hover:text-[#fff7dc]" onClick={() => setMenuOpen(true)}>
            Decks
          </button>
          <button type="button" className="rounded-md border border-[#d4af37]/14 bg-black/40 px-2 py-1 text-[11px] font-semibold text-[#c7b98f]/70 hover:bg-[#d4af37]/12 hover:text-[#fff7dc]" onClick={runVisibleFixture}>
            {visibleFixtureRun?.running ? `Fixture ${Math.min(visibleFixtureRun.nextStep + 1, pvpVisibleBattleFixtureScript.length)}/${pvpVisibleBattleFixtureScript.length}` : "Fixture"}
          </button>
        </div>
      </header>

      {publicState.status === "ended" ? (
        <div className="shrink-0 border-b border-[#d4af37]/25 bg-black/75 px-3 py-1.5 text-center font-sans text-sm font-bold text-[#fff7dc] shadow-[0_4px_12px_rgba(0,0,0,0.5)] backdrop-blur-md">
          {publicState.winner === "draw"
            ? "Match drawn"
            : publicState.winner !== undefined
              ? `Player ${publicState.winner + 1} wins`
              : "Duel ended"}
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <main className="h-full min-h-0 overflow-hidden px-2 pb-2 pt-1 sm:px-3">
          <div className="mx-auto flex h-full max-w-[1120px] flex-col overflow-hidden rounded-lg border border-[#d4af37]/18 bg-black/35 px-1.5 py-1.5 shadow-[0_0_24px_rgba(0,0,0,0.58)] backdrop-blur-md">
            <p className="shrink-0 truncate text-center text-[10px] leading-tight text-[#c7b98f]/68">
              <span className="font-semibold text-[#d4af37]/85">DuelSession</span> | P{waiting !== undefined ? waiting + 1 : "-"}
              {publicState.status !== "awaiting" ? ` · ${publicState.status}` : ""}
            </p>
            <div className="min-h-0 flex-1 overflow-hidden pt-1">
              <DuelBattlefield
                state={publicState}
                viewer={viewer}
                cardImages={cardImages.current}
                onCardInspect={inspectCard}
                onViewPile={setPileModal}
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
        <PileInspector
          pile={pileModal}
          viewer={viewer}
          cardImages={cardImages.current}
          onInspectCard={inspectCard}
          onClose={() => setPileModal(null)}
        />
      ) : null}

      <ToastStack toasts={toasts} />
      {zoomCard ? (
        <CardZoom
          card={zoomCard}
          actions={zoomActions}
          actionTitle={zoomActionTitle}
          onAction={(action) => {
            apply(action);
            setZoomCard(null);
          }}
          onClose={() => setZoomCard(null)}
        />
      ) : null}
    </div>
  );
}

function PileInspector(props: {
  pile: DuelPileView;
  viewer: PlayerId;
  cardImages: Map<string, CardImageInfo>;
  onInspectCard: (card: PublicDuelCard) => void;
  onClose: () => void;
}) {
  const orderedCards = orderedPileCards(props.pile, props.viewer);
  const visibleCount = orderedCards.filter((card) => pileCardIdentityVisible(card, props.pile, props.viewer)).length;
  const hiddenCount = orderedCards.length - visibleCount;
  const orderHidden = pileOrderIsHidden(props.pile, props.viewer);

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-slate-950/85 p-4 backdrop-blur-sm" onClick={props.onClose}>
      <div
        className="duel-pile-modal relative flex max-h-[88vh] w-full max-w-[1040px] flex-col overflow-hidden rounded-xl p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-[#d4af37]/20 pb-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-[#d4af37]/30 bg-[#d4af37]/12 text-sm font-black text-[#fff2b7]">
              {props.pile.icon}
            </span>
            <div className="min-w-0">
              <h2 className="truncate font-sans text-xl font-black tracking-wide text-[#fff7dc]">{props.pile.title}</h2>
              <p className="mt-1 text-xs font-semibold leading-snug text-[#c7b98f]/76">{pileRuleNote(props.pile, props.viewer)}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-[0.1em]">
                <span className="duel-pile-badge">{orderedCards.length} cards</span>
                <span className="duel-pile-badge">{visibleCount} visible</span>
                {hiddenCount > 0 ? <span className="duel-pile-badge duel-pile-badge--hidden">{hiddenCount} hidden</span> : null}
                {orderHidden ? <span className="duel-pile-badge duel-pile-badge--order">Order hidden</span> : null}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="grid size-10 shrink-0 place-items-center rounded-full border border-[#d4af37]/35 bg-black/55 text-2xl font-bold text-[#fff7dc] hover:bg-[#d4af37]/15"
            aria-label="Close pile viewer"
            onClick={props.onClose}
          >
            x
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {orderedCards.length === 0 ? (
            <div className="empty-state rounded-lg px-4 py-10 text-center text-sm">No cards in this zone.</div>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8">
              {orderedCards.map((card, index) => {
                const visible = pileCardIdentityVisible(card, props.pile, props.viewer);
                const image = props.cardImages.get(card.code);
                const url = visible ? image?.large || image?.small : undefined;
                const cardTypeClass =
                  visible && card.kind === "spell" ? "spell-card" : visible && card.kind === "trap" ? "trap-card" : visible && card.kind === "extra" ? "extra-card" : "";
                return (
                  <button
                    key={`${card.uid}-${index}`}
                    type="button"
                    disabled={!visible}
                    className={`duel-pile-card-button ${cardTypeClass}`}
                    onClick={() => visible && props.onInspectCard(card)}
                  >
                    <div className="aspect-[59/86] w-full overflow-hidden rounded border border-[#d4af37]/18 bg-slate-950">
                      {url ? (
                        <img className="h-full w-full object-contain" src={url} alt={card.name} loading="lazy" />
                      ) : visible ? (
                        <div className="flex h-full items-center justify-center p-1 text-center text-[9px] font-bold text-[#fff2b7]/80">{card.name}</div>
                      ) : (
                        <img className="h-full w-full object-contain opacity-90" src={cardBackUrl} alt="" loading="lazy" />
                      )}
                    </div>
                    <span className="mt-1 block min-h-[2.1em] text-[10px] font-bold leading-tight text-[#f7ead0]">
                      {visible ? card.name : "Hidden card"}
                    </span>
                    <small className="mt-0.5 block truncate text-[9px] font-semibold uppercase tracking-[0.08em] text-[#c7b98f]/58">
                      {pileCardMeta(card, props.pile, props.viewer, index)}
                    </small>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function pileCardIdentityVisible(card: PublicDuelCard, pile: DuelPileView, viewer: PlayerId): boolean {
  if (pile.location === "deck" && pile.player === viewer) return true;
  if (pile.location === "extraDeck" && pile.player === viewer) return true;
  return isDuelCardVisibleToPlayer(card, viewer);
}

function pileOrderIsHidden(pile: DuelPileView, viewer: PlayerId): boolean {
  return pile.location === "deck" || (pile.location === "extraDeck" && pile.player !== viewer);
}

function orderedPileCards(pile: DuelPileView, viewer: PlayerId): PublicDuelCard[] {
  if (pile.location === "deck" && pile.player === viewer) {
    return [...pile.cards].sort((left, right) => left.name.localeCompare(right.name) || left.code.localeCompare(right.code));
  }
  return [...pile.cards].sort((left, right) => left.sequence - right.sequence);
}

function pileRuleNote(pile: DuelPileView, viewer: PlayerId): string {
  const owner = pile.player === viewer ? "your" : "opponent's";
  switch (pile.location) {
    case "deck":
      return pile.player === viewer
        ? "Your remaining Deck identities are shown alphabetically for planning; current Deck order stays hidden."
        : "The opponent's Deck identities and order are hidden. Only the card count is public.";
    case "extraDeck":
      return pile.player === viewer
        ? "You may inspect your own Extra Deck. Face-up Extra Deck cards are public information."
        : "The opponent's face-down Extra Deck cards are hidden; face-up Extra Deck cards are public.";
    case "graveyard":
      return `Cards in ${owner} Graveyard are public information.`;
    case "banished":
      return `Face-up banished cards are public. Face-down banished cards stay hidden.`;
    case "hand":
      return pile.player === viewer ? "Your hand is private to you." : "The opponent's hand is hidden unless an effect reveals cards.";
    default:
      return "This zone follows normal card visibility rules.";
  }
}

function pileCardMeta(card: PublicDuelCard, pile: DuelPileView, viewer: PlayerId, index: number): string {
  if (pile.location === "deck") return pile.player === viewer ? "remaining deck" : `hidden #${index + 1}`;
  if (pile.location === "hand") return pile.player === viewer || isDuelCardVisibleToPlayer(card, viewer) ? "in hand" : `hidden #${index + 1}`;
  if (pile.location === "extraDeck" && pile.player !== viewer && !isDuelCardVisibleToPlayer(card, viewer)) return `hidden #${index + 1}`;
  return `${locationDisplayName(card.location)} ${card.sequence + 1}${card.faceUp ? " face-up" : " face-down"}`;
}

function locationDisplayName(location: DuelLocation): string {
  switch (location) {
    case "monsterZone":
      return "monster zone";
    case "spellTrapZone":
      return "spell/trap";
    case "fieldZone":
      return "field";
    case "extraDeck":
      return "extra";
    default:
      return location;
  }
}

function hiddenCardReason(card: PublicDuelCard, viewer: PlayerId): string {
  if (card.location === "deck") return card.controller === viewer ? "Deck order is hidden unless an effect reveals or searches it." : "The opponent's Deck is hidden by rule.";
  if (card.location === "hand") return "The opponent's hand is hidden unless an effect reveals it.";
  if (card.location === "extraDeck") return "The opponent's face-down Extra Deck cards are hidden.";
  if (card.location === "banished" && !card.faceUp) return "Face-down banished cards are hidden.";
  return "That face-down card is hidden information.";
}

function isAgentActionParams(value: unknown): value is { summonSequence?: number; spellTrapSequence?: number; summonUids?: string[] } {
  if (value === undefined) return true;
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.summonSequence === undefined || typeof record.summonSequence === "number") &&
    (record.spellTrapSequence === undefined || typeof record.spellTrapSequence === "number") &&
    (record.summonUids === undefined || (Array.isArray(record.summonUids) && record.summonUids.every((uid) => typeof uid === "string")))
  );
}

function handleAgentBridgeRequest(
  bridge: NonNullable<Window["__YGO_PVP_AGENT__"]>,
  request: unknown,
): unknown {
  if (typeof request !== "object" || request === null) return { ok: false, error: "Malformed agent bridge request" };
  const record = request as Record<string, unknown>;
  const player = record.player === 0 || record.player === 1 ? record.player : undefined;
  if (record.method === "state") return bridge.state();
  if (player === undefined) return { ok: false, error: "Agent bridge request requires player 0 or 1" };
  if (record.method === "observe") return bridge.observe(player);
  if (record.method === "act") {
    if (typeof record.actionId !== "string") return { ok: false, error: "Agent bridge act request requires actionId" };
    return bridge.act(player, record.actionId, isAgentActionParams(record.params) ? record.params : {});
  }
  return { ok: false, error: `Unknown agent bridge method ${String(record.method)}` };
}

function requestId(request: unknown): unknown {
  if (typeof request !== "object" || request === null) return undefined;
  return (request as Record<string, unknown>).id;
}
