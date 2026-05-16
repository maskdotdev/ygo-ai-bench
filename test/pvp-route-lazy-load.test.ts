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

  it("keeps the Lua host out of the eager PvP arena chunk", () => {
    const source = fs.readFileSync("src/playtest-app/pvp-arena.tsx", "utf8");

    expect(source).toContain('await import("#lua/host.js")');
    expect(source).not.toMatch(/import\s+\{\s*createLuaScriptHost\b[^}]*\}\s+from\s+["']#lua\/host\.js["']/);
  });
});
