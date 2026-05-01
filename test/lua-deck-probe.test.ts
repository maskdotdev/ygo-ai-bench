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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Onomat Ryzeal Lua deck probe with local fallbacks", () => {
  it("uses the local Bagooska fallback stub instead of reporting a missing script", () => {
    const output = execFileSync(
      "node",
      [
        "--experimental-transform-types",
        "tools/probe-lua-deck.ts",
        "onomat-ryzeal-ycs-guatemala-2026.ydk",
        "--upstream",
        ".upstream/ignis",
      ],
      { encoding: "utf8" },
    );

    expect(output).toContain("Metadata source: cards.cdb");
    expect(output).toContain("Local fallback scripts: 1");
    expect(output).toContain("STUB c90590304.lua");
    expect(output).toContain("Local fallback stubs: 1");
    expect(output).toContain("Scripts missing: 0");
    expect(output).toContain("Script load errors: 0");
    expect(output).toContain("Initial effect failures: 0");
  });
});

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Magician Pendulum Lua deck probe", () => {
  it("registers available Pendulum scripts without helper failures", () => {
    const output = execFileSync(
      "node",
      [
        "--experimental-transform-types",
        "tools/probe-lua-deck.ts",
        "magician-pendulum-mar-2026.ydk",
        "--upstream",
        ".upstream/ignis",
      ],
      { encoding: "utf8" },
    );

    expect(output).toContain("Metadata source: cards.cdb");
    expect(output).toContain("Local fallback scripts: 1");
    expect(output).toContain("FALLBACK c100452013.lua");
    expect(output).toContain("Local fallback stubs: 0");
    expect(output).toContain("Scripts missing: 0");
    expect(output).toContain("Script load errors: 0");
    expect(output).toContain("Initial effect failures: 0");
    expect(output).toContain("First failing API/helper: none detected");
  });
});

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Ritual of Light and Darkness Lua deck probe", () => {
  it("keeps missing new-card scripts separate from helper compatibility failures", () => {
    const output = execFileSync(
      "node",
      [
        "--experimental-transform-types",
        "tools/probe-lua-deck.ts",
        "ritual-of-light-and-darkness-apr-2026.ydk",
        "--upstream",
        ".upstream/ignis",
      ],
      { encoding: "utf8" },
    );

    expect(output).toContain("Metadata source: cards.cdb");
    expect(output).toContain("Local fallback scripts: 10");
    expect(output).toContain("Local fallback stubs: 0");
    expect(output).toContain("Scripts missing: 0");
    expect(output).toContain("Scripts not expected: 1");
    expect(output).toContain("NO SCRIPT c46986414.lua");
    expect(output).toContain("Script load errors: 0");
    expect(output).toContain("Initial effect failures: 0");
    expect(output).toContain("First failing API/helper: none detected");
  });
});

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Branded Dracotail Lua deck probe", () => {
  it("uses local alternate-art fallbacks without helper failures", () => {
    const output = execFileSync(
      "node",
      [
        "--experimental-transform-types",
        "tools/probe-lua-deck.ts",
        "branded-dracotail-ycs-guatemala-2026.ydk",
        "--upstream",
        ".upstream/ignis",
      ],
      { encoding: "utf8" },
    );

    expect(output).toContain("Metadata source: cards.cdb");
    expect(output).toContain("Local fallback scripts: 1");
    expect(output).toContain("FALLBACK c14558128.lua");
    expect(output).toContain("Local fallback stubs: 0");
    expect(output).toContain("Scripts missing: 0");
    expect(output).toContain("Script load errors: 0");
    expect(output).toContain("Initial effect failures: 0");
    expect(output).toContain("First failing API/helper: none detected");
  });
});

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Monarch Genesys Proto Lua deck probe", () => {
  it("loads current Monarch scripts without fallback coverage", () => {
    const output = execFileSync(
      "node",
      [
        "--experimental-transform-types",
        "tools/probe-lua-deck.ts",
        "monarch-genesys-proto-ycs-dortmund-2026.ydk",
        "--upstream",
        ".upstream/ignis",
      ],
      { encoding: "utf8" },
    );

    expect(output).toContain("Metadata source: cards.cdb");
    expect(output).toContain("Local fallback scripts: 0");
    expect(output).toContain("Scripts missing: 0");
    expect(output).toContain("Script load errors: 0");
    expect(output).toContain("Initial effect failures: 0");
    expect(output).toContain("First failing API/helper: none detected");
  });
});

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Kewl Tune Lua deck probe", () => {
  it("registers Synchro hand-material scripts without helper failures", () => {
    const output = execFileSync(
      "node",
      [
        "--experimental-transform-types",
        "tools/probe-lua-deck.ts",
        "kewl-tune-may-2026.ydk",
        "--upstream",
        ".upstream/ignis",
      ],
      { encoding: "utf8" },
    );

    expect(output).toContain("Metadata source: cards.cdb");
    expect(output).toContain("Local fallback scripts: 0");
    expect(output).toContain("Scripts missing: 0");
    expect(output).toContain("Script load errors: 0");
    expect(output).toContain("Initial effect failures: 0");
    expect(output).toContain("First failing API/helper: none detected");
  });
});

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("HERO Competitive Lua deck probe", () => {
  it("registers Fusion spell/procedure scripts without helper failures", () => {
    const output = execFileSync(
      "node",
      [
        "--experimental-transform-types",
        "tools/probe-lua-deck.ts",
        "hero-competitive-may-2026.ydk",
        "--upstream",
        ".upstream/ignis",
      ],
      { encoding: "utf8" },
    );

    expect(output).toContain("Metadata source: cards.cdb");
    expect(output).toContain("Local fallback scripts: 0");
    expect(output).toContain("Scripts missing: 0");
    expect(output).toContain("Scripts not expected: 1");
    expect(output).toContain("NO SCRIPT c89943723.lua");
    expect(output).toContain("Script load errors: 0");
    expect(output).toContain("Initial effect failures: 0");
    expect(output).toContain("First failing API/helper: none detected");
  });
});

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Rokket Lua deck probe", () => {
  it("uses the local Storm-Bane fallback without chain-condition crashes", () => {
    const output = execFileSync(
      "node",
      [
        "--experimental-transform-types",
        "tools/probe-lua-deck.ts",
        "rokket-2026.ydk",
        "--upstream",
        ".upstream/ignis",
      ],
      { encoding: "utf8" },
    );

    expect(output).toContain("Metadata source: cards.cdb");
    expect(output).toContain("Local fallback scripts: 1");
    expect(output).toContain("FALLBACK c101303089.lua");
    expect(output).toContain("Local fallback stubs: 0");
    expect(output).toContain("Scripts missing: 0");
    expect(output).toContain("Script load errors: 0");
    expect(output).toContain("Initial effect failures: 0");
    expect(output).toContain("First failing API/helper: none detected");
  });
});

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Labrynth Lua deck probe", () => {
  it("loads trap-control scripts without helper failures", () => {
    const output = execFileSync(
      "node",
      ["--experimental-transform-types", "tools/probe-lua-deck.ts", "labrynth-2026.ydk", "--upstream", ".upstream/ignis"],
      { encoding: "utf8" },
    );

    expect(output).toContain("Metadata source: cards.cdb");
    expect(output).toContain("Local fallback scripts: 0");
    expect(output).toContain("Scripts missing: 0");
    expect(output).toContain("Script load errors: 0");
    expect(output).toContain("Initial effect failures: 0");
    expect(output).toContain("First failing API/helper: none detected");
  });
});

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Voiceless Voice Lua deck probe", () => {
  it("registers Ritual procedure scripts without helper failures", () => {
    const output = execFileSync(
      "node",
      ["--experimental-transform-types", "tools/probe-lua-deck.ts", "voiceless-voice-2026.ydk", "--upstream", ".upstream/ignis"],
      { encoding: "utf8" },
    );

    expect(output).toContain("Metadata source: cards.cdb");
    expect(output).toContain("Local fallback scripts: 0");
    expect(output).toContain("Scripts missing: 0");
    expect(output).toContain("Script load errors: 0");
    expect(output).toContain("Initial effect failures: 0");
    expect(output).toContain("First failing API/helper: none detected");
  });
});

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Marincess Lua deck probe", () => {
  it("loads Link-heavy scripts without helper failures", () => {
    const output = execFileSync(
      "node",
      ["--experimental-transform-types", "tools/probe-lua-deck.ts", "marincess-2026.ydk", "--upstream", ".upstream/ignis"],
      { encoding: "utf8" },
    );

    expect(output).toContain("Metadata source: cards.cdb");
    expect(output).toContain("Local fallback scripts: 0");
    expect(output).toContain("Scripts missing: 0");
    expect(output).toContain("Script load errors: 0");
    expect(output).toContain("Initial effect failures: 0");
    expect(output).toContain("First failing API/helper: none detected");
  });
});

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Exosister Lua deck probe", () => {
  it("registers Xyz and Spirit-adjacent scripts without helper failures", () => {
    const output = execFileSync(
      "node",
      ["--experimental-transform-types", "tools/probe-lua-deck.ts", "exosister-ots-mar-2026.ydk", "--upstream", ".upstream/ignis"],
      { encoding: "utf8" },
    );

    expect(output).toContain("Metadata source: cards.cdb");
    expect(output).toContain("Local fallback scripts: 0");
    expect(output).toContain("Scripts missing: 0");
    expect(output).toContain("Script load errors: 0");
    expect(output).toContain("Initial effect failures: 0");
    expect(output).toContain("First failing API/helper: none detected");
  });
});

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Solfachord Lua deck probe", () => {
  it("uses alternate-art fallbacks for non-Magician Pendulum coverage", () => {
    const output = execFileSync(
      "node",
      ["--experimental-transform-types", "tools/probe-lua-deck.ts", "solfachord-2026.ydk", "--upstream", ".upstream/ignis"],
      { encoding: "utf8" },
    );

    expect(output).toContain("Metadata source: cards.cdb");
    expect(output).toContain("Local fallback scripts: 2");
    expect(output).toContain("FALLBACK c14558128.lua");
    expect(output).toContain("FALLBACK c65741787.lua");
    expect(output).toContain("Local fallback stubs: 0");
    expect(output).toContain("Scripts missing: 0");
    expect(output).toContain("Script load errors: 0");
    expect(output).toContain("Initial effect failures: 0");
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
