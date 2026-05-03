import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const scannerPath = path.resolve("tools/scan-lua-constants.mjs");
const parityScannerPath = path.resolve("tools/scan-lua-parity.mjs");

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

  it("keeps local Project Ignis constant names aligned with upstream constant.lua", () => {
    const upstream = ".upstream/ignis/script/constant.lua";
    if (!fs.existsSync(upstream)) return;

    const output = execFileSync(process.execPath, [scannerPath, "--upstream", upstream, "--fail-on-missing"], { encoding: "utf8" });

    expect(output).toContain("No missing constants found.");
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
    const result = spawnSync(process.execPath, [scannerPath, "--upstream", "--source", "src"], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Missing value for --upstream");
  });

  it("rejects combined parity scanner options that are missing required values", () => {
    const result = spawnSync(process.execPath, [parityScannerPath, "--limit"], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Missing value for --limit");
  });
});
