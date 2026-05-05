import fs from "node:fs";
import path from "node:path";

export const vitestTempRoot = path.resolve(".tmp/vitest");

export function prepareVitestTempRoot(clean = false): void {
  if (clean) {
    fs.rmSync(vitestTempRoot, { recursive: true, force: true });
  }

  fs.mkdirSync(vitestTempRoot, { recursive: true });
  process.env.TMPDIR = vitestTempRoot;
  process.env.TMP = vitestTempRoot;
  process.env.TEMP = vitestTempRoot;
}
