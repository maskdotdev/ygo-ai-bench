import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("PvP route lazy loading", () => {
  it("keeps the PvP arena behind a dynamic route import", () => {
    const source = fs.readFileSync("src/playtest-app/main.tsx", "utf8");

    expect(source).toContain("lazy(async () =>");
    expect(source).toContain('import("./pvp-arena.js")');
    expect(source).not.toMatch(/import\s+\{?\s*PvpArena\b/);
    expect(source).not.toMatch(/from\s+["']\.\/pvp-arena\.js["']/);
  });
});
