import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const battlePhaseEventFixtureCount = 4;
const battlePhaseEventKindCounts = {
  delayedReturn: 1,
  destroyTrigger: 2,
  positionChange: 1,
} satisfies Record<BattlePhaseEventKind, number>;
const battlePhaseEventSemanticVariantCounts = {
  giantOrcBattlePhasePositionChange: 1,
  scrapWormAttackFlagDestroy: 1,
  skullConductorPhaseDestroy: 1,
  yellowAlertDelayedReturnLock: 1,
} satisfies Record<BattlePhaseEventSemanticVariant, number>;

type BattlePhaseEventKind = "delayedReturn" | "destroyTrigger" | "positionChange";

type BattlePhaseEventSemanticVariant =
  | "giantOrcBattlePhasePositionChange"
  | "scrapWormAttackFlagDestroy"
  | "skullConductorPhaseDestroy"
  | "yellowAlertDelayedReturnLock";

describe("Lua real Battle Phase event restore coverage", () => {
  it("requires representative Battle Phase event fixtures to assert clean Lua restore", () => {
    const fixtures = representativeBattlePhaseEventFixtures();
    expect(fixtures).toHaveLength(battlePhaseEventFixtureCount);

    const missing = fixtures
      .filter((fixture) => {
        const text = coverageText(fs.readFileSync(path.join(root, fixture.file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)");
      })
      .map((fixture) => fixture.file);

    expect(missing).toEqual([]);
  });

  it("requires representative Battle Phase event fixtures to prove restored phase-event behavior", () => {
    const fixtures = representativeBattlePhaseEventFixtures();
    expect(fixtures).toHaveLength(battlePhaseEventFixtureCount);

    const weak = fixtures
      .filter((fixture) => {
        const text = coverageText(fs.readFileSync(path.join(root, fixture.file), "utf8"));
        return !fixture.requiredSnippets.every((snippet) => hasCoverageSnippet(text, snippet));
      })
      .map((fixture) => fixture.file);

    expect(weak).toEqual([]);
  });

  it("keeps representative Battle Phase event fixture kinds explicit", () => {
    expect(countBattlePhaseEventKinds(representativeBattlePhaseEventFixtures())).toEqual(battlePhaseEventKindCounts);
  });

  it("keeps named Battle Phase event semantic variants explicit", () => {
    expect(countBattlePhaseEventSemanticVariants(representativeBattlePhaseEventSemanticVariants())).toEqual(battlePhaseEventSemanticVariantCounts);

    const weak = representativeBattlePhaseEventSemanticVariants()
      .filter((fixture) => {
        const text = coverageText(fs.readFileSync(path.join(root, fixture.file), "utf8"));
        return fixture.requiredSnippets.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map((fixture) => fixture.kind);

    expect(weak).toEqual([]);
  });

  it("keeps Battle Phase event fixtures script-gated and database-independent", () => {
    const weak = representativeBattlePhaseEventSemanticVariants()
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

function representativeBattlePhaseEventFixtures(): Array<{
  file: string;
  kind: BattlePhaseEventKind;
  requiredSnippets: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-giant-orc-battle-phase-position.test.ts",
      kind: "positionChange",
      requiredSnippets: [
        'event: "continuous", code: 0x1080',
        'eventName: "phaseBattle", eventCode: 0x1080',
        'eventName: "positionChanged", eventCode: 1016',
        'position: "faceUpDefense"',
      ],
    },
    {
      file: "test/lua-real-script-scrap-worm-battle-phase-destroy.test.ts",
      kind: "destroyTrigger",
      requiredSnippets: [
        'event: "trigger", triggerEvent: "phaseBattle"',
        'eventName: "phaseBattle"',
        'triggerBucket: "turnMandatory"',
        'action.type === "activateTrigger"',
        'eventName: "destroyed"',
        "eventCode: 1029",
      ],
    },
    {
      file: "test/lua-real-script-skull-conductor-battle-phase-destroy.test.ts",
      kind: "destroyTrigger",
      requiredSnippets: [
        'event: "trigger"',
        'triggerEvent: "phaseBattle"',
        'eventName: "phaseBattle"',
        'triggerBucket: "turnMandatory"',
        'action.type === "activateTrigger"',
        'eventName: "destroyed"',
      ],
    },
    {
      file: "test/lua-real-script-yellow-alert-delayed-return.test.ts",
      kind: "delayedReturn",
      requiredSnippets: [
        'event: "continuous"',
        'triggerEvent": "phaseBattle"',
        'action.type === "changePhase" && action.phase === "main2"',
        'location: "hand", controller: 1',
        "expectAttackTarget(restored.session, secondAttacker!.uid, summonedTarget!.uid, true)",
        "expectAttackTarget(restored.session, secondAttacker!.uid, originalTarget!.uid, false)",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: BattlePhaseEventKind;
    requiredSnippets: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countBattlePhaseEventKinds(
  fixtures: Array<{ kind: BattlePhaseEventKind }>,
): Record<BattlePhaseEventKind, number> {
  return fixtures.reduce<Record<BattlePhaseEventKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      delayedReturn: 0,
      destroyTrigger: 0,
      positionChange: 0,
    },
  );
}

function representativeBattlePhaseEventSemanticVariants(): Array<{
  file: string;
  kind: BattlePhaseEventSemanticVariant;
  requiredSnippets: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-giant-orc-battle-phase-position.test.ts",
      kind: "giantOrcBattlePhasePositionChange",
      requiredSnippets: [
        'const giantOrcCode = "73698349"',
        "restores the Battle Phase event after an attack and changes itself to Defense Position",
        "battlePairs).toEqual([{ attackerUid: giantOrc!.uid, targetUid: target!.uid }])",
        'eventName: "positionChanged"',
        'position: "faceUpDefense"',
      ],
    },
    {
      file: "test/lua-real-script-scrap-worm-battle-phase-destroy.test.ts",
      kind: "scrapWormAttackFlagDestroy",
      requiredSnippets: [
        'const scrapWormCode = "32761286"',
        "restores its attack flag and mandatory Battle Phase trigger destruction",
        'triggerEvent": "attackDeclared"',
        "flagEffects).toEqual(expect.arrayContaining([expect.objectContaining({ ownerId: scrapWorm!.uid, code: Number(scrapWormCode) })]))",
        "eventReasonEffectId: 2",
      ],
    },
    {
      file: "test/lua-real-script-skull-conductor-battle-phase-destroy.test.ts",
      kind: "skullConductorPhaseDestroy",
      requiredSnippets: [
        'const skullConductorCode = "62782218"',
        "restores its mandatory Battle Phase trigger and destroys itself",
        'registryKey": "lua:62782218:lua-1-4224"',
        "effectId: \"lua-1-4224\"",
        "eventReasonEffectId: 1",
      ],
    },
    {
      file: "test/lua-real-script-yellow-alert-delayed-return.test.ts",
      kind: "yellowAlertDelayedReturnLock",
      requiredSnippets: [
        'const yellowAlertCode = "59277750"',
        "restores the temporary battle target lock and returns the summoned monster at the end of the Battle Phase",
        'luaValueDescriptor": "value-card:not-handler"',
        "expectAttackTarget(restored.session, secondAttacker!.uid, summonedTarget!.uid, true)",
        "expectAttackTarget(restored.session, secondAttacker!.uid, originalTarget!.uid, false)",
        'location: "hand", controller: 1',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: BattlePhaseEventSemanticVariant;
    requiredSnippets: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countBattlePhaseEventSemanticVariants(
  fixtures: Array<{ kind: BattlePhaseEventSemanticVariant }>,
): Record<BattlePhaseEventSemanticVariant, number> {
  return fixtures.reduce<Record<BattlePhaseEventSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      giantOrcBattlePhasePositionChange: 0,
      scrapWormAttackFlagDestroy: 0,
      skullConductorPhaseDestroy: 0,
      yellowAlertDelayedReturnLock: 0,
    },
  );
}
