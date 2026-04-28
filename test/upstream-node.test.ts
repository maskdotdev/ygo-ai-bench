import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCardReader, createDuel, createUpstreamSourceConfig, loadDecks, normalizeCdbRows, startDuel } from "../src/engine/index.js";
import { createLuaScriptHost } from "../src/engine/lua-host.js";
import { createUpstreamNodeWorkspace } from "../src/engine/upstream-node.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Node upstream workspace loader", () => {
  it("loads card scripts and banlists from a local upstream checkout shape", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "duel-upstream-"));
    tempRoots.push(root);
    fs.mkdirSync(path.join(root, "script"), { recursive: true });
    fs.writeFileSync(path.join(root, "script", "c100.lua"), "loaded_name = 'fixture script'\nDebug.Message(loaded_name)\n", "utf8");
    fs.writeFileSync(path.join(root, "lflist.conf"), "100 1\n200 0\n", "utf8");

    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(root));
    expect(workspace.readCardScript(100)).toContain("fixture script");
    expect(workspace.readBanlist("lflist.conf")).toEqual([
      { code: "100", limit: 1 },
      { code: "200", limit: 0 },
    ]);

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const result = host.loadCardScript(100, workspace);

    expect(result).toEqual({ ok: true, name: "c100.lua" });
    expect(host.getGlobalString("loaded_name")).toBe("fixture script");
    expect(host.messages).toContain("fixture script");
  });
});
