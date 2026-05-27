import { writeTextFile } from "../core/trace.js";
import type { ScenarioScore, TraceFrame } from "../core/types.js";

export async function writeViewerHtml(path: string, frames: TraceFrame[], score: ScenarioScore): Promise<void> {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>YGO Bench Viewer - ${escapeHtml(score.scenarioId)}</title>
  <style>
    body { margin: 0; font-family: Inter, system-ui, sans-serif; background: #101418; color: #eef2f5; }
    main { display: grid; grid-template-columns: minmax(0, 1fr) 360px; min-height: 100vh; }
    .board { padding: 24px; display: grid; gap: 16px; align-content: start; }
    .zones { display: grid; grid-template-columns: repeat(5, minmax(96px, 1fr)); gap: 10px; }
    .zone { min-height: 112px; border: 1px solid #34404a; background: #182028; border-radius: 8px; padding: 10px; }
    .zone h3 { margin: 0 0 8px; font-size: 12px; color: #9fb0bf; text-transform: uppercase; }
    .card { border: 1px solid #5f6f7d; border-radius: 6px; padding: 8px; margin-top: 6px; background: #232e38; font-size: 13px; }
    aside { border-left: 1px solid #34404a; padding: 20px; background: #151b21; overflow: auto; }
    .event { padding: 10px 0; border-bottom: 1px solid #28333d; font-size: 14px; }
    .decision { color: #9dd6ff; }
    pre { white-space: pre-wrap; background: #0b0f13; padding: 12px; border-radius: 8px; overflow: auto; }
  </style>
</head>
<body>
  <main>
    <section class="board">
      <h1>YGO Bench Viewer</h1>
      <p>Scenario ${escapeHtml(score.scenarioId)} - ${escapeHtml(score.agentId)} - score ${score.objectiveScore.toFixed(2)}</p>
      <div id="board"></div>
      <h2>Final Score</h2>
      <pre>${escapeHtml(JSON.stringify(score, null, 2))}</pre>
    </section>
    <aside>
      <h2>Timeline</h2>
      <div id="timeline"></div>
    </aside>
  </main>
  <script type="application/json" id="trace">${escapeHtml(JSON.stringify(frames))}</script>
  <script>
    const frames = JSON.parse(document.getElementById("trace").textContent);
    const lastDecision = [...frames].reverse().find((frame) => frame.type === "decision");
    const board = document.getElementById("board");
    const timeline = document.getElementById("timeline");
    if (lastDecision) {
      const state = lastDecision.observation.publicState;
      board.innerHTML = state.players.map((player, index) => \`
        <h2>Player \${index} - LP \${player.lp}</h2>
        <div class="zones">
          \${["monsters","spellsTraps","graveyard","banished","revealedHand"].map((zone) => \`
            <div class="zone"><h3>\${zone}</h3>\${player[zone].map((card) => \`<div class="card">\${card.name}</div>\`).join("") || "Empty"}</div>
          \`).join("")}
        </div>
      \`).join("");
    }
    timeline.innerHTML = frames.map((frame) => {
      if (frame.type === "decision") return \`<div class="event decision">Decision: \${frame.chosen.actionId}<br>\${frame.chosen.reason}</div>\`;
      return \`<div class="event">[\${frame.phase}] \${frame.text}</div>\`;
    }).join("");
  </script>
</body>
</html>`;
  await writeTextFile(path, html);
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
