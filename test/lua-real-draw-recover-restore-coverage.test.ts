import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const DRAW_RECOVER_FIXTURE_COUNT = 8;
const drawRecoverKindCounts = {
  costBanishDraw: 2,
  drawRecoverOrDamage: 2,
  drawTrigger: 2,
  negateThenDraw: 1,
  releaseDestroyDraw: 1,
} satisfies Record<DrawRecoverKind, number>;

type DrawRecoverKind = "costBanishDraw" | "drawRecoverOrDamage" | "drawTrigger" | "negateThenDraw" | "releaseDestroyDraw";

describe("Lua real draw and recover restore coverage", () => {
  it("requires draw/recover fixtures to assert clean Lua registry restore and restored event outcomes", () => {
    const files = drawRecoverFixtureFiles();
    expect(files).toHaveLength(DRAW_RECOVER_FIXTURE_COUNT);

    const missing = files
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("applyLuaRestoreResponse")
          || !text.includes("eventHistory")
          || !text.includes("operationInfos")
          || !text.includes('eventName: "cardsDrawn"')
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps draw/recover fixture kinds explicit", () => {
    expect(countDrawRecoverKinds(drawRecoverFixtureFiles())).toEqual(drawRecoverKindCounts);
  });
});

function drawRecoverFixtureFiles(): Array<{
  file: string;
  kind: DrawRecoverKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-bad-reaction-reverse-recover.test.ts",
      kind: "drawRecoverOrDamage",
      required: [
        'eventName: "cardsDrawn"',
        'eventName: "damageDealt"',
        "targetPlayer: 0",
        "targetParam: 1",
        "category: 0x100000",
        "players[1].lifePoints).toBe(7000)",
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-dark-bribe-negate-draw.test.ts",
      kind: "negateThenDraw",
      required: [
        'eventName: "cardsDrawn"',
        'eventName: "chainNegated"',
        'eventName: "chainDisabled"',
        "category: 65536",
        'location: "graveyard"',
        'location: "hand", controller: 0',
        'recoveredLifePoints")).toEqual([])',
      ],
    },
    {
      file: "test/lua-real-script-gemini-spark-release-destroy-draw.test.ts",
      kind: "releaseDestroyDraw",
      required: [
        'eventName: "cardsDrawn"',
        'eventName: "released"',
        "category: 0x10000",
        "parameter: 1",
        'location: "graveyard"',
        'location: "hand", controller: 0',
        "gemini spark responder resolved",
      ],
    },
    {
      file: "test/lua-real-script-naturia-ragweed-event-draw-trigger.test.ts",
      kind: "drawTrigger",
      required: [
        'eventName: "cardsDrawn"',
        "targetPlayer: 1",
        "targetParam: 2",
        "category: 0x10000",
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-pot-of-desires-deck-cost.test.ts",
      kind: "costBanishDraw",
      required: [
        'eventName: "cardsDrawn"',
        "targetPlayer: 0",
        "targetParam: 2",
        "category: 65536",
        'location: "banished"',
        'location: "hand", controller: 0',
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-pot-of-extravagance-extra-cost.test.ts",
      kind: "costBanishDraw",
      required: [
        'eventName: "cardsDrawn"',
        "targetPlayer: 0",
        "targetParam: 1",
        "category: 65536",
        "randomCounter).toBe(1)",
        'location: "banished"',
        'location: "hand", controller: 0',
        'location: "graveyard"',
      ],
    },
    {
      file: "test/lua-real-script-shinobird-crane-spirit-summon-draw.test.ts",
      kind: "drawTrigger",
      required: [
        'eventName: "normalSummoned"',
        "targetPlayer: 0",
        "targetParam: 1",
        "category: 0x10000",
        'location: "hand", controller: 0',
      ],
    },
    {
      file: "test/lua-real-script-upstart-goblin-draw-recover.test.ts",
      kind: "drawRecoverOrDamage",
      required: [
        "category: 0x10000",
        "category: 0x100000",
        'eventName: "recoveredLifePoints"',
        "players[1].lifePoints).toBe(9000)",
        'location: "graveyard"',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: DrawRecoverKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countDrawRecoverKinds(fixtures: Array<{ kind: DrawRecoverKind }>): Record<DrawRecoverKind, number> {
  return fixtures.reduce<Record<DrawRecoverKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      costBanishDraw: 0,
      drawRecoverOrDamage: 0,
      drawTrigger: 0,
      negateThenDraw: 0,
      releaseDestroyDraw: 0,
    },
  );
}
