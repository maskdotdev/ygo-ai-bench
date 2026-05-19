import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const SUMMON_PROCEDURE_FIXTURE_COUNT = 7;
const EVENT_RICH_SUMMON_PROCEDURE_FIXTURE_COUNT = 6;
const summonProcedureKindCounts = {
  broadTypedProcedure: 1,
  deckTwoMaterialShufflePierceProcedure: 1,
  graveBanishCostStatProcedure: 1,
  handOwnFaceupAttributeOpenZoneProcedure: 1,
  handBothFieldsGimmickOnlyProcedure: 1,
  handOpponentCountProcedure: 1,
  handSendCostProcedure: 1,
} satisfies Record<SummonProcedureKind, number>;
const summonProcedureSemanticVariantCounts = {
  broadTypedExtraDeckSpiritGeminiProcedures: 1,
  caligoClawCrowDarkMonsterOpenZoneProcedure: 1,
  familiarPossessedDeckTwoMaterialShufflePierceProcedure: 1,
  gigaraysGandoraTwoMonsterSendCostProcedure: 1,
  magnetDollBothFieldsGimmickOnlyHandProcedure: 1,
  megarockDragonGraveBanishStatProcedure: 1,
  pankratopsOpponentControlsMoreHandProcedure: 1,
} satisfies Record<SummonProcedureSemanticVariant, number>;

type SummonProcedureKind =
  | "broadTypedProcedure"
  | "deckTwoMaterialShufflePierceProcedure"
  | "graveBanishCostStatProcedure"
  | "handOwnFaceupAttributeOpenZoneProcedure"
  | "handBothFieldsGimmickOnlyProcedure"
  | "handOpponentCountProcedure"
  | "handSendCostProcedure";
