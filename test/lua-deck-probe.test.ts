import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createDuel, getLegalActions, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import type { DuelCardData } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";
import { parseYdk } from "#playtest/ydk.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts)("Dark Magical Blast Lua deck probe", () => {
  it("loads available scripts and exposes opening hand Lua actions", () => {
    const deck = parseYdk(fs.readFileSync("dark-magical-blast-master-duel-day1.ydk", "utf8"));
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const codes = Array.from(new Set([...deck.main, ...deck.extra]));
    const availableCodes = codes.filter((code) => workspace.readScript(`c${code}.lua`) !== undefined);
    const cards = createProbeCards(deck.main, deck.extra);
    const session = createDuel({ seed: 1, startingHandSize: 5, cardReader: createCardReader(cards) });

    loadDecks(session, {
      0: { main: deck.main, extra: deck.extra },
      1: { main: [], extra: [] },
    });
    startDuel(session);

    const host = createLuaScriptHost(session, workspace);
    const loadResults = availableCodes.map((code) => host.loadCardScript(code, workspace));
    const initialResults = host.registerInitialEffectsDetailed();
    const actions = getLegalActions(session, 0);

    expect(loadResults.every((result) => result.ok), loadResults.find((result) => !result.ok)?.error).toBe(true);
    expect(initialResults.filter((result) => result.ok && !result.skipped).length).toBeGreaterThanOrEqual(45);
    expect(initialResults.filter((result) => !result.ok)).toEqual([]);
    expect(actions.length).toBeGreaterThanOrEqual(10);
    expect(actions.filter((action) => action.type === "activateEffect").length).toBeLessThanOrEqual(5);
  });
});

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Dark Magical Blast Lua deck probe with CDB metadata", () => {
  it("classifies missing vanilla normal monster scripts as expected", () => {
    const output = execFileSync(
      "node",
      [
        "--experimental-transform-types",
        "tools/probe-lua-deck.ts",
        "dark-magical-blast-master-duel-day1.ydk",
        "--upstream",
        ".upstream/ignis",
      ],
      { encoding: "utf8" },
    );

    expect(output).toContain("Metadata source: cards.cdb");
    expect(output).toContain("Scripts missing: 0");
    expect(output).toContain("Scripts not expected: 2");
    expect(output).toContain("NO SCRIPT c46986414.lua");
    expect(output).toContain("NO SCRIPT c74677422.lua");
    expect(output).toContain("Script load errors: 0");
    expect(output).toContain("First failing API/helper: none detected");
  });
});

function createProbeCards(main: string[], extra: string[]): DuelCardData[] {
  const extraCodes = new Set(extra);
  return Array.from(new Set([...main, ...extra])).map((code) => ({
    code,
    name: `Card ${code}`,
    kind: extraCodes.has(code) ? "extra" : "monster",
  }));
}
