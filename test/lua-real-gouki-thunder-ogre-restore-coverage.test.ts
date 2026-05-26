import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const goukiThunderOgreKindCounts = { linkRegistrationMetadata: 1 } satisfies Record<GoukiThunderOgreKind, number>;
type GoukiThunderOgreKind = "linkRegistrationMetadata";

describe("Lua real Gouki Thunder Ogre restore coverage", () => {
  it("keeps Gouki Thunder Ogre's link registration metadata owned", () => {
    const file = "test/lua-real-script-gouki-thunder-ogre-registration.test.ts";
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
      'const thunderOgreCode = "30010480"',
      "Gouki Thunder Ogre",
      "restores Link procedure, extra summon count, and delayed destroyed ATK trigger metadata",
      "Link.AddProcedure(c,aux.FilterBoolFunctionEx(Card.IsSetCard,SET_GOUKI),2)",
      "c:EnableReviveLimit()",
      "e1:SetCode(EFFECT_EXTRA_SUMMON_COUNT)",
      "e1:SetTargetRange(LOCATION_HAND,LOCATION_HAND)",
      "e3:SetCode(EVENT_DESTROYED)",
      "e3:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DELAY)",
      "e:GetHandler():GetLinkedZone()",
      "e1:SetProperty(EFFECT_FLAG_COPY_INHERIT)",
      "e1:SetValue(400)",
      'triggerEvent: "destroyed"',
    ]) {
      expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
    }
  });

  it("keeps Gouki Thunder Ogre fixture kind explicit", () => {
    expect(goukiThunderOgreKindCounts).toEqual({ linkRegistrationMetadata: 1 });
  });
});
