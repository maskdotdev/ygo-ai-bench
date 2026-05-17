import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const battledRemovalFixtureCount = 5;
const battledRemovalKindCounts = {
  afterDamageBanish: 2,
  battleDestroyRedirect: 1,
  battleDestroyedBackrowDestroy: 1,
  battleDestroyedMonsterDestroy: 1,
} satisfies Record<BattledRemovalKind, number>;

type BattledRemovalKind =
  | "afterDamageBanish"
  | "battleDestroyRedirect"
  | "battleDestroyedBackrowDestroy"
  | "battleDestroyedMonsterDestroy";

describe("Lua real battled-removal restore coverage", () => {
  it("requires battled removal fixtures to assert clean Lua registry restore and restored trigger outcomes", () => {
    const files = battledRemovalFixtureFiles();
    expect(files).toHaveLength(battledRemovalFixtureCount);

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
          || !text.includes("pendingTriggers")
          || !text.includes("eventHistory")
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps battled-removal fixture kinds explicit", () => {
    expect(countBattledRemovalKinds(battledRemovalFixtureFiles())).toEqual(battledRemovalKindCounts);
  });
});

function battledRemovalFixtureFiles(): Array<{
  file: string;
  kind: BattledRemovalKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-dd-assailant-battled-remove.test.ts",
      kind: "afterDamageBanish",
      required: [
        'eventName: "afterDamageCalculation"',
        'type === "activateTrigger"',
        'eventName: "banished"',
        'location: "banished", controller: 0',
        'location: "banished", controller: 1',
        "battleDestroyed",
      ],
    },
    {
      file: "test/lua-real-script-divine-knight-ishzark-battled-remove.test.ts",
      kind: "afterDamageBanish",
      required: [
        'eventName: "afterDamageCalculation"',
        'type === "activateTrigger"',
        'eventName: "banished"',
        'location: "banished", controller: 1',
        "deferredBattleDestroyed",
        "battleDestroyed",
      ],
    },
    {
      file: "test/lua-real-script-newdoria-battle-destroyed-target.test.ts",
      kind: "battleDestroyedMonsterDestroy",
      required: [
        'eventName: "battleDestroyed"',
        'type === "activateTrigger"',
        'eventName: "destroyed"',
        'location: "graveyard"',
        "reasonCardUid: attacker!.uid",
      ],
    },
    {
      file: "test/lua-real-script-lesser-fiend-battle-destroy-redirect.test.ts",
      kind: "battleDestroyRedirect",
      required: [
        'eventName: "battleDestroyed"',
        "pendingTriggers).toEqual([])",
        'eventName: "banished"',
        'location: "banished"',
        "code: 204",
        "reason: 0x4000021",
      ],
    },
    {
      file: "test/lua-real-script-yamato-no-kami-battle-destroy-backrow.test.ts",
      kind: "battleDestroyedBackrowDestroy",
      required: [
        'eventName: "battleDestroyed"',
        'type === "activateTrigger"',
        'eventName: "destroyed"',
        "operationInfos: [{ category: 0x1",
        "property: 0xc000",
        'location: "graveyard", controller: 1',
        "specialSummonProcedure",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: BattledRemovalKind;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countBattledRemovalKinds(fixtures: Array<{ kind: BattledRemovalKind }>): Record<BattledRemovalKind, number> {
  return fixtures.reduce<Record<BattledRemovalKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      afterDamageBanish: 0,
      battleDestroyRedirect: 0,
      battleDestroyedBackrowDestroy: 0,
      battleDestroyedMonsterDestroy: 0,
    },
  );
}
