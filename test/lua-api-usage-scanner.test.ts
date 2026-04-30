import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const scannerPath = path.resolve("tools/scan-lua-api-usage.mjs");

describe("Lua API usage scanner", () => {
  it("ranks missing upstream-style API calls against local Lua bindings", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "lua-api-scan-"));
    const scripts = path.join(root, "script");
    const source = path.join(root, "source");
    fs.mkdirSync(path.join(source, "duel-api"), { recursive: true });
    fs.mkdirSync(scripts, { recursive: true });
    fs.writeFileSync(
      path.join(scripts, "c100.lua"),
      `
      function c100.initial_effect(c)
        Duel.Draw(0,1,REASON_EFFECT)
        Duel.Draw(0,1,REASON_EFFECT)
        Duel.HelperRegistered()
        Duel.NamedRegistered()
        Duel.MissingDuelCall()
        Card.IsCode(c,100)
        Card.MissingCardCall(c)
        aux.FilterBoolFunction(Card.IsCode,100)
        -- Duel.CommentedCall()
      end
      `,
    );
    fs.writeFileSync(path.join(source, "duel-api", "deck.ts"), `lua.lua_setfield(L, -2, to_luastring("Draw"));`);
    fs.writeFileSync(path.join(source, "duel-api", "helper.ts"), `pushHelper(L, "HelperRegistered", session);`);
    fs.writeFileSync(path.join(source, "duel-api", "named.ts"), `function Duel.NamedRegistered() end`);
    fs.writeFileSync(path.join(source, "card-api.ts"), `lua.lua_setfield(L, -2, to_luastring("IsCode"));`);
    fs.writeFileSync(path.join(source, "aux-api.ts"), `lua.lua_setfield(L, -2, to_luastring("FilterBoolFunction"));`);

    const output = execFileSync(process.execPath, [scannerPath, "--scripts", scripts, "--source", source, "--limit", "5"], { encoding: "utf8" });

    expect(output).toContain("Top missing APIs:");
    expect(output).toContain("     1  Card.MissingCardCall");
    expect(output).toContain("     1  Duel.MissingDuelCall");
    expect(output).not.toContain("Duel.Draw");
    expect(output).not.toContain("Duel.HelperRegistered");
    expect(output).not.toContain("Duel.NamedRegistered");
    expect(output).not.toContain("Card.IsCode");
    expect(output).not.toContain("Duel.CommentedCall");
  });
});
