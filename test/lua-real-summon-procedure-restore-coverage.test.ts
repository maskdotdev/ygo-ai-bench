import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const SUMMON_PROCEDURE_FIXTURE_COUNT = 4;
const summonProcedureKindCounts = {
  broadTypedProcedure: 1,
  graveBanishCostStatProcedure: 1,
  handOpponentCountProcedure: 1,
  handSendCostProcedure: 1,
} satisfies Record<SummonProcedureKind, number>;

type SummonProcedureKind =
  | "broadTypedProcedure"
  | "graveBanishCostStatProcedure"
  | "handOpponentCountProcedure"
  | "handSendCostProcedure";

const summonProcedureFixtures = [
  {
    file: "test/lua-real-script-summon-procedure.test.ts",
    kind: "broadTypedProcedure",
    required: [
      'action.type === "specialSummonProcedure"',
      'action.type === "xyzSummon"',
      'action.type === "linkSummon"',
      'action.type === "synchroSummon"',
      'summonType: "xyz"',
      'summonType: "link"',
      'summonType: "synchro"',
      "Spirit procedure End Phase return",
      "real cannot-be-Special-Summoned conditions for Spirit monsters",
      "real Gemini second Normal Summon triggers",
      "triggerRestored.missingRegistryKeys).toEqual([])",
      "triggerRestored.missingChainLimitRegistryKeys).toEqual([])",
    ],
  },
  {
    file: "test/lua-real-script-pankratops-special-summon-procedure.test.ts",
    kind: "handOpponentCountProcedure",
    required: [
      "opponent-controls-more-monsters hand Special Summon procedure",
      'action.type === "specialSummonProcedure"',
      "getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0))",
      "getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0))",
      "applyRestoredActionAndAssert(restored, procedure!)",
      'eventName: "specialSummoned"',
      "eventReason: duelReason.summon | duelReason.specialSummon",
    ],
  },
  {
    file: "test/lua-real-script-gigarays-gandora-special-summon-procedure.test.ts",
    kind: "handSendCostProcedure",
    required: [
      "two-monster send-to-Graveyard hand Special Summon procedure cost",
      'action.type === "specialSummonProcedure"',
      "getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0))",
      "getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0))",
      "applyRestoredActionAndAssert(restored, procedure!)",
      'eventName: "sentToGraveyard"',
      "eventReason: duelReason.cost",
    ],
  },
  {
    file: "test/lua-real-script-megarock-dragon-special-summon-procedure.test.ts",
    kind: "graveBanishCostStatProcedure",
    required: [
      "Rock graveyard banish-cost procedure and selected-count base stats",
      'action.type === "specialSummonProcedure"',
      "getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0))",
      "getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0))",
      "applyRestoredActionAndAssert(restored, procedure!)",
      'location: "banished"',
      "previousLocation: \"graveyard\"",
      "currentAttack(restoredMegarock, restored.session.state)).toBe(700)",
    ],
  },
] satisfies Array<{
  file: string;
  kind: SummonProcedureKind;
  required: string[];
}>;

describe("Lua real summon procedure restore coverage", () => {
  it("requires the broad summon procedure fixture to assert clean restore and restored legal actions", () => {
    expect(summonProcedureFixtures).toHaveLength(SUMMON_PROCEDURE_FIXTURE_COUNT);

    for (const { file, required } of summonProcedureFixtures) {
      const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));

      expect(text.includes("restoreDuelWithLuaScripts")).toBe(true);
      expect(text.includes("restoreComplete")).toBe(true);
      expect(text.includes('incompleteReasons.join("; ")')).toBe(true);
      expect(text.includes("missingRegistryKeys).toEqual([])")).toBe(true);
      expect(text.includes("missingChainLimitRegistryKeys).toEqual([])")).toBe(true);
      for (const snippet of required) {
        expect(hasCoverageSnippet(text, snippet), `${file} missing ${snippet}`).toBe(true);
      }
    }
  });

  it("keeps summon procedure fixture kinds explicit", () => {
    expect(countSummonProcedureKinds(summonProcedureFixtures)).toEqual(summonProcedureKindCounts);
  });
});

function countSummonProcedureKinds(
  fixtures: Array<{ kind: SummonProcedureKind }>,
): Record<SummonProcedureKind, number> {
  return fixtures.reduce<Record<SummonProcedureKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      broadTypedProcedure: 0,
      graveBanishCostStatProcedure: 0,
      handOpponentCountProcedure: 0,
      handSendCostProcedure: 0,
    },
  );
}
