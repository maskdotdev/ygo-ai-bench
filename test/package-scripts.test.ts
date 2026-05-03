import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("package scripts", () => {
  it("runs the Lua parity scanner in the default check gate", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

    expect(pkg.scripts?.["scan:lua-parity"]).toContain("--fail-on-missing");
    expect(pkg.scripts?.check?.split(" && ")).toEqual([
      "bun run check:loc",
      "bun run scan:lua-parity",
      "bun run typecheck",
      "bun run test",
      "bun run build",
    ]);
  });
});
