import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const spiritReturnFixtureCount = 5;

describe("Lua real Spirit return restore coverage", () => {
  it("requires Spirit return and bounce fixtures to assert clean Lua registry restore and payload outcomes", () => {
    const files = spiritReturnFixtureFiles();
    expect(files).toHaveLength(spiritReturnFixtureCount);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("eventHistory")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires UI-facing legal-action parity through restored Spirit trigger and chain windows", () => {
    const files = spiritReturnFixtureFiles();
    expect(files).toHaveLength(spiritReturnFixtureCount);

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

function spiritReturnFixtureFiles(): Array<{ file: string; required: string[] }> {
  return [
    {
      file: "lua-real-script-hebo-spirit-grant-return.test.ts",
      required: [
        "Hebo Spirit grant return",
        "target-granted Spirit type",
        "code: effectAddType",
        "code: phaseEndEvent",
        "eventName: \"sentToHand\"",
        "eventCardUid: target!.uid",
      ],
    },
    {
      file: "lua-real-script-izanami-spirit-grave-return.test.ts",
      required: [
        "Izanami Spirit Graveyard return",
        "eventName: \"discarded\"",
        "operationInfos: [{ category: 0x8",
        "eventName: \"sentToHand\"",
        "eventName: \"confirmed\"",
        "eventName: \"sentToHandConfirmed\"",
      ],
    },
    {
      file: "lua-real-script-rasetsu-spirit-cost-return.test.ts",
      required: [
        "Rasetsu Spirit cost return",
        "confirmed 1:",
        "operationInfos: [{ category: 0x8",
        "rasetsu can special false",
        "eventName: \"confirmed\"",
        "eventName: \"sentToHand\"",
      ],
    },
    {
      file: "lua-real-script-shinobird-pigeon-spirit-return.test.ts",
      required: [
        "Shinobird Pigeon Spirit return",
        "operationInfos: [{ category: 0x8",
        "targetUids).not.toContain(pigeon!.uid)",
        "targetUids).not.toContain(invalidMonster!.uid)",
        "eventName: \"sentToHand\"",
      ],
    },
    {
      file: "lua-real-script-spiritual-energy-settle-machine-return-lock.test.ts",
      required: [
        "Spiritual Energy Settle Machine return lock",
        'action.type === "activateTrigger"',
        "toBe(false)",
        "settle leaves 1",
        "eventName: \"sentToHand\"",
        "eventCardUid: yata.uid",
        "eventCardUid: opponentSpirit.uid",
      ],
    },
  ]
    .map(({ file, required }) => ({ file: path.join("test", file), required }))
    .sort((a, b) => a.file.localeCompare(b.file));
}
