import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { duelEventNames } from "#duel/event-names.js";

const missedTimingFixtureAliases = new Map<string, string>([
  ["battleDamageDealt", "battle-damage"],
]);
const testRoot = path.resolve("test");
const sharedDeclineFixtureHelper = "parity-missed-timing-decline-fixture-helper.ts";
const canonicalDuelEventCount = 84;
const missedTimingFixtureFileCount = 171;
const missedTimingActivationFixtureCount = 86;
const missedTimingDeclineFixtureCount = 85;
const missedTimingMultiStepFixtureCount = 166;
const missedTimingFullSourceEffectCauseFixtureCount = 126;
const missedTimingSourceEffectCauseExceptions = [
  "parity-missed-timing-battle-damage-decline-fixture.test.ts",
  "parity-missed-timing-battle-damage-fixture.test.ts",
  "parity-missed-timing-before-battle-damage-decline-fixture.test.ts",
  "parity-missed-timing-before-battle-damage-fixture.test.ts",
  "parity-missed-timing-chain-activating-decline-fixture.test.ts",
  "parity-missed-timing-chain-activating-fixture.test.ts",
  "parity-missed-timing-chain-disabled-decline-fixture.test.ts",
  "parity-missed-timing-chain-disabled-fixture.test.ts",
  "parity-missed-timing-chain-ended-decline-fixture.test.ts",
  "parity-missed-timing-chain-ended-fixture.test.ts",
  "parity-missed-timing-chain-negated-decline-fixture.test.ts",
  "parity-missed-timing-chain-negated-fixture.test.ts",
  "parity-missed-timing-chain-solved-decline-fixture.test.ts",
  "parity-missed-timing-chain-solved-fixture.test.ts",
  "parity-missed-timing-chain-solving-decline-fixture.test.ts",
  "parity-missed-timing-chain-solving-fixture.test.ts",
  "parity-missed-timing-chaining-decline-fixture.test.ts",
  "parity-missed-timing-chaining-fixture.test.ts",
  "parity-missed-timing-phase-battle-decline-fixture.test.ts",
  "parity-missed-timing-phase-battle-fixture.test.ts",
  "parity-missed-timing-phase-draw-decline-fixture.test.ts",
  "parity-missed-timing-phase-draw-fixture.test.ts",
  "parity-missed-timing-phase-main1-decline-fixture.test.ts",
  "parity-missed-timing-phase-main1-fixture.test.ts",
  "parity-missed-timing-phase-main2-decline-fixture.test.ts",
  "parity-missed-timing-phase-main2-fixture.test.ts",
  "parity-missed-timing-phase-standby-decline-fixture.test.ts",
  "parity-missed-timing-phase-standby-fixture.test.ts",
  "parity-missed-timing-phase-start-battle-decline-fixture.test.ts",
  "parity-missed-timing-phase-start-battle-fixture.test.ts",
  "parity-missed-timing-phase-start-draw-decline-fixture.test.ts",
  "parity-missed-timing-phase-start-draw-fixture.test.ts",
  "parity-missed-timing-phase-start-main1-decline-fixture.test.ts",
  "parity-missed-timing-phase-start-main1-fixture.test.ts",
  "parity-missed-timing-phase-start-main2-decline-fixture.test.ts",
  "parity-missed-timing-phase-start-main2-fixture.test.ts",
  "parity-missed-timing-phase-start-standby-decline-fixture.test.ts",
  "parity-missed-timing-phase-start-standby-fixture.test.ts",
  "parity-missed-timing-startup-decline-fixture.test.ts",
  "parity-missed-timing-startup-fixture.test.ts",
];

