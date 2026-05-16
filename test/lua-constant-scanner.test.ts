import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const scannerPath = path.resolve("tools/scan-lua-constants.mjs");
const parityScannerPath = path.resolve("tools/scan-lua-parity.mjs");
const expectedLocalFallbackConstants = [
  "CATEGORY_DRAW",
  "CATEGORY_HANDES",
  "CATEGORY_REMOVE",
  "CATEGORY_SEARCH",
  "CATEGORY_SPECIAL_SUMMON",
  "CATEGORY_TODECK",
  "CATEGORY_TOGRAVE",
  "CATEGORY_TOHAND",
  "EFFECT_AVOID_BATTLE_DAMAGE",
  "EFFECT_COUNT_CODE_OATH",
  "EFFECT_EXTRA_ATTACK",
  "EFFECT_FLAG_CARD_TARGET",
  "EFFECT_FLAG_DAMAGE_CAL",
  "EFFECT_FLAG_DAMAGE_STEP",
  "EFFECT_FLAG_DELAY",
  "EFFECT_FLAG_UNCOPYABLE",
  "EFFECT_INDESTRUCTABLE_BATTLE",
  "EFFECT_RITUAL_LEVEL",
  "EFFECT_SPSUMMON_PROC",
  "EFFECT_TYPE_ACTIVATE",
  "EFFECT_TYPE_FIELD",
  "EFFECT_TYPE_IGNITION",
  "EFFECT_TYPE_QUICK_O",
  "EFFECT_TYPE_SINGLE",
  "EFFECT_TYPE_TRIGGER_O",
  "EVENT_BATTLE_DESTROYING",
  "EVENT_CHAINING",
  "EVENT_FREE_CHAIN",
  "EVENT_LEAVE_FIELD",
  "EVENT_SPSUMMON_SUCCESS",
  "EVENT_SUMMON_SUCCESS",
  "EVENT_TO_GRAVE",
  "HINTMSG_ATOHAND",
  "HINTMSG_POSCHANGE",
  "HINTMSG_RELEASE",
  "HINTMSG_RTOHAND",
  "HINTMSG_SET",
  "HINTMSG_SPSUMMON",
  "HINTMSG_TODECK",
  "HINTMSG_TOFIELD",
  "HINTMSG_TOGRAVE",
  "HINT_SELECTMSG",
  "LOCATION_DECK",
  "LOCATION_GRAVE",
  "LOCATION_HAND",
  "LOCATION_MZONE",
  "LOCATION_ONFIELD",
  "LOCATION_REMOVED",
  "LOCATION_SZONE",
  "PHASE_DAMAGE",
  "PHASE_END",
  "PLAYER_ALL",
  "POS_FACEDOWN_DEFENSE",
  "POS_FACEUP",
  "POS_FACEUP_ATTACK",
  "RACE_SPELLCASTER",
  "RACE_WARRIOR",
  "REASON_COST",
  "REASON_DISCARD",
  "REASON_EFFECT",
  "RESET_PHASE",
  "SEQ_DECKBOTTOM",
  "SEQ_DECKSHUFFLE",
  "SUMMON_TYPE_RITUAL",
  "TYPE_RITUAL",
  "TYPE_SPELL",
  "TYPE_TRAP",
];

