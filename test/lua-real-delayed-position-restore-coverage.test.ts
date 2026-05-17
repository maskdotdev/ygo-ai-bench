import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { coverageText, hasCoverageSnippet } from "./coverage-text.js";

const root = process.cwd();
const delayedPositionFixtureCount = 4;
const delayedPositionKindCounts = {
  battlePhaseCleanup: 1,
  damageStepPositionChange: 1,
  endPhaseFlipDraw: 1,
  endPhaseSetGroup: 1,
} satisfies Record<DelayedPositionKind, number>;
const delayedPositionSemanticVariantCounts = {
  bigShieldGardnaEndDamageStepPositionSwap: 1,
  bookOfEclipseEndPhaseFlipDrawWatcher: 1,
  giantOrcBattlePhaseDefenseCleanup: 1,
  unleashYourPowerEndPhaseGeminiSetGroup: 1,
} satisfies Record<DelayedPositionSemanticVariant, number>;

type DelayedPositionKind = "battlePhaseCleanup" | "damageStepPositionChange" | "endPhaseFlipDraw" | "endPhaseSetGroup";
type DelayedPositionSemanticVariant =
  | "bigShieldGardnaEndDamageStepPositionSwap"
  | "bookOfEclipseEndPhaseFlipDrawWatcher"
  | "giantOrcBattlePhaseDefenseCleanup"
  | "unleashYourPowerEndPhaseGeminiSetGroup";

describe("Lua real delayed position restore coverage", () => {
  it("requires delayed position fixtures to assert clean restore and restored delayed outcomes", () => {
    const files = delayedPositionFixtureFiles();
    expect(files).toHaveLength(delayedPositionFixtureCount);

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
          || required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ file }) => file);

    expect(missing).toEqual([]);
  });

  it("keeps delayed position fixture kinds explicit", () => {
    expect(countDelayedPositionKinds(delayedPositionFixtureFiles())).toEqual(delayedPositionKindCounts);
  });

  it("keeps named delayed-position semantic variants explicit", () => {
    expect(countDelayedPositionSemanticVariants(delayedPositionSemanticVariants())).toEqual(delayedPositionSemanticVariantCounts);

    const weak = delayedPositionSemanticVariants()
      .filter(({ file, required }) => {
        const text = coverageText(fs.readFileSync(path.join(root, file), "utf8"));
        return required.some((snippet) => !hasCoverageSnippet(text, snippet));
      })
      .map(({ kind }) => kind);

    expect(weak).toEqual([]);
  });
});

function delayedPositionFixtureFiles(): Array<{
  file: string;
  kind: DelayedPositionKind;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-big-shield-gardna-damage-step-position.test.ts",
      kind: "damageStepPositionChange",
      required: [
        'battleWindow?.kind).toBe("endDamageStep")',
        'eventName: "damageStepEnded"',
        'eventName: "positionChanged"',
        "position: \"faceUpDefense\"",
        "position: \"faceUpAttack\"",
      ],
    },
    {
      file: "test/lua-real-script-unleash-your-power-gemini-delayed-set.test.ts",
      kind: "endPhaseSetGroup",
      required: [
        "restores group-wide Gemini status and delayed End Phase position change",
        "restoredActivation.missingRegistryKeys).toEqual([])",
        "restoredActivation.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChain.missingRegistryKeys).toEqual([])",
        "restoredChain.missingChainLimitRegistryKeys).toEqual([])",
        "restoredStatus.missingRegistryKeys).toEqual([])",
        "restoredStatus.missingChainLimitRegistryKeys).toEqual([])",
        "restoredAfterEnd.missingRegistryKeys).toEqual([])",
        "restoredAfterEnd.missingChainLimitRegistryKeys).toEqual([])",
        'action.type === "changePhase"',
        "position: \"faceUpAttack\"",
        "position: \"faceUpDefense\"",
        "position: \"faceDownDefense\"",
        'eventName: "positionChanged"',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-book-eclipse-delayed-flip-draw.test.ts",
      kind: "endPhaseFlipDraw",
      required: [
        "restoredActivation.missingRegistryKeys).toEqual([])",
        "restoredActivation.missingChainLimitRegistryKeys).toEqual([])",
        "restoredChain.missingRegistryKeys).toEqual([])",
        "restoredChain.missingChainLimitRegistryKeys).toEqual([])",
        "restoredEnd.missingRegistryKeys).toEqual([])",
        "restoredEnd.missingChainLimitRegistryKeys).toEqual([])",
        "operationInfos: [",
        "position: \"faceDownDefense\"",
        "position: \"faceUpDefense\"",
        'action.type === "changePhase"',
        'location: "hand", controller: 1',
        "host.messages).not.toContain",
      ],
    },
    {
      file: "test/lua-real-script-giant-orc-battle-phase-position.test.ts",
      kind: "battlePhaseCleanup",
      required: [
        "restored.missingRegistryKeys).toEqual([])",
        "restored.missingChainLimitRegistryKeys).toEqual([])",
        'action.type === "changePhase" && action.phase === "main2"',
        'eventName: "phaseBattle"',
        'eventName: "positionChanged"',
        "position: \"faceUpDefense\"",
        "battlePairs",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: DelayedPositionKind;
    required: string[];
  }>);
}

