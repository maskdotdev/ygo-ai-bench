import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();

describe("Lua real War Rock Ordeal restore coverage", () => {
  it("owns battle-destroyed draw with last-counter self-send", () => {
    const file = "test/lua-real-script-war-rock-ordeal-counter-draw.test.ts";
    const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));

    expect(text).toContain("restoreDuelWithLuaScripts");
    expect(text).toContain("restoreComplete");
    expect(text).toContain('incompleteReasons.join("; ")');
    expect(text).toContain("missingRegistryKeys).toEqual([])");
    expect(text).toContain("missingChainLimitRegistryKeys).toEqual([])");
    expect(text).toContain("getLuaRestoreLegalActions");
    expect(text).toContain("getLuaRestoreLegalActionGroups");
    expect(text).toContain("getGroupedDuelLegalActions");
    expect(text).toContain("flatMap((group) => group.actions)");

    const required = [
      'const ordealCode = "71331215"',
      "War Rock Ordeal",
      "restores battle-destroyed counter removal into draw plus last-counter self-send",
      "c:EnableCounterPermit(0x205)",
      "e1:SetCategory(CATEGORY_COUNTER)",
      "e1:SetCode(EVENT_FREE_CHAIN)",
      "e:GetHandler():AddCounter(0x205,3)",
      "e2:SetCategory(CATEGORY_COUNTER+CATEGORY_DRAW)",
      "e2:SetCode(EVENT_BATTLE_DESTROYED)",
      "rc:IsSetCard(SET_WAR_ROCK)",
      "Duel.SetOperationInfo(0,CATEGORY_COUNTER,e:GetHandler(),1,tp,LOCATION_SZONE)",
      "Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,1,tp,LOCATION_DECK)",
      "e:GetHandler():RemoveCounter(tp,0x205,1,REASON_EFFECT)",
      "Duel.RaiseEvent(c,EVENT_REMOVE_COUNTER+0x205,e,REASON_EFFECT,tp,tp,1)",
      "Duel.Draw(tp,1,REASON_EFFECT)",
      "e3:SetCode(EVENT_REMOVE_COUNTER+0x205)",
      "Duel.SendtoGrave(e:GetHandler(),REASON_EFFECT)",
      'eventName: "battleDestroyed"',
      'eventName: "counterRemoved"',
      'eventName: "cardsDrawn"',
      'eventName: "sentToGraveyard"',
    ];
    expect(required.filter((snippet) => !hasCoverageSnippet(text, snippet))).toEqual([]);
  });
});
