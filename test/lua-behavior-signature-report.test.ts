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
    const scriptsRoot = makeTempScripts({
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

    const result = spawnSync(process.execPath, ["tools/report-lua-behavior-signatures.mjs", "--scripts", scriptsRoot, "--json"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout) as {
      totalScripts: number;
      uniqueSignatures: number;
      largestSignatureSize: number;
      singletonSignatures: number;
      signatures: Array<{ count: number; categories: string[]; effectTypes: string[]; eventCodes: string[]; duelApis: string[]; examples: string[] }>;
    };

    expect(report.totalScripts).toBe(3);
    expect(report.uniqueSignatures).toBe(2);
    expect(report.largestSignatureSize).toBe(2);
    expect(report.singletonSignatures).toBe(1);
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
});

function makeTempScripts(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lua-behavior-signatures-"));
  tempRoots.push(root);
  for (const [file, source] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, file), source);
  }
  return root;
}