function countDelayedPositionKinds(
  fixtures: Array<{ kind: DelayedPositionKind }>,
): Record<DelayedPositionKind, number> {
  return fixtures.reduce<Record<DelayedPositionKind, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      battlePhaseCleanup: 0,
      damageStepPositionChange: 0,
      endPhaseFlipDraw: 0,
      endPhaseSetGroup: 0,
    },
  );
}

function delayedPositionSemanticVariants(): Array<{
  file: string;
  kind: DelayedPositionSemanticVariant;
  required: string[];
}> {
  return ([
    {
      file: "test/lua-real-script-big-shield-gardna-damage-step-position.test.ts",
      kind: "bigShieldGardnaEndDamageStepPositionSwap",
      required: [
        'const gardnaCode = "65240384"',
        "restores its end Damage Step position change after being attacked in Defense Position",
        'battleWindow?.kind).toBe("endDamageStep")',
        'eventName: "damageStepEnded"',
      ],
    },
    {
      file: "test/lua-real-script-book-eclipse-delayed-flip-draw.test.ts",
      kind: "bookOfEclipseEndPhaseFlipDrawWatcher",
      required: [
        'const bookCode = "35480699"',
        "restores grouped turn-set resolution and the End Phase opponent flip/draw watcher",
        "operationInfos: [",
        'location: "hand", controller: 1',
      ],
    },
    {
      file: "test/lua-real-script-giant-orc-battle-phase-position.test.ts",
      kind: "giantOrcBattlePhaseDefenseCleanup",
      required: [
        'const giantOrcCode = "73698349"',
        "restores the Battle Phase event after an attack and changes itself to Defense Position",
        'action.type === "changePhase" && action.phase === "main2"',
        'eventName: "phaseBattle"',
      ],
    },
    {
      file: "test/lua-real-script-unleash-your-power-gemini-delayed-set.test.ts",
      kind: "unleashYourPowerEndPhaseGeminiSetGroup",
      required: [
        'const unleashCode = "73567374"',
        "restores group-wide Gemini status and delayed End Phase position change",
        "position: \"faceDownDefense\"",
        "host.messages).not.toContain",
      ],
    },
  ] satisfies Array<{
    file: string;
    kind: DelayedPositionSemanticVariant;
    required: string[];
  }>);
}

function countDelayedPositionSemanticVariants(
  fixtures: Array<{ kind: DelayedPositionSemanticVariant }>,
): Record<DelayedPositionSemanticVariant, number> {
  return fixtures.reduce<Record<DelayedPositionSemanticVariant, number>>(
    (counts, fixture) => {
      counts[fixture.kind] += 1;
      return counts;
    },
    {
      bigShieldGardnaEndDamageStepPositionSwap: 0,
      bookOfEclipseEndPhaseFlipDrawWatcher: 0,
      giantOrcBattlePhaseDefenseCleanup: 0,
      unleashYourPowerEndPhaseGeminiSetGroup: 0,
    },
  );
}
