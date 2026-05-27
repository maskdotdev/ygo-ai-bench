import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync, watch, type FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { extname, join, resolve } from "node:path";
import { encodeWebSocketTextFrame } from "../viewer/liveServer.js";
import { getRunArtifact, listRunArtifacts, listSummaryArtifacts, readRunFile, readRunTrace, readSummaryArtifact, resolveRunDir } from "./artifacts.js";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export interface BenchUiServer {
  url: string;
  close(): Promise<void>;
}

export async function startBenchUiServer(options: { port?: number; host?: string; root?: string; staticDir?: string; openRunId?: string }): Promise<BenchUiServer> {
  const host = options.host ?? "127.0.0.1";
  const root = options.root ?? "benchmark-runs";
  const staticDir = resolve(options.staticDir ?? "dist-viewer");
  const liveClients = new Map<string, Set<Socket>>();
  const watchers = new Map<string, FSWatcher>();
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    try {
      if (url.pathname === "/api/runs") return sendJson(response, await listRunArtifacts(root));
      const runMatch = /^\/api\/runs\/([^/]+)(?:\/(.+))?$/.exec(url.pathname);
      if (runMatch) {
        const id = decodeURIComponent(runMatch[1] ?? "");
        const child = runMatch[2];
        if (!child) return sendNullableJson(response, await getRunArtifact(id, root));
        if (child === "trace") return sendNullableJson(response, await readRunTrace(id, root));
        if (child === "trace/raw") return sendText(response, await readRunFile(id, "trace.jsonl", root), "application/x-ndjson; charset=utf-8");
        if (child === "score") return sendText(response, await readRunFile(id, "final-score.json", root), "application/json; charset=utf-8");
        if (child === "metadata") return sendText(response, await readRunFile(id, "metadata.json", root), "application/json; charset=utf-8");
        if (child === "transcript") return sendText(response, await readRunFile(id, "model-transcript.md", root), "text/markdown; charset=utf-8");
        if (child === "legacy-viewer") return sendText(response, await readRunFile(id, "viewer.html", root), "text/html; charset=utf-8");
      }
      if (url.pathname === "/api/summaries") return sendJson(response, await listSummaryArtifacts(root));
      const summaryMatch = /^\/api\/summaries\/([^/]+)$/.exec(url.pathname);
      if (summaryMatch) return sendNullableJson(response, await readSummaryArtifact(decodeURIComponent(summaryMatch[1] ?? ""), root));
      return await sendStatic(response, staticDir, url.pathname, options.openRunId);
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });

  server.on("upgrade", async (request, rawSocket) => {
    const socket = rawSocket as Socket;
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const match = /^\/api\/runs\/([^/]+)\/live$/.exec(url.pathname);
    if (!match) {
      socket.destroy();
      return;
    }
    const id = decodeURIComponent(match[1] ?? "");
    const runDir = await resolveRunDir(id, root);
    if (!runDir) {
      socket.destroy();
      return;
    }
    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }
    socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${websocketAccept(key)}`, "\r\n"].join("\r\n"));
    const clients = liveClients.get(id) ?? new Set<Socket>();
    liveClients.set(id, clients);
    clients.add(socket);
    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => clients.delete(socket));
    const tracePath = join(runDir, "trace.jsonl");
    await streamTrace(tracePath, socket);
    if (!watchers.has(id)) watchers.set(id, watchTrace(tracePath, clients));
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(options.port ?? 0, host, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("YGO Bench UI server did not bind to a TCP port");
  return {
    url: `http://${host}:${address.port}/`,
    close: () =>
      new Promise((resolveClose, rejectClose) => {
        for (const watcher of watchers.values()) watcher.close();
        for (const clients of liveClients.values()) for (const client of clients) client.destroy();
        server.close((error) => {
          if (error) rejectClose(error);
          else resolveClose();
        });
      }),
  };
}

async function sendStatic(response: ServerResponse, staticDir: string, pathName: string, openRunId?: string): Promise<void> {
  const relative = pathName === "/" ? "index.html" : decodeURIComponent(pathName.slice(1));
  const filePath = resolve(staticDir, relative);
  if (!filePath.startsWith(`${staticDir}/`) && filePath !== staticDir) return notFound(response);
  if (existsSync(filePath) && statSync(filePath).isFile()) {
    response.writeHead(200, { "content-type": contentType(filePath) });
    createReadStream(filePath).pipe(response);
    return;
  }
  const indexPath = join(staticDir, "index.html");
  if (!existsSync(indexPath)) {
    response.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    response.end("Viewer bundle is missing. Run `pnpm --filter @ygo-bench/app viewer:build` first.");
    return;
  }
  let html = await readFile(indexPath, "utf8");
  if (openRunId) html = html.replace("</head>", `<script>window.__YGO_BENCH_OPEN_RUN__=${JSON.stringify(openRunId)}</script></head>`);
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
}

function sendJson(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function sendNullableJson(response: ServerResponse, value: unknown | null): void {
  if (value === null) return notFound(response);
  sendJson(response, value);
}

function sendText(response: ServerResponse, value: string | null, contentTypeValue: string): void {
  if (value === null) return notFound(response);
  response.writeHead(200, { "content-type": contentTypeValue });
  response.end(value);
}

function notFound(response: ServerResponse): void {
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found");
}

function contentType(path: string): string {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

async function streamTrace(tracePath: string, socket: Socket): Promise<void> {
  const raw = await readFile(tracePath, "utf8").catch(() => "");
  for (const line of raw.split("\n")) sendTraceLine(socket, line);
  sendSocketJson(socket, { type: "ready" });
}

function watchTrace(tracePath: string, clients: Set<Socket>): FSWatcher {
  let readOffset = safeSize(tracePath);
  return watch(tracePath, { persistent: false }, () => {
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
      for (const line of lines) for (const client of clients) sendTraceLine(client, line);
    });
    stream.on("end", () => {
      if (buffered.trim()) for (const client of clients) sendTraceLine(client, buffered);
    });
  });
}

function sendTraceLine(socket: Socket, line: string): void {
  if (!line.trim()) return;
  let payload: unknown;
  try {
    payload = JSON.parse(line);
  } catch {
    payload = { type: "raw", line };
  }
  sendSocketJson(socket, { type: "trace", payload });
}

function sendSocketJson(socket: Socket, value: unknown): void {
  if (!socket.destroyed) socket.write(encodeWebSocketTextFrame(JSON.stringify(value)));
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
