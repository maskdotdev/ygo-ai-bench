import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const parityFixtureDir = path.resolve("test");

describe("parity fixture metadata", () => {
  it("requires expectation blocks in parity fixtures to declare their evidence source", () => {
    expect(missingExpectationSources()).toEqual([]);
  });

  it("requires backlog expectations in parity fixtures to explain the EDOPro behavior they track", () => {
    expect(missingBacklogNotes()).toEqual([]);
  });

  it("detects missing source and backlog note metadata in fixture text", () => {
    const lines = [
      "after: {",
      "  waitingFor: 0,",
      "},",
      "expected: {",
      '  source: "parity-backlog",',
      "  waitingFor: 0,",
      "},",
    ];

    expect(missingSourcesInLines("fixture.ts", lines)).toEqual(["fixture.ts:1"]);
    expect(missingBacklogNotesInLines("fixture.ts", lines)).toEqual(["fixture.ts:5"]);
  });
});

function missingExpectationSources(): string[] {
  return parityFixtureFiles().flatMap((file) => missingSourcesInLines(file, readFixtureLines(file)));
}

function missingBacklogNotes(): string[] {
  return parityFixtureFiles().flatMap((file) => missingBacklogNotesInLines(file, readFixtureLines(file)));
}

function missingSourcesInLines(file: string, lines: string[]): string[] {
  const missingSources: string[] = [];
  lines.forEach((line, index) => {
    if (!/^\s*(before|after|expected): \{/.test(line)) return;
    if (!expectationBlock(lines, index).includes("source:")) missingSources.push(`${file}:${index + 1}`);
  });
  return missingSources;
}

function missingBacklogNotesInLines(file: string, lines: string[]): string[] {
  const missingNotes: string[] = [];
  lines.forEach((line, index) => {
    if (!line.includes('source: "parity-backlog"')) return;
    if (!expectationBlock(lines, index).includes("note:")) missingNotes.push(`${file}:${index + 1}`);
  });
  return missingNotes;
}

function parityFixtureFiles(): string[] {
  return fs.readdirSync(parityFixtureDir).filter((name) => /^parity-.*\.test\.ts$/.test(name) && name !== "parity-fixture-metadata.test.ts");
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
