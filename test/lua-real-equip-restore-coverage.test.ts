import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const equipFixtureCount = 7;
const equipRelationFixtureCount = 11;
const equipProbeFixtureCount = 8;
const equipOperationInfoFixtureCount = 9;
const equipCleanupFixtureCount = 6;

describe("Lua real equip restore coverage", () => {
  it("requires representative equip fixtures to assert grouped legal actions and clean Lua registry restore", () => {
    const files = realScriptEquipFixtureFiles();
    expect(files).toHaveLength(equipFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])");
      });

    expect(missing).toEqual([]);
  });

  it("requires representative equip fixtures to prove restored equip relation and response suppression", () => {
    const files = realScriptEquipRelationFixtureFiles();
    expect(files).toHaveLength(equipRelationFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !/location:\s*["']spellTrapZone["']/.test(text)
          || !text.includes("equippedToUid")
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !/host\.messages\)\.not\.toContain/.test(text);
      });

    expect(missing).toEqual([]);
  });

  it("requires representative equip activation fixtures to pin operation info metadata", () => {
    const files = realScriptEquipOperationInfoFixtureFiles();
    expect(files).toHaveLength(equipOperationInfoFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("operationInfos")
          || !/"category":\s*262144/.test(text);
      });

    expect(missing).toEqual([]);
  });

  it("requires equip probe fixtures to prove restored Lua equip APIs and stat/control effects", () => {
    const files = realScriptEquipProbeFixtureFiles();
    expect(files).toHaveLength(equipProbeFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !/host\.messages\)\.toContain/.test(text)
          || !/probe/.test(text)
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !/GetEquipTarget|GetFirstCardTarget|IsHasEffect|GetAttack|GetControler/.test(text);
      });

    expect(missing).toEqual([]);
  });

  it("requires equip cleanup fixtures to prove leave-field cleanup and triggered follow-up state", () => {
    const files = realScriptEquipCleanupFixtureFiles();
    expect(files).toHaveLength(equipCleanupFixtureCount);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !/previousEquippedToUid/.test(text)
          || !/location:\s*["']graveyard["']/.test(text)
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !/eventName:\s*["']sentToGraveyard["']|eventName:\s*["']destroyed["']|previousController/.test(text);
      });

    expect(missing).toEqual([]);
  });

  it("keeps split equip continuation fixtures under restore coverage ownership", () => {
    const files = realScriptEquipContinuationFixtureFiles();
    expect(files).toHaveLength(2);

    const missing = files
      .filter((file) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("restoreComplete")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("operationInfos");
      });

    expect(missing).toEqual([]);
  });
});

function realScriptEquipFixtureFiles(): string[] {
  return [
    "lua-real-script-equip-procedure-actions.test.ts",
    "lua-real-script-fairy-meteor-crush-equip-pierce.test.ts",
    "lua-real-script-gemini-booster-equip-destroy-status.test.ts",
    "lua-real-script-mask-accursed-equip-lock-damage.test.ts",
    "lua-real-script-premature-burial-revive-destroy.test.ts",
    "lua-real-script-snatch-steal-equip-control.test.ts",
    "lua-real-script-train-connection-equip-cost.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptEquipRelationFixtureFiles(): string[] {
  return [
    "lua-real-script-equip-procedure-actions.test.ts",
    "lua-real-script-equip-return-actions.test.ts",
    "lua-real-script-equip-stat-lock-actions.test.ts",
    "lua-real-script-fairy-meteor-crush-equip-pierce.test.ts",
    "lua-real-script-gemini-booster-equip-destroy-status.test.ts",
    "lua-real-script-mask-accursed-equip-lock-damage.test.ts",
    "lua-real-script-orb-yasaka-spirit-equip-return.test.ts",
    "lua-real-script-rider-storm-winds-equip-pierce.test.ts",
    "lua-real-script-snatch-steal-equip-control.test.ts",
    "lua-real-script-supervise-gemini-equip-revive.test.ts",
    "lua-real-script-train-connection-equip-cost.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptEquipProbeFixtureFiles(): string[] {
  return [
    "lua-real-script-equip-procedure-actions.test.ts",
    "lua-real-script-equip-return-actions.test.ts",
    "lua-real-script-equip-stat-lock-actions.test.ts",
    "lua-real-script-orb-yasaka-spirit-equip-return.test.ts",
    "lua-real-script-premature-burial-revive-destroy.test.ts",
    "lua-real-script-rider-storm-winds-equip-pierce.test.ts",
    "lua-real-script-snatch-steal-equip-control.test.ts",
    "lua-real-script-train-connection-equip-cost.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptEquipOperationInfoFixtureFiles(): string[] {
  return [
    "lua-real-script-equip-procedure-actions.test.ts",
    "lua-real-script-equip-return-actions.test.ts",
    "lua-real-script-equip-stat-lock-actions.test.ts",
    "lua-real-script-fairy-meteor-crush-equip-pierce.test.ts",
    "lua-real-script-gemini-booster-equip-destroy-status.test.ts",
    "lua-real-script-mask-accursed-equip-lock-damage.test.ts",
    "lua-real-script-snatch-steal-equip-control.test.ts",
    "lua-real-script-supervise-gemini-equip-revive.test.ts",
    "lua-real-script-train-connection-equip-cost.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptEquipCleanupFixtureFiles(): string[] {
  return [
    "lua-real-script-equip-procedure-actions.test.ts",
    "lua-real-script-equip-return-actions.test.ts",
    "lua-real-script-premature-burial-revive-destroy.test.ts",
    "lua-real-script-orb-yasaka-spirit-equip-return.test.ts",
    "lua-real-script-snatch-steal-equip-control.test.ts",
    "lua-real-script-supervise-gemini-equip-revive.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptEquipContinuationFixtureFiles(): string[] {
  return [
    "lua-real-script-equip-procedure-actions-part2.test.ts",
    "lua-real-script-equip-return-actions-part2.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}
