import { applyAction, chooseHighestPriority, getLegalActions, parseYdk, runPlaytest, snapshot, startPlaytest, type PlaytestSession } from "./playtest/index.js";
import type { PlaytestAction, CardSummary } from "./engine/index.js";

const el = {
  loadIncludedDeckBtn: byId<HTMLButtonElement>("loadIncludedDeckBtn"),
  startPlaytestBtn: byId<HTMLButtonElement>("startPlaytestBtn"),
  stepActionBtn: byId<HTMLButtonElement>("stepActionBtn"),
  autoRunBtn: byId<HTMLButtonElement>("autoRunBtn"),
  seedInput: byId<HTMLInputElement>("seedInput"),
  handSizeInput: byId<HTMLInputElement>("handSizeInput"),
  maxActionsInput: byId<HTMLInputElement>("maxActionsInput"),
  ydkInput: byId<HTMLTextAreaElement>("playtestYdkInput"),
  deckInputBadge: byId<HTMLElement>("deckInputBadge"),
  qualityBadge: byId<HTMLElement>("qualityBadge"),
  scoreValue: byId<HTMLElement>("scoreValue"),
  deckCountValue: byId<HTMLElement>("deckCountValue"),
  actionCountValue: byId<HTMLElement>("actionCountValue"),
  sessionValue: byId<HTMLElement>("sessionValue"),
  riskList: byId<HTMLElement>("riskList"),
  normalSummonBadge: byId<HTMLElement>("normalSummonBadge"),
  handZone: byId<HTMLElement>("handZone"),
  fieldZone: byId<HTMLElement>("fieldZone"),
  graveyardZone: byId<HTMLElement>("graveyardZone"),
  extraZone: byId<HTMLElement>("extraZone"),
  legalActionBadge: byId<HTMLElement>("legalActionBadge"),
  legalActionList: byId<HTMLElement>("legalActionList"),
  logBadge: byId<HTMLElement>("logBadge"),
  transcriptList: byId<HTMLElement>("transcriptList"),
  toastStack: byId<HTMLElement>("toastStack"),
};

let session: PlaytestSession | null = null;

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
renderEmpty();

el.loadIncludedDeckBtn.addEventListener("click", async () => {
  try {
    const response = await fetch("./dark-magical-blast-tcg-branded-dm.ydk");
    if (!response.ok) throw new Error(`Could not load included deck (${response.status})`);
    el.ydkInput.value = await response.text();
    renderDeckBadge();
    toast("Included deck loaded", "Dark Magical Blast TCG list is ready.");
  } catch (error) {
    el.ydkInput.value = starterYdk;
    renderDeckBadge();
    toast("Using embedded deck", error instanceof Error ? error.message : "Could not fetch the deck file.", "warning");
  }
});

el.startPlaytestBtn.addEventListener("click", () => {
  try {
    const parsed = parseYdk(el.ydkInput.value);
    session = startPlaytest({
      deck: parsed.main,
      extraDeck: parsed.extra,
      seed: el.seedInput.value || Date.now(),
      handSize: Number(el.handSizeInput.value) || 5,
    });
    render();
    toast("Playtest started", "Opening hand is ready.");
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
  el.stepActionBtn.disabled = false;
  el.autoRunBtn.disabled = false;
  el.qualityBadge.textContent = view.evaluation.quality;
  el.qualityBadge.className = `badge ${view.evaluation.quality === "weak" ? "bad" : view.evaluation.quality === "thin" ? "warn" : "ok"}`;
  el.scoreValue.textContent = String(view.evaluation.score);
  el.deckCountValue.textContent = String(view.state.deckCount);
  el.actionCountValue.textContent = String(view.legalActions.filter((action) => action.type !== "end").length);
  el.sessionValue.textContent = view.sessionId.split("-").slice(-2).join("-");
  el.normalSummonBadge.textContent = view.state.normalSummonUsed ? "Normal used" : "Normal ready";
  el.normalSummonBadge.className = `badge ${view.state.normalSummonUsed ? "warn" : "ok"}`;
  el.riskList.innerHTML = view.evaluation.risks.length
    ? view.evaluation.risks.map((risk) => `<li>${escapeHtml(risk)}</li>`).join("")
    : `<li>No obvious V1 risk flags.</li>`;

  renderCards(el.handZone, view.state.hand);
  renderCards(el.fieldZone, view.state.field);
  renderCards(el.graveyardZone, view.state.graveyard);
  renderCards(el.extraZone, view.state.extraDeck);
  renderActions(view.legalActions);
  renderTranscript(view.state.log);
  renderDeckBadge();
}

function renderEmpty(): void {
  el.stepActionBtn.disabled = true;
  el.autoRunBtn.disabled = true;
  el.qualityBadge.textContent = "Waiting";
  el.qualityBadge.className = "badge neutral";
  el.scoreValue.textContent = "0";
  el.deckCountValue.textContent = "0";
  el.actionCountValue.textContent = "0";
  el.sessionValue.textContent = "—";
  el.normalSummonBadge.textContent = "Normal ready";
  el.normalSummonBadge.className = "badge neutral";
  el.riskList.innerHTML = `<li>Start a hand to evaluate the opener.</li>`;
  for (const zone of [el.handZone, el.fieldZone, el.graveyardZone, el.extraZone]) {
    zone.innerHTML = `<span class="mini-card empty">Empty</span>`;
  }
  el.legalActionBadge.textContent = "0";
  el.legalActionList.innerHTML = `<p class="muted">No session yet.</p>`;
  el.logBadge.textContent = "0";
  el.transcriptList.innerHTML = `<li>Transcript will appear after the opening draw.</li>`;
  renderDeckBadge();
}

function renderDeckBadge(): void {
  const parsed = parseYdk(el.ydkInput.value);
  el.deckInputBadge.textContent = `${parsed.main.length} / ${parsed.extra.length}`;
}

function renderCards(target: HTMLElement, cards: CardSummary[]): void {
  target.innerHTML = cards.length
    ? cards.map((card) => `<span class="mini-card ${escapeAttr(card.type)}"><strong>${escapeHtml(card.name)}</strong><small>${escapeHtml(card.type)}</small></span>`).join("")
    : `<span class="mini-card empty">Empty</span>`;
}

function renderActions(actions: PlaytestAction[]): void {
  const playable = actions.filter((action) => action.type !== "end");
  el.legalActionBadge.textContent = String(playable.length);
  el.legalActionList.innerHTML = playable.length
    ? playable.map((action, index) => `<button class="action-choice" type="button" data-action-index="${index}">${escapeHtml(action.label)}</button>`).join("")
    : `<p class="muted">No legal V1 actions remain.</p>`;

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
  el.transcriptList.innerHTML = log.length
    ? log.map((entry) => `
      <li>
        <span>${entry.step}</span>
        <div>
          <strong>${escapeHtml(entry.action)}${entry.card ? ` · ${escapeHtml(entry.card)}` : ""}</strong>
          <small>${escapeHtml(entry.detail)}</small>
        </div>
      </li>`).join("")
    : `<li>Transcript will appear after the opening draw.</li>`;
}

function toast(title: string, message: string, tone = "default"): void {
  const node = document.createElement("div");
  node.className = `toast ${tone}`;
  node.innerHTML = `<strong>${escapeHtml(title)}</strong><small>${escapeHtml(message)}</small>`;
  el.toastStack.append(node);
  window.setTimeout(() => {
    node.style.opacity = "0";
    node.style.transform = "translateY(8px)";
    node.style.transition = "opacity 180ms ease, transform 180ms ease";
    window.setTimeout(() => node.remove(), 220);
  }, 3000);
}

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
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
