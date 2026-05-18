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
const battleDamageTriggerSemanticVariantCounts = {
  fushiNoToriBattleRecover: 1,
  greatLongNoseBattleSkip: 1,
  hinoKaguTsuchiPredrawDiscard: 1,
  yamataDragonDrawUntilFive: 1,
  yataGarasuSkipDraw: 1,
} satisfies Record<BattleDamageTriggerSemanticVariant, number>;

type BattleDamageTriggerKind = "drawUntilFive" | "predrawDiscard" | "recoverLifePoints" | "skipBattlePhase" | "skipDrawPhase";

type BattleDamageTriggerSemanticVariant =
  | "fushiNoToriBattleRecover"
  | "greatLongNoseBattleSkip"
  | "hinoKaguTsuchiPredrawDiscard"
  | "yamataDragonDrawUntilFive"
  | "yataGarasuSkipDraw";

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

  it("keeps named battle-damage trigger semantic variants explicit", () => {
    expect(countBattleDamageTriggerSemanticVariants(battleDamageTriggerSemanticVariants())).toEqual(battleDamageTriggerSemanticVariantCounts);

    const weak = battleDamageTriggerSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });

  it("keeps battle-damage trigger fixtures script-gated and database-independent", () => {
    const weak = battleDamageTriggerSemanticVariants()
      .filter(({ file }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return text.includes("readDatabaseCards")
          || text.includes("hasUpstreamDatabase")
          || !text.includes("workspace.readScript")
          || !text.includes("describe.skipIf(!hasUpstreamScripts || !has");
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
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

function battleDamageTriggerSemanticVariants(): Array<{
  file: string;
  kind: BattleDamageTriggerSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "lua-real-script-fushi-no-tori-battle-recover.test.ts",
      kind: "fushiNoToriBattleRecover",
      required: [
        'const fushiCode = "38538445"',
        "restores its battle-damage trigger into CHAININFO target-param LP recovery",
        "eventName: \"battleDamageDealt\"",
        "targetPlayer: 0",
        "targetParam: 700",
        "eventName: \"recoveredLifePoints\"",
        "players[0].lifePoints).toBe(8700)",
      ],
    },
    {
      file: "lua-real-script-great-long-nose-skip-battle.test.ts",
      kind: "greatLongNoseBattleSkip",
      required: [
        'const noseCode = "2356994"',
        "restores its battle-damage trigger into an opponent Battle Phase skip",
        "eventName: \"battleDamageDealt\"",
        "code: 183",
        "targetRange: [0, 1]",
        "phase: \"main1\", waitingFor: 1",
        "phase: \"main2\"",
      ],
    },
    {
      file: "lua-real-script-hino-kagu-tsuchi-predraw-discard.test.ts",
      kind: "hinoKaguTsuchiPredrawDiscard",
      required: [
        'const hinoCode = "75745607"',
        "restores its battle-damage trigger into the opponent's next Draw Phase hand discard",
        "eventName: \"battleDamageDealt\"",
        "eventValue: 1800",
        "code: 1113",
        "eventName: \"preDraw\"",
        "eventName: \"discarded\"",
      ],
    },
    {
      file: "lua-real-script-yamata-dragon-battle-damage-draw.test.ts",
      kind: "yamataDragonDrawUntilFive",
      required: [
        'const yamataCode = "76862289"',
        "restores its battle-damage trigger and draws until 5 from CHAININFO_TARGET_PLAYER",
        "eventName: \"battleDamageDealt\"",
        "eventValue: 1600",
        "eventName: \"cardsDrawn\"",
        "eventUids: [drawA!.uid, drawB!.uid, drawC!.uid]",
      ],
    },
    {
      file: "lua-real-script-yata-garasu-skip-draw.test.ts",
      kind: "yataGarasuSkipDraw",
      required: [
        'const yataCode = "3078576"',
        "restores its battle-damage trigger into the opponent's next Draw Phase skip",
        "eventName: \"battleDamageDealt\"",
        "eventValue: 200",
        'skippedPhases).toEqual([{ player: 1, phase: "draw", remaining: 1 }])',
        'eventName === "preDraw"',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: BattleDamageTriggerSemanticVariant;
    required: string[];
  }>)
    .map(({ file, kind, required }) => ({ file: path.join("test", file), kind, required }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

function countBattleDamageTriggerSemanticVariants(
  fixtures: Array<{ kind: BattleDamageTriggerSemanticVariant }>,
): Record<BattleDamageTriggerSemanticVariant, number> {
  return fixtures.reduce<Record<BattleDamageTriggerSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      fushiNoToriBattleRecover: 0,
      greatLongNoseBattleSkip: 0,
      hinoKaguTsuchiPredrawDiscard: 0,
      yamataDragonDrawUntilFive: 0,
      yataGarasuSkipDraw: 0,
    },
  );
}
