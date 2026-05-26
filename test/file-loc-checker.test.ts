import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const checkerPath = path.resolve("tools/check-file-loc.mjs");
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("file LOC checker", () => {
  it("passes when checked files stay at or below the line limit", () => {
    const root = makeTempRoot();
    fs.writeFileSync(path.join(root, "small.ts"), ["const ok = true;", "export { ok };"].join("\n"));

    const output = execFileSync(process.execPath, [checkerPath, "--limit", "2", root], { encoding: "utf8" });

    expect(output).toContain("File LOC check passed");
  });

  it("fails and reports checked files over the line limit", () => {
    const root = makeTempRoot();
    const longFile = path.join(root, "large.ts");
    fs.writeFileSync(longFile, ["const one = 1;", "const two = 2;", "const three = 3;"].join("\n"));

    const result = spawnSync(process.execPath, [checkerPath, "--limit", "2", root], { encoding: "utf8" });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("File LOC check failed");
    expect(result.stderr).toContain("large.ts");
  });

  it("allows explicitly baselined oversized files but still fails if they grow", () => {
    const root = makeTempRoot();
    const longFile = path.join(root, "large.ts");
    const baseline = path.join(root, "baseline.json");
    fs.writeFileSync(longFile, ["const one = 1;", "const two = 2;", "const three = 3;"].join("\n"));
    fs.writeFileSync(baseline, JSON.stringify({ [path.relative(process.cwd(), longFile)]: 3 }));

    const passing = execFileSync(process.execPath, [checkerPath, "--limit", "2", "--baseline", baseline, longFile], { encoding: "utf8" });
    expect(passing).toContain("File LOC check passed");

    fs.writeFileSync(longFile, ["const one = 1;", "const two = 2;", "const three = 3;", "const four = 4;"].join("\n"));
    const failing = spawnSync(process.execPath, [checkerPath, "--limit", "2", "--baseline", baseline, longFile], { encoding: "utf8" });
    expect(failing.status).toBe(2);
    expect(failing.stderr).toContain("large.ts");
  });

  it("ignores unchecked file extensions", () => {
    const root = makeTempRoot();
    fs.writeFileSync(path.join(root, "large.txt"), ["one", "two", "three"].join("\n"));

    const output = execFileSync(process.execPath, [checkerPath, "--limit", "2", root], { encoding: "utf8" });

    expect(output).toContain("File LOC check passed");
  });

  it("rejects options that are missing required values", () => {
    const result = spawnSync(process.execPath, [checkerPath, "--root", "--limit", "2"], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Missing value for --root");
  });

  it("rejects a missing baseline option value", () => {
    const result = spawnSync(process.execPath, [checkerPath, "--baseline"], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Missing value for --baseline");
  });
});

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "file-loc-check-"));
  tempRoots.push(root);
  return root;
}
