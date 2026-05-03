import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const parityFixtureDir = path.resolve("test");
const parityDocFiles = ["README.md", path.join("docs", "gameplay-parity-plan.md")];

describe("parity fixture metadata", () => {
  it("scans existing parity documentation files", () => {
    expect(parityDocFiles.filter((file) => !fs.existsSync(file))).toEqual([]);
  });

  it("keeps parity docs from framing engine gaps as unsupported", () => {
    expect(unsupportedParityDocLanguage()).toEqual([]);
  });

  it("requires expectation blocks in parity fixtures to declare their evidence source", () => {
    expect(missingExpectationSources()).toEqual([]);
  });

  it("requires expectation evidence sources to be EDOPro observations or parity backlog", () => {
    expect(invalidExpectationSources()).toEqual([]);
  });

  it("requires backlog expectations in parity fixtures to explain the EDOPro behavior they track", () => {
    expect(missingBacklogNotes()).toEqual([]);
  });

  it("requires backlog expectation notes to reference EDOPro behavior", () => {
    expect(backlogNotesWithoutEdopro()).toEqual([]);
  });

  it("requires UI-facing grouped legal-action expectations to track raw positive legal-action expectations", () => {
    expect(missingLegalActionGroupCoverage()).toEqual([]);
  });

  it("requires UI-facing grouped absence expectations to track raw absent legal-action expectations", () => {
    expect(missingAbsentLegalActionGroupCoverage()).toEqual([]);
  });

  it("requires legal-action expectations to pin aggregate action counts", () => {
    expect(missingLegalActionCountCoverage()).toEqual([]);
  });

  it("requires parity fixtures to exercise snapshot restore coverage", () => {
    expect(parityFixturesWithoutSnapshotRestore()).toEqual([]);
  });

  it("detects missing source, backlog note, and grouped action metadata in fixture text", () => {
    const lines = [
      "runScriptedDuelFixture({",
      "after: {",
      "  waitingFor: 0,",
      "  legalActions: [],",
      "},",
      "expected: {",
      '  source: "parity-backlog",',
      "  waitingFor: 0,",
      "},",
    ];

    expect(missingSourcesInLines("fixture.ts", lines)).toEqual(["fixture.ts:2"]);
    expect(invalidSourcesInLines("fixture.ts", [...lines.slice(0, 3), '  source: "local",', ...lines.slice(3)])).toEqual(["fixture.ts:2"]);
    expect(invalidSourcesInLines("fixture.ts", [...lines.slice(0, 3), "  source: 'local',", ...lines.slice(3)])).toEqual(["fixture.ts:2"]);
    expect(missingBacklogNotesInLines("fixture.ts", lines)).toEqual(["fixture.ts:7"]);
    expect(backlogNotesWithoutEdoproInLines("fixture.ts", [...lines.slice(0, 7), '  note: "temporary local behavior",', ...lines.slice(7)])).toEqual(["fixture.ts:7"]);
    expect(backlogNotesWithoutEdoproInLines("fixture.ts", [...lines.slice(0, 6), "  source: 'parity-backlog',", '  note: "temporary local behavior",', ...lines.slice(8)])).toEqual(["fixture.ts:7"]);
    expect(missingAnyLegalActionGroupsInLines("fixture.ts", lines)).toEqual(["fixture.ts:2"]);
    expect(missingLegalActionCountsInLines("fixture.ts", lines)).toEqual(["fixture.ts:2"]);
    expect(parityFixtureWithoutSnapshotRestoreInLines("fixture.ts", lines)).toEqual(["fixture.ts"]);
  });
});

function missingExpectationSources(): string[] {
  return scriptedFixtureFiles().flatMap((file) => missingSourcesInLines(file, readFixtureLines(file)));
}

function invalidExpectationSources(): string[] {
  return scriptedFixtureFiles().flatMap((file) => invalidSourcesInLines(file, readFixtureLines(file)));
}

function unsupportedParityDocLanguage(): string[] {
  return parityDocFiles.flatMap((file) => {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    return lines.flatMap((line, index) => /unsupported|not supported|out of scope/i.test(line) ? [`${file}:${index + 1}`] : []);
  });
}

function missingBacklogNotes(): string[] {
  return scriptedFixtureFiles().flatMap((file) => missingBacklogNotesInLines(file, readFixtureLines(file)));
}

function backlogNotesWithoutEdopro(): string[] {
  return scriptedFixtureFiles().flatMap((file) => backlogNotesWithoutEdoproInLines(file, readFixtureLines(file)));
}

function missingLegalActionGroupCoverage(): string[] {
  return parityFixtureFiles().flatMap((file) => missingLegalActionGroupsInLines(file, readFixtureLines(file), "legalActions:", "legalActionGroups:"));
}

function missingAbsentLegalActionGroupCoverage(): string[] {
  return parityFixtureFiles().flatMap((file) => missingLegalActionGroupsInLines(file, readFixtureLines(file), "absentLegalActions:", "absentLegalActionGroups:"));
}

function missingLegalActionCountCoverage(): string[] {
  return ["parity-battle-result-fixture.test.ts", "parity-battle-window-fixture.test.ts", "parity-battle-action-lock-fixture.test.ts"]
    .flatMap((file) => missingLegalActionCountsInLines(file, readFixtureLines(file)));
}

