import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const equipFixtureCount = 1;
const equipRelationFixtureCount = 8;
const equipProbeFixtureCount = 8;
const equipOperationInfoFixtureCount = 6;
const equipCleanupFixtureCount = 6;

describe("Lua real equip restore coverage", () => {
  it("requires representative equip fixtures to assert grouped legal actions and clean Lua registry restore", () => {
    const files = realScriptEquipFixtureFiles();
    expect(files).toHaveLength(equipFixtureCount);

    const missing = files
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])");
      });

    expect(missing).toEqual([]);
  });

  it("requires representative equip fixtures to prove restored equip relation and response suppression", () => {
    const files = realScriptEquipRelationFixtureFiles();
    expect(files).toHaveLength(equipRelationFixtureCount);

    const missing = files
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !/location:\s*["']spellTrapZone["']/.test(text)
          || !text.includes("equippedToUid")
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !/host\.messages\)\.not\.toContain/.test(text);
      });

    expect(missing).toEqual([]);
  });

  it("requires representative equip activation fixtures to pin operation info metadata", () => {
    const files = realScriptEquipOperationInfoFixtureFiles();
    expect(files).toHaveLength(equipOperationInfoFixtureCount);

    const missing = files
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("operationInfos")
          || !/category:\s*0x40000/.test(text);
      });

    expect(missing).toEqual([]);
  });

  it("requires equip probe fixtures to prove restored Lua equip APIs and stat/control effects", () => {
    const files = realScriptEquipProbeFixtureFiles();
    expect(files).toHaveLength(equipProbeFixtureCount);

    const missing = files
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !/host\.messages\)\.toContain/.test(text)
          || !/probe/.test(text)
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !/GetEquipTarget|GetFirstCardTarget|IsHasEffect|GetAttack|GetControler/.test(text);
      });

    expect(missing).toEqual([]);
  });

  it("requires equip cleanup fixtures to prove leave-field cleanup and triggered follow-up state", () => {
    const files = realScriptEquipCleanupFixtureFiles();
    expect(files).toHaveLength(equipCleanupFixtureCount);

    const missing = files
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !/previousEquippedToUid/.test(text)
          || !/location:\s*["']graveyard["']/.test(text)
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !/eventName:\s*["']sentToGraveyard["']|eventName:\s*["']destroyed["']|previousController/.test(text);
      });

    expect(missing).toEqual([]);
  });
});

function realScriptEquipFixtureFiles(): string[] {
  return [
    "lua-real-script-equip-procedure-actions.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function realScriptEquipRelationFixtureFiles(): string[] {
  return [
    "lua-real-script-equip-procedure-actions.test.ts",
    "lua-real-script-equip-return-actions.test.ts",
    "lua-real-script-equip-stat-lock-actions.test.ts",
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
