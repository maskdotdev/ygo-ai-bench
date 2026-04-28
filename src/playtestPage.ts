import { applyAction, chooseHighestPriority, getLegalActions, parseYdk, runPlaytest, snapshot, startPlaytest, type PlaytestSession } from "./playtest/index.js";
import type { PlaytestAction, CardSummary } from "./engine/index.js";

interface CardImageInfo {
  small: string;
  large: string;
}

const el = {
  // Header stats
  headerDeckCount: byId<HTMLElement>("headerDeckCount"),
  headerHandCount: byId<HTMLElement>("headerHandCount"),
  headerFieldCount: byId<HTMLElement>("headerFieldCount"),
  headerGYCount: byId<HTMLElement>("headerGYCount"),
  
  // Deck input
  loadIncludedDeckBtn: byId<HTMLButtonElement>("loadIncludedDeckBtn"),
  useBuilderDeckBtn: byId<HTMLButtonElement>("useBuilderDeckBtn"),
  ydkInput: byId<HTMLTextAreaElement>("playtestYdkInput"),
  deckInputBadge: byId<HTMLElement>("deckInputBadge"),
  
  // Controls
  startPlaytestBtn: byId<HTMLButtonElement>("startPlaytestBtn"),
  stepActionBtn: byId<HTMLButtonElement>("stepActionBtn"),
  autoRunBtn: byId<HTMLButtonElement>("autoRunBtn"),
  seedInput: byId<HTMLInputElement>("seedInput"),
  handSizeInput: byId<HTMLInputElement>("handSizeInput"),
  maxActionsInput: byId<HTMLInputElement>("maxActionsInput"),
  normalSummonIndicator: byId<HTMLElement>("normalSummonIndicator"),
  normalSummonBadge: byId<HTMLElement>("normalSummonBadge"),
  
  // Game mat zones
  handZone: byId<HTMLElement>("handZone"),
  fieldZone: byId<HTMLElement>("fieldZone"),
  graveyardZone: byId<HTMLElement>("graveyardZone"),
  extraZone: byId<HTMLElement>("extraZone"),
  banishedZone: byId<HTMLElement>("banishedZone"),
  deckPileCount: byId<HTMLElement>("deckPileCount"),
  
  // Evaluation
  qualityBadge: byId<HTMLElement>("qualityBadge"),
  scoreValue: byId<HTMLElement>("scoreValue"),
  scoreRing: byId<SVGCircleElement>("scoreRing"),
  sessionValue: byId<HTMLElement>("sessionValue"),
  actionCountValue: byId<HTMLElement>("actionCountValue"),
  riskList: byId<HTMLElement>("riskList"),
  
  // Actions
  legalActionBadge: byId<HTMLElement>("legalActionBadge"),
  legalActionList: byId<HTMLElement>("legalActionList"),
  
  // Transcript
  logBadge: byId<HTMLElement>("logBadge"),
  transcriptList: byId<HTMLElement>("transcriptList"),
  
  // Toast
  toastStack: byId<HTMLElement>("toastStack"),
};

let session: PlaytestSession | null = null;
const AUTO_DECK_KEY = "duelDeckStudio.autoDeck.v1";
const cardImages = new Map<string, CardImageInfo>();

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

el.ydkInput.value = starterYdk;
if (new URLSearchParams(window.location.search).get("source") === "builder") loadBuilderDeck(false);
void hydrateImagesForCurrentDeck();
renderEmpty();

el.useBuilderDeckBtn.addEventListener("click", () => {
  if (loadBuilderDeck(true)) return;
  toast("No builder deck", "Build or import a deck on the deck builder page first.", "warning");
});

el.loadIncludedDeckBtn.addEventListener("click", async () => {
  try {
    const response = await fetch("./dark-magical-blast-tcg-branded-dm.ydk");
    if (!response.ok) throw new Error(`Could not load included deck (${response.status})`);
    el.ydkInput.value = await response.text();
    renderDeckBadge();
    void hydrateImagesForCurrentDeck();
    toast("Sample Deck Loaded", "Dark Magical Blast TCG list is ready to test.", "success");
  } catch (error) {
    el.ydkInput.value = starterYdk;
    renderDeckBadge();
    void hydrateImagesForCurrentDeck();
    toast("Using embedded deck", error instanceof Error ? error.message : "Could not fetch the deck file.", "warning");
  }
});

el.startPlaytestBtn.addEventListener("click", () => {
  try {
    const parsed = parseYdk(el.ydkInput.value);
    void hydrateImagesForIds([...parsed.main, ...parsed.extra]);
    session = startPlaytest({
      deck: parsed.main,
      extraDeck: parsed.extra,
      seed: el.seedInput.value || Date.now(),
      handSize: Number(el.handSizeInput.value) || 5,
    });
    render();
    toast("Duel Started!", "Your opening hand has been drawn.", "success");
  } catch (error) {
    toast("Could not start", error instanceof Error ? error.message : "Invalid deck input.", "error");
  }
});