describe("EDOPro parity missed-timing event coverage", () => {
  it("has activation and decline fixtures for each canonical duel event", () => {
    const fixtureFiles = new Set(fs.readdirSync(testRoot).filter((file) => file.startsWith("parity-missed-timing-") && file.endsWith("-fixture.test.ts")));
    expect(duelEventNames.size).toBe(canonicalDuelEventCount);
    expect(fixtureFiles.size).toBe(missedTimingFixtureFileCount);

    const missing = [...duelEventNames].flatMap((eventName) => {
      const fixtureName = missedTimingFixtureAliases.get(eventName) ?? camelToKebab(eventName);
      return [
        fixtureFiles.has(`parity-missed-timing-${fixtureName}-fixture.test.ts`) ? [] : [`${eventName} (${fixtureName}) activation`],
        fixtureFiles.has(`parity-missed-timing-${fixtureName}-decline-fixture.test.ts`) ? [] : [`${eventName} (${fixtureName}) decline`],
      ].flat();
    });

    expect(missing).toEqual([]);
  });

  it("requires decline fixtures to prove restored open fast priority with stale trigger suppression", () => {
    const declineFiles = fs.readdirSync(testRoot)
      .filter((file) => file.startsWith("parity-missed-timing-") && file.endsWith("-decline-fixture.test.ts"));
    expect(declineFiles).toHaveLength(missedTimingDeclineFixtureCount);

    const weak = declineFiles
      .filter((file) => !hasDeclineOpenFastRestoreProof(file));

    expect(weak).toEqual([]);
  });

  it("requires activation fixtures to prove restored trigger activation with stale trigger suppression", () => {
    const activationFiles = fs.readdirSync(testRoot)
      .filter((file) => file.startsWith("parity-missed-timing-") && file.endsWith("-fixture.test.ts") && !file.endsWith("-decline-fixture.test.ts"));
    expect(activationFiles).toHaveLength(missedTimingActivationFixtureCount);

    const weak = activationFiles
      .filter((file) => !hasActivationRestoreProof(file));

    expect(weak).toEqual([]);
  });

  it("pins multi-step missed-timing source-effect cause metadata coverage", () => {
    const multiStepFiles = fs.readdirSync(testRoot)
      .filter((file) => file.startsWith("parity-missed-timing-") && file.endsWith("-fixture.test.ts"))
      .filter((file) => readTestFile(file).includes("eventIsLast: false"))
      .sort();
    const fullSourceEffectCauseFiles = multiStepFiles
      .filter((file) => hasSourceEffectCauseMetadata(file));
    const exceptions = multiStepFiles
      .filter((file) => !hasSourceEffectCauseMetadata(file))
      .sort();

    expect(multiStepFiles).toHaveLength(missedTimingMultiStepFixtureCount);
    expect(fullSourceEffectCauseFiles).toHaveLength(missedTimingFullSourceEffectCauseFixtureCount);
    expect(exceptions).toEqual([...missedTimingSourceEffectCauseExceptions].sort());
  });
});

function camelToKebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function hasDeclineOpenFastRestoreProof(file: string): boolean {
  const text = readTestFile(file);
  if (file !== sharedDeclineFixtureHelper && text.includes("expectMissedTimingDeclineFixture(")) return hasDeclineOpenFastRestoreProof(sharedDeclineFixtureHelper);
  return (
    /source:\s*["']edopro["']/.test(text) &&
    /snapshotRestore:\s*["']both["']/.test(text) &&
    /makeResponseSelector\(\s*["']declineTrigger["']/.test(text) &&
    /triggerTiming:\s*["']when["']/.test(text) &&
    /triggerTiming:\s*["']if["']/.test(text) &&
    /eventTriggerTiming:\s*["']if["']/.test(text) &&
    /after:\s*\{[\s\S]*?windowKind:\s*["']open["']/.test(text) &&
    /pendingTriggers:\s*\[\]/.test(text) &&
    /pendingTriggerBuckets:\s*\[\]/.test(text) &&
    /legalActions:\s*\[/.test(text) &&
    /legalActionGroups:\s*\[/.test(text) &&
    /absentLegalActions:\s*\[/.test(text) &&
    /absentLegalActionGroups:\s*\[/.test(text) &&
    /optional-when/.test(text)
  );
}

function hasActivationRestoreProof(file: string): boolean {
  const text = readTestFile(file);
  return (
    /source:\s*["']edopro["']/.test(text) &&
    /snapshotRestore:\s*["']both["']/.test(text) &&
    /makeResponseSelector\(\s*["']activateTrigger["']/.test(text) &&
    /triggerTiming:\s*["']when["']/.test(text) &&
    /triggerTiming:\s*["']if["']/.test(text) &&
    /eventTriggerTiming:\s*["']if["']/.test(text) &&
    /after:\s*\{[\s\S]*?windowKind:\s*["']open["']/.test(text) &&
    /pendingTriggers:\s*\[\]/.test(text) &&
    /pendingTriggerBuckets:\s*\[\]/.test(text) &&
    /legalActions:\s*\[/.test(text) &&
    /legalActionGroups:\s*\[/.test(text) &&
    /absentLegalActions:\s*\[/.test(text) &&
    /absentLegalActionGroups:\s*\[/.test(text) &&
    /optional-when/.test(text)
  );
}

function hasSourceEffectCauseMetadata(file: string): boolean {
  const text = readTestFile(file);
  return (
    /eventReason:\s*0x(?:40|80)/.test(text) &&
    /eventReasonPlayer:\s*0/.test(text) &&
    /eventReasonCardUid:\s*["']p0-deck-100-0["']/.test(text) &&
    /eventReasonEffectId:\s*\d+/.test(text) &&
    /eventTriggerTiming:\s*["']if["']/.test(text)
  );
}

function readTestFile(file: string): string {
  return fs.readFileSync(path.join(testRoot, file), "utf8");
}
