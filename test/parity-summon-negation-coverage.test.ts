import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const summonNegationFixtureCount = 3;

describe("EDOPro parity summon-negation coverage", () => {
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
          || !/removes? (?:the )?.*success trigger/.test(text)
          || !/without resolving removed .*success triggers/.test(text);
      })
      .map((fixture) => fixture.file);

    expect(weak).toEqual([]);
  });
});

function summonNegationFixtures(): Array<{
  file: string;
  attemptEvent: string;
  successEvent: string;
  negatedEvent: string;
  negatorEffectId: string;
  negatedWatcherEffectId: string;
}> {
  return [
    {
      file: "parity-summon-negation-fixture.test.ts",
      attemptEvent: 'eventName: "normalSummoning"',
      successEvent: 'eventName: "normalSummoned"',
      negatedEvent: 'eventName: "normalSummonNegated"',
      negatorEffectId: "fixture-summon-negator",
      negatedWatcherEffectId: "fixture-negated-summon-watcher",
    },
    {
      file: "parity-flip-summon-negation-fixture.test.ts",
      attemptEvent: 'eventName: "flipSummoning"',
      successEvent: 'eventName: "flipSummoned"',
      negatedEvent: 'eventName: "flipSummonNegated"',
      negatorEffectId: "fixture-flip-summon-negator",
      negatedWatcherEffectId: "fixture-flip-negated-watcher",
    },
    {
      file: "parity-special-summon-negation-fixture.test.ts",
      attemptEvent: 'eventName: "specialSummoning"',
      successEvent: 'eventName: "specialSummoned"',
      negatedEvent: 'eventName: "specialSummonNegated"',
      negatorEffectId: "fixture-special-summon-negator",
      negatedWatcherEffectId: "fixture-special-negated-watcher",
    },
  ].sort((a, b) => a.file.localeCompare(b.file));
}

function hasSharedSummonNegationWindowProof(text: string): boolean {
  return (
    /source:\s*["']edopro["']/.test(text) &&
    /snapshotRestore:\s*["']both["']/.test(text) &&
    /windowKind:\s*["']triggerBucket["']/.test(text) &&
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
