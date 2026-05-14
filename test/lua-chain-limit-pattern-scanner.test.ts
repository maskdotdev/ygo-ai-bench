import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const scannerPath = path.resolve("tools/scan-lua-chain-limit-patterns.mjs");

describe("Lua chain-limit pattern scanner", () => {
  it("classifies inline, named, and factory chain-limit predicates", () => {
    const scripts = makeScriptRoot({
      "c100.lua": `
        local s,id=GetID()
        function s.initial_effect(c)
          Duel.SetChainLimit(function(e,rp,tp) return rp==tp end)
          Duel.SetChainLimit(s.block_activation)
          Duel.SetChainLimitTillChainEnd(s.same_handler(c))
          Duel.SetChainLimit(function(te) return not Duel.GetTargetCards(e):IsContains(te:GetHandler()) end)
        end
        function s.block_activation(e)
          return not e:IsHasType(EFFECT_TYPE_ACTIVATE)
        end
        function s.same_handler(c)
          return function(e,rp,tp)
            return e:GetHandler()==c
          end
        end
      `,
      "c200.lua": `
        local s,id=GetID()
        function s.initial_effect(c)
          Duel.SetChainLimit(function(e,rp,tp)
            local rc=e:GetHandler()
            return rc~=tc1 and rc~=tc2
          end)
          Duel.SetChainLimit(aux.FALSE)
        end
      `,
    });

    const output = execFileSync(process.execPath, [scannerPath, "--scripts", scripts, "--limit", "20", "--fail-on-unclassified"], { encoding: "utf8" });

    expect(output).toContain("calls: 6");
    expect(output).toContain("unclassified calls: 0");
    expect(output).toContain("SetChainLimit:inline:response-chain-player");
    expect(output).toContain("SetChainLimit:named:effect-type");
    expect(output).toContain("SetChainLimitTillChainEnd:factory:handler-only");
    expect(output).toContain("SetChainLimit:inline:target-card-handler-exclusion");
    expect(output).toContain("SetChainLimit:inline:handler-exclusion");
    expect(output).toContain("SetChainLimit:aux.FALSE");
  });

  it("fails when requested and a chain-limit predicate shape is unclassified", () => {
    const scripts = makeScriptRoot({
      "c300.lua": `
        local s,id=GetID()
        function s.initial_effect(c)
          Duel.SetChainLimit(function(e,rp,tp) return e:GetLabel()==42 end)
        end
      `,
    });

    const result = spawnSync(process.execPath, [scannerPath, "--scripts", scripts, "--fail-on-unclassified"], { encoding: "utf8" });

    expect(result.status).toBe(2);
    expect(result.stdout).toContain("unclassified calls: 1");
    expect(result.stdout).toContain("SetChainLimit:inline:unclassified-inline");
  });

  it("fails when the files-with-calls corpus floor is not met", () => {
    const scripts = makeScriptRoot({
      "c400.lua": `
        local s,id=GetID()
        function s.initial_effect(c)
          Duel.SetChainLimit(aux.FALSE)
        end
      `,
    });

    const result = spawnSync(process.execPath, [scannerPath, "--scripts", scripts, "--min-files-with-calls", "2"], { encoding: "utf8" });

    expect(result.status).toBe(2);
    expect(result.stdout).toContain("files with calls: 1");
    expect(result.stderr).toContain("Files with calls 1 is below required 2");
  });

  it("fails when the chain-limit call corpus floor is not met", () => {
    const scripts = makeScriptRoot({
      "c500.lua": `
        local s,id=GetID()
        function s.initial_effect(c)
          Duel.SetChainLimit(aux.FALSE)
        end
      `,
    });

    const result = spawnSync(process.execPath, [scannerPath, "--scripts", scripts, "--min-calls", "2"], { encoding: "utf8" });

    expect(result.status).toBe(2);
    expect(result.stdout).toContain("calls: 1");
    expect(result.stderr).toContain("Calls 1 is below required 2");
  });
});

function makeScriptRoot(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lua-chain-limit-scan-"));
  for (const [name, source] of Object.entries(files)) fs.writeFileSync(path.join(root, name), source);
  return root;
}
