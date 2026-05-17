import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createCardReader, createUpstreamSourceConfig, normalizeCdbRows } from "#engine/data-loaders.js";
import { applyResponse, createDuel, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { moveDuelCard } from "#duel/card-state.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";

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

    fs.mkdirSync(path.join(root, "local-card-scripts"), { recursive: true });
    const workspace = createUpstreamNodeWorkspace({ ...createUpstreamSourceConfig(root), localScriptPath: path.join(root, "local-card-scripts") });
    expect(workspace.readCardScript(100)).toContain("fixture script");
    expect(workspace.readBanlist("lflist.conf")).toEqual([
      { code: "100", limit: 1 },
      { code: "200", limit: 0 },
    ]);

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session, workspace);
    const result = host.loadCardScript(100, workspace);

    expect(result).toEqual({ ok: true, name: "c100.lua" });
    expect(host.getGlobalString("loaded_name")).toBe("fixture script");
    expect(host.messages).toContain("fixture script");
  });

  it("prefers local overrides, then upstream scripts, then local fallbacks", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "duel-upstream-"));
    tempRoots.push(root);
    fs.mkdirSync(path.join(root, "script", "official"), { recursive: true });
    fs.mkdirSync(path.join(root, "local-card-scripts", "overrides", "official"), { recursive: true });
    fs.mkdirSync(path.join(root, "local-card-scripts", "fallbacks", "official"), { recursive: true });
    fs.writeFileSync(path.join(root, "script", "c100.lua"), "loaded_name = 'root script'\n", "utf8");
    fs.writeFileSync(path.join(root, "script", "official", "c100.lua"), "loaded_name = 'official script'\n", "utf8");
    fs.writeFileSync(path.join(root, "local-card-scripts", "overrides", "official", "c100.lua"), "loaded_name = 'override script'\n", "utf8");
    fs.writeFileSync(path.join(root, "local-card-scripts", "fallbacks", "official", "c200.lua"), "loaded_name = 'fallback script'\n", "utf8");

    const workspace = createUpstreamNodeWorkspace({ ...createUpstreamSourceConfig(root), localScriptPath: path.join(root, "local-card-scripts") });

    expect(workspace.readCardScript(100)).toContain("override script");
    expect(workspace.readCardScript(200)).toContain("fallback script");
    expect(workspace.scriptCandidates("c100.lua").map((candidate) => [candidate.source, path.relative(root, candidate.path)])).toEqual([
      ["local-override", path.join("local-card-scripts", "overrides", "official", "c100.lua")],
      ["local-override", path.join("local-card-scripts", "overrides", "c100.lua")],
      ["upstream-official", path.join("script", "official", "c100.lua")],
      ["upstream-root", path.join("script", "c100.lua")],
      ["upstream-pre-release", path.join("script", "pre-release", "c100.lua")],
      ["local-fallback", path.join("local-card-scripts", "fallbacks", "official", "c100.lua")],
      ["local-fallback", path.join("local-card-scripts", "fallbacks", "c100.lua")],
    ]);
  });

  it("synthesizes configured local script aliases without fallback files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "duel-upstream-"));
    tempRoots.push(root);
    fs.mkdirSync(path.join(root, "script", "official"), { recursive: true });
    fs.mkdirSync(path.join(root, "local-card-scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, "script", "official", "c100.lua"), "c100={}; loaded_name = 'canonical alias script'\n", "utf8");
    fs.writeFileSync(path.join(root, "local-card-scripts", "script-aliases.json"), `${JSON.stringify({ "999": "100" }, null, 2)}\n`, "utf8");

    const workspace = createUpstreamNodeWorkspace({ ...createUpstreamSourceConfig(root), localScriptPath: path.join(root, "local-card-scripts") });
    const cards = normalizeCdbRows([{ id: 999, type: 1 }], []);
    const session = createDuel({ seed: 1, startingHandSize: 1, cardReader: createCardReader(cards) });
    loadDecks(session, { 0: { main: ["999"] }, 1: { main: [] } });
    startDuel(session);
    const host = createLuaScriptHost(session, workspace);

    expect(workspace.scriptAlias(999)).toBe("100");
    expect(workspace.readCardScript(999)).toBe("Duel.LoadCardScriptAlias(100)\n");
    expect(host.loadCardScript(999, workspace)).toEqual({ ok: true, name: "c999.lua" });
    expect(host.getGlobalString("loaded_name")).toBe("canonical alias script");
  });

  it("loads card metadata from a local CDB database", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "duel-upstream-"));
    tempRoots.push(root);
    fs.mkdirSync(path.join(root, "cdb"), { recursive: true });
    const databasePath = path.join(root, "cdb", "cards.cdb");
    const sqlite = [
      "create table datas(id integer, alias integer, setcode integer, type integer, atk integer, def integer, level integer, race integer, attribute integer);",
      "create table texts(id integer, name text);",
      "insert into datas values(100,0,4660,33,2500,2100,7,2,32);",
      "insert into texts values(100,'Dark Metadata Probe');",
    ].join("");
    expect(() => fs.rmSync(databasePath, { force: true })).not.toThrow();
    execFileSync("sqlite3", [databasePath, sqlite]);

    fs.mkdirSync(path.join(root, "local-card-scripts"), { recursive: true });
    const workspace = createUpstreamNodeWorkspace({ ...createUpstreamSourceConfig(root), localScriptPath: path.join(root, "local-card-scripts") });

    expect(workspace.readDatabaseCards("cards.cdb")).toEqual([
      expect.objectContaining({
        code: "100",
        name: "Dark Metadata Probe",
        kind: "monster",
        typeFlags: 33,
        attack: 2500,
        defense: 2100,
        level: 7,
        race: 2,
        attribute: 32,
        setcodes: [4660],
      }),
    ]);
  });

  it("maps Link monster CDB def values to link markers", () => {
    const cards = normalizeCdbRows([{ id: 100, type: 0x4000001, atk: 1500, def: 0x120, level: 2 }], [{ id: 100, name: "Link Metadata Probe" }]);

    expect(cards).toEqual([
      expect.objectContaining({
        code: "100",
        name: "Link Metadata Probe",
        kind: "extra",
        typeFlags: 0x4000001,
        attack: 1500,
        level: 2,
        linkMarkers: 0x120,
      }),
    ]);
    expect(cards[0]?.defense).toBeUndefined();
  });

  it("merges supplemental local card metadata after CDB rows", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "duel-upstream-"));
    tempRoots.push(root);
    fs.mkdirSync(path.join(root, "cdb"), { recursive: true });
    fs.mkdirSync(path.join(root, "local-card-scripts"), { recursive: true });
    const databasePath = path.join(root, "cdb", "cards.cdb");
    const sqlite = [
      "create table datas(id integer, alias integer, setcode integer, type integer, atk integer, def integer, level integer, race integer, attribute integer);",
      "create table texts(id integer, name text);",
      "insert into datas values(100,0,0,2,0,0,0,0,0);",
      "insert into texts values(100,'Primary Spell');",
    ].join("");
    execFileSync("sqlite3", [databasePath, sqlite]);
    fs.writeFileSync(path.join(root, "local-card-scripts", "card-data.json"), `${JSON.stringify({
      datas: [{ id: 400, alias: 0, setcode: 207, type: 161, atk: 2800, def: 2600, level: 8, race: 2, attribute: 32 }],
      texts: [{ id: 400, name: "Supplemental Ritual" }],
    }, null, 2)}\n`, "utf8");

    const workspace = createUpstreamNodeWorkspace({ ...createUpstreamSourceConfig(root), localScriptPath: path.join(root, "local-card-scripts") });

    expect(workspace.readDatabaseCards("cards.cdb")).toEqual([
      expect.objectContaining({ code: "100", name: "Primary Spell", kind: "spell" }),
      expect.objectContaining({ code: "400", name: "Supplemental Ritual", kind: "monster", typeFlags: 161, setcodes: [207] }),
    ]);
  });

  it("registers a basic Lua ignition effect into the duel engine", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "duel-upstream-"));
    tempRoots.push(root);
    fs.mkdirSync(path.join(root, "script"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "script", "c100.lua"),
      `
      c100 = {}
      c100.initial_effect = function(c)
        local e = Effect.CreateEffect(c)
        e:SetType(EFFECT_TYPE_IGNITION)
        e:SetRange(LOCATION_HAND)
        e:SetCountLimit(1)
        e:SetOperation(function(e,c)
          Debug.Message("lua ignition resolved")
          Debug.Message("handler code " .. e:GetHandler():GetCode())
          Debug.Message("handler player " .. e:GetHandlerPlayer())
        end)
        c:RegisterEffect(e)
      end
      `,
      "utf8",
    );

    const cards = normalizeCdbRows([{ id: 100, type: 1 }, { id: 200, type: 1 }], []);
    const session = createDuel({ seed: 1, startingHandSize: 2, cardReader: createCardReader(cards) });
    loadDecks(session, {
      0: { main: ["100"] },
      1: { main: ["200"] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session);
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(root));
    expect(host.loadCardScript(100, workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const action = getDuelLegalActions(session, 0).find((candidate) => candidate.type === "activateEffect");
    expect(action).toBeTruthy();
    const result = applyResponse(session, action!);

    expect(result.ok).toBe(true);
    expect(host.messages).toContain("lua ignition resolved");
    expect(host.messages).toContain("handler code 100");
    expect(host.messages).toContain("handler player 0");
    expect(result.state.log.some((entry) => entry.detail.includes("Lua effect operation resolved"))).toBe(true);
    expect(getDuelLegalActions(session, 0).some((candidate) => candidate.type === "activateEffect")).toBe(false);
  });

});
