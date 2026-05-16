import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const checkerPath = path.resolve("tools/check-browser-asset-manifests.mjs");
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("browser asset manifest checker", () => {
  it("passes when exported card data and script manifests match their payloads", () => {
    const root = makeTempRoot();
    const cardDataDir = path.join(root, "card-data");
    const cardScriptsDir = path.join(root, "card-scripts");
    writeCardDataExport(cardDataDir, { datas: [{ id: 100, type: 1 }], texts: [{ id: 100, name: "Manifest Monster" }] });
    writeScriptExport(cardScriptsDir, { "c100.lua": "c100={}\n" });

    const result = spawnSync(process.execPath, [
      checkerPath,
      "--card-data",
      cardDataDir,
      "--card-scripts",
      cardScriptsDir,
    ], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Browser asset manifest check passed");
  });

  it("fails when the CDB payload hash differs from its manifest", () => {
    const root = makeTempRoot();
    const cardDataDir = path.join(root, "card-data");
    writeCardDataExport(cardDataDir, { datas: [{ id: 100, type: 1 }], texts: [{ id: 100, name: "Manifest Monster" }] });
    fs.writeFileSync(path.join(cardDataDir, "cdb-rows.json"), `${JSON.stringify({ datas: [], texts: [] }, null, 2)}\n`, "utf8");

    const result = spawnSync(process.execPath, [checkerPath, "--card-data", cardDataDir], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CDB rows payload hash mismatch");
  });

  it("fails when selected CDB passcodes do not match payload row ids", () => {
    const root = makeTempRoot();
    const cardDataDir = path.join(root, "card-data");
    writeCardDataExport(cardDataDir, { datas: [{ id: 100, type: 1 }], texts: [{ id: 100, name: "Manifest Monster" }] });
    const manifestPath = path.join(cardDataDir, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { selectedCodes: string[] };
    manifest.selectedCodes = ["100", "200"];
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const result = spawnSync(process.execPath, [checkerPath, "--card-data", cardDataDir], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CDB rows manifest selectedCodes 100,200 does not match payload datas ids 100");
  });

  it("fails when CDB datas and texts rows are not paired for selected passcodes", () => {
    const root = makeTempRoot();
    const cardDataDir = path.join(root, "card-data");
    writeCardDataExport(cardDataDir, { datas: [{ id: 100, type: 1 }], texts: [{ id: 200, name: "Wrong Text" }] });

    const result = spawnSync(process.execPath, [checkerPath, "--card-data", cardDataDir], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("CDB rows manifest selectedCodes 100 does not match payload texts ids 200");
  });

  it("fails when an exported Lua script hash differs from its manifest", () => {
    const root = makeTempRoot();
    const cardScriptsDir = path.join(root, "card-scripts");
    writeScriptExport(cardScriptsDir, { "c100.lua": "c100={}\n" });
    fs.writeFileSync(path.join(cardScriptsDir, "c100.lua"), "c100={mutated=true}\n", "utf8");

    const result = spawnSync(process.execPath, [checkerPath, "--card-scripts", cardScriptsDir], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Lua script c100.lua byte count");
  });

  it("fails when selected script passcodes do not match copied and missing script lists", () => {
    const root = makeTempRoot();
    const cardScriptsDir = path.join(root, "card-scripts");
    writeScriptExport(cardScriptsDir, { "c100.lua": "c100={}\n" });
    const manifestPath = path.join(cardScriptsDir, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { selectedCodes: string[] };
    manifest.selectedCodes = ["100", "200"];
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const result = spawnSync(process.execPath, [checkerPath, "--card-scripts", cardScriptsDir], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Lua script manifest selectedCodes 100,200 does not match copied/missing script codes 100");
  });

  it("fails when copied Lua scripts are missing exact file metadata", () => {
    const root = makeTempRoot();
    const cardScriptsDir = path.join(root, "card-scripts");
    writeScriptExport(cardScriptsDir, {
      "c100.lua": "c100={}\n",
      "c200.lua": "c200={}\n",
    });
    const manifestPath = path.join(cardScriptsDir, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      files: Array<{ name: string; bytes: number; sha256: string }>;
    };
    manifest.files = [manifest.files[0]!, manifest.files[0]!];
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const result = spawnSync(process.execPath, [checkerPath, "--card-scripts", cardScriptsDir], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Lua script manifest files list contains duplicate names");
  });

  it("rejects missing asset directory arguments", () => {
    const result = spawnSync(process.execPath, [checkerPath], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Expected --card-data <dir>, --card-scripts <dir>, or both");
  });
});

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "browser-asset-manifest-check-"));
  tempRoots.push(root);
  return root;
}

function writeCardDataExport(dir: string, payload: { datas: unknown[]; texts: unknown[] }): void {
  fs.mkdirSync(dir, { recursive: true });
  const payloadText = `${JSON.stringify(payload, null, 2)}\n`;
  fs.writeFileSync(path.join(dir, "cdb-rows.json"), payloadText, "utf8");
  fs.writeFileSync(path.join(dir, "manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    kind: "browser-cdb-rows",
    payload: "cdb-rows.json",
    selectedCodes: payload.datas.map((row) => String((row as { id: number }).id)),
    datasRows: payload.datas.length,
    textsRows: payload.texts.length,
    sha256: sha256(payloadText),
  }, null, 2)}\n`, "utf8");
}

function writeScriptExport(dir: string, scripts: Record<string, string>): void {
  fs.mkdirSync(dir, { recursive: true });
  const names = Object.keys(scripts).sort();
  for (const name of names) fs.writeFileSync(path.join(dir, name), scripts[name]!, "utf8");
  fs.writeFileSync(path.join(dir, "manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    kind: "browser-lua-scripts",
    selectedCodes: names.map((name) => name.slice(1, -4)),
    copiedCount: names.length,
    missingCount: 0,
    copied: names,
    missing: [],
    files: names.map((name) => ({
      name,
      bytes: Buffer.byteLength(scripts[name]!),
      sha256: sha256(scripts[name]!),
    })),
  }, null, 2)}\n`, "utf8");
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
