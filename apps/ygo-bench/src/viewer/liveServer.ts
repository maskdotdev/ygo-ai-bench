import { createHash } from "node:crypto";
import { createReadStream, statSync, watch, type FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import type { Socket } from "node:net";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export interface TraceViewerServer {
  url: string;
  close(): Promise<void>;
}

export async function startTraceViewerServer(options: { tracePath: string; port?: number; host?: string }): Promise<TraceViewerServer> {
  const tracePath = resolve(options.tracePath);
  const host = options.host ?? "127.0.0.1";
  const clients = new Set<Socket>();
  let watcher: FSWatcher | null = null;
  let readOffset = safeSize(tracePath);

  const server = createServer(async (request, response) => {
    if (request.url === "/" || request.url === "/index.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(renderLiveViewerHtml());
      return;
    }
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, tracePath }));
      return;
    }
    response.writeHead(404);
    response.end("Not found");
  });

  server.on("upgrade", (request, rawSocket) => {
    const socket = rawSocket as Socket;
    if (request.url !== "/trace") {
      socket.destroy();
      return;
    }
    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${websocketAccept(key)}`,
        "\r\n",
      ].join("\r\n"),
    );
    clients.add(socket);
    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => clients.delete(socket));
    streamExistingTrace(tracePath, socket).catch((error: unknown) => sendJson(socket, { type: "error", message: errorMessage(error) }));
  });

  watcher = watch(tracePath, { persistent: false }, () => {
    const currentSize = safeSize(tracePath);
    if (currentSize < readOffset) readOffset = 0;
    if (currentSize <= readOffset) return;
    const stream = createReadStream(tracePath, { encoding: "utf8", start: readOffset, end: currentSize - 1 });
    readOffset = currentSize;
    let buffered = "";
    stream.on("data", (chunk) => {
      buffered += chunk;
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) broadcastLine(clients, line);
    });
    stream.on("end", () => {
      if (buffered.trim()) broadcastLine(clients, buffered);
    });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(options.port ?? 0, host, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Trace viewer server did not bind to a TCP port");

  return {
    url: `http://${host}:${address.port}/`,
    close: () =>
      new Promise((resolveClose, rejectClose) => {
        watcher?.close();
        for (const client of clients) client.destroy();
        server.close((error) => {
          if (error) rejectClose(error);
          else resolveClose();
        });
      }),
  };
}

async function streamExistingTrace(tracePath: string, socket: Socket): Promise<void> {
  const raw = await readFile(tracePath, "utf8");
  for (const line of raw.split("\n")) broadcastLine(new Set([socket]), line);
  sendJson(socket, { type: "ready" });
}

function broadcastLine(clients: Set<Socket>, line: string): void {
  if (!line.trim()) return;
  let payload: unknown;
  try {
    payload = JSON.parse(line);
  } catch {
    payload = { type: "raw", line };
  }
  for (const client of clients) sendJson(client, { type: "trace", payload });
}

function sendJson(socket: Socket, value: unknown): void {
  if (socket.destroyed) return;
  socket.write(encodeWebSocketTextFrame(JSON.stringify(value)));
}

export function encodeWebSocketTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }
  if (payload.length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, payload]);
}

function websocketAccept(key: string): string {
  return createHash("sha1")
    .update(`${key}${WS_GUID}`)
    .digest("base64");
}

function safeSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function renderLiveViewerHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>YGO Bench Live Trace Viewer</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #111417; color: #eef3f7; }
    main { display: grid; grid-template-columns: minmax(0, 1fr) 380px; min-height: 100vh; }
    section { padding: 20px; min-width: 0; }
    aside { border-left: 1px solid #303942; background: #171c21; overflow: auto; max-height: 100vh; padding: 18px; }
    h1 { margin: 0 0 8px; font-size: 22px; }
    h2 { margin: 16px 0 10px; font-size: 15px; }
    .meta { display: flex; flex-wrap: wrap; gap: 10px; color: #aebbc6; font-size: 13px; }
    .board { display: grid; gap: 14px; margin-top: 18px; }
    .player { border: 1px solid #34404a; border-radius: 8px; background: #171d22; padding: 13px; }
    .zones { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .zone { min-height: 92px; border: 1px solid #394753; border-radius: 6px; padding: 8px; background: #202830; }
    .zone h3 { margin: 0 0 7px; font-size: 11px; color: #9ca9b4; text-transform: uppercase; }
    .card, .action { border: 1px solid #647584; border-radius: 6px; padding: 7px; margin-top: 6px; background: #2b3640; font-size: 12px; }
    .chosen { border-color: #86c8f4; background: #1c3545; }
    .empty { color: #7d8b96; font-size: 12px; }
    .event { border-bottom: 1px solid #29323a; padding: 8px 0; font-size: 13px; }
    .decision { color: #a8dcff; }
    pre { white-space: pre-wrap; overflow: auto; max-height: 220px; background: #0d1013; border-radius: 6px; padding: 10px; font-size: 12px; color: #cdd7df; }
    @media (max-width: 900px) { main { grid-template-columns: 1fr; } aside { max-height: none; border-left: 0; border-top: 1px solid #303942; } .zones { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <section>
      <h1>YGO Bench Live Trace Viewer</h1>
      <div class="meta" id="meta">Connecting...</div>
      <div class="board" id="board"></div>
      <h2>Current Prompt</h2>
      <div id="prompt" class="empty">Waiting for a decision frame.</div>
      <div id="actions"></div>
      <h2>Observation</h2>
      <pre id="observation"></pre>
    </section>
    <aside>
      <h2>Timeline</h2>
      <div id="timeline"></div>
    </aside>
  </main>
  <script>
    const frames = [];
    const meta = document.getElementById("meta");
    const board = document.getElementById("board");
    const timeline = document.getElementById("timeline");
    const promptBox = document.getElementById("prompt");
    const actionsBox = document.getElementById("actions");
    const observationBox = document.getElementById("observation");
    const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/trace");
    ws.addEventListener("open", () => meta.textContent = "Connected. Waiting for trace frames.");
    ws.addEventListener("close", () => meta.textContent = "Disconnected. Replay data remains visible.");
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type !== "trace") return;
      frames.push(message.payload);
      render();
    });
    function render() {
      const visible = frames.filter((frame) => frame && (frame.type === "event" || frame.type === "decision" || frame.type === "engine"));
      const lastDecision = [...visible].reverse().find((frame) => frame.type === "decision");
      const lastState = lastDecision && (lastDecision.reducedState || (lastDecision.observation && lastDecision.observation.publicState));
      meta.textContent = visible.length + " frame(s), " + visible.filter((frame) => frame.type === "decision").length + " decision(s)";
      if (lastState) board.innerHTML = renderState(lastState);
      if (lastDecision) {
        const obs = lastDecision.observation || {};
        promptBox.textContent = obs.prompt ? obs.prompt.type + " for player " + obs.player : "Decision frame";
        actionsBox.innerHTML = renderDecisionDetails(lastDecision) + (lastDecision.legalActions || []).map((action) => '<div class="action ' + (lastDecision.chosen && lastDecision.chosen.actionId === action.id ? "chosen" : "") + '">' + escapeHtml(action.id + " - " + action.label) + '</div>').join("");
        observationBox.textContent = JSON.stringify(obs, null, 2);
      }
      timeline.innerHTML = visible.map((frame) => {
        if (frame.type === "decision") return '<div class="event decision">Decision: ' + escapeHtml(frame.chosen.actionId + " - " + frame.chosen.reason) + '</div>';
        return '<div class="event">' + escapeHtml(frame.text || frame.typeName || frame.type || "") + '</div>';
      }).join("");
    }
    function renderState(state) {
      const players = state.players || [];
      return players.map((player, index) => '<div class="player"><h2>Player ' + index + ' - LP ' + player.lp + ' | Hand ' + (player.handCount || 0) + ' | Deck ' + (player.deckCount || 0) + ' | Extra ' + (player.extraDeckCount || 0) + '</h2><div class="zones">' + renderZone("Monsters", player.monsters) + renderZone("Spells/Traps", player.spellsTraps) + renderZone("Graveyard", player.graveyard) + renderZone("Banished", player.banished) + '</div></div>').join("");
    }
    function renderZone(label, cards) {
      const body = cards && cards.length ? cards.map((card) => '<div class="card">' + escapeHtml(card.name || String(card.code || "card")) + '</div>').join("") : '<div class="empty">Empty</div>';
      return '<div class="zone"><h3>' + escapeHtml(label) + '</h3>' + body + '</div>';
    }
    function renderDecisionDetails(frame) {
      const chosen = frame.chosen || {};
      const details = [
        chosen.actionId ? "Chosen: " + chosen.actionId : "",
        chosen.reason ? "Reason: " + chosen.reason : "",
        chosen.tokenCount == null ? "" : "Tokens: " + chosen.tokenCount,
        frame.error ? "Error: " + frame.error : "",
        frame.lineQuality == null ? "" : "Line quality: " + Number(frame.lineQuality).toFixed(2)
      ].filter(Boolean);
      return details.length ? '<div class="action chosen">' + details.map(escapeHtml).join("<br>") + '</div>' : "";
    }
    function escapeHtml(value) {
      return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    }
  </script>
</body>
</html>`;
}
