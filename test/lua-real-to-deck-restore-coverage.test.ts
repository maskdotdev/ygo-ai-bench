import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const TO_DECK_FIXTURE_COUNT = 1;
const toDeckKindCounts = {
  flipGraveTargetShuffleToDeck: 1,
} satisfies Record<ToDeckKind, number>;
const toDeckSemanticVariantCounts = {
  desFeralImpFlipGraveTargetShuffleToDeck: 1,
} satisfies Record<ToDeckSemanticVariant, number>;

type ToDeckKind = "flipGraveTargetShuffleToDeck";

type ToDeckSemanticVariant = "desFeralImpFlipGraveTargetShuffleToDeck";

describe("Lua real to-Deck restore coverage", () => {
  it("requires representative to-Deck operations to assert clean Lua restore and restored movement events", () => {
    const files = toDeckFixtureFiles();
    expect(files).toHaveLength(TO_DECK_FIXTURE_COUNT);

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
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps to-Deck fixture kinds explicit", () => {
    expect(countToDeckKinds(toDeckFixtureFiles())).toEqual(toDeckKindCounts);
  });

  it("keeps named to-Deck semantic variants explicit", () => {
    expect(countToDeckSemanticVariants(toDeckSemanticVariants())).toEqual(toDeckSemanticVariantCounts);

    const weak = toDeckSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function toDeckFixtureFiles(): Array<{
  file: string;
  kind: ToDeckKind;
  required: string[];
}> {
  return [
    {
      file: "test/lua-real-script-des-feral-imp-flip-grave-to-deck.test.ts",
      kind: "flipGraveTargetShuffleToDeck",
      required: [
        'const impCode = "81985784"',
        "restores its Flip target and shuffles an own Graveyard card into the Deck",
        "e1:SetCategory(CATEGORY_TODECK)",
        "e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_FLIP)",
        "Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil)",
        "Duel.SetOperationInfo(0,CATEGORY_TODECK,g,#g,0,0)",
        "Duel.SendtoDeck(tc,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)",
        "operationInfos: [{ category: 0x10",
        'eventName: "sentToDeck"',
        "eventCode: 1013",
        "eventReason: duelReason.effect",
        "eventReasonEffectId: 1",
      ],
    },
  ];
}

function countToDeckKinds(fixtures: Array<{ kind: ToDeckKind }>): Record<ToDeckKind, number> {
  return fixtures.reduce<Record<ToDeckKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      flipGraveTargetShuffleToDeck: 0,
    },
  );
}

function toDeckSemanticVariants(): Array<{
  file: string;
  kind: ToDeckSemanticVariant;
  required: string[];
}> {
  return [
    {
      file: "test/lua-real-script-des-feral-imp-flip-grave-to-deck.test.ts",
      kind: "desFeralImpFlipGraveTargetShuffleToDeck",
      required: [
        'const impCode = "81985784"',
        "restores its Flip target and shuffles an own Graveyard card into the Deck",
        "Duel.SelectTarget(tp,s.filter,tp,LOCATION_GRAVE,0,1,1,nil)",
        "Duel.SendtoDeck(tc,nil,SEQ_DECKSHUFFLE,REASON_EFFECT)",
        'eventName: "sentToDeck"',
        "location: \"deck\"",
        "des feral imp responder resolved",
      ],
    },
  ];
}

function countToDeckSemanticVariants(fixtures: Array<{ kind: ToDeckSemanticVariant }>): Record<ToDeckSemanticVariant, number> {
  return fixtures.reduce<Record<ToDeckSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      desFeralImpFlipGraveTargetShuffleToDeck: 0,
    },
  );
}