el.stepActionBtn.addEventListener("click", () => {
  if (!session) return;
  const action = chooseHighestPriority({ state: snapshot(session).state, legalActions: getLegalActions(session), evaluation: snapshot(session).evaluation });
  if (!action || action.type === "end") return;
  const result = applyAction(session, action);
  render();
  if (!result.ok) toast("Action rejected", result.error ?? "The engine rejected that action.", "error");
});

el.autoRunBtn.addEventListener("click", () => {
  if (!session) return;
  runPlaytest(session, chooseHighestPriority, Number(el.maxActionsInput.value) || 10);
  render();
});

function render(): void {
  if (!session) {
    renderEmpty();
    return;
  }

  const view = snapshot(session);
  
  // Enable controls
  el.stepActionBtn.disabled = false;
  el.autoRunBtn.disabled = false;
  
  // Header stats
  el.headerDeckCount.textContent = String(view.state.deckCount);
  el.headerHandCount.textContent = String(view.state.hand.length);
  el.headerFieldCount.textContent = String(view.state.field.length);
  el.headerGYCount.textContent = String(view.state.graveyard.length);
  
  // Deck pile count
  el.deckPileCount.textContent = String(view.state.deckCount);
  
  // Evaluation
  const qualityClass = view.evaluation.quality === "weak" ? "badge-bad" : view.evaluation.quality === "thin" ? "badge-warn" : "badge-ok";
  el.qualityBadge.textContent = capitalize(view.evaluation.quality);
  el.qualityBadge.className = `badge ${qualityClass}`;
  
  el.scoreValue.textContent = String(view.evaluation.score);
  updateScoreRing(view.evaluation.score);
  
  el.sessionValue.textContent = view.sessionId.split("-").slice(-2).join("-");
  el.actionCountValue.textContent = String(view.legalActions.filter((action) => action.type !== "end").length);
  
  // Normal summon status
  el.normalSummonBadge.textContent = view.state.normalSummonUsed ? "Normal Used" : "Normal Ready";
  el.normalSummonIndicator.className = view.state.normalSummonUsed ? "status-indicator used" : "status-indicator";
  
  // Risks
  el.riskList.innerHTML = view.evaluation.risks.length
    ? view.evaluation.risks.map((risk) => `<li>${escapeHtml(risk)}</li>`).join("")
    : `<li style="background: rgba(68,170,102,0.08); border-left-color: rgba(68,170,102,0.4);">No obvious risks detected.</li>`;

  // Zones
  renderHandCards(view.state.hand);
  renderFieldCards(view.state.field);
  renderPileCards(el.graveyardZone, view.state.graveyard, "GY");
  renderPileCards(el.extraZone, view.state.extraDeck, "ED", true);
  renderPileCards(el.banishedZone, view.state.banished, "RFG");
  
  // Actions
  renderActions(view.legalActions);
  
  // Transcript
  renderTranscript(view.state.log);
  
  // Deck badge
  renderDeckBadge();
}

function renderEmpty(): void {
  el.stepActionBtn.disabled = true;
  el.autoRunBtn.disabled = true;
  
  // Header stats
  el.headerDeckCount.textContent = "40";
  el.headerHandCount.textContent = "0";
  el.headerFieldCount.textContent = "0";
  el.headerGYCount.textContent = "0";
  
  // Deck pile
  el.deckPileCount.textContent = "40";
  
  // Evaluation
  el.qualityBadge.textContent = "Waiting";
  el.qualityBadge.className = "badge";
  el.scoreValue.textContent = "0";
  updateScoreRing(0);
  el.sessionValue.textContent = "—";
  el.actionCountValue.textContent = "0";
  
  // Normal summon
  el.normalSummonBadge.textContent = "Normal Ready";
  el.normalSummonIndicator.className = "status-indicator";
  
  // Risks
  el.riskList.innerHTML = `<li>Start a hand to evaluate...</li>`;
  
  // Zones
  el.handZone.innerHTML = `
    <div class="empty-hand">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="4" y="4" width="16" height="16" rx="2"/>
        <path d="M9 9h6M9 13h6M9 17h4"/>
      </svg>
      <span>Draw a hand to begin</span>
    </div>`;
  
  renderFieldSlots();
  el.graveyardZone.innerHTML = `<div class="card-placeholder"><span>GY</span></div>`;
  el.extraZone.innerHTML = `<div class="card-placeholder"><span>ED</span></div>`;
  el.banishedZone.innerHTML = `<div class="card-placeholder faded"><span>RFG</span></div>`;
  
  // Actions
  el.legalActionBadge.textContent = "0";
  el.legalActionList.innerHTML = `<p class="no-actions">No session yet.</p>`;
  
  // Transcript
  el.logBadge.textContent = "0";
  el.transcriptList.innerHTML = `<li class="log-empty">Start a duel to see the action log...</li>`;
  
  renderDeckBadge();
}

