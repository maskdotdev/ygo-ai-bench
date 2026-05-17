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
const missedTimingOptionalWhenVsIfFixtureCount = 166;
const missedTimingFullSourceEffectCauseFixtureCount = 126;
const missedTimingSourceEffectCauseEventCodeFixtureCount = 116;
const missedTimingChainEventFixtureCount = 14;
const missedTimingChainActivatingStateFixtureCount = 2;
const missedTimingChainLifecycleOriginFixtureCount = 12;
const missedTimingBattleDamageCauseFixtureCount = 4;
const missedTimingPhaseBoundaryFixtureCount = 22;
const missedTimingPhaseEndBoundaryCauseFixtureCount = 4;
const missedTimingEventFamilyCounts = {
  battle: 28,
  chain: 14,
  customRandomConfirm: 20,
  genericTimingFixture: 1,
  movementActivation: 26,
  phaseTurn: 32,
  stateChange: 22,
  summonMaterialSet: 28,
} satisfies Record<MissedTimingEventFamily, number>;
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

  it("keeps missed-timing fixture event families explicit", () => {
    expect(countMissedTimingEventFamilies(missedTimingFixtureFiles())).toEqual(missedTimingEventFamilyCounts);
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

  it("pins canonical event-code metadata on source-effect cause fixtures", () => {
    const multiStepFiles = fs.readdirSync(testRoot)
      .filter((file) => file.startsWith("parity-missed-timing-") && file.endsWith("-fixture.test.ts"))
      .filter((file) => readTestFile(file).includes("eventIsLast: false"))
      .sort();
    const sourceEffectCauseEventCodeFiles = multiStepFiles
      .filter((file) => hasSourceEffectCauseMetadata(file) && hasEventCodeMetadata(file));

    expect(multiStepFiles).toHaveLength(missedTimingMultiStepFixtureCount);
    expect(sourceEffectCauseEventCodeFiles).toHaveLength(missedTimingSourceEffectCauseEventCodeFixtureCount);
  });

  it("pins multi-step optional when versus optional if missed-timing proof", () => {
    const multiStepFiles = fs.readdirSync(testRoot)
      .filter((file) => file.startsWith("parity-missed-timing-") && file.endsWith("-fixture.test.ts"))
      .filter((file) => readTestFile(file).includes("eventIsLast: false"))
      .sort();
    const strong = multiStepFiles.filter((file) => hasOptionalWhenVsIfMissedTimingProof(file));

    expect(multiStepFiles).toHaveLength(missedTimingMultiStepFixtureCount);
    expect(strong).toHaveLength(missedTimingOptionalWhenVsIfFixtureCount);
    expect(strong).toEqual(multiStepFiles);
  });

  it("pins missed-timing chain event origin metadata coverage", () => {
    const chainFiles = fs.readdirSync(testRoot)
      .filter((file) => /^parity-missed-timing-(?:chain-activating|chaining|chain-solving|chain-solved|chain-negated|chain-disabled|chain-ended)(?:-decline)?-fixture\.test\.ts$/.test(file))
      .sort();
    const chainActivatingStateFiles = chainFiles.filter((file) => hasChainActivatingStateMetadata(file));
    const chainLifecycleOriginFiles = chainFiles.filter((file) => hasChainLifecycleOriginMetadata(file));

    expect(chainFiles).toHaveLength(missedTimingChainEventFixtureCount);
    expect(chainActivatingStateFiles).toHaveLength(missedTimingChainActivatingStateFixtureCount);
    expect(chainLifecycleOriginFiles).toHaveLength(missedTimingChainLifecycleOriginFixtureCount);
    expect([...chainActivatingStateFiles, ...chainLifecycleOriginFiles].sort()).toEqual(chainFiles);
  });

  it("pins missed-timing battle damage cause metadata coverage", () => {
    const battleDamageFiles = fs.readdirSync(testRoot)
      .filter((file) => /^parity-missed-timing-(?:before-battle-damage|battle-damage)(?:-decline)?-fixture\.test\.ts$/.test(file))
      .sort();
    const battleDamageCauseFiles = battleDamageFiles.filter((file) => hasBattleDamageCauseMetadata(file));

    expect(battleDamageFiles).toHaveLength(missedTimingBattleDamageCauseFixtureCount);
    expect(battleDamageCauseFiles).toEqual(battleDamageFiles);
  });

  it("pins missed-timing phase and startup boundary metadata coverage", () => {
    const phaseBoundaryFiles = fs.readdirSync(testRoot)
      .filter((file) => /^parity-missed-timing-(?:phase-(?:draw|standby|main1|battle|main2)|phase-start-(?:draw|standby|main1|battle|main2)|startup)(?:-decline)?-fixture\.test\.ts$/.test(file))
      .sort();
    const phaseBoundaryMetadataFiles = phaseBoundaryFiles.filter((file) => hasPhaseBoundaryMetadata(file));

    expect(phaseBoundaryFiles).toHaveLength(missedTimingPhaseBoundaryFixtureCount);
    expect(phaseBoundaryMetadataFiles).toEqual(phaseBoundaryFiles);
  });

  it("pins missed-timing phase-end boundary source-effect cause metadata coverage", () => {
    const phaseEndBoundaryFiles = fs.readdirSync(testRoot)
      .filter((file) => /^parity-missed-timing-(?:phase-end|phase-start-end)(?:-decline)?-fixture\.test\.ts$/.test(file))
      .sort();
    const phaseEndCauseFiles = phaseEndBoundaryFiles.filter((file) => hasPhaseEndBoundaryCauseMetadata(file));

    expect(phaseEndBoundaryFiles).toHaveLength(missedTimingPhaseEndBoundaryCauseFixtureCount);
    expect(phaseEndCauseFiles).toEqual(phaseEndBoundaryFiles);
  });

  it("accounts for every missed-timing source-effect cause exception with a dedicated metadata guard", () => {
    const guardedExceptionFiles = fs.readdirSync(testRoot)
      .filter((file) =>
        /^parity-missed-timing-(?:(?:before-)?battle-damage|chain-(?:activating|disabled|ended|negated|solved|solving)|chaining|phase-(?:draw|standby|main1|battle|main2)|phase-start-(?:draw|standby|main1|battle|main2)|startup)(?:-decline)?-fixture\.test\.ts$/.test(file)
      )
      .sort();

    expect(guardedExceptionFiles).toEqual([...missedTimingSourceEffectCauseExceptions].sort());
  });
});

