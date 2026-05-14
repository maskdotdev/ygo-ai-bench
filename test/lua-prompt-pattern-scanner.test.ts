import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { luaPromptApis } from "#lua/host-types.js";

const scannerPath = path.resolve("tools/scan-lua-prompt-patterns.mjs");

describe("Lua prompt pattern scanner", () => {
  it("scans the same prompt APIs that the engine can expose to the browser", () => {
    const scannerSource = fs.readFileSync(scannerPath, "utf8");
    const duelApiRegex = /\\bDuel\\s\*\\\.\\s\*\(([^)]+)\)\\s\*\\\(/.exec(scannerSource);
    if (!duelApiRegex?.[1]) throw new Error("Expected scanner Duel prompt API regex");
    const scannedApis = duelApiRegex[1].split("|").sort();

    expect(scannedApis).toEqual([...luaPromptApis].sort());
  });

  it("classifies SelectOption and SelectYesNo prompt shapes", () => {
    const scripts = makeScriptRoot({
      "c100.lua": `
        local s,id=GetID()
        function s.initial_effect(c)
          Duel.SelectOption(tp,aux.Stringid(id,0),aux.Stringid(id,1))
          Duel.SelectOption(tp,false,aux.Stringid(id,2),aux.Stringid(id,3))
          Duel.SelectOption(tp,false,table.unpack(ops))
          Duel.SelectYesNo(tp,aux.Stringid(id,4))
          Duel.SelectEffectYesNo(tp,c,aux.Stringid(id,5))
          Duel.AnnounceNumber(tp,table.unpack(nums))
          Duel.AnnounceType(tp,TYPE_MONSTER,TYPE_SPELL)
          Duel.AnnounceRace(tp,RACE_DRAGON,RACE_SPELLCASTER)
          Duel.SelectField(tp,1,LOCATION_MZONE,0,0)
        end
      `,
      "c200.lua": `
        local s,id=GetID()
        function s.initial_effect(c)
          Duel.SelectOption(tp,table.unpack(ops))
          Duel.SelectEffect(tp,{true,aux.Stringid(id,0)})
        end
      `,
    });

    const output = execFileSync(process.execPath, [scannerPath, "--scripts", scripts, "--limit", "20", "--fail-on-unclassified"], { encoding: "utf8" });

    expect(output).toContain("prompt calls: 11");
    expect(output).toContain("SelectOption calls: 4");
    expect(output).toContain("SelectYesNo calls: 1");
    expect(output).toContain("SelectEffect calls: 1");
    expect(output).toContain("SelectEffectYesNo calls: 1");
    expect(output).toContain("AnnounceNumber calls: 1");
    expect(output).toContain("AnnounceType calls: 1");
    expect(output).toContain("AnnounceRace calls: 1");
    expect(output).toContain("SelectField calls: 1");
    expect(output).toContain("announcement helper calls: 4");
    expect(output).toContain("unclassified prompt calls: 0");
    expect(output).toContain("SelectOption:literal-options");
    expect(output).toContain("SelectOption:leading-boolean-literals");
    expect(output).toContain("SelectOption:leading-boolean-table-unpack");
    expect(output).toContain("SelectOption:table-unpack");
    expect(output).toContain("SelectYesNo:description");
    expect(output).toContain("SelectEffectYesNo:description");
    expect(output).toContain("SelectEffect:effect-table-options");
    expect(output).toContain("AnnounceNumber:table-unpack");
    expect(output).toContain("AnnounceType:literal-options");
    expect(output).toContain("AnnounceRace:literal-options");
    expect(output).toContain("SelectField:zone-mask");
  });

  it("emits machine-readable prompt corpus counts", () => {
    const scripts = makeScriptRoot({
      "c250.lua": `
        local s,id=GetID()
        function s.initial_effect(c)
          Duel.SelectOption(tp,false,aux.Stringid(id,0),aux.Stringid(id,1))
          Duel.SelectOption(tp,table.unpack(ops))
          Duel.SelectEffect(tp,table.unpack(options))
          Duel.SelectEffectYesNo(tp,c,aux.Stringid(id,2))
          Duel.AnnounceNumber(tp,table.unpack(nums))
          Duel.AnnounceCard(tp,{100,OPCODE_ISCODE})
          Duel.AnnounceType(tp,TYPE_MONSTER,TYPE_SPELL)
        end
      `,
    });

    const report = JSON.parse(execFileSync(process.execPath, [scannerPath, "--scripts", scripts, "--json"], { encoding: "utf8" }));

    expect(report).toMatchObject({
      filesWithCalls: 1,
      promptCalls: 7,
      apiCounts: {
        SelectOption: 2,
        SelectEffect: 1,
        SelectEffectYesNo: 1,
        AnnounceNumber: 1,
        AnnounceCard: 1,
        AnnounceType: 1,
      },
      announcementCalls: 3,
      unclassifiedPromptCalls: 0,
      patternCounts: {
        "SelectOption:leading-boolean-literals": 1,
        "SelectOption:table-unpack": 1,
        "SelectEffect:dynamic-options": 1,
        "SelectEffectYesNo:description": 1,
        "AnnounceNumber:table-unpack": 1,
        "AnnounceCard:table-options": 1,
        "AnnounceType:literal-options": 1,
      },
    });
    expect(report.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "SelectEffect:dynamic-options",
          count: 1,
          samples: [expect.objectContaining({ card: "250", line: 6 })],
        }),
      ]),
    );
  });

  it("fails when the prompt corpus floor is not met", () => {
    const scripts = makeScriptRoot({
      "c300.lua": `
        local s,id=GetID()
        function s.initial_effect(c)
          Duel.SelectYesNo(tp,aux.Stringid(id,0))
        end
      `,
    });

    const result = spawnSync(process.execPath, [scannerPath, "--scripts", scripts, "--min-select-option-calls", "1"], { encoding: "utf8" });

    expect(result.status).toBe(2);
    expect(result.stdout).toContain("SelectOption calls: 0");
    expect(result.stderr).toContain("SelectOption calls 0 is below required 1");
  });

  it("fails when SelectEffect prompt floors are not met", () => {
    const scripts = makeScriptRoot({
      "c400.lua": `
        local s,id=GetID()
        function s.initial_effect(c)
          Duel.SelectOption(tp,aux.Stringid(id,0))
          Duel.SelectYesNo(tp,aux.Stringid(id,1))
        end
      `,
    });

    const result = spawnSync(process.execPath, [
      scannerPath,
      "--scripts",
      scripts,
      "--min-select-effect-calls",
      "1",
      "--min-select-effect-yes-no-calls",
      "1",
    ], { encoding: "utf8" });

    expect(result.status).toBe(2);
    expect(result.stdout).toContain("SelectEffect calls: 0");
    expect(result.stdout).toContain("SelectEffectYesNo calls: 0");
    expect(result.stderr).toContain("SelectEffect calls 0 is below required 1");
    expect(result.stderr).toContain("SelectEffectYesNo calls 0 is below required 1");
  });

  it("fails when announcement helper floors are not met", () => {
    const scripts = makeScriptRoot({
      "c450.lua": `
        local s,id=GetID()
        function s.initial_effect(c)
          Duel.SelectYesNo(tp,aux.Stringid(id,0))
        end
      `,
    });

    const result = spawnSync(process.execPath, [scannerPath, "--scripts", scripts, "--min-announcement-calls", "1"], { encoding: "utf8" });

    expect(result.status).toBe(2);
    expect(result.stdout).toContain("announcement helper calls: 0");
    expect(result.stderr).toContain("Announcement helper calls 0 is below required 1");
  });

  it("fails when a scanned API floor is not met", () => {
    const scripts = makeScriptRoot({
      "c475.lua": `
        local s,id=GetID()
        function s.initial_effect(c)
          Duel.AnnounceRace(tp,RACE_DRAGON,RACE_SPELLCASTER)
        end
      `,
    });

    const result = spawnSync(process.execPath, [scannerPath, "--scripts", scripts, "--min-api-count", "AnnounceCard", "1"], { encoding: "utf8" });

    expect(result.status).toBe(2);
    expect(result.stdout).toContain("AnnounceCard calls: 0");
    expect(result.stderr).toContain("AnnounceCard calls 0 is below required 1");
  });

  it("rejects unknown scanned API floors", () => {
    const scripts = makeScriptRoot({
      "c490.lua": `
        local s,id=GetID()
        function s.initial_effect(c)
          Duel.SelectYesNo(tp,aux.Stringid(id,0))
        end
      `,
    });

    const result = spawnSync(process.execPath, [scannerPath, "--scripts", scripts, "--min-api-count", "SelectMatchingCard", "1"], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown scanned API for --min-api-count: SelectMatchingCard");
  });

  it("fails when prompt pattern floors are not met", () => {
    const scripts = makeScriptRoot({
      "c500.lua": `
        local s,id=GetID()
        function s.initial_effect(c)
          Duel.SelectEffect(tp,{true,aux.Stringid(id,0)})
        end
      `,
    });

    const result = spawnSync(process.execPath, [
      scannerPath,
      "--scripts",
      scripts,
      "--min-pattern-count",
      "SelectEffect:dynamic-options",
      "1",
    ], { encoding: "utf8" });

    expect(result.status).toBe(2);
    expect(result.stdout).toContain("SelectEffect:effect-table-options");
    expect(result.stderr).toContain("SelectEffect:dynamic-options calls 0 is below required 1");
  });
});

function makeScriptRoot(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lua-prompt-scan-"));
  for (const [name, source] of Object.entries(files)) fs.writeFileSync(path.join(root, name), source);
  return root;
}