function renderDeckBadge(): void {
  const parsed = parseYdk(el.ydkInput.value);
  el.deckInputBadge.textContent = `${parsed.main.length} / ${parsed.extra.length}`;
}

function updateScoreRing(score: number): void {
  // Score ring has circumference of ~264 (2 * PI * 42)
  const maxScore = 10;
  const percentage = Math.min(score / maxScore, 1);
  const dashOffset = 264 - (264 * percentage);
  el.scoreRing.style.strokeDashoffset = String(dashOffset);
}

function renderHandCards(cards: CardSummary[]): void {
  if (!cards.length) {
    el.handZone.innerHTML = `
      <div class="empty-hand">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="4" y="4" width="16" height="16" rx="2"/>
          <path d="M9 9h6M9 13h6M9 17h4"/>
        </svg>
        <span>Hand is empty</span>
      </div>`;
    return;
  }
  
  el.handZone.innerHTML = cards.map((card) => createCardHtml(card)).join("");
}

function renderFieldCards(cards: CardSummary[]): void {
  // First clear and render the slot structure
  renderFieldSlots();
  
  // Then place cards in slots
  const slots = el.fieldZone.querySelectorAll('.field-slot');
  cards.forEach((card, index) => {
    if (index < slots.length) {
      const slot = slots[index];
      if (slot) slot.innerHTML = createCardHtml(card);
    }
  });
}

function renderFieldSlots(): void {
  el.fieldZone.innerHTML = `
    <div class="field-slot monster-slot" data-slot="m1"></div>
    <div class="field-slot monster-slot" data-slot="m2"></div>
    <div class="field-slot monster-slot" data-slot="m3"></div>
    <div class="field-slot monster-slot" data-slot="m4"></div>
    <div class="field-slot monster-slot" data-slot="m5"></div>
    <div class="field-slot spell-slot" data-slot="st1"></div>
    <div class="field-slot spell-slot" data-slot="st2"></div>
    <div class="field-slot spell-slot" data-slot="st3"></div>
    <div class="field-slot spell-slot" data-slot="st4"></div>
    <div class="field-slot spell-slot" data-slot="st5"></div>`;
}

function renderPileCards(target: HTMLElement, cards: CardSummary[], emptyLabel: string, faceDown = false): void {
  if (!cards.length) {
    target.innerHTML = `<div class="card-placeholder${emptyLabel === 'RFG' ? ' faded' : ''}"><span>${emptyLabel}</span></div>`;
    return;
  }
  if (faceDown) {
    target.innerHTML = `
      <div class="card-back"><img src="./assets/card-back.webp" alt="${escapeAttr(emptyLabel)} card stack" /></div>
      <span class="pile-count">${cards.length}</span>`;
    return;
  }
  
  // Show stacked cards (max 3 visible) with count
  const visibleCards = cards.slice(0, 3);
  target.innerHTML = visibleCards.map((card) => createCardHtml(card)).join("") +
    `<span class="pile-count">${cards.length}</span>`;
}

function createCardHtml(card: CardSummary): string {
  const typeClass = getCardTypeClass(card.type, card.tags);
  const icon = getCardIcon(card.type);
  const image = cardImages.get(card.id);
  const fullCard = image?.large || image?.small;
  if (fullCard) {
    return `
      <div class="game-card real-card ${typeClass}" data-uid="${escapeAttr(card.uid)}" title="${escapeAttr(card.name)}">
        <img src="${escapeAttr(fullCard)}" alt="${escapeAttr(card.name)}" loading="lazy" />
      </div>`;
  }
  
  return `
    <div class="game-card ${typeClass}" data-uid="${escapeAttr(card.uid)}" title="${escapeAttr(card.name)}">
      <div class="game-card-inner">
        <div class="card-art">
          <span class="card-art-icon">${icon}</span>
        </div>
        <div class="card-info">
          <span class="card-name">${escapeHtml(card.name)}</span>
          <span class="card-type-badge">${escapeHtml(formatCardType(card.type))}</span>
        </div>
      </div>
    </div>`;
}

function getCardTypeClass(type: string, tags: string[]): string {
  if (type === "extra") return "extra";
  if (type === "spell") return "spell";
  if (type === "trap") return "trap";
  return "monster";
}

function getCardIcon(type: string): string {
  switch (type) {
    case "spell": return "✦";
    case "trap": return "⚠";
    case "extra": return "★";
    default: return "⚔";
  }
}

function formatCardType(type: string): string {
  switch (type) {
    case "extra": return "Extra";
    case "spell": return "Spell";
    case "trap": return "Trap";
    default: return "Monster";
  }
}

