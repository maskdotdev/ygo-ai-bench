import { writeTextFile } from "../core/trace.js";
import type { ScenarioScore } from "../core/types.js";
import type { RealReducedState } from "./normalizedEvents.js";

export async function writeRealViewerHtml(path: string, trace: unknown[], state: RealReducedState, score: ScenarioScore): Promise<void> {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>YGO Bench Real Viewer - ${escapeHtml(score.agentId)}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #111417; color: #edf2f6; }
    main { display: grid; grid-template-columns: minmax(0, 1fr) 390px; min-height: 100vh; }
    .surface { padding: 22px; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: 16px; min-width: 0; }
    header { display: flex; justify-content: space-between; gap: 18px; align-items: end; border-bottom: 1px solid #313a42; padding-bottom: 14px; }
    h1, h2, h3 { margin: 0; font-weight: 650; }
    h1 { font-size: 22px; }
    h2 { font-size: 15px; }
    h3 { font-size: 12px; color: #9ca9b4; text-transform: uppercase; }
    .meta { display: flex; flex-wrap: wrap; gap: 10px 16px; color: #b5c1cb; font-size: 13px; }
    .board { display: grid; grid-template-rows: 1fr 1fr; gap: 14px; min-height: 0; }
    .player { border: 1px solid #34404a; border-radius: 8px; padding: 14px; background: #171d22; display: grid; gap: 12px; }
    .player-head { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }
    .zones { display: grid; grid-template-columns: 1.3fr 1.1fr 1fr 1fr; gap: 10px; }
    .zone { min-height: 118px; border: 1px solid #33404b; background: #202830; border-radius: 6px; padding: 10px; }
    .card { border: 1px solid #687786; border-radius: 6px; padding: 8px; margin-top: 7px; background: #2b3640; font-size: 13px; line-height: 1.25; }
    .empty { color: #7d8b96; font-size: 13px; margin-top: 8px; }
    aside { border-left: 1px solid #313a42; background: #171b20; overflow: auto; max-height: 100vh; }
    .timeline-head { position: sticky; top: 0; background: #171b20; padding: 18px; border-bottom: 1px solid #313a42; z-index: 1; }
    .timeline { padding: 8px 18px 20px; display: grid; gap: 4px; }
    .event { width: 100%; text-align: left; color: #dce5ec; background: transparent; border: 0; border-bottom: 1px solid #29323a; padding: 9px 0; font: inherit; font-size: 13px; cursor: pointer; }
    .event.active { color: #9dd8ff; }
    .event.decision { color: #b7e0ff; }
    .action-panel { border-top: 1px solid #313a42; padding-top: 14px; display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 14px; }
    .panel { border: 1px solid #34404a; border-radius: 8px; background: #171d22; padding: 13px; min-width: 0; }
    .actions { display: grid; gap: 7px; margin-top: 10px; }
    .action { border: 1px solid #40515f; border-radius: 6px; padding: 8px; background: #202a32; font-size: 13px; }
    .chosen { border-color: #86c8f4; background: #1c3545; }
    pre { white-space: pre-wrap; overflow: auto; max-height: 210px; margin: 10px 0 0; background: #0d1013; border-radius: 6px; padding: 10px; font-size: 12px; color: #cdd7df; }
    button.control { border: 1px solid #556574; border-radius: 6px; background: #222b33; color: #edf2f6; padding: 7px 10px; cursor: pointer; }
    @media (max-width: 900px) {
      main { grid-template-columns: 1fr; }
      aside { max-height: none; border-left: 0; border-top: 1px solid #313a42; }
      .zones, .action-panel { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <section class="surface">
      <header>
        <div>
          <h1>YGO Bench Real Engine Viewer</h1>
          <div class="meta" id="meta"></div>
        </div>
        <div>
          <button class="control" id="prev">Prev</button>
          <button class="control" id="next">Next</button>
        </div>
      </header>
      <div class="board" id="board"></div>
      <div class="action-panel">
        <section class="panel">
          <h2>Current Prompt</h2>
          <div id="prompt"></div>
          <div class="actions" id="actions"></div>
        </section>
        <section class="panel">
          <h2>Chosen Action</h2>
          <div id="chosen"></div>
          <pre id="observation"></pre>
        </section>
      </div>
    </section>
    <aside>
      <div class="timeline-head">
        <h2>Timeline</h2>
      </div>
      <div class="timeline" id="timeline"></div>
    </aside>
  </main>
  <script id="trace-data" type="application/json">${escapeScriptJson(JSON.stringify({ trace, finalState: state, score }, jsonReplacer))}</script>
  <script>
    const data = JSON.parse(document.getElementById("trace-data").textContent);
    const trace = data.trace.filter((line) => line && (line.type === "event" || line.type === "decision"));
    const snapshots = trace.map((line, index) => {
      if (line.type === "decision" && line.reducedState) return { index, state: line.reducedState };
      const previous = [...trace.slice(0, index)].reverse().find((item) => item.type === "decision" && item.reducedState);
      return { index, state: previous ? previous.reducedState : data.finalState };
    });
    let selected = Math.max(0, trace.findIndex((line) => line.type === "decision"));
    if (selected === -1) selected = trace.length - 1;

    function render() {
      const line = trace[selected] || {};
      const state = (snapshots[selected] && snapshots[selected].state) || data.finalState;
      document.getElementById("meta").innerHTML = [
        "Agent: " + data.score.agentId,
        "Turn: " + state.turn,
        "Phase: " + state.phase,
        "Decisions: " + data.score.decisionsTaken,
        "Score: " + Number(data.score.objectiveScore).toFixed(2)
      ].map(escapeHtml).map((item) => "<span>" + item + "</span>").join("");
      document.getElementById("board").innerHTML = state.players.map(renderPlayer).join("");
      document.getElementById("prompt").textContent = line.observation ? line.observation.prompt.type + " for player " + line.observation.player : line.text || "No prompt at this frame.";
      document.getElementById("actions").innerHTML = renderActions(line);
      document.getElementById("chosen").textContent = line.chosen ? line.chosen.actionId + ": " + line.chosen.reason : "No model decision at this frame.";
      document.getElementById("observation").textContent = line.observation ? JSON.stringify(line.observation, null, 2) : "";
      renderTimeline();
    }

    function renderPlayer(player, index) {
      return '<section class="player"><div class="player-head"><h2>Player ' + index + '</h2><span>LP ' + player.lp + ' | Hand ' + player.handCount + ' | Deck ' + player.deckCount + '</span></div><div class="zones">' +
        renderZone("Monsters", player.monsters) +
        renderZone("Spells/Traps", player.spellsTraps) +
        renderZone("Graveyard", player.graveyard) +
        renderZone("Banished", player.banished) +
        '</div></section>';
    }

    function renderZone(label, cards) {
      const body = cards && cards.length ? cards.map((card) => '<div class="card">' + escapeHtml(card.name) + '</div>').join("") : '<div class="empty">Empty</div>';
      return '<div class="zone"><h3>' + escapeHtml(label) + '</h3>' + body + '</div>';
    }

    function renderActions(line) {
      const actions = line.legalActions || [];
      if (!actions.length) return '<div class="empty">No legal-action prompt at this frame.</div>';
      return actions.map((action) => {
        const className = line.chosen && line.chosen.actionId === action.id ? "action chosen" : "action";
        return '<div class="' + className + '">' + escapeHtml(action.id + " - " + action.label) + '</div>';
      }).join("");
    }

    function renderTimeline() {
      document.getElementById("timeline").innerHTML = trace.map((line, index) => {
        const label = line.type === "decision" ? "Decision: " + line.chosen.actionId + " - " + line.chosen.reason : line.text;
        const className = "event " + (line.type === "decision" ? "decision " : "") + (index === selected ? "active" : "");
        return '<button class="' + className + '" data-index="' + index + '">' + escapeHtml(label || "") + '</button>';
      }).join("");
      for (const button of document.querySelectorAll("[data-index]")) {
        button.addEventListener("click", () => {
          selected = Number(button.dataset.index);
          render();
        });
      }
    }

    function escapeHtml(value) {
      return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    }

    document.getElementById("prev").addEventListener("click", () => {
      selected = Math.max(0, selected - 1);
      render();
    });
    document.getElementById("next").addEventListener("click", () => {
      selected = Math.min(trace.length - 1, selected + 1);
      render();
    });
    render();
  </script>
</body>
</html>`;
  await writeTextFile(path, html);
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeScriptJson(value: string): string {
  return value.replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
