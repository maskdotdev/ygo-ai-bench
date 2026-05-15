import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const SUMMON_PROCEDURE_FIXTURE_COUNT = 1;

describe("Lua real summon procedure restore coverage", () => {
  it("requires the broad summon procedure fixture to assert clean restore and restored legal actions", () => {
    const file = "test/lua-real-script-summon-procedure.test.ts";
    expect([file]).toHaveLength(SUMMON_PROCEDURE_FIXTURE_COUNT);

    const text = fs.readFileSync(path.join(root, file), "utf8");

    expect(text.includes("restoreDuelWithLuaScripts")).toBe(true);
    expect(text.includes("restoreComplete")).toBe(true);
    expect(text.includes('incompleteReasons.join("; ")')).toBe(true);
    expect(text.includes("missingRegistryKeys).toEqual([])")).toBe(true);
    expect(text.includes("missingChainLimitRegistryKeys).toEqual([])")).toBe(true);
    expect(text.includes("getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0))")).toBe(true);
    expect(text.includes('action.type === "specialSummonProcedure"')).toBe(true);
    expect(text.includes('action.type === "xyzSummon"')).toBe(true);
    expect(text.includes('action.type === "linkSummon"')).toBe(true);
    expect(text.includes('action.type === "synchroSummon"')).toBe(true);
    expect(text.includes('summonType: "xyz"')).toBe(true);
    expect(text.includes('summonType: "link"')).toBe(true);
    expect(text.includes('summonType: "synchro"')).toBe(true);
    expect(text.includes("Spirit procedure End Phase return")).toBe(true);
    expect(text.includes("real cannot-be-Special-Summoned conditions for Spirit monsters")).toBe(true);
    expect(text.includes("real Gemini second Normal Summon triggers")).toBe(true);
    expect(text.includes("triggerRestored.missingRegistryKeys).toEqual([])")).toBe(true);
    expect(text.includes("triggerRestored.missingChainLimitRegistryKeys).toEqual([])")).toBe(true);
  });
});