function renderActions(actions: PlaytestAction[]): void {
  const playable = actions.filter((action) => action.type !== "end");
  el.legalActionBadge.textContent = String(playable.length);
  el.legalActionBadge.className = playable.length > 0 ? "badge badge-gold" : "badge";
  
  if (!playable.length) {
    el.legalActionList.innerHTML = `<p class="no-actions">No legal actions remain.</p>`;
    return;
  }
  
  el.legalActionList.innerHTML = playable.map((action, index) => `
    <button class="action-btn" type="button" data-action-index="${index}">
      ${escapeHtml(action.label)}
    </button>`).join("");

  for (const button of el.legalActionList.querySelectorAll<HTMLButtonElement>("[data-action-index]")) {
    button.addEventListener("click", () => {
      if (!session) return;
      const action = playable[Number(button.dataset.actionIndex)];
      if (!action) return;
      const result = applyAction(session, action);
      render();
      if (!result.ok) toast("Action rejected", result.error ?? "The engine rejected that action.", "error");
    });
  }
}

function renderTranscript(log: Array<{ step: number; action: string; card?: string; detail: string }>): void {
  el.logBadge.textContent = String(log.length);
  
  if (!log.length) {
    el.transcriptList.innerHTML = `<li class="log-empty">Start a duel to see the action log...</li>`;
    return;
  }
  
  el.transcriptList.innerHTML = log.map((entry) => `
    <li>
      <span>${entry.step}</span>
      <div>
        <strong>${escapeHtml(entry.action)}${entry.card ? ` · ${escapeHtml(entry.card)}` : ""}</strong>
        <small>${escapeHtml(entry.detail)}</small>
      </div>
    </li>`).join("");
  
  // Scroll to bottom
  el.transcriptList.scrollTop = el.transcriptList.scrollHeight;
}

function toast(title: string, message: string, tone: "default" | "success" | "warning" | "error" = "default"): void {
  const node = document.createElement("div");
  node.className = `toast ${tone}`;
  node.innerHTML = `<strong>${escapeHtml(title)}</strong><small>${escapeHtml(message)}</small>`;
  el.toastStack.append(node);
  window.setTimeout(() => {
    node.style.opacity = "0";
    node.style.transform = "translateY(8px)";
    node.style.transition = "opacity 180ms ease, transform 180ms ease";
    window.setTimeout(() => node.remove(), 220);
  }, 3500);
}

function loadBuilderDeck(showToast: boolean): boolean {
  const raw = localStorage.getItem(AUTO_DECK_KEY);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { deckName?: string; deck?: { main?: Record<string, number>; extra?: Record<string, number>; side?: Record<string, number> } };
    const main = expandZone(parsed.deck?.main);
    const extra = expandZone(parsed.deck?.extra);
    const side = expandZone(parsed.deck?.side);
    if (!main.length && !extra.length) return false;
    el.ydkInput.value = [
      "#created by Duel Deck Studio",
      `#deck ${parsed.deckName || "Builder Deck"}`,
      "#main",
      ...main,
      "#extra",
      ...extra,
      "!side",
      ...side,
    ].join("\n");
    renderDeckBadge();
    void hydrateImagesForCurrentDeck();
    if (showToast) toast("Builder Deck Loaded", `${main.length} Main and ${extra.length} Extra cards imported.`, "success");
    return true;
  } catch {
    return false;
  }
}

function expandZone(zone: Record<string, number> | undefined): string[] {
  if (!zone) return [];
  return Object.entries(zone).flatMap(([id, count]) => Array.from({ length: Math.max(0, Number(count) || 0) }, () => id));
}

async function hydrateImagesForCurrentDeck(): Promise<void> {
  const parsed = parseYdk(el.ydkInput.value);
  await hydrateImagesForIds([...parsed.main, ...parsed.extra]);
}

async function hydrateImagesForIds(ids: string[]): Promise<void> {
  const missing = [...new Set(ids.map(String).filter((id) => !cardImages.has(id)))];
  if (!missing.length) return;
  try {
    const response = await fetch(`https://db.ygoprodeck.com/api/v7/cardinfo.php?id=${missing.join(",")}`);
    if (!response.ok) throw new Error(`YGOPRODeck returned ${response.status}`);
    const payload = await response.json() as { data?: Array<{ id: number | string; card_images?: Array<{ image_url?: string; image_url_small?: string }> }> };
    for (const card of payload.data ?? []) {
      const image = card.card_images?.[0];
      if (!image) continue;
      cardImages.set(String(card.id), {
        small: image.image_url_small || image.image_url || "",
        large: image.image_url || image.image_url_small || "",
      });
    }
    if (session) render();
  } catch (error) {
    console.warn("Could not hydrate card images", error);
  }
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function byId<T extends Element>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as unknown as T;
}

function escapeHtml(value: string): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
