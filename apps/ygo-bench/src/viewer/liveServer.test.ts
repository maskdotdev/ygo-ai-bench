import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { describe, expect, it } from "vitest";
import { encodeWebSocketTextFrame, renderLiveViewerHtml, startTraceViewerServer } from "./liveServer.js";

describe("trace live viewer server", () => {
  it("serves HTML and streams trace lines over WebSocket", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ygo-trace-viewer-"));
    const tracePath = join(dir, "trace.jsonl");
    await writeFile(
      tracePath,
      JSON.stringify({
        type: "decision",
        chosen: { actionId: "a_001", reason: "test" },
        legalActions: [{ id: "a_001", label: "Test action" }],
      }) + "\n",
    );

    const server = await startServerIfAllowed(tracePath);
    if (!server) return;
    try {
      const html = await fetchText(server.url);
      expect(html).toContain("YGO Bench Live Trace Viewer");

      const firstMessage = await readFirstWebSocketMessage(server.url.replace("http://", ""));
      expect(firstMessage).toMatchObject({
        type: "trace",
        payload: {
          type: "decision",
          chosen: { actionId: "a_001" },
        },
      });
    } finally {
      await server.close();
    }
  });

  it("encodes medium websocket text frames", () => {
    const frame = encodeWebSocketTextFrame("x".repeat(130));
    expect(frame[0]).toBe(0x81);
    expect(frame[1]).toBe(126);
    expect(frame.readUInt16BE(2)).toBe(130);
  });

  it("renders the live viewer shell", () => {
    expect(renderLiveViewerHtml()).toContain("new WebSocket");
    expect(renderLiveViewerHtml()).toContain("YGO Bench Live Trace Viewer");
  });
});

async function startServerIfAllowed(tracePath: string): Promise<Awaited<ReturnType<typeof startTraceViewerServer>> | null> {
  try {
    return await startTraceViewerServer({ tracePath, port: 0 });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EPERM") return null;
    throw error;
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  return response.text();
}

async function readFirstWebSocketMessage(hostAndPort: string): Promise<Record<string, unknown>> {
  const [host, portText] = hostAndPort.replace(/\/$/, "").split(":");
  const port = Number(portText);
  const key = randomBytes(16).toString("base64");
  return new Promise((resolve, reject) => {
    const socket = connect(port, host);
    let buffer = Buffer.alloc(0);
    socket.on("connect", () => {
      socket.write(
        [
          "GET /trace HTTP/1.1",
          `Host: ${hostAndPort}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          "\r\n",
        ].join("\r\n"),
      );
    });
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1 || buffer.length <= headerEnd + 6) return;
      const frame = buffer.subarray(headerEnd + 4);
      const lengthByte = frame[1] ?? 0;
      const length = lengthByte < 126 ? lengthByte : frame.readUInt16BE(2);
      const offset = lengthByte < 126 ? 2 : 4;
      if (frame.length < offset + length) return;
      socket.destroy();
      resolve(JSON.parse(frame.subarray(offset, offset + length).toString("utf8")) as Record<string, unknown>);
    });
    socket.on("error", reject);
  });
}
