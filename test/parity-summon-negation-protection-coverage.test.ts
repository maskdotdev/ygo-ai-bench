import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const summonNegationProtectionFixtureCount = 4;
const summonNegationProtectionKindCounts: Record<SummonNegationProtectionKind, number> = {
  flip: 1,
  normal: 1,
  special: 2,
};
const summonNegationProtectionEffectCounts: Record<SummonNegationProtectionEffect, number> = {
  cannotDisableFlipSummon: 1,
  cannotDisableSpecialSummon: 1,
  cannotDisableSummon: 2,
};

describe("EDOPro parity summon-negation protection coverage", () => {
  it("keeps protected summon-negation fixture kinds explicit", () => {
    expect(countSummonNegationProtectionKinds(summonNegationProtectionFixtures())).toEqual(summonNegationProtectionKindCounts);
  });

  it("keeps protected summon-negation effect coverage explicit", () => {
    expect(countSummonNegationProtectionEffects(summonNegationProtectionFixtures())).toEqual(summonNegationProtectionEffectCounts);
  });

  it("pins protected summon-negation fixtures that preserve success triggers", () => {
    const fixtures = summonNegationProtectionFixtures();
    expect(fixtures).toHaveLength(summonNegationProtectionFixtureCount);

    const weak = fixtures
      .filter((fixture) => {
        const text = readTestFile(fixture.file);
        return !hasSharedSummonNegationWindowProof(text)
          || !text.includes(fixture.protectionEffect)
          || !text.includes(fixture.attemptEvent)
          || !text.includes(fixture.successEvent)
          || !text.includes(fixture.blockedNegatorEffectId)
          || !text.includes(fixture.successWatcherEffectId)
          || !/keeps? (?:the )?.*success trigger/.test(text)
          || !/prevents? summon negation/.test(text)
          || !/logIncludes:\s*\[["']Fixture .*success watcher resolved["']\]/.test(text);
      })
      .map((fixture) => fixture.file);

    expect(weak).toEqual([]);
  });
});

type SummonNegationProtectionEffect = "cannotDisableFlipSummon" | "cannotDisableSpecialSummon" | "cannotDisableSummon";
type SummonNegationProtectionKind = "flip" | "normal" | "special";

function summonNegationProtectionFixtures(): Array<{
  file: string;
  kind: SummonNegationProtectionKind;
  effect: SummonNegationProtectionEffect;
  protectionEffect: string;
  attemptEvent: string;
  successEvent: string;
  blockedNegatorEffectId: string;
  successWatcherEffectId: string;
}> {
  return ([
    {
      file: "parity-summon-negation-protection-fixture.test.ts",
      kind: "normal",
      effect: "cannotDisableSummon",
      protectionEffect: "EFFECT_CANNOT_DISABLE_SUMMON",
      attemptEvent: 'eventName: "normalSummoning"',
      successEvent: 'eventName: "normalSummoned"',
      blockedNegatorEffectId: "fixture-blocked-summon-negator",
      successWatcherEffectId: "fixture-protected-success-watcher",
    },
    {
      file: "parity-flip-summon-negation-protection-fixture.test.ts",
      kind: "flip",
      effect: "cannotDisableFlipSummon",
      protectionEffect: "EFFECT_CANNOT_DISABLE_FLIP_SUMMON",
      attemptEvent: 'eventName: "flipSummoning"',
      successEvent: 'eventName: "flipSummoned"',
      blockedNegatorEffectId: "fixture-blocked-flip-summon-negator",
      successWatcherEffectId: "fixture-protected-flip-success-watcher",
    },
    {
      file: "parity-special-summon-negation-protection-fixture.test.ts",
      kind: "special",
      effect: "cannotDisableSummon",
      protectionEffect: "EFFECT_CANNOT_DISABLE_SUMMON",
      attemptEvent: 'eventName: "specialSummoning"',
      successEvent: 'eventName: "specialSummoned"',
      blockedNegatorEffectId: "fixture-blocked-special-summon-negator",
      successWatcherEffectId: "fixture-protected-special-success-watcher",
    },
    {
      file: "parity-special-summon-sp-negation-protection-fixture.test.ts",
      kind: "special",
      effect: "cannotDisableSpecialSummon",
      protectionEffect: "EFFECT_CANNOT_DISABLE_SPSUMMON",
      attemptEvent: 'eventName: "specialSummoning"',
      successEvent: 'eventName: "specialSummoned"',
      blockedNegatorEffectId: "fixture-blocked-sp-summon-negator",
      successWatcherEffectId: "fixture-protected-sp-success-watcher",
    },
  ] satisfies Array<{
    file: string;
    kind: SummonNegationProtectionKind;
    effect: SummonNegationProtectionEffect;
    protectionEffect: string;
    attemptEvent: string;
    successEvent: string;
    blockedNegatorEffectId: string;
    successWatcherEffectId: string;
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countSummonNegationProtectionKinds(fixtures: Array<{ kind: SummonNegationProtectionKind }>): Record<SummonNegationProtectionKind, number> {
  return fixtures.reduce(
    (counts, { kind }) => {
      counts[kind] += 1;
      return counts;
    },
    { flip: 0, normal: 0, special: 0 },
  );
}

function countSummonNegationProtectionEffects(
  fixtures: Array<{ effect: SummonNegationProtectionEffect }>,
): Record<SummonNegationProtectionEffect, number> {
  return fixtures.reduce(
    (counts, { effect }) => {
      counts[effect] += 1;
      return counts;
    },
    { cannotDisableFlipSummon: 0, cannotDisableSpecialSummon: 0, cannotDisableSummon: 0 },
  );
}

function hasSharedSummonNegationWindowProof(text: string): boolean {
  return (
    /source:\s*["']edopro["']/.test(text) &&
    /note:\s*["'][^"']*EDOPro/.test(text) &&
    /snapshotRestore:\s*["']both["']/.test(text) &&
    /windowKind:\s*["']triggerBucket["']/.test(text) &&
    /waitingFor:\s*[01]/.test(text) &&
    /pendingTriggers:\s*\[/.test(text) &&
    /pendingTriggerBuckets:\s*\[\{ player:\s*0,\s*triggerBucket:\s*["']turnOptional["'] \}\]/.test(text) &&
    /triggerOrderPrompt:\s*\{ type:\s*["']orderTriggers["']/.test(text) &&
    /legalActions:\s*\[/.test(text) &&
    /legalActionGroups:\s*\[/.test(text) &&
    /eventTriggerTiming:\s*["']if["']/.test(text) &&
    /pendingTriggers:\s*\[\]/.test(text)
  );
}

function readTestFile(file: string): string {
  return fs.readFileSync(path.join(root, "test", file), "utf8");
}
