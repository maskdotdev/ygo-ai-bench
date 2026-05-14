import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const parityFixtureDir = path.resolve("test");

describe("aggregate legal-action evidence", () => {
  it("requires aggregate EDOPro legal-action counts to include positive action evidence", () => {
    expect(missingEdoproAggregateLegalActionEvidence()).toEqual([]);
  });

  it("requires positive aggregate EDOPro legal-action counts to include non-empty evidence", () => {
    expect(emptyEdoproAggregateLegalActionEvidence()).toEqual([]);
  });

  it("requires positive aggregate EDOPro legal-action counts to include positive evidence counts", () => {
    expect(zeroCountEdoproAggregateLegalActionEvidence()).toEqual([]);
  });

  it("keeps zero-count EDOPro legal-action evidence in absent expectations", () => {
    expect(zeroCountEdoproLegalActionEvidence()).toEqual([]);
  });

  it("detects aggregate EDOPro legal-action counts without positive action evidence", () => {
    const lines = [
      "runScriptedDuelFixture({",
      "after: {",
      "  waitingFor: 0,",
      '  source: "edopro",',
      '  note: "EDOPro observed behavior",',
      "  legalActionCounts: { 0: 1, 1: 0 },",
      "  legalActionGroupCounts: { 0: 1, 1: 0 },",
      "},",
    ];

    expect(missingEdoproAggregateLegalActionEvidenceInLines("fixture.ts", lines)).toEqual(["fixture.ts:2"]);
    expect(
      missingEdoproAggregateLegalActionEvidenceInLines("fixture.ts", [
        ...lines.slice(0, 7),
        '  legalActions: [{ type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 }],',
        "  legalActionGroups: [turnGroup(1)],",
        ...lines.slice(7),
      ]),
    ).toEqual([]);
  });

  it("detects positive aggregate EDOPro legal-action counts with empty evidence", () => {
    const lines = [
      "runScriptedDuelFixture({",
      "after: {",
      "  waitingFor: 0,",
      '  source: "edopro",',
      '  note: "EDOPro observed behavior",',
      "  legalActionCounts: { 0: 1, 1: 0 },",
      "  legalActionGroupCounts: { 0: 1, 1: 0 },",
      "  legalActions: [],",
      "  legalActionGroups: [],",
      "},",
    ];

    expect(emptyEdoproAggregateLegalActionEvidenceInLines("fixture.ts", lines)).toEqual(["fixture.ts:2"]);
    expect(
      emptyEdoproAggregateLegalActionEvidenceInLines("fixture.ts", [
        ...lines.slice(0, 7),
        '  legalActions: [{ type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 }],',
        "  legalActionGroups: [turnGroup(1)],",
        ...lines.slice(9),
      ]),
    ).toEqual([]);
  });

  it("detects positive aggregate EDOPro legal-action counts with only zero-count evidence", () => {
    const lines = [
      "runScriptedDuelFixture({",
      "after: {",
      "  waitingFor: 0,",
      '  source: "edopro",',
      '  note: "EDOPro observed behavior",',
      "  legalActionCounts: { 0: 1, 1: 0 },",
      "  legalActionGroupCounts: { 0: 1, 1: 0 },",
      '  legalActions: [{ type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 0 }],',
      "  legalActionGroups: [turnGroup(0)],",
      "},",
    ];

    expect(zeroCountEdoproAggregateLegalActionEvidenceInLines("fixture.ts", lines)).toEqual(["fixture.ts:2"]);
    expect(
      zeroCountEdoproAggregateLegalActionEvidenceInLines("fixture.ts", [
        ...lines.slice(0, 7),
        '  legalActions: [{ type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 }],',
        "  legalActionGroups: [turnGroup(1)],",
        ...lines.slice(9),
      ]),
    ).toEqual([]);
  });

  it("detects zero-count EDOPro legal-action evidence even beside positive evidence", () => {
    const lines = [
      "runScriptedDuelFixture({",
      "after: {",
      "  waitingFor: 0,",
      '  source: "edopro",',
      '  note: "EDOPro observed behavior",',
      "  legalActionCounts: { 0: 1, 1: 0 },",
      "  legalActionGroupCounts: { 0: 1, 1: 0 },",
      "  legalActions: [",
      '    { type: "declareAttack", player: 0, windowId: 1, windowKind: "open", count: 0 },',
      '    { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },',
      "  ],",
      "  legalActionGroups: [directAttackGroup(0, 'attacker', 0, 1), turnGroup(1)],",
      "},",
    ];

    expect(zeroCountEdoproLegalActionEvidenceInLines("fixture.ts", lines)).toEqual(["fixture.ts:2"]);
    expect(
      zeroCountEdoproLegalActionEvidenceInLines("fixture.ts", [
        ...lines.slice(0, 8),
        '    { type: "endTurn", player: 0, windowId: 1, windowKind: "open", count: 1 },',
        ...lines.slice(10, 11),
        "  legalActionGroups: [turnGroup(1)],",
        ...lines.slice(12),
      ]),
    ).toEqual([]);
  });
});

function missingEdoproAggregateLegalActionEvidence(): string[] {
  return parityFixtureFiles().flatMap((file) => missingEdoproAggregateLegalActionEvidenceInLines(file, readFixtureLines(file)));
}

function emptyEdoproAggregateLegalActionEvidence(): string[] {
  return parityFixtureFiles().flatMap((file) => emptyEdoproAggregateLegalActionEvidenceInLines(file, readFixtureLines(file)));
}

