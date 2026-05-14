import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
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
const deckProbeTimeoutMs = 30_000;

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
    expect(availableCodes).toHaveLength(35);
    expect(initialResults.filter((result) => result.ok && !result.skipped)).toHaveLength(52);
    expect(initialResults.filter((result) => !result.ok)).toEqual([]);
    expect(actions).toHaveLength(13);
    expect(actions.filter((action) => action.type === "activateEffect")).toHaveLength(1);
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
  }, deckProbeTimeoutMs);

  it("fails strict probes when the legal-action surface is below the required minimum", () => {
    const result = spawnSync(
      "node",
      [
        "--experimental-transform-types",
        "tools/probe-lua-deck.ts",
        "dark-magical-blast-master-duel-day1.ydk",
        "--upstream",
        ".upstream/ignis",
        "--fail-on-errors",
        "--min-actions",
        "999",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Opening hand legal actions:");
    expect(result.stderr).toContain("Lua deck probe failed:");
    expect(result.stderr).toContain("Opening hand legal actions");
    expect(result.stderr).toContain("is below required 999");
  }, deckProbeTimeoutMs);

  it("fails strict probes when the upstream script surface is below the required minimum", () => {
    const result = spawnSync(
      "node",
      [
        "--experimental-transform-types",
        "tools/probe-lua-deck.ts",
        "dark-magical-blast-master-duel-day1.ydk",
        "--upstream",
        ".upstream/ignis",
        "--fail-on-errors",
        "--min-upstream-scripts",
        "999",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Upstream scripts found:");
    expect(result.stderr).toContain("Lua deck probe failed:");
    expect(result.stderr).toContain("Upstream scripts found");
    expect(result.stderr).toContain("is below required 999");
  }, deckProbeTimeoutMs);

  it("fails strict probes when the Lua activate-effect surface is below the required minimum", () => {
    const result = spawnSync(
      "node",
      [
        "--experimental-transform-types",
        "tools/probe-lua-deck.ts",
        "dark-magical-blast-master-duel-day1.ydk",
        "--upstream",
        ".upstream/ignis",
        "--fail-on-errors",
        "--min-activate-effects",
        "999",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("activateEffect:");
    expect(result.stderr).toContain("Lua deck probe failed:");
    expect(result.stderr).toContain("Opening hand activateEffect actions");
    expect(result.stderr).toContain("is below required 999");
  }, deckProbeTimeoutMs);

  it("fails strict probes when the registered effect surface is below required minimums", () => {
    const result = spawnSync(
      "node",
      [
        "--experimental-transform-types",
        "tools/probe-lua-deck.ts",
        "dark-magical-blast-master-duel-day1.ydk",
        "--upstream",
        ".upstream/ignis",
        "--fail-on-errors",
        "--min-initial-effects",
        "999",
        "--min-registered-effects",
        "999",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Registered initial_effect calls:");
    expect(result.stdout).toContain("Registered Lua effects:");
    expect(result.stderr).toContain("Lua deck probe failed:");
    expect(result.stderr).toContain("Registered initial_effect calls");
    expect(result.stderr).toContain("Registered Lua effects");
    expect(result.stderr).toContain("is below required 999");
  }, deckProbeTimeoutMs);

  it("fails strict probes when expected missing script count grows above the allowed maximum", () => {
    const result = spawnSync(
      "node",
      [
        "--experimental-transform-types",
        "tools/probe-lua-deck.ts",
        "dark-magical-blast-master-duel-day1.ydk",
        "--upstream",
        ".upstream/ignis",
        "--fail-on-errors",
        "--max-expected-missing-scripts",
        "1",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Scripts not expected: 2");
    expect(result.stderr).toContain("Lua deck probe failed:");
    expect(result.stderr).toContain("Expected missing script count 2 is above allowed 1");
  }, deckProbeTimeoutMs);

  it("fails strict probes when expected missing script identities change", () => {
    const result = spawnSync(
      "node",
      [
        "--experimental-transform-types",
        "tools/probe-lua-deck.ts",
        "dark-magical-blast-master-duel-day1.ydk",
        "--upstream",
        ".upstream/ignis",
        "--fail-on-errors",
        "--max-expected-missing-scripts",
        "2",
        "--expected-missing-script-code",
        "46986414",
        "--expected-missing-script-code",
        "12345678",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Scripts not expected: 2");
    expect(result.stdout).toContain("Expected no-script codes: 12345678, 46986414");
    expect(result.stderr).toContain("Lua deck probe failed:");
    expect(result.stderr).toContain("Unexpected expected-missing scripts: c74677422.lua");
    expect(result.stderr).toContain("Expected missing script codes were not missing: c12345678.lua");
  }, deckProbeTimeoutMs);

  it("fails strict probes when local fallback script count grows above the allowed maximum", () => {
    const result = spawnSync(
      "node",
      [
        "--experimental-transform-types",
        "tools/probe-lua-deck.ts",
        "onomat-ryzeal-ycs-guatemala-2026.ydk",
        "--upstream",
        ".upstream/ignis",
        "--fail-on-errors",
        "--max-local-fallbacks",
        "0",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Local fallback scripts: 1");
    expect(result.stderr).toContain("Lua deck probe failed:");
    expect(result.stderr).toContain("Local fallback scripts 1 is above allowed 0");
  }, deckProbeTimeoutMs);

  it("accepts strict probes when scripts load and legal actions are present", () => {
    const output = execFileSync(
      "node",
      [
        "--experimental-transform-types",
        "tools/probe-lua-deck.ts",
        "dark-magical-blast-master-duel-day1.ydk",
        "--upstream",
        ".upstream/ignis",
        "--fail-on-errors",
        "--min-upstream-scripts",
        "1",
        "--min-actions",
        "1",
        "--min-activate-effects",
        "1",
        "--min-initial-effects",
        "1",
        "--min-registered-effects",
        "1",
        "--max-local-overrides",
        "0",
        "--max-local-fallbacks",
        "0",
        "--max-expected-missing-scripts",
        "2",
        "--expected-missing-script-code",
        "46986414",
        "--expected-missing-script-code",
        "74677422",
      ],
      { encoding: "utf8" },
    );

    expect(output).toContain("Scripts missing: 0");
    expect(output).toContain("Script load errors: 0");
    expect(output).toContain("Initial effect failures: 0");
    expect(output).toContain("Opening hand legal actions:");
  }, deckProbeTimeoutMs);
});

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Dark Magical Blast Branded Lua deck probe", () => {
  it("loads the TCG Branded variant without helper failures", () => {
    const output = execFileSync(
      "node",
      [
        "--experimental-transform-types",
        "tools/probe-lua-deck.ts",
        "dark-magical-blast-tcg-branded-dm.ydk",
        "--upstream",
        ".upstream/ignis",
      ],
      { encoding: "utf8" },
    );

    expect(output).toContain("Metadata source: cards.cdb");
    expect(output).toContain("Local fallback scripts: 0");
    expect(output).toContain("Scripts missing: 0");
    expect(output).toContain("Scripts not expected: 2");
    expect(output).toContain("NO SCRIPT c46986414.lua");
    expect(output).toContain("NO SCRIPT c74677422.lua");
    expect(output).toContain("Script load errors: 0");
    expect(output).toContain("Initial effect failures: 0");
    expect(output).toContain("First failing API/helper: none detected");
  }, deckProbeTimeoutMs);
});

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Onomat Ryzeal Lua deck probe with local fallbacks", () => {
  it("uses the local Bagooska alias fallback instead of reporting a missing script", () => {
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
    expect(output).toContain("FALLBACK c90590304.lua");
    expect(output).toContain("Local fallback stubs: 0");
    expect(output).toContain("Scripts missing: 0");
    expect(output).toContain("Script load errors: 0");
    expect(output).toContain("Initial effect failures: 0");
  }, deckProbeTimeoutMs);
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
  }, deckProbeTimeoutMs);
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
  }, deckProbeTimeoutMs);
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
  }, deckProbeTimeoutMs);
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
  }, deckProbeTimeoutMs);
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
  }, deckProbeTimeoutMs);
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
  }, deckProbeTimeoutMs);
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
  }, deckProbeTimeoutMs);
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
  }, deckProbeTimeoutMs);
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
  }, deckProbeTimeoutMs);
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
  }, deckProbeTimeoutMs);
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
  }, deckProbeTimeoutMs);
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
  }, deckProbeTimeoutMs);
});

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Phantom Knights Lua deck probe", () => {
  it("uses upstream pre-release scripts for graveyard and Rank-Up coverage", () => {
    const output = execFileSync(
      "node",
      ["--experimental-transform-types", "tools/probe-lua-deck.ts", "phantom-knights-mar-2026-v4.ydk", "--upstream", ".upstream/ignis"],
      { encoding: "utf8" },
    );

    expect(output).toContain("Metadata source: cards.cdb");
    expect(output).toContain("Local fallback scripts: 1");
    expect(output).toContain("FALLBACK c100452015.lua");
    expect(output).toContain("OK c101305018.lua -> script/pre-release/c101305018.lua");
    expect(output).toContain("OK c101305019.lua -> script/pre-release/c101305019.lua");
    expect(output).toContain("OK c101305037.lua -> script/pre-release/c101305037.lua");
    expect(output).toContain("OK c101305057.lua -> script/pre-release/c101305057.lua");
    expect(output).toContain("OK c101305073.lua -> script/pre-release/c101305073.lua");
    expect(output).toContain("Local fallback stubs: 0");
    expect(output).toContain("Scripts missing: 0");
    expect(output).toContain("Script load errors: 0");
    expect(output).toContain("Initial effect failures: 0");
    expect(output).toContain("First failing API/helper: none detected");
  }, deckProbeTimeoutMs);
});

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Kashtira Lua deck probe", () => {
  it("loads banish-control scripts without helper failures", () => {
    const output = execFileSync(
      "node",
      ["--experimental-transform-types", "tools/probe-lua-deck.ts", "kashtira-2026.ydk", "--upstream", ".upstream/ignis"],
      { encoding: "utf8" },
    );

    expect(output).toContain("Metadata source: cards.cdb");
    expect(output).toContain("Local fallback scripts: 0");
    expect(output).toContain("Scripts missing: 0");
    expect(output).toContain("Script load errors: 0");
    expect(output).toContain("Initial effect failures: 0");
    expect(output).toContain("First failing API/helper: none detected");
  }, deckProbeTimeoutMs);
});

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Mikanko Lua deck probe", () => {
  it("registers equip and Kaiju-style summon procedure scripts", () => {
    const output = execFileSync(
      "node",
      ["--experimental-transform-types", "tools/probe-lua-deck.ts", "mikanko-2026.ydk", "--upstream", ".upstream/ignis"],
      { encoding: "utf8" },
    );

    expect(output).toContain("Metadata source: cards.cdb");
    expect(output).toContain("Local fallback scripts: 1");
    expect(output).toContain("FALLBACK c18144507.lua");
    expect(output).toContain("Local fallback stubs: 0");
    expect(output).toContain("Scripts missing: 0");
    expect(output).toContain("Script load errors: 0");
    expect(output).toContain("Initial effect failures: 0");
    expect(output).toContain("First failing API/helper: none detected");
  }, deckProbeTimeoutMs);
});

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Rikka Sunavalon Lua deck probe", () => {
  it("loads plant resource scripts while preserving expected vanilla no-script cards", () => {
    const output = execFileSync(
      "node",
      ["--experimental-transform-types", "tools/probe-lua-deck.ts", "rikka-sunavalon-2026.ydk", "--upstream", ".upstream/ignis"],
      { encoding: "utf8" },
    );

    expect(output).toContain("Metadata source: cards.cdb");
    expect(output).toContain("Local fallback scripts: 0");
    expect(output).toContain("Scripts missing: 0");
    expect(output).toContain("Scripts not expected: 1");
    expect(output).toContain("NO SCRIPT c27520594.lua");
    expect(output).toContain("Script load errors: 0");
    expect(output).toContain("Initial effect failures: 0");
    expect(output).toContain("First failing API/helper: none detected");
  }, deckProbeTimeoutMs);
});

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Ancient Gear Lua deck probe", () => {
  it("loads legacy Fusion/procedure scripts with alternate-art fallbacks", () => {
    const output = execFileSync(
      "node",
      [
        "--experimental-transform-types",
        "tools/probe-lua-deck.ts",
        "ancient-gear-legend-anthology-2026.ydk",
        "--upstream",
        ".upstream/ignis",
      ],
      { encoding: "utf8" },
    );

    expect(output).toContain("Metadata source: cards.cdb");
    expect(output).toContain("Local fallback scripts: 1");
    expect(output).toContain("FALLBACK c18144507.lua");
    expect(output).toContain("Local fallback stubs: 0");
    expect(output).toContain("Scripts missing: 0");
    expect(output).toContain("Script load errors: 0");
    expect(output).toContain("Initial effect failures: 0");
    expect(output).toContain("First failing API/helper: none detected");
  }, deckProbeTimeoutMs);
});

function createProbeCards(main: string[], extra: string[]): DuelCardData[] {
  const extraCodes = new Set(extra);
  return Array.from(new Set([...main, ...extra])).map((code) => ({
    code,
    name: `Card ${code}`,
    kind: extraCodes.has(code) ? "extra" : "monster",
  }));
}
