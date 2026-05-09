import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(".");
const testDir = path.join(repoRoot, "test");

const generatedCodedEventNames = [
  "customEvent",
  "phaseDraw",
  "phaseStandby",
  "phaseMain1",
  "phaseBattle",
  "phaseMain2",
  "phaseEnd",
  "phaseStartDraw",
  "phaseStartStandby",
  "phaseStartMain1",
  "phaseStartBattle",
  "phaseStartMain2",
  "phaseStartEnd",
] as const;

describe("missed timing event fixture coverage", () => {
  it("keeps activation and decline fixtures for every coded duel event", () => {
    const expectedEvents = expectedCodedMissedTimingEvents();
    const activationCoverage = missedTimingCoverage("activation");
    const declineCoverage = missedTimingCoverage("decline");

    expect(missingCoverage(expectedEvents, activationCoverage)).toEqual([]);
    expect(missingCoverage(expectedEvents, declineCoverage)).toEqual([]);
  });
});

function expectedCodedMissedTimingEvents(): string[] {
  return Array.from(new Set([...eventCodeMapNames(), ...generatedCodedEventNames])).sort();
}

function eventCodeMapNames(): string[] {
  const source = fs.readFileSync(path.join(repoRoot, "src/engine/duel/event-codes.ts"), "utf8");
  const eventCodesBlock = source.match(/const eventCodes:[\s\S]*?= \{([\s\S]*?)\};/)?.[1];
  if (!eventCodesBlock) throw new Error("Could not find eventCodes in src/engine/duel/event-codes.ts");
  return Array.from(eventCodesBlock.matchAll(/^\s*([A-Za-z][A-Za-z0-9]*):/gm), (match) => match[1]!);
}

function missedTimingCoverage(kind: "activation" | "decline"): Set<string> {
  const coveredEvents = new Set<string>();
  for (const file of missedTimingFixtureFiles()) {
    const text = fs.readFileSync(path.join(testDir, file), "utf8");
    if (!coversResponseKind(text, kind)) continue;
    for (const eventName of triggerEventsIn(text)) coveredEvents.add(eventName);
  }
  return coveredEvents;
}

function missedTimingFixtureFiles(): string[] {
  return fs
    .readdirSync(testDir)
    .filter((file) => file.startsWith("parity-missed-timing-") && file.endsWith("fixture.test.ts"))
    .sort();
}

function coversResponseKind(text: string, kind: "activation" | "decline"): boolean {
  const responseType = kind === "activation" ? "activateTrigger" : "declineTrigger";
  return new RegExp(`makeResponseSelector\\(\\s*["']${responseType}["']`).test(text);
}

function triggerEventsIn(text: string): string[] {
  return Array.from(text.matchAll(/triggerEvent:\s*["']([^"']+)["']/g), (match) => match[1]!);
}

function missingCoverage(expectedEvents: string[], coveredEvents: Set<string>): string[] {
  return expectedEvents.filter((eventName) => !coveredEvents.has(eventName));
}
