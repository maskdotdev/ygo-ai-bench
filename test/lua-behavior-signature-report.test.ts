import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const tempRoots: string[] = [];

describe("Lua behavior signature report", () => {
  afterEach(() => {
    while (tempRoots.length > 0) {
      fs.rmSync(tempRoots.pop()!, { force: true, recursive: true });
    }
  });

  it("groups scripts by coarse behavior signatures instead of one-card expectations", () => {
    const scriptsRoot = makeTempFiles("lua-behavior-signatures-scripts-", {
      "c1.lua": `
        local s,id=GetID()
        function s.initial_effect(c)
          local e1=Effect.CreateEffect(c)
          e1:SetCategory(CATEGORY_DAMAGE)
          e1:SetType(EFFECT_TYPE_ACTIVATE)
          e1:SetCode(EVENT_FREE_CHAIN)
          e1:SetTarget(s.tg)
          e1:SetOperation(s.op)
          c:RegisterEffect(e1)
        end
        function s.tg(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return true end
          Duel.SetTargetPlayer(1-tp)
          Duel.SetTargetParam(800)
          Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,800)
        end
        function s.op(e,tp)
          local p,d=Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)
          Duel.Damage(p,d,REASON_EFFECT)
        end
      `,
      "c2.lua": `
        local s,id=GetID()
        function s.initial_effect(c)
          local e1=Effect.CreateEffect(c)
          e1:SetCategory(CATEGORY_DAMAGE)
          e1:SetType(EFFECT_TYPE_ACTIVATE)
          e1:SetCode(EVENT_FREE_CHAIN)
          e1:SetTarget(s.tg)
          e1:SetOperation(s.op)
          c:RegisterEffect(e1)
        end
        function s.tg(e,tp,eg,ep,ev,re,r,rp,chk)
          if chk==0 then return true end
          Duel.SetTargetPlayer(1-tp)
          Duel.SetTargetParam(500)
          Duel.SetOperationInfo(0,CATEGORY_DAMAGE,nil,0,1-tp,500)
        end
        function s.op(e,tp)
          local p,d=Duel.GetChainInfo(0,CHAININFO_TARGET_PLAYER,CHAININFO_TARGET_PARAM)
          Duel.Damage(p,d,REASON_EFFECT)
        end
      `,
      "c3.lua": `
        local s,id=GetID()
        function s.initial_effect(c)
          local e1=Effect.CreateEffect(c)
          e1:SetCategory(CATEGORY_DRAW)
          e1:SetType(EFFECT_TYPE_ACTIVATE)
          e1:SetCode(EVENT_FREE_CHAIN)
          e1:SetOperation(function(e,tp) Duel.Draw(tp,1,REASON_EFFECT) end)
          c:RegisterEffect(e1)
        end
      `,
    });
    const testRoot = makeTempFiles("lua-behavior-signatures-tests-", {
      "lua-real-script-damage.test.ts": `
        const damageCode = "1";
        const responderCode = "1001";
      `,
    });

    const result = spawnSync(process.execPath, ["tools/report-lua-behavior-signatures.mjs", "--scripts", scriptsRoot, "--test-root", testRoot, "--json"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout) as {
      totalScripts: number;
      uniqueSignatures: number;
      largestSignatureSize: number;
      singletonSignatures: number;
      fixtureCoverage: {
        realScriptFixtureFiles: number;
        coveredScripts: number;
        coveredSignatures: number;
        signatureCoveragePercent: number;
        uncoveredSignatures: number;
      };
      signatures: Array<{ count: number; categories: string[]; effectTypes: string[]; eventCodes: string[]; duelApis: string[]; examples: string[] }>;
    };

    expect(report.totalScripts).toBe(3);
    expect(report.uniqueSignatures).toBe(2);
    expect(report.largestSignatureSize).toBe(2);
    expect(report.singletonSignatures).toBe(1);
    expect(report.fixtureCoverage).toMatchObject({
      realScriptFixtureFiles: 1,
      coveredScripts: 1,
      coveredSignatures: 1,
      signatureCoveragePercent: 50,
      uncoveredSignatures: 1,
    });
    const topSignature = report.signatures[0];
    expect(topSignature).toBeDefined();
    expect(topSignature).toMatchObject({
      count: 2,
      categories: ["CATEGORY_DAMAGE"],
      effectTypes: ["EFFECT_TYPE_ACTIVATE"],
      eventCodes: ["EVENT_FREE_CHAIN"],
      duelApis: ["Damage", "GetChainInfo", "SetOperationInfo", "SetTargetParam", "SetTargetPlayer"],
    });
    expect(topSignature!.examples).toHaveLength(2);
  });

  it("prints largest uncovered signatures when requested", () => {
    const scriptsRoot = makeTempFiles("lua-behavior-signatures-uncovered-scripts-", {
      "c10.lua": `
        local s,id=GetID()
        function s.initial_effect(c)
          local e1=Effect.CreateEffect(c)
          e1:SetCategory(CATEGORY_DAMAGE)
          e1:SetType(EFFECT_TYPE_ACTIVATE)
          e1:SetCode(EVENT_FREE_CHAIN)
          e1:SetOperation(function(e,tp) Duel.Damage(1-tp,500,REASON_EFFECT) end)
          c:RegisterEffect(e1)
        end
      `,
      "c11.lua": `
        local s,id=GetID()
        function s.initial_effect(c)
          local e1=Effect.CreateEffect(c)
          e1:SetCategory(CATEGORY_DAMAGE)
          e1:SetType(EFFECT_TYPE_ACTIVATE)
          e1:SetCode(EVENT_FREE_CHAIN)
          e1:SetOperation(function(e,tp) Duel.Damage(1-tp,800,REASON_EFFECT) end)
          c:RegisterEffect(e1)
        end
      `,
      "c20.lua": `
        local s,id=GetID()
        function s.initial_effect(c)
          local e1=Effect.CreateEffect(c)
          e1:SetType(EFFECT_TYPE_SINGLE)
          e1:SetCode(EFFECT_PIERCE)
          c:RegisterEffect(e1)
        end
      `,
      "c30.lua": `
        local s,id=GetID()
        function s.initial_effect(c)
          local e1=Effect.CreateEffect(c)
          e1:SetCategory(CATEGORY_DRAW)
          e1:SetType(EFFECT_TYPE_ACTIVATE)
          e1:SetCode(EVENT_FREE_CHAIN)
          e1:SetOperation(function(e,tp) Duel.Draw(tp,1,REASON_EFFECT) end)
          c:RegisterEffect(e1)
        end
      `,
    });
    const testRoot = makeTempFiles("lua-behavior-signatures-uncovered-tests-", {
      "lua-real-script-draw.test.ts": `
        const drawCode = "30";
      `,
    });

    const result = spawnSync(process.execPath, ["tools/report-lua-behavior-signatures.mjs", "--scripts", scriptsRoot, "--test-root", testRoot, "--uncovered-only", "--top", "1"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Top uncovered signatures: 1");
    expect(result.stdout).toContain("- 2 scripts");
    expect(result.stdout).toContain("fixture covered: no");
    expect(result.stdout).toContain("categories: CATEGORY_DAMAGE");
    expect(result.stdout).not.toContain("categories: CATEGORY_DRAW");
  });
});

function makeTempFiles(prefix: string, files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  for (const [file, source] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, file), source);
  }
  return root;
}