function parityFixturesWithoutSnapshotRestore(): string[] {
  return parityFixtureFiles().flatMap((file) => parityFixtureWithoutSnapshotRestoreInLines(file, readFixtureLines(file)));
}

function missingSourcesInLines(file: string, lines: string[]): string[] {
  const missingSources: string[] = [];
  lines.forEach((line, index) => {
    if (!/^\s*(before|after|expected): \{/.test(line)) return;
    if (sourceLineInBlock(expectationBlock(lines, index)) === undefined) missingSources.push(`${file}:${index + 1}`);
  });
  return missingSources;
}

function invalidSourcesInLines(file: string, lines: string[]): string[] {
  const invalidSources: string[] = [];
  lines.forEach((line, index) => {
    if (!/^\s*(before|after|expected): \{/.test(line)) return;
    const sourceLine = sourceLineInBlock(expectationBlock(lines, index));
    if (sourceLine !== undefined && !/source:\s*["'](edopro|parity-backlog)["']/.test(sourceLine)) invalidSources.push(`${file}:${index + 1}`);
  });
  return invalidSources;
}

function missingBacklogNotesInLines(file: string, lines: string[]): string[] {
  const missingNotes: string[] = [];
  lines.forEach((line, index) => {
    if (!hasParityBacklogSource(line)) return;
    if (!expectationBlock(lines, index).includes("note:")) missingNotes.push(`${file}:${index + 1}`);
  });
  return missingNotes;
}

function backlogNotesWithoutEdoproInLines(file: string, lines: string[]): string[] {
  const missingEdopro: string[] = [];
  lines.forEach((line, index) => {
    if (!hasParityBacklogSource(line)) return;
    const noteLine = expectationBlock(lines, index).split("\n").find((blockLine) => blockLine.includes("note:"));
    if (noteLine !== undefined && !/edopro/i.test(noteLine)) missingEdopro.push(`${file}:${index + 1}`);
  });
  return missingEdopro;
}

function missingAnyLegalActionGroupsInLines(file: string, lines: string[]): string[] {
  return [
    ...missingLegalActionGroupsInLines(file, lines, "legalActions:", "legalActionGroups:"),
    ...missingLegalActionGroupsInLines(file, lines, "absentLegalActions:", "absentLegalActionGroups:"),
  ];
}

function missingLegalActionGroupsInLines(file: string, lines: string[], rawSearch: string, groupSearch: string): string[] {
  const missingGroups: string[] = [];
  lines.forEach((line, index) => {
    if (!/^\s*(before|after|expected): \{/.test(line)) return;
    const block = expectationBlock(lines, index);
    const rawCount = occurrenceCount(block, rawSearch);
    const groupCount = occurrenceCount(block, groupSearch);
    if (rawCount > groupCount) missingGroups.push(`${file}:${index + 1}`);
  });
  return missingGroups;
}

function missingLegalActionCountsInLines(file: string, lines: string[]): string[] {
  const missingCounts: string[] = [];
  lines.forEach((line, index) => {
    if (!/^\s*(before|after|expected): \{/.test(line)) return;
    const block = expectationBlock(lines, index);
    if (block.includes("legalActions:") && !block.includes("legalActionCounts:")) missingCounts.push(`${file}:${index + 1}`);
    if (block.includes("legalActionGroups:") && !block.includes("legalActionGroupCounts:")) missingCounts.push(`${file}:${index + 1}`);
  });
  return [...new Set(missingCounts)];
}

function parityFixtureWithoutSnapshotRestoreInLines(file: string, lines: string[]): string[] {
  const text = lines.join("\n");
  return text.includes("runScriptedDuelFixture") && !text.includes("snapshotRestore") ? [file] : [];
}

function parityFixtureFiles(): string[] {
  return fs.readdirSync(parityFixtureDir).filter((name) => /^parity-.*\.test\.ts$/.test(name) && name !== "parity-fixture-metadata.test.ts");
}

function scriptedFixtureFiles(): string[] {
  return fs.readdirSync(parityFixtureDir).filter((name) => {
    if (!name.endsWith(".test.ts") || name === "parity-fixture-metadata.test.ts") return false;
    return fs.readFileSync(path.join(parityFixtureDir, name), "utf8").includes("runScriptedDuelFixture");
  });
}

function readFixtureLines(file: string): string[] {
  return fs.readFileSync(path.join(parityFixtureDir, file), "utf8").split("\n");
}

function expectationBlock(lines: string[], sourceIndex: number): string {
  const start = findBlockStart(lines, sourceIndex);
  let depth = 0;
  const block: string[] = [];
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    block.push(line);
    depth += braceDelta(line);
    if (depth === 0) break;
  }
  return block.join("\n");
}

function findBlockStart(lines: string[], sourceIndex: number): number {
  for (let index = sourceIndex; index >= 0; index -= 1) {
    if ((lines[index] ?? "").includes("{")) return index;
  }
  return sourceIndex;
}

function braceDelta(line: string): number {
  return [...line].reduce((total, char) => total + (char === "{" ? 1 : char === "}" ? -1 : 0), 0);
}

function occurrenceCount(text: string, search: string): number {
  return text.split(search).length - 1;
}

function sourceLineInBlock(block: string): string | undefined {
  return block.split("\n").find((line) => /\bsource:/.test(line));
}

function hasParityBacklogSource(line: string): boolean {
  return /source:\s*["']parity-backlog["']/.test(line);
}
