import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const checkerPath = path.resolve("tools/check-bridge-bundle.mjs");
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("bridge bundle checker", () => {
  it("fails when the browser bridge API surface is missing", () => {
    const root = makeTempRoot();
    const bridge = path.join(root, "playtest-engine.js");
    fs.writeFileSync(bridge, "window.duelDeckPlaytest = {};\n");

    const result = spawnSync(process.execPath, [checkerPath, "--bridge", bridge], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("is missing browser bridge API snippets: legalActions, legalActionGroups, runScripted");
  });

  it("fails when the browser bridge bundle is missing", () => {
    const root = makeTempRoot();
    const bridge = path.join(root, "missing-playtest-engine.js");

    const result = spawnSync(process.execPath, [checkerPath, "--bridge", bridge], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${bridge} does not exist. Run the bridge build before checking it.`);
  });

  it("fails when the browser bridge bundle contains Node-facing snippets", () => {
    const root = makeTempRoot();
    const bridge = path.join(root, "playtest-engine.js");
    fs.writeFileSync(bridge, "window.duelDeckPlaytest = { legalActions(){}, legalActionGroups(){}, runScripted(){} }; require(\"fs\");\n");

    const result = spawnSync(process.execPath, [checkerPath, "--bridge", bridge], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("contains Node-facing snippets: require(\"fs\")");
  });

  it("fails when the browser bridge bundle exceeds the size budget", () => {
    const root = makeTempRoot();
    const bridge = path.join(root, "playtest-engine.js");
    fs.writeFileSync(bridge, [
      "window.duelDeckPlaytest = { legalActions(){}, legalActionGroups(){}, runScripted(){} };",
      "x".repeat(128 * 1024),
    ].join("\n"));

    const result = spawnSync(process.execPath, [checkerPath, "--bridge", bridge], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("expected at most 131072");
  });

  it("passes when the browser bridge API surface is present", () => {
    const root = makeTempRoot();
    const bridge = path.join(root, "playtest-engine.js");
    fs.writeFileSync(bridge, "window.duelDeckPlaytest = { legalActions(){}, legalActionGroups(){}, runScripted(){} };\n");

    const result = spawnSync(process.execPath, [checkerPath, "--bridge", bridge], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Bridge bundle check passed.");
  });

  it("rejects a missing --bridge option value", () => {
    const result = spawnSync(process.execPath, [checkerPath, "--bridge"], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Missing value for --bridge");
  });
});

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-bundle-check-"));
  tempRoots.push(root);
  return root;
}
