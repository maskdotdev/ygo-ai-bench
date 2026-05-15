import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const battleDamageTriggerFixtureCount = 4;

describe("Lua real battle-damage trigger restore coverage", () => {
  it("requires battle-damage trigger fixtures to assert clean Lua registry restore and carried event payloads", () => {
    const files = battleDamageTriggerFixtureFiles();
    expect(files).toHaveLength(battleDamageTriggerFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires UI-facing legal-action parity while restored battle-damage triggers are pending or chained", () => {
    const files = battleDamageTriggerFixtureFiles();
    expect(files).toHaveLength(battleDamageTriggerFixtureCount);

    const missing = files
      .filter(({ file }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("getLuaRestoreLegalActions");
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });
});

function battleDamageTriggerFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "lua-real-script-fushi-no-tori-battle-recover.test.ts",
      required: [
        "Fushi No Tori battle recover",
        "eventName: \"battleDamageDealt\"",
        "eventPlayer: 1",
        "eventValue: 700",
        "targetPlayer: 0",
        "targetParam: 700",
        "category: 0x100000",
        "property: 0xc000",
        "eventName: \"recoveredLifePoints\"",
        "players[0].lifePoints).toBe(8700)",
      ],
    },
    {
      file: "lua-real-script-great-long-nose-skip-battle.test.ts",
      required: [
        "Great Long Nose battle skip",
        "eventName: \"battleDamageDealt\"",
        "eventPlayer: 1",
        "code: 183",
        "targetRange: [0, 1]",
        "phase: \"main1\", waitingFor: 1",
        "phase: \"main2\"",
        "phase: \"battle\"",
      ],
    },
    {
      file: "lua-real-script-hino-kagu-tsuchi-predraw-discard.test.ts",
      required: [
        "Hino-Kagu-Tsuchi predraw discard",
        "eventName: \"battleDamageDealt\"",
        "eventPlayer: 1",
        "eventValue: 1800",
        "code: 1113",
        "eventName: \"preDraw\"",
        "eventName: \"discarded\"",
      ],
    },
    {
      file: "lua-real-script-yamata-dragon-battle-damage-draw.test.ts",
      required: [
        "Yamata Dragon battle-damage draw",
        "eventName: \"battleDamageDealt\"",
        "eventPlayer: 1",
        "eventValue: 1600",
        "eventName: \"cardsDrawn\"",
        "eventValue: 3",
        "eventUids: [drawA!.uid, drawB!.uid, drawC!.uid]",
      ],
    },
  ]
    .map(({ file, required }) => ({ file: path.join("test", file), required }))
    .sort((a, b) => a.file.localeCompare(b.file));
}
