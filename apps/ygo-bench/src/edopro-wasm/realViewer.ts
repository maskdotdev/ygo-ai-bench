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
    body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #101418; color: #eef2f5; }
    main { display: grid; grid-template-columns: minmax(0, 1fr) 380px; min-height: 100vh; }
    .board { padding: 24px; display: grid; gap: 18px; align-content: start; }
    .players { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
    .player { border: 1px solid #34404a; border-radius: 8px; padding: 14px; background: #151d24; }
    .zones { display: grid; grid-template-columns: repeat(2, minmax(120px, 1fr)); gap: 10px; }
    .zone { min-height: 96px; border: 1px solid #34404a; background: #1b242d; border-radius: 6px; padding: 10px; }
    .zone h3 { margin: 0 0 8px; font-size: 12px; color: #9fb0bf; text-transform: uppercase; }
    .card { border: 1px solid #607080; border-radius: 6px; padding: 8px; margin-top: 6px; background: #26323d; font-size: 13px; }
    aside { border-left: 1px solid #34404a; padding: 20px; background: #151b21; overflow: auto; max-height: 100vh; }
    .event { padding: 9px 0; border-bottom: 1px solid #28333d; font-size: 14px; }
    .decision { color: #9dd6ff; }
    .meta { display: flex; gap: 16px; color: #bed0dc; }
    pre { white-space: pre-wrap; background: #0b0f13; padding: 12px; border-radius: 8px; overflow: auto; }
  </style>
</head>
<body>
  <main>
    <section class="board">
      <h1>YGO Bench Real Engine Viewer</h1>
      <div class="meta">
        <span>Agent: ${escapeHtml(score.agentId)}</span>
        <span>Turn: ${state.turn}</span>
        <span>Phase: ${escapeHtml(state.phase)}</span>
        <span>Decisions: ${score.decisionsTaken}</span>
      </div>
      <div class="players">
        ${state.players.map((player, index) => renderPlayer(index, player)).join("")}
      </div>
      <h2>Final Score</h2>
      <pre>${escapeHtml(JSON.stringify(score, null, 2))}</pre>
    </section>
    <aside>
      <h2>Timeline</h2>
      ${trace.map(renderTraceLine).join("")}
    </aside>
  </main>
</body>
</html>`;
  await writeTextFile(path, html);
}

function renderPlayer(index: number, player: RealReducedState["players"][number]): string {
  return `<section class="player">
    <h2>Player ${index} - LP ${player.lp}</h2>
    <p>Hand ${player.handCount} | Deck ${player.deckCount}</p>
    <div class="zones">
      ${renderZone("Monsters", player.monsters)}
      ${renderZone("Spells/Traps", player.spellsTraps)}
      ${renderZone("Graveyard", player.graveyard)}
      ${renderZone("Banished", player.banished)}
    </div>
  </section>`;
}

function renderZone(label: string, cards: Array<{ name: string }>): string {
  return `<div class="zone"><h3>${escapeHtml(label)}</h3>${cards.map((card) => `<div class="card">${escapeHtml(card.name)}</div>`).join("") || "Empty"}</div>`;
}

function renderTraceLine(line: unknown): string {
  if (!isRecord(line)) return "";
  if (line.type === "decision" && isRecord(line.chosen)) {
    return `<div class="event decision">Decision: ${escapeHtml(String(line.chosen.actionId))}<br>${escapeHtml(String(line.chosen.reason))}</div>`;
  }
  if (line.type === "event") {
    return `<div class="event">${escapeHtml(String(line.text ?? line.event ?? ""))}</div>`;
  }
  return "";
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
