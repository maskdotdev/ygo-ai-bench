import { describe, expect, it } from "vitest";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "../src/index.js";

describe("public API", () => {
  it("exports fail-closed Lua snapshot restore helpers", () => {
    expect(restoreDuelWithLuaScripts).toBeTypeOf("function");
    expect(getLuaRestoreLegalActions).toBeTypeOf("function");
    expect(getLuaRestoreLegalActionGroups).toBeTypeOf("function");
    expect(applyLuaRestoreResponse).toBeTypeOf("function");
  });
});
