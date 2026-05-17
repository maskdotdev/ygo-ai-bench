import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const summonNegationFixtureCount = 3;
const summonNegationKindCounts: Record<SummonNegationKind, number> = {
  flip: 1,
  normal: 1,
  special: 1,
};

describe("EDOPro parity summon-negation coverage", () => {
  it("keeps summon-negation fixture kinds explicit", () => {
    expect(countSummonNegationKinds(summonNegationFixtures())).toEqual(summonNegationKindCounts);
  });

  it("pins Normal, Flip, and inherent Special Summon negation fixtures", () => {
    const fixtures = summonNegationFixtures();
    expect(fixtures).toHaveLength(summonNegationFixtureCount);

    const weak = fixtures
      .filter((fixture) => {
        const text = readTestFile(fixture.file);
        return !hasSharedSummonNegationWindowProof(text)
          || !text.includes(fixture.attemptEvent)
          || !text.includes(fixture.successEvent)
          || !text.includes(fixture.negatedEvent)
          || !text.includes(fixture.negatorEffectId)
          || !text.includes(fixture.negatedWatcherEffectId)
          || !hasRemovedSuccessWatcherProof(text, fixture.removedSuccessWatcherEffectId)
          || !/removes? (?:the )?.*success trigger/.test(text)
          || !/without resolving removed .*success triggers/.test(text);
      })
      .map((fixture) => fixture.file);

    expect(weak).toEqual([]);
  });
});

type SummonNegationKind = "flip" | "normal" | "special";

function summonNegationFixtures(): Array<{
  file: string;
  kind: SummonNegationKind;
  attemptEvent: string;
  successEvent: string;
  negatedEvent: string;
  negatorEffectId: string;
  negatedWatcherEffectId: string;
  removedSuccessWatcherEffectId: string;
}> {
  return ([
    {
      file: "parity-summon-negation-fixture.test.ts",
      kind: "normal",
      attemptEvent: 'eventName: "normalSummoning"',
      successEvent: 'eventName: "normalSummoned"',
      negatedEvent: 'eventName: "normalSummonNegated"',
      negatorEffectId: "fixture-summon-negator",
      negatedWatcherEffectId: "fixture-negated-summon-watcher",
      removedSuccessWatcherEffectId: "fixture-success-watcher",
    },
    {
      file: "parity-flip-summon-negation-fixture.test.ts",
      kind: "flip",
      attemptEvent: 'eventName: "flipSummoning"',
      successEvent: 'eventName: "flipSummoned"',
      negatedEvent: 'eventName: "flipSummonNegated"',
      negatorEffectId: "fixture-flip-summon-negator",
      negatedWatcherEffectId: "fixture-flip-negated-watcher",
      removedSuccessWatcherEffectId: "fixture-flip-success-watcher",
    },
    {
      file: "parity-special-summon-negation-fixture.test.ts",
      kind: "special",
      attemptEvent: 'eventName: "specialSummoning"',
      successEvent: 'eventName: "specialSummoned"',
      negatedEvent: 'eventName: "specialSummonNegated"',
      negatorEffectId: "fixture-special-summon-negator",
      negatedWatcherEffectId: "fixture-special-negated-watcher",
      removedSuccessWatcherEffectId: "fixture-special-success-watcher",
    },
  ] satisfies Array<{
    file: string;
    kind: SummonNegationKind;
    attemptEvent: string;
    successEvent: string;
    negatedEvent: string;
    negatorEffectId: string;
    negatedWatcherEffectId: string;
    removedSuccessWatcherEffectId: string;
  }>).sort((a, b) => a.file.localeCompare(b.file));
}

function countSummonNegationKinds(fixtures: Array<{ kind: SummonNegationKind }>): Record<SummonNegationKind, number> {
  return fixtures.reduce(
    (counts, { kind }) => {
      counts[kind] += 1;
      return counts;
    },
    { flip: 0, normal: 0, special: 0 },
  );
}

function hasRemovedSuccessWatcherProof(text: string, effectId: string): boolean {
  const absentActionBlock = /absentLegalActions:\s*\[[\s\S]*?\]/.exec(text)?.[0] ?? "";
  return (
    absentActionBlock.includes(`effectId: "${effectId}"`) &&
    /windowId:\s*2/.test(absentActionBlock) &&
    /windowKind:\s*["']triggerBucket["']/.test(absentActionBlock) &&
    text.includes(`absentTriggerActivationGroup(0, "${effectId}", "turnOptional", 2, "triggerBucket")`)
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