describe("Lua constant scanner", () => {
  it("reports missing upstream constants against local constant data files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lua-constant-scan-"));
    const upstream = path.join(root, "constant.lua");
    const source = path.join(root, "source");
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(
      upstream,
      `
      FOO_CONSTANT = 1
      BAR_CONSTANT = FOO_CONSTANT|2
      -- COMMENTED_CONSTANT = 3
      `,
    );
    fs.writeFileSync(
      path.join(source, "basic-test-constant-data.ts"),
      `
      export const constants = {
        FOO_CONSTANT: 1,
      };
      `,
    );

    const result = spawnSync(process.execPath, [scannerPath, "--upstream", upstream, "--source", source, "--fail-on-missing"], { encoding: "utf8" });

    expect(result.status).toBe(2);
    expect(result.stdout).toContain("Missing constants:");
    expect(result.stdout).toContain("BAR_CONSTANT");
    expect(result.stdout).not.toContain("COMMENTED_CONSTANT");
  });

  it("passes when all upstream constants are present locally", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lua-constant-scan-"));
    const upstream = path.join(root, "constant.lua");
    const source = path.join(root, "source");
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(upstream, "FOO_CONSTANT = 1\nBAR_CONSTANT = 2\n");
    fs.writeFileSync(path.join(source, "basic-test-constant-data.ts"), "export const constants = { FOO_CONSTANT: 1, BAR_CONSTANT: 2 };\n");

    const output = execFileSync(process.execPath, [scannerPath, "--upstream", upstream, "--source", source, "--fail-on-missing"], { encoding: "utf8" });

    expect(output).toContain("No missing constants found.");
  });

  it("can scan multiple upstream constant files", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lua-constant-scan-"));
    const upstream = path.join(root, "constant.lua");
    const archetypes = path.join(root, "archetype_setcode_constants.lua");
    const source = path.join(root, "source");
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(upstream, "REASON_EFFECT = 0x40\n");
    fs.writeFileSync(archetypes, "SET_FIXTURE = 0x123\nSET_TABLE_FIXTURE = {1,2}\nSET_MISSING_FIXTURE = 0x456\n");
    fs.writeFileSync(path.join(source, "basic-test-constant-data.ts"), "export const constants = { REASON_EFFECT: 0x40, SET_FIXTURE: 0x123 };\n");

    const result = spawnSync(process.execPath, [
      scannerPath,
      "--upstream",
      upstream,
      "--upstream",
      archetypes,
      "--source",
      source,
      "--fail-on-missing",
    ], { encoding: "utf8" });

    expect(result.status).toBe(2);
    expect(result.stdout).toContain("Missing constants:");
    expect(result.stdout).toContain("SET_MISSING_FIXTURE");
    expect(result.stdout).not.toContain("SET_TABLE_FIXTURE");
  });

  it("keeps local Project Ignis constant names aligned with upstream scalar constant files", () => {
    for (const upstream of [".upstream/ignis/script/constant.lua", ".upstream/ignis/script/archetype_setcode_constants.lua", ".upstream/ignis/script/card_counter_constants.lua"]) {
      if (!fs.existsSync(upstream)) return;
    }

    const output = execFileSync(process.execPath, [scannerPath, "--fail-on-missing"], { encoding: "utf8" });

    expect(output).toContain("No missing constants found.");
  });

  it("keeps local fallback script constants aligned with local Lua constants", () => {
    const usedConstants = localFallbackLuaConstants();
    const localConstants = localLuaConstants();
    const missing = usedConstants.filter((name) => !localConstants.includes(name));

    expect(usedConstants).toEqual(expectedLocalFallbackConstants);
    expect(missing).toEqual([]);
  });

  it("runs combined Lua parity scans while keeping API-only limits off the constant scanner", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lua-parity-scan-"));
    const scripts = path.join(root, "script");
    const source = path.join(root, "source");
    const upstream = path.join(root, "constant.lua");
    fs.mkdirSync(path.join(source, "duel-api"), { recursive: true });
    fs.mkdirSync(scripts, { recursive: true });
    fs.writeFileSync(path.join(scripts, "c100.lua"), "Duel.Draw(0,1,REASON_EFFECT)\n");
    fs.writeFileSync(path.join(source, "duel-api", "deck.ts"), `lua.lua_setfield(L, -2, to_luastring("Draw"));\n`);
    fs.writeFileSync(path.join(source, "basic-test-constant-data.ts"), "export const constants = { REASON_EFFECT: 0x40 };\n");
    fs.writeFileSync(upstream, "REASON_EFFECT = 0x40\n");

    const output = execFileSync(process.execPath, [
      parityScannerPath,
      "--scripts",
      scripts,
      "--upstream",
      upstream,
      "--source",
      source,
      "--limit",
      "1",
      "--fail-on-missing",
    ], { encoding: "utf8" });

    expect(output).toContain("No missing API usages found.");
    expect(output).toContain("No missing constants found.");
  });

  it("fails combined Lua parity scans when API corpus floors are not met", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lua-parity-scan-"));
    const scripts = path.join(root, "script");
    const source = path.join(root, "source");
    const upstream = path.join(root, "constant.lua");
    fs.mkdirSync(path.join(source, "duel-api"), { recursive: true });
    fs.mkdirSync(scripts, { recursive: true });
    fs.writeFileSync(path.join(scripts, "c100.lua"), "Duel.Draw(0,1,REASON_EFFECT)\n");
    fs.writeFileSync(path.join(source, "duel-api", "deck.ts"), `lua.lua_setfield(L, -2, to_luastring("Draw"));\n`);
    fs.writeFileSync(path.join(source, "basic-test-constant-data.ts"), "export const constants = { REASON_EFFECT: 0x40 };\n");
    fs.writeFileSync(upstream, "REASON_EFFECT = 0x40\n");

    const result = spawnSync(process.execPath, [
      parityScannerPath,
      "--scripts",
      scripts,
      "--upstream",
      upstream,
      "--source",
      source,
      "--min-used-apis",
      "2",
      "--min-implemented-apis",
      "2",
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("used APIs: 1");
    expect(result.stdout).toContain("implemented APIs found: 1");
    expect(result.stderr).toContain("Used APIs 1 is below required 2");
    expect(result.stderr).toContain("Implemented APIs 1 is below required 2");
  });

  it("fails combined Lua parity scans when constant corpus floors are not met", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lua-parity-scan-"));
    const scripts = path.join(root, "script");
    const source = path.join(root, "source");
    const upstream = path.join(root, "constant.lua");
    fs.mkdirSync(path.join(source, "duel-api"), { recursive: true });
    fs.mkdirSync(scripts, { recursive: true });
    fs.writeFileSync(path.join(scripts, "c100.lua"), "Duel.Draw(0,1,REASON_EFFECT)\n");
    fs.writeFileSync(path.join(source, "duel-api", "deck.ts"), `lua.lua_setfield(L, -2, to_luastring("Draw"));\n`);
    fs.writeFileSync(path.join(source, "basic-test-constant-data.ts"), "export const constants = { REASON_EFFECT: 0x40 };\n");
    fs.writeFileSync(upstream, "REASON_EFFECT = 0x40\n");

    const result = spawnSync(process.execPath, [
      parityScannerPath,
      "--scripts",
      scripts,
      "--upstream",
      upstream,
      "--source",
      source,
      "--min-upstream-constants",
      "2",
      "--min-local-constants",
      "2",
    ], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("upstream constants: 1");
    expect(result.stdout).toContain("local constants:    1");
    expect(result.stderr).toContain("Upstream constants 1 is below required 2");
    expect(result.stderr).toContain("Local constants 1 is below required 2");
  });

  it("fails combined Lua parity scans when upstream scripts use missing APIs", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lua-parity-scan-"));
    const scripts = path.join(root, "script");
    const source = path.join(root, "source");
    const upstream = path.join(root, "constant.lua");
    fs.mkdirSync(path.join(source, "duel-api"), { recursive: true });
    fs.mkdirSync(scripts, { recursive: true });
    fs.writeFileSync(path.join(scripts, "c100.lua"), "Duel.MissingApi(0)\n");
    fs.writeFileSync(path.join(source, "basic-test-constant-data.ts"), "export const constants = { REASON_EFFECT: 0x40 };\n");
    fs.writeFileSync(upstream, "REASON_EFFECT = 0x40\n");

    const result = spawnSync(process.execPath, [
      parityScannerPath,
      "--scripts",
      scripts,
      "--upstream",
      upstream,
      "--source",
      source,
      "--fail-on-missing",
    ], { encoding: "utf8" });

    expect(result.status).toBe(2);
    expect(result.stdout).toContain("Top missing APIs:");
    expect(result.stdout).toContain("Duel.MissingApi");
  });

  it("fails combined Lua parity scans when upstream constants are missing locally", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lua-parity-scan-"));
    const scripts = path.join(root, "script");
    const source = path.join(root, "source");
    const upstream = path.join(root, "constant.lua");
    fs.mkdirSync(path.join(source, "duel-api"), { recursive: true });
    fs.mkdirSync(scripts, { recursive: true });
    fs.writeFileSync(path.join(scripts, "c100.lua"), "Duel.Draw(0,1,REASON_EFFECT)\n");
    fs.writeFileSync(path.join(source, "duel-api", "deck.ts"), `lua.lua_setfield(L, -2, to_luastring("Draw"));\n`);
    fs.writeFileSync(path.join(source, "basic-test-constant-data.ts"), "export const constants = { REASON_EFFECT: 0x40 };\n");
    fs.writeFileSync(upstream, "REASON_EFFECT = 0x40\nMISSING_CONSTANT = 1\n");

    const result = spawnSync(process.execPath, [
      parityScannerPath,
      "--scripts",
      scripts,
      "--upstream",
      upstream,
      "--source",
      source,
      "--fail-on-missing",
    ], { encoding: "utf8" });

    expect(result.status).toBe(2);
    expect(result.stdout).toContain("No missing API usages found.");
    expect(result.stdout).toContain("Missing constants:");
    expect(result.stdout).toContain("MISSING_CONSTANT");
  });

  it("rejects constant scanner options that are missing required values", () => {
    const cases = [
      { args: ["--upstream", "--source", "src"], error: "Missing value for --upstream" },
      { args: ["--source"], error: "Missing value for --source" },
      { args: ["--min-upstream-constants"], error: "Missing value for --min-upstream-constants" },
      { args: ["--min-upstream-constants", "-1"], error: "--min-upstream-constants must be a non-negative integer" },
      { args: ["--min-local-constants"], error: "Missing value for --min-local-constants" },
      { args: ["--min-local-constants", "1.5"], error: "--min-local-constants must be a non-negative integer" },
      { args: ["--unknown"], error: "Unknown argument: --unknown" },
    ];

    for (const { args, error } of cases) {
      const result = spawnSync(process.execPath, [scannerPath, ...args], { encoding: "utf8" });
      expect(result.status, args.join(" ")).toBe(1);
      expect(result.stderr, args.join(" ")).toContain(error);
    }
  });

  it("rejects combined parity scanner options that are missing required values", () => {
    const cases = [
      { args: ["--scripts"], error: "Missing value for --scripts" },
      { args: ["--upstream"], error: "Missing value for --upstream" },
      { args: ["--source"], error: "Missing value for --source" },
      { args: ["--limit"], error: "Missing value for --limit" },
      { args: ["--min-used-apis"], error: "Missing value for --min-used-apis" },
      { args: ["--min-implemented-apis"], error: "Missing value for --min-implemented-apis" },
      { args: ["--min-upstream-constants"], error: "Missing value for --min-upstream-constants" },
      { args: ["--min-local-constants"], error: "Missing value for --min-local-constants" },
      { args: ["--unknown"], error: "Unknown argument: --unknown" },
    ];

    for (const { args, error } of cases) {
      const result = spawnSync(process.execPath, [parityScannerPath, ...args], { encoding: "utf8" });
      expect(result.status, args.join(" ")).toBe(1);
      expect(result.stderr, args.join(" ")).toContain(error);
    }
  });
});