function zeroCountEdoproAggregateLegalActionEvidence(): string[] {
  return parityFixtureFiles().flatMap((file) => zeroCountEdoproAggregateLegalActionEvidenceInLines(file, readFixtureLines(file)));
}

function zeroCountEdoproLegalActionEvidence(): string[] {
  return parityFixtureFiles().flatMap((file) => zeroCountEdoproLegalActionEvidenceInLines(file, readFixtureLines(file)));
}

function parityFixtureFiles(): string[] {
  return fs.readdirSync(parityFixtureDir).filter((name) => /^parity-.*\.test\.ts$/.test(name) && name !== "parity-fixture-metadata.test.ts");
}

function readFixtureLines(file: string): string[] {
  return fs.readFileSync(path.join(parityFixtureDir, file), "utf8").split("\n");
}

function missingEdoproAggregateLegalActionEvidenceInLines(file: string, lines: string[]): string[] {
  const missingEvidence: string[] = [];
  lines.forEach((line, index) => {
    if (!/^\s*(before|after|expected): \{/.test(line)) return;
    const block = expectationBlock(lines, index);
    if (!/source:\s*["']edopro["']/.test(block)) return;
    if (block.includes("legalActionCounts:") && !block.includes("legalActions:")) missingEvidence.push(`${file}:${index + 1}`);
    if (block.includes("legalActionGroupCounts:") && !block.includes("legalActionGroups:")) missingEvidence.push(`${file}:${index + 1}`);
  });
  return [...new Set(missingEvidence)];
}

function emptyEdoproAggregateLegalActionEvidenceInLines(file: string, lines: string[]): string[] {
  const emptyEvidence: string[] = [];
  lines.forEach((line, index) => {
    if (!/^\s*(before|after|expected): \{/.test(line)) return;
    const block = expectationBlock(lines, index);
    if (!/source:\s*["']edopro["']/.test(block)) return;
    if (aggregateCountTotal(block, "legalActionCounts") > 0 && hasEmptyArray(block, "legalActions")) emptyEvidence.push(`${file}:${index + 1}`);
    if (aggregateCountTotal(block, "legalActionGroupCounts") > 0 && hasEmptyArray(block, "legalActionGroups")) emptyEvidence.push(`${file}:${index + 1}`);
  });
  return [...new Set(emptyEvidence)];
}

function zeroCountEdoproAggregateLegalActionEvidenceInLines(file: string, lines: string[]): string[] {
  const zeroCountEvidence: string[] = [];
  lines.forEach((line, index) => {
    if (!/^\s*(before|after|expected): \{/.test(line)) return;
    const block = expectationBlock(lines, index);
    if (!/source:\s*["']edopro["']/.test(block)) return;
    if (aggregateCountTotal(block, "legalActionCounts") > 0 && hasOnlyZeroCountEvidence(block, "legalActions")) zeroCountEvidence.push(`${file}:${index + 1}`);
    if (aggregateCountTotal(block, "legalActionGroupCounts") > 0 && hasOnlyZeroCountEvidence(block, "legalActionGroups")) zeroCountEvidence.push(`${file}:${index + 1}`);
  });
  return [...new Set(zeroCountEvidence)];
}

function zeroCountEdoproLegalActionEvidenceInLines(file: string, lines: string[]): string[] {
  const zeroCountEvidence: string[] = [];
  lines.forEach((line, index) => {
    if (!/^\s*(before|after|expected): \{/.test(line)) return;
    const block = expectationBlock(lines, index);
    if (!/source:\s*["']edopro["']/.test(block)) return;
    if (hasZeroCountEvidence(block, "legalActions")) zeroCountEvidence.push(`${file}:${index + 1}`);
    if (hasZeroCountEvidence(block, "legalActionGroups")) zeroCountEvidence.push(`${file}:${index + 1}`);
  });
  return [...new Set(zeroCountEvidence)];
}

function aggregateCountTotal(block: string, key: string): number {
  const counts = block.match(new RegExp(`${key}:\\s*\\{([^}]*)\\}`))?.[1];
  return counts === undefined ? 0 : [...counts.matchAll(/:\s*(\d+)/g)].reduce((total, match) => total + Number(match[1]), 0);
}

function hasEmptyArray(block: string, key: string): boolean {
  return new RegExp(`${key}:\\s*\\[\\s*\\]`).test(block);
}

function hasOnlyZeroCountEvidence(block: string, key: string): boolean {
  const evidence = block.match(new RegExp(`${key}:\\s*\\[([\\s\\S]*?)\\]\\s*,?`))?.[1];
  if (evidence === undefined) return false;
  const counts = [...evidence.matchAll(/count:\s*(\d+)/g)].map((match) => Number(match[1]));
  return counts.length > 0 && counts.every((count) => count === 0);
}

function hasZeroCountEvidence(block: string, key: string): boolean {
  const evidence = block.match(new RegExp(`${key}:\\s*\\[([\\s\\S]*?)\\]\\s*,?`))?.[1];
  return evidence !== undefined && /count:\s*0\b/.test(evidence);
}

function expectationBlock(lines: string[], sourceIndex: number): string {
  let depth = 0;
  const block: string[] = [];
  for (let index = sourceIndex; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    block.push(line);
    depth += braceDelta(line);
    if (depth === 0) break;
  }
  return block.join("\n");
}

function braceDelta(line: string): number {
  return [...line].reduce((total, char) => total + (char === "{" ? 1 : char === "}" ? -1 : 0), 0);
}
