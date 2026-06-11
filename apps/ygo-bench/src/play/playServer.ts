import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Socket } from "node:net";
import { extname, join, resolve } from "node:path";
import { encodeWebSocketTextFrame } from "../viewer/liveServer.js";
import { jsonReplacer } from "../edopro-wasm/realRunner.js";
import { getRunArtifact, listRunArtifacts, listSummaryArtifacts, readRunFile, readRunTrace, readSummaryArtifact } from "../viewer-ui/artifacts.js";
import { PlaySessionManager } from "./PlaySessionManager.js";
import type { PlaySessionCreateRequest } from "./playTypes.js";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export interface PlayServer {
  url: string;
  close(): Promise<void>;
}

export async function startPlayServer(options: {
  port?: number;
  host?: string;
  staticDir?: string;
  initialSession?: PlaySessionCreateRequest;
}): Promise<PlayServer> {
  const host = options.host ?? "127.0.0.1";
  const staticDir = resolve(options.staticDir ?? "dist-viewer");
  const clients = new Map<string, Set<Socket>>();
  const manager = new PlaySessionManager((session) => broadcast(clients.get(session.id), { type: "session", session }));
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    try {
      if (request.method === "POST" && url.pathname === "/api/play/sessions") {
        return sendJson(response, await manager.create((await readJson(request)) as PlaySessionCreateRequest));
      }
      if (request.method === "GET" && url.pathname === "/api/play/sessions") return sendJson(response, manager.list());
      if (request.method === "GET" && url.pathname === "/api/runs") return sendJson(response, await listRunArtifacts());
      if (request.method === "GET" && url.pathname === "/api/summaries") return sendJson(response, await listSummaryArtifacts());
      const summaryMatch = /^\/api\/summaries\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && summaryMatch) return sendNullableJson(response, await readSummaryArtifact(decodeURIComponent(summaryMatch[1] ?? "")));
      const runMatch = /^\/api\/runs\/([^/]+)(?:\/(.+))?$/.exec(url.pathname);
      if (request.method === "GET" && runMatch) {
        const id = decodeURIComponent(runMatch[1] ?? "");
        const child = runMatch[2];
        if (!child) return sendNullableJson(response, await getRunArtifact(id));
        if (child === "trace") return sendJson(response, await readRunTrace(id));
        if (child === "trace/raw") return sendText(response, (await readRunFile(id, "trace.jsonl")) ?? "", "application/x-ndjson; charset=utf-8");
        if (child === "score") return sendText(response, (await readRunFile(id, "final-score.json")) ?? "", "application/json; charset=utf-8");
        if (child === "metadata") return sendText(response, (await readRunFile(id, "metadata.json")) ?? "", "application/json; charset=utf-8");
        if (child === "transcript") return sendText(response, (await readRunFile(id, "model-transcript.md")) ?? "", "text/markdown; charset=utf-8");
      }
      const sessionMatch = /^\/api\/play\/sessions\/([^/]+)(?:\/(.+))?$/.exec(url.pathname);
      if (sessionMatch) {
        const id = decodeURIComponent(sessionMatch[1] ?? "");
        const child = sessionMatch[2];
        if (request.method === "GET" && !child) return sendNullableJson(response, manager.get(id));
        if (request.method === "POST" && child === "actions") {
          const body = (await readJson(request)) as { actionId?: string };
          if (!body.actionId) throw new Error("Missing actionId");
          return sendJson(response, await manager.submitHumanAction(id, body.actionId));
        }
        if (request.method === "POST" && child === "concede") return sendJson(response, await manager.concede(id));
        if (request.method === "GET" && child === "transcript") {
          const session = manager.get(id);
          if (!session) return notFound(response);
          return sendText(response, await readFile(join(session.runDir, "model-transcript.md"), "utf8").catch(() => ""), "text/markdown; charset=utf-8");
        }
      }
      return await sendStatic(response, staticDir, url.pathname);
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });

  server.on("upgrade", (request, rawSocket) => {
    const socket = rawSocket as Socket;
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    const match = /^\/api\/play\/sessions\/([^/]+)\/live$/.exec(url.pathname);
    if (!match) return socket.destroy();
    const id = decodeURIComponent(match[1] ?? "");
    const key = request.headers["sec-websocket-key"];
    if (typeof key !== "string") return socket.destroy();
    socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", `Sec-WebSocket-Accept: ${websocketAccept(key)}`, "\r\n"].join("\r\n"));
    const sockets = clients.get(id) ?? new Set<Socket>();
    clients.set(id, sockets);
    sockets.add(socket);
    const session = manager.get(id);
    if (session) sendSocketJson(socket, { type: "session", session });
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => sockets.delete(socket));
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(options.port ?? 0, host, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });
  if (options.initialSession) await manager.create(options.initialSession);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Play server did not bind to a TCP port");
  return {
    url: `http://${host}:${address.port}/?mode=play`,
    close: () =>
      new Promise((resolveClose, rejectClose) => {
        manager.close();
        for (const sockets of clients.values()) for (const socket of sockets) socket.destroy();
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      }),
  };
}

function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolveRead, rejectRead) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      try {
        resolveRead(body.trim() ? JSON.parse(body) : {});
      } catch (error) {
        rejectRead(error);
      }
    });
    request.on("error", rejectRead);
  });
}

function sendJson(response: ServerResponse, value: unknown): void {
  const body = JSON.stringify(value, jsonReplacer);
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(body);
}

function sendNullableJson(response: ServerResponse, value: unknown | null): void {
  if (!value) return notFound(response);
  sendJson(response, value);
}

function sendText(response: ServerResponse, value: string, contentTypeValue: string): void {
  response.writeHead(200, { "content-type": contentTypeValue });
  response.end(value);
}

async function sendStatic(response: ServerResponse, staticDir: string, pathName: string): Promise<void> {
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
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(await readFile(indexPath, "utf8"));
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
    default:
      return "application/octet-stream";
  }
}

function broadcast(clients: Set<Socket> | undefined, value: unknown): void {
  if (!clients) return;
  for (const client of clients) sendSocketJson(client, value);
}

function sendSocketJson(socket: Socket, value: unknown): void {
  if (!socket.destroyed) socket.write(encodeWebSocketTextFrame(JSON.stringify(value, jsonReplacer)));
}

function websocketAccept(key: string): string {
  return createHash("sha1")
    .update(`${key}${WS_GUID}`)
    .digest("base64");
}