type SummonProcedureSemanticVariant =
  | "broadTypedExtraDeckSpiritGeminiProcedures"
  | "caligoClawCrowDarkMonsterOpenZoneProcedure"
  | "familiarPossessedDeckTwoMaterialShufflePierceProcedure"
  | "gigaraysGandoraTwoMonsterSendCostProcedure"
  | "magnetDollBothFieldsGimmickOnlyHandProcedure"
  | "megarockDragonGraveBanishStatProcedure"
  | "pankratopsOpponentControlsMoreHandProcedure";

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
    file: "test/lua-real-script-gimmick-puppet-magnet-doll-special-summon-procedure.test.ts",
    kind: "handBothFieldsGimmickOnlyProcedure",
    required: [
      "both-fields Gimmick Puppet-only hand Special Summon procedure",
      'fieldCase: "noOpponentMonster"',
      'fieldCase: "ownNonPuppet"',
      'fieldCase: "ownFaceDownPuppet"',
      'action.type === "specialSummonProcedure"',
      "getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0))",
      "getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0))",
      "applyRestoredActionAndAssert(restored, procedure!)",
      'eventName: "specialSummoned"',
      "eventReason: duelReason.summon | duelReason.specialSummon",
    ],
  },
  {
    file: "test/lua-real-script-caligo-claw-crow-special-summon-procedure.test.ts",
    kind: "handOwnFaceupAttributeOpenZoneProcedure",
    required: [
      "face-up DARK monster and open MZONE hand Special Summon procedure",
      'const caligoCode = "67692580"',
      'fieldCase: "wrongAttribute"',
      'fieldCase: "faceDownDark"',
      'fieldCase: "fullMonsterZone"',
      'action.type === "specialSummonProcedure"',
      "Duel.GetLocationCount(tp,LOCATION_MZONE)>0",
      "Duel.IsExistingMatchingCard(s.filter,tp,LOCATION_MZONE,0,1,nil)",
      "return c:IsFaceup() and c:IsAttribute(ATTRIBUTE_DARK)",
      "expectRestoredActionSurfaces(restored, 0)",
      "applyLuaRestoreResponse(restored, procedure as DuelAction)",
      'eventName: "specialSummoned"',
      "eventReason: duelReason.summon | duelReason.specialSummon",
    ],
  },
  {
    file: "test/lua-real-script-familiar-possessed-hiita-deck-special-summon-procedure.test.ts",
    kind: "deckTwoMaterialShufflePierceProcedure",
    required: [
      "Deck summon procedure material selection, cost send, deck shuffle, and piercing grant",
      'const hiitaCode = "4376658"',
      'action.type === "specialSummonProcedure"',
      "aux.SelectUnselectGroup(g,e,tp,2,2,s.rescon,0)",
      "Duel.SendtoGrave(g,REASON_COST)",
      "Duel.ShuffleDeck(tp)",
      "getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0))",
      "getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0))",
      "applyRestoredActionAndAssert(restored, procedure!)",
      'eventName: "sentToGraveyard"',
      'eventName: "specialSummoned"',
      "eventReason: duelReason.summon | duelReason.specialSummon",
      "effect.code === 203",
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

  it("keeps named summon procedure semantic variants explicit", () => {
    expect(countSummonProcedureSemanticVariants(summonProcedureSemanticVariants())).toEqual(
      summonProcedureSemanticVariantCounts,
    );

    const weak = summonProcedureSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });

  it("requires focused summon procedure fixtures to pin event identity after restore", () => {
    const fixtures = eventRichSummonProcedureFixtures();
    expect(fixtures).toHaveLength(EVENT_RICH_SUMMON_PROCEDURE_FIXTURE_COUNT);

    const weak = fixtures
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
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
      deckTwoMaterialShufflePierceProcedure: 0,
      handOwnFaceupAttributeOpenZoneProcedure: 0,
      handBothFieldsGimmickOnlyProcedure: 0,
      handOpponentCountProcedure: 0,
      handSendCostProcedure: 0,
    },
  );
}

function summonProcedureSemanticVariants(): Array<{
  file: string;
  kind: SummonProcedureSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-summon-procedure.test.ts",
      kind: "broadTypedExtraDeckSpiritGeminiProcedures",
      required: [
        'const diabellstarCode = "72270339"',
        "restores official Xyz.AddProcedure material counts for real extra deck summons",
        "restores official Synchro.AddProcedure tuner and non-tuner count ranges for real extra deck summons",
        "restores Spirit procedure End Phase return after a real Normal Summon",
      ],
    },
    {
      file: "test/lua-real-script-caligo-claw-crow-special-summon-procedure.test.ts",
      kind: "caligoClawCrowDarkMonsterOpenZoneProcedure",
      required: [
        'const caligoCode = "67692580"',
        "restores its face-up DARK monster and open MZONE hand Special Summon procedure",
        'fieldCase: "wrongAttribute"',
        'fieldCase: "faceDownDark"',
        'fieldCase: "fullMonsterZone"',
        "Duel.GetLocationCount(tp,LOCATION_MZONE)>0",
      ],
    },
    {
      file: "test/lua-real-script-familiar-possessed-hiita-deck-special-summon-procedure.test.ts",
      kind: "familiarPossessedDeckTwoMaterialShufflePierceProcedure",
      required: [
        'const hiitaCode = "4376658"',
        "restores its Deck summon procedure material selection, cost send, deck shuffle, and piercing grant",
        "aux.SelectUnselectGroup(g,e,tp,2,2,s.rescon,0)",
        "Duel.ShuffleDeck(tp)",
        "effect.code === 203",
      ],
    },
    {
      file: "test/lua-real-script-gigarays-gandora-special-summon-procedure.test.ts",
      kind: "gigaraysGandoraTwoMonsterSendCostProcedure",
      required: [
        'const gandoraCode = "58330108"',
        "restores its two-monster send-to-Graveyard hand Special Summon procedure cost",
        'eventName: "sentToGraveyard"',
      ],
    },
    {
      file: "test/lua-real-script-gimmick-puppet-magnet-doll-special-summon-procedure.test.ts",
      kind: "magnetDollBothFieldsGimmickOnlyHandProcedure",
      required: [
        'const magnetDollCode = "39806198"',
        "both-fields Gimmick Puppet-only hand Special Summon procedure",
        'fieldCase: "ownNonPuppet"',
        'fieldCase: "ownFaceDownPuppet"',
      ],
    },
    {
      file: "test/lua-real-script-megarock-dragon-special-summon-procedure.test.ts",
      kind: "megarockDragonGraveBanishStatProcedure",
      required: [
        'const megarockCode = "71544954"',
        "restores its Rock graveyard banish-cost procedure and selected-count base stats",
        "currentAttack(restoredMegarock, restored.session.state)).toBe(700)",
      ],
    },
    {
      file: "test/lua-real-script-pankratops-special-summon-procedure.test.ts",
      kind: "pankratopsOpponentControlsMoreHandProcedure",
      required: [
        'const pankratopsCode = "82385847"',
        "restores its opponent-controls-more-monsters hand Special Summon procedure",
        'eventName: "specialSummoned"',
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: SummonProcedureSemanticVariant;
    required: string[];
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function eventRichSummonProcedureFixtures(): Array<{
  file: string;
  kind: SummonProcedureKind;
  required: string[];
}> {
  return summonProcedureFixtures
    .filter(({ kind }) => kind !== "broadTypedProcedure")
    .map(({ file, kind }) => ({
      file,
      kind,
      required: [
        "eventCode: 1102",
        "eventCardUid:",
        "eventReason: duelReason.summon | duelReason.specialSummon",
        ...(kind === "handSendCostProcedure"
          ? [
              'eventName: "sentToGraveyard"',
              "eventCode: 1014",
              "eventReasonCardUid: gandora!.uid",
              "eventReasonEffectId: 2",
              "eventUids: [fieldCost!.uid, handCost!.uid]",
            ]
          : []),
        ...(kind === "deckTwoMaterialShufflePierceProcedure"
          ? [
              'eventName: "sentToGraveyard"',
              "eventCode: 1014",
              "eventReasonCardUid: hiita!.uid",
              "eventReasonEffectId: 1",
              "eventUids: [charmer!.uid, fireMaterial!.uid]",
            ]
          : []),
        ...(kind === "graveBanishCostStatProcedure"
          ? [
              'eventName: "banished"',
              "eventCode: 1011",
              "eventReasonCardUid: megarock!.uid",
              "eventReasonEffectId: 3",
            ]
          : []),
      ],
    }));
}

function countSummonProcedureSemanticVariants(
  fixtures: Array<{ kind: SummonProcedureSemanticVariant }>,
): Record<SummonProcedureSemanticVariant, number> {
  return fixtures.reduce<Record<SummonProcedureSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      broadTypedExtraDeckSpiritGeminiProcedures: 0,
      caligoClawCrowDarkMonsterOpenZoneProcedure: 0,
      familiarPossessedDeckTwoMaterialShufflePierceProcedure: 0,
      gigaraysGandoraTwoMonsterSendCostProcedure: 0,
      magnetDollBothFieldsGimmickOnlyHandProcedure: 0,
      megarockDragonGraveBanishStatProcedure: 0,
      pankratopsOpponentControlsMoreHandProcedure: 0,
    },
  );
}
