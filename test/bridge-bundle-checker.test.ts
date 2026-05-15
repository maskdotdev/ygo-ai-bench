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

  it("passes when the browser bridge API surface is present", () => {
    const root = makeTempRoot();
    const bridge = path.join(root, "playtest-engine.js");
    fs.writeFileSync(bridge, "window.duelDeckPlaytest = { legalActions(){}, legalActionGroups(){}, runScripted(){} };\n");

    const result = spawnSync(process.execPath, [checkerPath, "--bridge", bridge], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Bridge bundle check passed.");
  });
});

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-bundle-check-"));
  tempRoots.push(root);
  return root;
}
