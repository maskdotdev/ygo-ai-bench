import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const exporterPath = path.resolve("tools/export-browser-lua-scripts.mjs");
const checkerPath = path.resolve("tools/check-browser-asset-manifests.mjs");
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("browser Lua script exporter", () => {
  it("exports selected card scripts from upstream candidate folders", () => {
    const root = makeTempRoot();
    tempRoots.push(root);
    const scriptRoot = path.join(root, "script");
    const outDir = path.join(root, "public", "card-scripts");
    fs.mkdirSync(path.join(scriptRoot, "official"), { recursive: true });
    fs.mkdirSync(path.join(scriptRoot, "pre-release"), { recursive: true });
    fs.writeFileSync(path.join(scriptRoot, "official", "c100.lua"), "official 100", "utf8");
    fs.writeFileSync(path.join(scriptRoot, "c200.lua"), "root 200", "utf8");
    fs.writeFileSync(path.join(scriptRoot, "pre-release", "c300.lua"), "pre 300", "utf8");

    const summary = execFileSync("node", [
      exporterPath,
      "--scripts",
      scriptRoot,
      "--out",
      outDir,
      "--codes",
      "300,100,999",
      "--allow-missing",
    ], { encoding: "utf8" });

    expect(JSON.parse(summary)).toEqual({
      copied: ["c100.lua", "c300.lua"],
      missing: ["c999.lua"],
    });
    expect(fs.readFileSync(path.join(outDir, "c100.lua"), "utf8")).toBe("official 100");
    expect(fs.readFileSync(path.join(outDir, "c300.lua"), "utf8")).toBe("pre 300");
    expect(fs.existsSync(path.join(outDir, "c200.lua"))).toBe(false);
    expect(execFileSync("node", [checkerPath, "--card-scripts", outDir], { encoding: "utf8" })).toContain("Browser asset manifest check passed");
    expect(JSON.parse(fs.readFileSync(path.join(outDir, "manifest.json"), "utf8"))).toEqual({
      schemaVersion: 1,
      kind: "browser-lua-scripts",
      selectedCodes: ["100", "300", "999"],
      copiedCount: 2,
      missingCount: 1,
      sourceCounts: {
        "upstream-official": 1,
        "upstream-pre-release": 1,
      },
      fallbackKindCounts: {},
      copied: ["c100.lua", "c300.lua"],
      missing: ["c999.lua"],
      files: [
        { name: "c100.lua", source: "upstream-official", bytes: Buffer.byteLength("official 100"), sha256: sha256("official 100") },
        { name: "c300.lua", source: "upstream-pre-release", bytes: Buffer.byteLength("pre 300"), sha256: sha256("pre 300") },
      ],
    });
  });

  it("exports discovered scripts when no passcodes are selected", () => {
    const root = makeTempRoot();
    const scriptRoot = path.join(root, "script");
    const outDir = path.join(root, "public", "card-scripts");
    fs.mkdirSync(path.join(scriptRoot, "official"), { recursive: true });
    fs.writeFileSync(path.join(scriptRoot, "official", "c200.lua"), "official 200", "utf8");
    fs.writeFileSync(path.join(scriptRoot, "c100.lua"), "root 100", "utf8");
    fs.writeFileSync(path.join(scriptRoot, "constant.lua"), "not a card script", "utf8");

    const summary = execFileSync("node", [exporterPath, "--scripts", scriptRoot, "--out", outDir], { encoding: "utf8" });

    expect(JSON.parse(summary)).toEqual({
      copied: ["c100.lua", "c200.lua"],
      missing: [],
    });
    expect(fs.readdirSync(outDir).sort()).toEqual(["c100.lua", "c200.lua", "manifest.json"]);
    expect(execFileSync("node", [checkerPath, "--card-scripts", outDir], { encoding: "utf8" })).toContain("Browser asset manifest check passed");
  });

  it("prefers local overrides and falls back to local fallback scripts", () => {
    const root = makeTempRoot();
    const scriptRoot = path.join(root, "script");
    const localScriptRoot = path.join(root, "local-card-scripts");
    const outDir = path.join(root, "public", "card-scripts");
    fs.mkdirSync(path.join(scriptRoot, "official"), { recursive: true });
    fs.mkdirSync(path.join(localScriptRoot, "overrides", "official"), { recursive: true });
    fs.mkdirSync(path.join(localScriptRoot, "fallbacks", "official"), { recursive: true });
    fs.writeFileSync(path.join(scriptRoot, "official", "c100.lua"), "official 100", "utf8");
    fs.writeFileSync(path.join(localScriptRoot, "overrides", "official", "c100.lua"), "override 100", "utf8");
    fs.writeFileSync(path.join(localScriptRoot, "fallbacks", "official", "c400.lua"), "-- yugioh-deck-builder: local-fallback-provisional\nfallback 400", "utf8");

    const summary = execFileSync("node", [
      exporterPath,
      "--scripts",
      scriptRoot,
      "--local-scripts",
      localScriptRoot,
      "--out",
      outDir,
      "--codes",
      "100,400",
      "--max-local-fallbacks",
      "1",
      "--max-local-alias-fallbacks",
      "0",
      "--max-local-provisional-fallbacks",
      "1",
      "--max-local-other-fallbacks",
      "0",
    ], { encoding: "utf8" });

    expect(JSON.parse(summary)).toEqual({
      copied: ["c100.lua", "c400.lua"],
      missing: [],
    });
    expect(execFileSync("node", [checkerPath, "--card-scripts", outDir], { encoding: "utf8" })).toContain("Browser asset manifest check passed");
    expect(fs.readFileSync(path.join(outDir, "c100.lua"), "utf8")).toBe("override 100");
    expect(fs.readFileSync(path.join(outDir, "c400.lua"), "utf8")).toBe("-- yugioh-deck-builder: local-fallback-provisional\nfallback 400");
    expect(JSON.parse(fs.readFileSync(path.join(outDir, "manifest.json"), "utf8"))).toMatchObject({
      copiedCount: 2,
      missingCount: 0,
      sourceCounts: {
        "local-override": 1,
        "local-fallback": 1,
      },
      fallbackKindCounts: {
        provisional: 1,
      },
      copied: ["c100.lua", "c400.lua"],
      missing: [],
      files: [
        { name: "c100.lua", source: "local-override" },
        { name: "c400.lua", source: "local-fallback", fallbackKind: "provisional" },
      ],
    });
  });

  it("fails when local fallback export budgets are exceeded", () => {
    const root = makeTempRoot();
    const scriptRoot = path.join(root, "script");
    const localScriptRoot = path.join(root, "local-card-scripts");
    const outDir = path.join(root, "public", "card-scripts");
    fs.mkdirSync(scriptRoot, { recursive: true });
    fs.mkdirSync(path.join(localScriptRoot, "fallbacks", "official"), { recursive: true });
    fs.writeFileSync(path.join(localScriptRoot, "fallbacks", "official", "c400.lua"), "Duel.LoadCardScriptAlias(100)", "utf8");

    expect(() => execFileSync("node", [
      exporterPath,
      "--scripts",
      scriptRoot,
      "--local-scripts",
      localScriptRoot,
      "--out",
      outDir,
      "--codes",
      "400",
      "--max-local-alias-fallbacks",
      "0",
    ], { encoding: "utf8", stdio: "pipe" })).toThrow(/Local alias fallback scripts 1 is above allowed 0/);
  });
});

function makeTempRoot(): string {
  fs.mkdirSync(os.tmpdir(), { recursive: true });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "browser-lua-export-"));
  tempRoots.push(root);
  return root;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
