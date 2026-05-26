import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const gorgonicGolemKindCounts = { graveSelfBanishFacedownTriggerLockRestore: 1 } satisfies Record<GorgonicGolemKind, number>;
type GorgonicGolemKind = "graveSelfBanishFacedownTriggerLockRestore";

describe("Lua real Gorgonic Golem restore coverage", () => {
  it("keeps Gorgonic Golem's grave self-banish facedown trigger-lock flow owned", () => {
    const file = "test/lua-real-script-gorgonic-golem-grave-trigger-lock.test.ts";
    const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));

    expect(text.includes("restoreDuelWithLuaScripts")).toBe(true);
    expect(text.includes("restoreComplete")).toBe(true);
    expect(text.includes('incompleteReasons.join("; ")')).toBe(true);
    expect(text.includes("missingRegistryKeys).toEqual([])")).toBe(true);
    expect(text.includes("missingChainLimitRegistryKeys).toEqual([])")).toBe(true);
    expect(text.includes("getLuaRestoreLegalActions")).toBe(true);
    expect(text.includes("getLuaRestoreLegalActionGroups")).toBe(true);
    expect(text.includes("getGroupedDuelLegalActions")).toBe(true);
    for (const snippet of [
      'const golemCode = "37984162"',
      "Gorgonic Golem",
      "restores battle-destroyed metadata and resolves graveyard self-banish into facedown trigger lock",
      "e1:SetCode(EVENT_BATTLE_DESTROYED)",
      "e1:SetCode(EFFECT_SET_ATTACK_FINAL)",
      "e1:SetValue(0)",
      "e2:SetRange(LOCATION_GRAVE)",
      "e2:SetCost(Cost.SelfBanish)",
      "Duel.SelectTarget(tp,Card.IsFacedown,tp,0,LOCATION_SZONE,1,1,nil)",
      "Duel.SetChainLimit(s.limit(g:GetFirst()))",
      "return e:GetHandler()~=c",
      "e1:SetCode(EFFECT_CANNOT_TRIGGER)",
      'triggerEvent: "battleDestroyed"',
      'action.type === "activateEffect"',
      "applyLuaRestoreResponse",
      "resolveRestoredChain",
      "reason: duelReason.cost",
      "reasonEffectId: 2",
      "code: effectCannotTrigger",
      'event: "continuous"',
      "reset: { flags: 1107169792 }",
      "value: 1",
      'eventName: "banished"',
      "eventCode: 1021",
      'eventName: "becameTarget"',
      "eventCode: 1028",
      'eventChainLinkId: "chain-3"',
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Gorgonic Golem fixture kind explicit", () => {
    expect(gorgonicGolemKindCounts).toEqual({ graveSelfBanishFacedownTriggerLockRestore: 1 });
  });
});