type MissedTimingEventFamily =
  | "battle"
  | "chain"
  | "customRandomConfirm"
  | "genericTimingFixture"
  | "movementActivation"
  | "phaseTurn"
  | "stateChange"
  | "summonMaterialSet";

function camelToKebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function missedTimingFixtureFiles(): string[] {
  return fs.readdirSync(testRoot)
    .filter((file) => file.startsWith("parity-missed-timing-") && file.endsWith("-fixture.test.ts"))
    .sort();
}

function countMissedTimingEventFamilies(files: string[]): Record<MissedTimingEventFamily, number> {
  return files.reduce<Record<MissedTimingEventFamily, number>>(
    (counts, file) => {
      counts[classifyMissedTimingEventFamily(file)] += 1;
      return counts;
    },
    {
      battle: 0,
      chain: 0,
      customRandomConfirm: 0,
      genericTimingFixture: 0,
      movementActivation: 0,
      phaseTurn: 0,
      stateChange: 0,
      summonMaterialSet: 0,
    },
  );
}

function classifyMissedTimingEventFamily(file: string): MissedTimingEventFamily {
  if (file === "parity-missed-timing-fixture.test.ts") return "genericTimingFixture";
  const eventName = file
    .replace(/^parity-missed-timing-/, "")
    .replace(/-decline-fixture\.test\.ts$/, "")
    .replace(/-fixture\.test\.ts$/, "");

  if (/^(chain-activating|chaining|chain-solving|chain-solved|chain-negated|chain-disabled|chain-ended)$/.test(eventName)) return "chain";
  if (/^(phase|phase-start|startup|turn-started|turn-ended|phase-changed|phase-start-end|phase-end)/.test(eventName)) return "phaseTurn";
  if (/^(attack|battle|before-damage-calculation|damage-calculating|after-damage-calculation|before-battle-damage|damage-step-ended)/.test(eventName)) return "battle";
  if (/(summon|summoned|summoning|monster-set|spell-trap-set|used-as-material|pre-used-as-material|detached-material)/.test(eventName)) return "summonMaterialSet";
  if (/(coin|dice|custom|pre-draw|break-effect|adjust|confirmed|sent-to-hand-confirmed)/.test(eventName)) return "customRandomConfirm";
  if (/(damage-dealt|recovered-life-points|life-point-cost-paid|cards-drawn|level-changed|counter|control-changed|position-changed|became-target|equipped)/.test(eventName)) return "stateChange";
  if (/^(activated|banished|destroyed|destroying|discarded|left-field|left-graveyard|moved|released|returned-to-graveyard|sent-to-deck|sent-to-graveyard|sent-to-hand)$/.test(eventName)) {
    return "movementActivation";
  }

  throw new Error(`Unclassified missed-timing fixture event: ${file}`);
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
    hasTriggerBucketWindowProof(text) &&
    /after:\s*\{[\s\S]*?windowKind:\s*["']open["']/.test(text) &&
    hasPublicWindowEvidence(text) &&
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
    hasTriggerBucketWindowProof(text) &&
    /after:\s*\{[\s\S]*?windowKind:\s*["']open["']/.test(text) &&
    hasPublicWindowEvidence(text) &&
    /pendingTriggers:\s*\[\]/.test(text) &&
    /pendingTriggerBuckets:\s*\[\]/.test(text) &&
    /legalActions:\s*\[/.test(text) &&
    /legalActionGroups:\s*\[/.test(text) &&
    /absentLegalActions:\s*\[/.test(text) &&
    /absentLegalActionGroups:\s*\[/.test(text) &&
    /optional-when/.test(text)
  );
}

function hasPublicWindowEvidence(text: string): boolean {
  return (
    /windowId:\s*\d+/.test(text) &&
    /windowKind:\s*["'](?:open|triggerBucket)["']/.test(text) &&
    /legalActionCounts:\s*\{/.test(text) &&
    /legalActionGroupCounts:\s*\{/.test(text)
  );
}

function hasTriggerBucketWindowProof(text: string): boolean {
  return (
    /before:\s*\{[\s\S]*?windowKind:\s*["']triggerBucket["']/.test(text) &&
    /legalActions:\s*\[[\s\S]*?type:\s*["']activateTrigger["'][\s\S]*?windowKind:\s*["']triggerBucket["']/.test(text) &&
    /legalActions:\s*\[[\s\S]*?type:\s*["']declineTrigger["'][\s\S]*?windowKind:\s*["']triggerBucket["']/.test(text) &&
    /legalActionGroups:\s*\[[\s\S]*?windowKind:\s*["']triggerBucket["']/.test(text)
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

function hasEventCodeMetadata(file: string): boolean {
  return /eventCode:\s*(?:0x[0-9a-fA-F]+|\d+)/.test(readTestFile(file));
}

function hasOptionalWhenVsIfMissedTimingProof(file: string): boolean {
  const text = readTestFile(file);
  return (
    /source:\s*["']edopro["']/.test(text) &&
    /snapshotRestore:\s*["']both["']/.test(text) &&
    /triggerTiming:\s*["']when["']/.test(text) &&
    /triggerTiming:\s*["']if["']/.test(text) &&
    /pendingTriggers:\s*\[/.test(text) &&
    /effectId:\s*["'][^"']*optional-if["']/.test(text) &&
    /eventTriggerTiming:\s*["']if["']/.test(text) &&
    /absentLegalActions:\s*\[/.test(text) &&
    /absentLegalActionGroups:\s*\[/.test(text) &&
    /effectId:\s*["'][^"']*optional-when["']/.test(text) &&
    /EDOPro[\s\S]*optional (?:when|if)/.test(text) &&
    /pendingTriggers:\s*\[\]/.test(text) &&
    /pendingTriggerBuckets:\s*\[\]/.test(text)
  );
}

function hasChainActivatingStateMetadata(file: string): boolean {
  const text = readTestFile(file);
  return (
    /eventName:\s*["']chainActivating["']/.test(text) &&
    /eventReason:\s*1024/.test(text) &&
    /eventReasonPlayer:\s*0/.test(text) &&
    /eventPreviousState:\s*\{/.test(text) &&
    /eventCurrentState:\s*\{/.test(text) &&
    /eventTriggerTiming:\s*["']if["']/.test(text)
  );
}

function hasChainLifecycleOriginMetadata(file: string): boolean {
  const text = readTestFile(file);
  return (
    !/eventName:\s*["']chainActivating["']/.test(text) &&
    /eventValue:\s*1/.test(text) &&
    /eventReasonPlayer:\s*0/.test(text) &&
    /eventChainDepth:\s*1/.test(text) &&
    /eventChainLinkId:\s*["']fixture-chain-1["']/.test(text) &&
    /eventTriggerTiming:\s*["']if["']/.test(text)
  );
}

function hasBattleDamageCauseMetadata(file: string): boolean {
  const text = readTestFile(file);
  return (
    /eventName:\s*["'](?:beforeBattleDamage|battleDamageDealt)["']/.test(text) &&
    /eventCode:\s*(?:1136|1143)/.test(text) &&
    /eventPlayer:\s*1/.test(text) &&
    /eventValue:\s*1800/.test(text) &&
    /eventReason:\s*0x20/.test(text) &&
    /eventReasonPlayer:\s*0/.test(text) &&
    /eventReasonCardUid:\s*["']p0-deck-700-4["']/.test(text) &&
    /eventTriggerTiming:\s*["']if["']/.test(text) &&
    !/eventReasonEffectId/.test(text)
  );
}

function hasPhaseBoundaryMetadata(file: string): boolean {
  const text = readTestFile(file);
  return (
    /collectEvents:\s*\[\{ collectEvent:\s*["'](?:phaseDraw|phaseStandby|phaseMain1|phaseBattle|phaseMain2|phaseStartDraw|phaseStartStandby|phaseStartMain1|phaseStartBattle|phaseStartMain2|startup)["']/.test(text) &&
    /eventCode:\s*(?:1000|0x1001|0x1002|0x1004|0x1008|0x1100|0x2001|0x2002|0x2004|0x2008|0x2100)/.test(text) &&
    /eventName:\s*["'](?:phaseDraw|phaseStandby|phaseMain1|phaseBattle|phaseMain2|phaseStartDraw|phaseStartStandby|phaseStartMain1|phaseStartBattle|phaseStartMain2|startup)["']/.test(text) &&
    /eventTriggerTiming:\s*["']if["']/.test(text) &&
    !/eventReasonEffectId/.test(text)
  );
}

function hasPhaseEndBoundaryCauseMetadata(file: string): boolean {
  const text = readTestFile(file);
  return (
    /collectEventsOnResolve:\s*\[\s*\{[\s\S]*collectEvent:\s*["'](?:phaseEnd|phaseStartEnd)["']/.test(text) &&
    /eventCode:\s*(?:0x1200|0x2200)/.test(text) &&
    /eventName:\s*["'](?:phaseEnd|phaseStartEnd)["']/.test(text) &&
    hasSourceEffectCauseMetadata(file)
  );
}

function readTestFile(file: string): string {
  return fs.readFileSync(path.join(testRoot, file), "utf8");
}
