import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const tokenSummonFixtureCount = 2;
const tokenSummonKindCounts = {
  previousOnFieldToGraveMandatoryTokenSummon: 1,
  spellStepTokenSummonOathLock: 1,
} satisfies Record<TokenSummonKind, number>;
const tokenSummonSemanticVariantCounts = {
  oysterMeisterPreviousOnFieldToGraveFishTokenSummon: 1,
  scapegoatStepSummonOathLock: 1,
} satisfies Record<TokenSummonSemanticVariant, number>;

type TokenSummonKind = "previousOnFieldToGraveMandatoryTokenSummon" | "spellStepTokenSummonOathLock";
type TokenSummonSemanticVariant = "oysterMeisterPreviousOnFieldToGraveFishTokenSummon" | "scapegoatStepSummonOathLock";

describe("Lua real token summon restore coverage", () => {
  it("requires token summon fixtures to assert clean Lua registry restore and restored legal actions", () => {
    const fixtures = tokenSummonFixtureFiles();
    expect(fixtures).toHaveLength(tokenSummonFixtureCount);

    const missing = fixtures
      .filter(({ file }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("restoreDuelWithLuaScripts")
          || !text.includes("restoreComplete")
          || !text.includes('incompleteReasons.join("; ")')
          || !text.includes("missingRegistryKeys).toEqual([])")
          || !text.includes("missingChainLimitRegistryKeys).toEqual([])")
          || !text.includes("getLuaRestoreLegalActionGroups")
          || !text.includes("getGroupedDuelLegalActions")
          || !text.includes("flatMap((group) => group.actions)")
          || !text.includes("getLuaRestoreLegalActions")
          || !text.includes("applyLuaRestoreResponse");
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("requires token summon fixtures to prove trigger metadata, operation info, and summon events", () => {
    const fixtures = tokenSummonFixtureFiles();
    expect(fixtures).toHaveLength(tokenSummonFixtureCount);

    const missing = fixtures
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return !text.includes("operationInfos")
          || !text.includes("category: 0x400")
          || !text.includes("category: 0x200")
          || !text.includes('eventName: "specialSummoned"')
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps token summon fixture kinds explicit", () => {
    expect(countTokenSummonKinds(tokenSummonFixtureFiles())).toEqual(tokenSummonKindCounts);
  });

  it("keeps named token summon semantic variants explicit", () => {
    expect(countTokenSummonSemanticVariants(tokenSummonSemanticVariants())).toEqual(tokenSummonSemanticVariantCounts);

    const weak = tokenSummonSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });

  it("keeps token summon fixtures script-gated and database-independent", () => {
    const weak = tokenSummonSemanticVariants()
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

function tokenSummonFixtureFiles(): Array<{ file: string; kind: TokenSummonKind; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-oyster-meister-to-grave-token-summon.test.ts",
      kind: "previousOnFieldToGraveMandatoryTokenSummon",
      required: [
        'const oysterMeisterCode = "83239739"',
        "restores mandatory previous-on-field EVENT_TO_GRAVE token creation and summon",
        "e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_TOKEN)",
        "e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)",
        "return e:GetHandler():GetPreviousLocation()&LOCATION_ONFIELD>0",
        "Duel.IsPlayerCanSpecialSummonMonster(tp,id+1,0,TYPES_TOKEN,0,0,1,RACE_FISH,ATTRIBUTE_WATER)",
        "local token=Duel.CreateToken(tp,id+1)",
        "Duel.SpecialSummon(token,0,tp,tp,false,false,POS_FACEUP)",
      ],
    },
    {
      file: "test/lua-real-script-scapegoat-token-step-summon-lock.test.ts",
      kind: "spellStepTokenSummonOathLock",
      required: [
        'const scapegoatCode = "73915051"',
        "restores staged Token Special Summons and same-turn summon oath locks",
        "e1:SetCategory(CATEGORY_SPECIAL_SUMMON+CATEGORY_TOKEN)",
        "Duel.GetActivityCount(tp,ACTIVITY_SUMMON)==0",
        "Duel.IsPlayerCanSpecialSummonMonster(tp,id+1,0,TYPES_TOKEN,0,0,1,RACE_BEAST,ATTRIBUTE_EARTH)",
        "local token=Duel.CreateToken(tp,id+i)",
        "Duel.SpecialSummonStep(token,0,tp,tp,false,false,POS_FACEUP_DEFENSE)",
        "Duel.SpecialSummonComplete()",
      ],
    },
  ];
}

function tokenSummonSemanticVariants(): Array<{ file: string; kind: TokenSummonSemanticVariant; required: string[] }> {
  return [
    {
      file: "test/lua-real-script-oyster-meister-to-grave-token-summon.test.ts",
      kind: "oysterMeisterPreviousOnFieldToGraveFishTokenSummon",
      required: [
        "typesToken",
        "raceFish",
        "attributeWater",
        "{ category: 0x400, targetUids: [], count: 1, player: 0, parameter: 0 }",
        "{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0 }",
        "reason: duelReason.summon | duelReason.specialSummon",
        'host.messages).not.toContain("oyster responder resolved")',
      ],
    },
    {
      file: "test/lua-real-script-scapegoat-token-step-summon-lock.test.ts",
      kind: "scapegoatStepSummonOathLock",
      required: [
        "sheepTokenCodes",
        "typesToken",
        "raceBeast",
        "attributeEarth",
        "{ category: 0x400, targetUids: [], count: 4, player: 0, parameter: 0 }",
        "{ category: 0x200, targetUids: [], count: 4, player: 0, parameter: 0 }",
        "effect.code === 43",
        'host.messages).not.toContain("scapegoat responder resolved")',
      ],
    },
  ];
}

function countTokenSummonKinds(fixtures: Array<{ kind: TokenSummonKind }>): Record<TokenSummonKind, number> {
  return fixtures.reduce<Record<TokenSummonKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      previousOnFieldToGraveMandatoryTokenSummon: 0,
      spellStepTokenSummonOathLock: 0,
    },
  );
}

function countTokenSummonSemanticVariants(
  fixtures: Array<{ kind: TokenSummonSemanticVariant }>,
): Record<TokenSummonSemanticVariant, number> {
  return fixtures.reduce<Record<TokenSummonSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      oysterMeisterPreviousOnFieldToGraveFishTokenSummon: 0,
      scapegoatStepSummonOathLock: 0,
    },
  );
}
