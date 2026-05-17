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

describe("Lua deck probe CLI", () => {
  it("rejects malformed probe options before loading a deck", () => {
    const cases = [
      ["--unknown"],
      ["dark-magical-blast-master-duel-day1.ydk", "--unknown"],
      ["dark-magical-blast-master-duel-day1.ydk", "--min-actions"],
      ["dark-magical-blast-master-duel-day1.ydk", "--min-actions", "-1"],
      ["dark-magical-blast-master-duel-day1.ydk", "--max-local-alias-fallbacks"],
      ["dark-magical-blast-master-duel-day1.ydk", "--max-local-provisional-fallbacks", "-1"],
      ["dark-magical-blast-master-duel-day1.ydk", "--max-local-other-fallbacks", "abc"],
      ["dark-magical-blast-master-duel-day1.ydk", "--expected-local-fallback-script-code"],
      ["dark-magical-blast-master-duel-day1.ydk", "--expected-local-fallback-script-code", "abc"],
      ["dark-magical-blast-master-duel-day1.ydk", "--expected-missing-script-code"],
      ["dark-magical-blast-master-duel-day1.ydk", "--expected-missing-script-code", "abc"],
    ];

    for (const args of cases) {
      const result = spawnSync("node", ["--experimental-transform-types", "tools/probe-lua-deck.ts", ...args], { encoding: "utf8" });

      expect(result.status, args.join(" ")).toBe(1);
      expect(result.stderr).toContain("Usage: bun run probe:lua-deck");
    }
  });
});

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
  it("classifies vanilla normal monsters as scriptless instead of missing", () => {
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
    expect(output).toContain("Scriptless Normal Monsters: 2");
    expect(output).toContain("NORMAL c46986414.lua");
    expect(output).toContain("NORMAL c74677422.lua");
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

  it("keeps scriptless Normal Monsters out of the strict missing-script budget", () => {
    const output = execFileSync(
      "node",
      [
        "--experimental-transform-types",
        "tools/probe-lua-deck.ts",
        "dark-magical-blast-master-duel-day1.ydk",
        "--upstream",
        ".upstream/ignis",
        "--fail-on-errors",
        "--max-expected-missing-scripts",
        "0",
      ],
      { encoding: "utf8" },
    );

    expect(output).toContain("Scripts missing: 0");
    expect(output).toContain("Scriptless Normal Monsters: 2");
  }, deckProbeTimeoutMs);

  it("fails strict probes when expected missing script identities are stale", () => {
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
        "0",
        "--expected-missing-script-code",
        "12345678",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Scripts missing: 0");
    expect(result.stdout).toContain("Expected missing script codes: 12345678");
    expect(result.stderr).toContain("Lua deck probe failed:");
    expect(result.stderr).toContain("Expected missing script codes were not missing: c12345678.lua");
  }, deckProbeTimeoutMs);

  it("fails strict probes when local fallback script count grows above the allowed maximum", () => {
    const result = spawnSync(
      "node",
      [
        "--experimental-transform-types",
        "tools/probe-lua-deck.ts",
        "phantom-knights-mar-2026-v4.ydk",
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

  it("fails strict probes when local fallback script identities change", () => {
    const result = spawnSync(
      "node",
      [
        "--experimental-transform-types",
        "tools/probe-lua-deck.ts",
        "phantom-knights-mar-2026-v4.ydk",
        "--upstream",
        ".upstream/ignis",
        "--fail-on-errors",
        "--max-local-fallbacks",
        "1",
        "--expected-local-fallback-script-code",
        "12345678",
      ],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Local fallback scripts: 1");
    expect(result.stdout).toContain("Expected local fallback codes: 12345678");
    expect(result.stderr).toContain("Lua deck probe failed:");
    expect(result.stderr).toContain("Unexpected local fallback scripts: c100452015.lua");
    expect(result.stderr).toContain("Expected local fallback script codes were not used: c12345678.lua");
  }, deckProbeTimeoutMs);

  it("fails strict probes when local fallback kind budgets are exceeded", () => {
    const aliasResult = spawnSync(
      "node",
      [
        "--experimental-transform-types",
        "tools/probe-lua-deck.ts",
        "phantom-knights-mar-2026-v4.ydk",
        "--upstream",
        ".upstream/ignis",
        "--fail-on-errors",
        "--max-local-fallbacks",
        "1",
        "--max-local-alias-fallbacks",
        "0",
        "--expected-local-fallback-script-code",
        "100452015",
      ],
      { encoding: "utf8" },
    );
    const provisionalResult = spawnSync(
      "node",
      [
        "--experimental-transform-types",
        "tools/probe-lua-deck.ts",
        "ritual-of-light-and-darkness-apr-2026.ydk",
        "--upstream",
        ".upstream/ignis",
        "--fail-on-errors",
        "--max-local-fallbacks",
        "10",
        "--max-local-provisional-fallbacks",
        "9",
        "--expected-local-fallback-script-code",
        "98684220",
        "--expected-local-fallback-script-code",
        "24088928",
        "--expected-local-fallback-script-code",
        "50073633",
        "--expected-local-fallback-script-code",
        "97462632",
        "--expected-local-fallback-script-code",
        "70405001",
        "--expected-local-fallback-script-code",
        "44001993",
        "--expected-local-fallback-script-code",
        "24461358",
        "--expected-local-fallback-script-code",
        "2372506",
        "--expected-local-fallback-script-code",
        "33599853",
        "--expected-local-fallback-script-code",
        "24749710",
      ],
      { encoding: "utf8" },
    );

    expect(aliasResult.status).toBe(1);
    expect(aliasResult.stdout).toContain("Local alias fallback scripts: 1");
    expect(aliasResult.stderr).toContain("Local alias fallback scripts 1 is above allowed 0");
    expect(provisionalResult.status).toBe(1);
    expect(provisionalResult.stdout).toContain("Local provisional fallback scripts: 10");
    expect(provisionalResult.stderr).toContain("Local provisional fallback scripts 10 is above allowed 9");
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
        "0",
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
    expect(output).toContain("Scriptless Normal Monsters: 2");
    expect(output).toContain("NORMAL c46986414.lua");
    expect(output).toContain("NORMAL c74677422.lua");
    expect(output).toContain("Script load errors: 0");
    expect(output).toContain("Initial effect failures: 0");
    expect(output).toContain("First failing API/helper: none detected");
  }, deckProbeTimeoutMs);
});

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Onomat Ryzeal Lua deck probe", () => {
  it("uses the CDB Bagooska alias instead of local fallback coverage", () => {
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
    expect(output).toContain("Local fallback scripts: 0");
    expect(output).toContain("OK c90590304.lua -> script/official/c90590303.lua");
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
    expect(output).toContain("Local alias fallback scripts: 1");
    expect(output).toContain("Local provisional fallback scripts: 0");
    expect(output).toContain("Local other fallback scripts: 0");
    expect(output).toContain("FALLBACK c100452013.lua");
    expect(output).toContain("Local fallback stubs: 0");
    expect(output).toContain("Scripts missing: 0");
    expect(output).toContain("Script load errors: 0");
    expect(output).toContain("Initial effect failures: 0");
    expect(output).toContain("First failing API/helper: none detected");
  }, deckProbeTimeoutMs);
});

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Ritual of Light and Darkness Lua deck probe", () => {
  it("keeps scriptless normals separate from helper compatibility failures", () => {
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
    expect(output).toContain("Local alias fallback scripts: 0");
    expect(output).toContain("Local provisional fallback scripts: 10");
    expect(output).toContain("Local other fallback scripts: 0");
    expect(output).toContain("Local fallback stubs: 0");
    expect(output).toContain("Scripts missing: 0");
    expect(output).toContain("Scriptless Normal Monsters: 1");
    expect(output).toContain("NORMAL c46986414.lua");
    expect(output).toContain("Script load errors: 0");
    expect(output).toContain("Initial effect failures: 0");
    expect(output).toContain("First failing API/helper: none detected");
  }, deckProbeTimeoutMs);
});

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Branded Dracotail Lua deck probe", () => {
  it("uses CDB alternate-art aliases without helper failures", () => {
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
    expect(output).toContain("Local fallback scripts: 0");
    expect(output).toContain("OK c14558128.lua -> script/official/c14558127.lua");
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
    expect(output).toContain("Scriptless Normal Monsters: 1");
    expect(output).toContain("NORMAL c89943723.lua");
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
    expect(output).toContain("Local alias fallback scripts: 1");
    expect(output).toContain("Local provisional fallback scripts: 0");
    expect(output).toContain("Local other fallback scripts: 0");
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
  it("uses CDB alternate-art aliases for non-Magician Pendulum coverage", () => {
    const output = execFileSync(
      "node",
      ["--experimental-transform-types", "tools/probe-lua-deck.ts", "solfachord-2026.ydk", "--upstream", ".upstream/ignis"],
      { encoding: "utf8" },
    );

    expect(output).toContain("Metadata source: cards.cdb");
    expect(output).toContain("Local fallback scripts: 0");
    expect(output).toContain("OK c14558128.lua -> script/official/c14558127.lua");
    expect(output).toContain("OK c65741787.lua -> script/official/c65741786.lua");
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
    expect(output).toContain("Local alias fallback scripts: 1");
    expect(output).toContain("Local provisional fallback scripts: 0");
    expect(output).toContain("Local other fallback scripts: 0");
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
    expect(output).toContain("Local fallback scripts: 0");
    expect(output).toContain("OK c18144507.lua -> script/official/c18144506.lua");
    expect(output).toContain("Local fallback stubs: 0");
    expect(output).toContain("Scripts missing: 0");
    expect(output).toContain("Script load errors: 0");
    expect(output).toContain("Initial effect failures: 0");
    expect(output).toContain("First failing API/helper: none detected");
  }, deckProbeTimeoutMs);
});

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Rikka Sunavalon Lua deck probe", () => {
  it("loads plant resource scripts while reporting vanilla no-script cards separately", () => {
    const output = execFileSync(
      "node",
      ["--experimental-transform-types", "tools/probe-lua-deck.ts", "rikka-sunavalon-2026.ydk", "--upstream", ".upstream/ignis"],
      { encoding: "utf8" },
    );

    expect(output).toContain("Metadata source: cards.cdb");
    expect(output).toContain("Local fallback scripts: 0");
    expect(output).toContain("Scripts missing: 0");
    expect(output).toContain("Scriptless Normal Monsters: 1");
    expect(output).toContain("NORMAL c27520594.lua");
    expect(output).toContain("Script load errors: 0");
    expect(output).toContain("Initial effect failures: 0");
    expect(output).toContain("First failing API/helper: none detected");
  }, deckProbeTimeoutMs);
});

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Ancient Gear Lua deck probe", () => {
  it("loads legacy Fusion/procedure scripts with CDB alternate-art aliases", () => {
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
    expect(output).toContain("Local fallback scripts: 0");
    expect(output).toContain("OK c18144507.lua -> script/official/c18144506.lua");
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
