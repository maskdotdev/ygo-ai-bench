import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const scannerPath = path.resolve("tools/scan-lua-api-usage.mjs");
const expectedFallbackScripts: string[] = [];
const expectedLocalScriptAliases = {
  "100452013": "27118421",
  "100452015": "90091224",
  "101303089": "94641726",
  "2372506": "101305046",
  "24088928": "101305002",
  "24461358": "101305062",
  "24749710": "101305065",
  "33599853": "101305044",
  "44001993": "101305027",
  "50073633": "101305003",
  "70405001": "101305028",
  "97462632": "101305004",
  "98684220": "101305001",
};
const expectedAliasFallbackScripts: string[] = [];
const expectedProvisionalFallbackScripts: string[] = [];
const expectedProvisionalFallbackCoverage: Record<string, string[]> = {};

describe("Lua API usage scanner", () => {
  it("keeps the local fallback inventory explicit", () => {
    const fallbackNames = fallbackScripts().map((file) => path.basename(file)).sort();
    const aliasFallbackNames = aliasFallbackScripts().map((file) => path.basename(file)).sort();
    const provisionalFallbackNames = provisionalFallbackScripts().map((file) => path.basename(file)).sort();

    expect(fallbackNames).toEqual(expectedFallbackScripts);
    expect(aliasFallbackNames).toEqual(expectedAliasFallbackScripts);
    expect(provisionalFallbackNames).toEqual(expectedProvisionalFallbackScripts);
  });

  it("keeps local fallbacks from duplicating exact upstream scripts", () => {
    const duplicated = fallbackScripts().filter((file) => {
      const name = path.basename(file);
      return [
        path.join(".upstream/ignis/script/official", name),
        path.join(".upstream/ignis/script", name),
        path.join(".upstream/ignis/script/pre-release", name),
      ].some((candidate) => fs.existsSync(candidate));
    });

    expect(duplicated).toEqual([]);
  });

  it("keeps local fallback passcodes out of the upstream card database", () => {
    if (!fs.existsSync(".upstream/ignis/cdb/cards.cdb")) return;
    const codes = fallbackScripts().map((file) => path.basename(file, ".lua").replace(/^c/, ""));
    const query = `select id, alias from datas where id in (${codes.join(",")}) or alias in (${codes.join(",")}) order by id`;
    const output = execFileSync("sqlite3", ["-readonly", ".upstream/ignis/cdb/cards.cdb", query], { encoding: "utf8" });

    expect(output.trim()).toBe("");
  });

  it("keeps local alias fallbacks pointed at existing upstream scripts", () => {
    const broken = fallbackScripts()
      .filter((file) => !fs.readFileSync(file, "utf8").includes("local-fallback-provisional"))
      .flatMap((file) => {
        const source = fs.readFileSync(file, "utf8");
        const alias = source.match(/Duel\.LoadCardScriptAlias\((\d+)\)/)?.[1];
        if (!alias) return [`${file}: missing Duel.LoadCardScriptAlias`];
        const candidates = [
          path.join(".upstream/ignis/script/official", `c${alias}.lua`),
          path.join(".upstream/ignis/script", `c${alias}.lua`),
          path.join(".upstream/ignis/script/pre-release", `c${alias}.lua`),
        ];
        return candidates.some((candidate) => fs.existsSync(candidate)) ? [] : [`${file}: missing upstream alias c${alias}.lua`];
      });

    expect(broken).toEqual([]);
  });

  it("keeps local script aliases explicit and pointed at existing upstream scripts", () => {
    const aliases = JSON.parse(fs.readFileSync("local-card-scripts/script-aliases.json", "utf8")) as Record<string, string>;
    const broken = Object.entries(aliases).flatMap(([code, alias]) => {
      if (!/^\d+$/.test(code) || !/^\d+$/.test(alias)) return [`${code}: malformed alias ${alias}`];
      const candidates = [
        path.join(".upstream/ignis/script/official", `c${alias}.lua`),
        path.join(".upstream/ignis/script", `c${alias}.lua`),
        path.join(".upstream/ignis/script/pre-release", `c${alias}.lua`),
      ];
      return candidates.some((candidate) => fs.existsSync(candidate)) ? [] : [`${code}: missing upstream alias c${alias}.lua`];
    });

    expect(aliases).toEqual(expectedLocalScriptAliases);
    expect(broken).toEqual([]);
  });

  it("rejects local fallback stub scripts", () => {
    const stubs = fallbackScripts().filter((file) => fs.readFileSync(file, "utf8").includes("local-fallback-stub"));

    expect(stubs).toEqual([]);
  });

  it("requires provisional fallback scripts to have direct test coverage", () => {
    const coverage = Object.fromEntries(
      provisionalFallbackScripts()
        .map((file) => {
          const name = path.basename(file);
          const testNames = testFiles()
            .filter((testFile) => {
              const source = fs.readFileSync(testFile, "utf8");
              return source.includes(`local-card-scripts/fallbacks/official/${name}`);
            })
            .map((testFile) => path.basename(testFile))
            .sort();
          return [name, testNames] as const;
        })
        .sort(([a], [b]) => a.localeCompare(b)),
    );

    expect(coverage).toEqual(expectedProvisionalFallbackCoverage);
  });

  it("keeps local provisional fallback scripts on Group:GetCount checks", () => {
    const groupLengthChecks = provisionalFallbackScripts().flatMap((file) => {
      const source = fs.readFileSync(file, "utf8");
      const matches = source.match(/#[a-z][a-z0-9_]*(?=\s*[<>=~])/gi) ?? [];
      return matches.map((match) => `${file}: ${match}`);
    });

    expect(groupLengthChecks).toEqual([]);
  });

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

  it("keeps local Lua API names aligned with upstream Project Ignis scripts", () => {
    const scripts = ".upstream/ignis/script";
    if (!fs.existsSync(scripts)) return;

    const output = execFileSync(process.execPath, [scannerPath, "--scripts", scripts, "--fail-on-missing"], { encoding: "utf8" });

    expect(output).toContain("No missing API usages found.");
  }, 15_000);

  it("keeps local card-script fallback API names aligned with local Lua bindings", () => {
    const output = execFileSync(process.execPath, [
      scannerPath,
      "--scripts",
      "local-card-scripts",
      "--fail-on-missing",
      "--min-used-apis",
      "0",
      "--min-implemented-apis",
      "1222",
    ], { encoding: "utf8" });

    expect(output).toContain("scripts: ");
    expect(output).toContain("local-card-scripts");
    expect(output).toContain("used APIs: 0");
    expect(output).toContain("implemented APIs found: 1222");
    expect(output).toContain("No missing API usages found.");
  });

  it("rejects scanner options that are missing required values", () => {
    const cases = [
      { args: ["--scripts", "--limit", "5"], error: "Missing value for --scripts" },
      { args: ["--source"], error: "Missing value for --source" },
      { args: ["--limit"], error: "Missing value for --limit" },
      { args: ["--min-used-apis"], error: "Missing value for --min-used-apis" },
      { args: ["--min-used-apis", "-1"], error: "--min-used-apis must be a non-negative integer" },
      { args: ["--min-implemented-apis"], error: "Missing value for --min-implemented-apis" },
      { args: ["--min-implemented-apis", "1.5"], error: "--min-implemented-apis must be a non-negative integer" },
      { args: ["--unknown"], error: "Unknown argument: --unknown" },
    ];

    for (const { args, error } of cases) {
      const result = spawnSync(process.execPath, [scannerPath, ...args], { encoding: "utf8" });
      expect(result.status, args.join(" ")).toBe(1);
      expect(result.stderr, args.join(" ")).toContain(error);
    }
  });
});

function provisionalFallbackScripts(): string[] {
  return fallbackScripts().filter((file) => fs.readFileSync(file, "utf8").includes("local-fallback-provisional"));
}

function aliasFallbackScripts(): string[] {
  return fallbackScripts().filter((file) => fs.readFileSync(file, "utf8").includes("Duel.LoadCardScriptAlias"));
}

function fallbackScripts(): string[] {
  return fs
    .readdirSync("local-card-scripts/fallbacks/official")
    .filter((file) => file.endsWith(".lua"))
    .map((file) => path.join("local-card-scripts/fallbacks/official", file));
}

function testFiles(): string[] {
  return fs
    .readdirSync("test")
    .filter((file) => file.endsWith(".test.ts") && file !== "lua-api-usage-scanner.test.ts")
    .map((file) => path.join("test", file));
}
