import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const exporterPath = path.resolve("tools/export-browser-lua-scripts.mjs");
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("browser Lua script exporter", () => {
  it("exports selected card scripts from upstream candidate folders", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "browser-lua-export-"));
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
  });

  it("exports discovered scripts when no passcodes are selected", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "browser-lua-export-"));
    tempRoots.push(root);
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
    expect(fs.readdirSync(outDir).sort()).toEqual(["c100.lua", "c200.lua"]);
  });
});
