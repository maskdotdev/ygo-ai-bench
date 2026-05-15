import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const geminiFixtureCount = 13;
const geminiStatusFixtureCount = 11;
const geminiOperationFixtureCount = 10;
const geminiStateFixtureCount = 4;

describe("Lua real Gemini restore coverage", () => {
  it("requires representative Gemini fixtures to assert clean Lua registry restore", () => {
    const files = geminiFixtureFiles();
    expect(files).toHaveLength(geminiFixtureCount);

    const missing = files
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys")
          || !text.includes("missingRegistryKeys).toEqual([])");
      });

    expect(missing).toEqual([]);
  });

  it("requires representative Gemini fixtures to prove grouped restored legal-action parity", () => {
    const files = geminiFixtureFiles();
    expect(files).toHaveLength(geminiFixtureCount);

    const missing = files
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("getDuelLegalActions")
          || !text.includes("applyLuaRestoreResponse");
      });

    expect(missing).toEqual([]);
  });

  it("requires Gemini status fixtures to probe restored IsGeminiStatus behavior", () => {
    const files = geminiStatusFixtureFiles();
    expect(files).toHaveLength(geminiStatusFixtureCount);

    const missing = files
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("IsGeminiStatus")
          || !/status .*true|status true|gemini status true/.test(text)
          || !/status .*false|status false|gemini status false/.test(text);
      });

    expect(missing).toEqual([]);
  });

  it("requires Gemini operation fixtures to pin operation info and final event history", () => {
    const files = geminiOperationFixtureFiles();
    expect(files).toHaveLength(geminiOperationFixtureCount);

    const missing = files
      .filter((file) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return !text.includes("operationInfos")
          || !text.includes("eventHistory")
          || !/eventName:\s*["'](released|counterAdded|sentToGraveyard|banished|destroyed|specialSummoned|cardsDrawn)["']/.test(text);
      });

    expect(missing).toEqual([]);
  });

  it("requires Gemini state fixtures to pin restored delayed, equip, and battle outcomes", () => {
    const files = geminiStateFixtureFiles();
    expect(files).toHaveLength(geminiStateFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = fs.readFileSync(path.join(root, file), "utf8");
        return required.some((snippet) => !text.includes(snippet));
      });

    expect(missing).toEqual([]);
  });
});

function geminiFixtureFiles(): string[] {
  return [
    "lua-real-script-blazewing-butterfly-gemini-revive-status.test.ts",
    "lua-real-script-chemicritter-hydron-hawk-discard-revive.test.ts",
    "lua-real-script-chemicritter-oxy-ox-gemini-level-change.test.ts",
    "lua-real-script-dark-valkyria-gemini-counter-destroy.test.ts",
    "lua-real-script-future-samurai-gemini-banish-destroy.test.ts",
    "lua-real-script-gemini-booster-equip-destroy-status.test.ts",
    "lua-real-script-gemini-soldier-battled-deck-summon.test.ts",
    "lua-real-script-gemini-spark-release-destroy-draw.test.ts",
    "lua-real-script-herculean-power-gemini-hand-summon.test.ts",
    "lua-real-script-magical-reflect-slime-gemini-battle-damage.test.ts",
    "lua-real-script-super-double-summon-gemini-return.test.ts",
    "lua-real-script-supervise-gemini-equip-revive.test.ts",
    "lua-real-script-unleash-your-power-gemini-delayed-set.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function geminiStatusFixtureFiles(): string[] {
  return [
    "lua-real-script-blazewing-butterfly-gemini-revive-status.test.ts",
    "lua-real-script-chemicritter-hydron-hawk-discard-revive.test.ts",
    "lua-real-script-chemicritter-oxy-ox-gemini-level-change.test.ts",
    "lua-real-script-dark-valkyria-gemini-counter-destroy.test.ts",
    "lua-real-script-future-samurai-gemini-banish-destroy.test.ts",
    "lua-real-script-gemini-booster-equip-destroy-status.test.ts",
    "lua-real-script-gemini-soldier-battled-deck-summon.test.ts",
    "lua-real-script-magical-reflect-slime-gemini-battle-damage.test.ts",
    "lua-real-script-super-double-summon-gemini-return.test.ts",
    "lua-real-script-supervise-gemini-equip-revive.test.ts",
    "lua-real-script-unleash-your-power-gemini-delayed-set.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function geminiOperationFixtureFiles(): string[] {
  return [
    "lua-real-script-blazewing-butterfly-gemini-revive-status.test.ts",
    "lua-real-script-chemicritter-hydron-hawk-discard-revive.test.ts",
    "lua-real-script-chemicritter-oxy-ox-gemini-level-change.test.ts",
    "lua-real-script-dark-valkyria-gemini-counter-destroy.test.ts",
    "lua-real-script-evocator-eveque-gemini-trigger.test.ts",
    "lua-real-script-future-samurai-gemini-banish-destroy.test.ts",
    "lua-real-script-gemini-spark-release-destroy-draw.test.ts",
    "lua-real-script-gemini-soldier-battled-deck-summon.test.ts",
    "lua-real-script-herculean-power-gemini-hand-summon.test.ts",
    "lua-real-script-supervise-gemini-equip-revive.test.ts",
  ]
    .map((file) => path.join("test", file))
    .sort();
}

function geminiStateFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-gemini-booster-equip-destroy-status.test.ts",
      required: [
        "operationInfos",
        'eventName: "leftField"',
        "equippedToUid: slime!.uid",
        "gemini booster status",
      ],
    },
    {
      file: "test/lua-real-script-magical-reflect-slime-gemini-battle-damage.test.ts",
      required: [
        'eventName: "battleDamageDealt"',
        "battleDamage).toEqual({ 0: 0, 1: 1300 })",
        "magical reflect slime gemini status",
      ],
    },
    {
      file: "test/lua-real-script-super-double-summon-gemini-return.test.ts",
      required: [
        'eventName: "phaseEnd"',
        'eventName: "sentToHand"',
        "super double gemini status",
      ],
    },
    {
      file: "test/lua-real-script-unleash-your-power-gemini-delayed-set.test.ts",
      required: [
        'eventName: "positionChanged"',
        "unleash gemini status",
        "position: \"faceDownDefense\"",
      ],
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}