function localFallbackLuaConstants(): string[] {
  const constants = new Set<string>();
  for (const file of listFiles("local-card-scripts", ".lua")) {
    const source = stripLuaCommentsAndStrings(fs.readFileSync(file, "utf8"));
    for (const match of source.matchAll(/\b[A-Z][A-Z0-9_]+\b/g)) {
      if (match[0]) constants.add(match[0]);
    }
  }
  return [...constants].sort();
}

function localLuaConstants(): string[] {
  const constants = new Set<string>();
  for (const file of listFiles("src/engine/lua", ".ts")) {
    if (!/\/basic-[a-z0-9-]*constant-data\.ts$/.test(file.split(path.sep).join("/"))) continue;
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/\b([A-Z][A-Z0-9_]+)\s*:/g)) {
      if (match[1]) constants.add(match[1]);
    }
  }
  return [...constants].sort();
}

function listFiles(root: string, extension: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(fullPath, extension));
    else if (entry.isFile() && entry.name.endsWith(extension)) files.push(fullPath);
  }
  return files;
}

function stripLuaCommentsAndStrings(text: string): string {
  return text
    .replace(/--\[\[[\s\S]*?\]\]/g, "")
    .replace(/--[^\n\r]*/g, "")
    .replace(/(["'])(?:\\.|(?!\1)[\s\S])*\1/g, "");
}
