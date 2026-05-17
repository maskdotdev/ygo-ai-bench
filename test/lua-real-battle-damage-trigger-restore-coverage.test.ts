import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const battleDamageTriggerFixtureCount = 5;
const battleDamageTriggerKindCounts = {
  drawUntilFive: 1,
  predrawDiscard: 1,
  recoverLifePoints: 1,
  skipBattlePhase: 1,
  skipDrawPhase: 1,
} satisfies Record<BattleDamageTriggerKind, number>;

type BattleDamageTriggerKind = "drawUntilFive" | "predrawDiscard" | "recoverLifePoints" | "skipBattlePhase" | "skipDrawPhase";

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

  it("keeps battle-damage trigger fixture kinds explicit", () => {
    expect(countBattleDamageTriggerKinds(battleDamageTriggerFixtureFiles())).toEqual(battleDamageTriggerKindCounts);
  });
});

function battleDamageTriggerFixtureFiles(): Array<{
  file: string;
  kind: BattleDamageTriggerKind;
  required: string[];
}> {
  return ([
    {
      file: "lua-real-script-fushi-no-tori-battle-recover.test.ts",
      kind: "recoverLifePoints",
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
      kind: "skipBattlePhase",
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
      kind: "predrawDiscard",
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
      kind: "drawUntilFive",
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
    {
      file: "lua-real-script-yata-garasu-skip-draw.test.ts",
      kind: "skipDrawPhase",
      required: [
        "Yata-Garasu skip draw",
        "eventName: \"battleDamageDealt\"",
        "eventPlayer: 1",
        "eventValue: 200",
        'skippedPhases).toEqual([{ player: 1, phase: "draw", remaining: 1 }])',
        'phase: "main1", waitingFor: 1',
        'eventName === "preDraw"',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: BattleDamageTriggerKind;
    required: string[];
  }>)
    .map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function countBattleDamageTriggerKinds(
  fixtures: Array<{ kind: BattleDamageTriggerKind }>,
): Record<BattleDamageTriggerKind, number> {
  return fixtures.reduce<Record<BattleDamageTriggerKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      drawUntilFive: 0,
      predrawDiscard: 0,
      recoverLifePoints: 0,
      skipBattlePhase: 0,
      skipDrawPhase: 0,
    },
  );
}
