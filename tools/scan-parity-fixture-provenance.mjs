#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const defaultTestRoot = "test";
const validSources = new Set(["edopro", "parity-backlog"]);

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return 0;
  }

  const testRoot = path.resolve(options.testRoot ?? defaultTestRoot);
  const files = parityFixtureFiles(testRoot);
  const missingSource = [];
  const invalidSource = [];
  const missingNote = [];
  const weakNote = [];
  const missingRestore = [];
  const unrestoredBeforeBlocks = [];
  const unrestoredAfterBlocks = [];
  const afterOnlyRestoreSteps = [];
  let blocks = 0;
  let edoproBlocks = 0;
  let backlogBlocks = 0;
  let restoredFixtures = 0;
  let restoredBeforeBlocks = 0;
  let restoredAfterBlocks = 0;
  let finalExpectedBlocks = 0;

  for (const file of files) {
    const text = fs.readFileSync(path.join(testRoot, file), "utf8");
    const lines = text.split("\n");
    const fileBlocks = expectationBlocks(lines);
    for (const line of afterOnlySnapshotRestoreStepLines(lines)) afterOnlyRestoreSteps.push(`${file}:${line}`);
    blocks += fileBlocks.length;
    if (text.includes("runScriptedDuelFixture")) {
      if (text.includes("snapshotRestore")) restoredFixtures += 1;
      else missingRestore.push(file);
    }
    for (const block of fileBlocks) {
      const source = sourceValue(block.text);
      const note = noteValue(block.text);
      if (source === undefined) {
        missingSource.push(`${file}:${block.line}`);
        continue;
      }
      if (!validSources.has(source)) invalidSource.push(`${file}:${block.line}`);
      if (source === "edopro") edoproBlocks += 1;
      if (source === "parity-backlog") backlogBlocks += 1;
      if (source === "edopro" && block.kind === "expected") finalExpectedBlocks += 1;
      if (source === "edopro" && block.kind === "before" && (block.snapshotRestore === "before" || block.snapshotRestore === "both")) restoredBeforeBlocks += 1;
      if (source === "edopro" && block.kind === "after" && (block.snapshotRestore === "after" || block.snapshotRestore === "both")) restoredAfterBlocks += 1;
      if (source === "edopro" && block.kind === "before" && block.snapshotRestore !== "before" && block.snapshotRestore !== "both") {
        unrestoredBeforeBlocks.push({ location: `${file}:${block.line}`, note });
      }
      if (source === "edopro" && block.kind === "after" && block.snapshotRestore !== "after" && block.snapshotRestore !== "both") {
        unrestoredAfterBlocks.push({ location: `${file}:${block.line}`, note });
      }
      if (note === undefined || note.length === 0) missingNote.push(`${file}:${block.line}`);
      else if (!/EDOPro/.test(note)) weakNote.push(`${file}:${block.line}`);
    }
  }

  const restoredWindowBlocks = restoredBeforeBlocks + restoredAfterBlocks;
  console.log(`Parity fixture provenance: ${files.length} files, ${blocks} expectation blocks, ${edoproBlocks} EDOPro, ${backlogBlocks} backlog, ${restoredFixtures} restored scripted fixtures, ${restoredBeforeBlocks} restored before blocks, ${restoredAfterBlocks} restored after blocks, ${restoredWindowBlocks} restored window blocks, ${finalExpectedBlocks} final expected blocks, ${afterOnlyRestoreSteps.length} after-only restore steps`);

  const failures = [];
  if (options.minFiles !== undefined && files.length < options.minFiles) failures.push(`Parity fixture files ${files.length} is below required ${options.minFiles}`);
  if (options.minExpectationBlocks !== undefined && blocks < options.minExpectationBlocks) failures.push(`Expectation blocks ${blocks} is below required ${options.minExpectationBlocks}`);
  if (options.minEdoproBlocks !== undefined && edoproBlocks < options.minEdoproBlocks) failures.push(`EDOPro expectation blocks ${edoproBlocks} is below required ${options.minEdoproBlocks}`);
  if (options.minRestoredFixtures !== undefined && restoredFixtures < options.minRestoredFixtures) failures.push(`Restored scripted fixtures ${restoredFixtures} is below required ${options.minRestoredFixtures}`);
  if (options.minRestoredBeforeBlocks !== undefined && restoredBeforeBlocks < options.minRestoredBeforeBlocks) failures.push(`Restored before blocks ${restoredBeforeBlocks} is below required ${options.minRestoredBeforeBlocks}`);
  if (options.minRestoredAfterBlocks !== undefined && restoredAfterBlocks < options.minRestoredAfterBlocks) failures.push(`Restored after blocks ${restoredAfterBlocks} is below required ${options.minRestoredAfterBlocks}`);
  if (options.minRestoredWindowBlocks !== undefined && restoredWindowBlocks < options.minRestoredWindowBlocks) failures.push(`Restored window blocks ${restoredWindowBlocks} is below required ${options.minRestoredWindowBlocks}`);
  if (options.minFinalExpectedBlocks !== undefined && finalExpectedBlocks < options.minFinalExpectedBlocks) failures.push(`Final expected blocks ${finalExpectedBlocks} is below required ${options.minFinalExpectedBlocks}`);
  if (options.maxUnrestoredBeforeBlocks !== undefined && unrestoredBeforeBlocks.length > options.maxUnrestoredBeforeBlocks) {
    failures.push(`Unrestored EDOPro before blocks ${unrestoredBeforeBlocks.length} exceeds allowed ${options.maxUnrestoredBeforeBlocks}:\n${formatList(unrestoredBeforeBlocks.map(({ location }) => location))}`);
  }
  if (options.maxUnrestoredAfterBlocks !== undefined && unrestoredAfterBlocks.length > options.maxUnrestoredAfterBlocks) {
    failures.push(`Unrestored EDOPro after blocks ${unrestoredAfterBlocks.length} exceeds allowed ${options.maxUnrestoredAfterBlocks}:\n${formatList(unrestoredAfterBlocks.map(({ location }) => location))}`);
  }
  if (options.maxAfterOnlyRestoreSteps !== undefined && afterOnlyRestoreSteps.length > options.maxAfterOnlyRestoreSteps) {
    failures.push(`After-only restore steps ${afterOnlyRestoreSteps.length} exceeds allowed ${options.maxAfterOnlyRestoreSteps}:\n${formatList(afterOnlyRestoreSteps)}`);
  }
  if (options.requireUnrestoredAfterNote !== undefined) {
    const invalidUnrestoredNotes = unrestoredAfterBlocks
      .filter(({ note }) => note === undefined || !note.includes(options.requireUnrestoredAfterNote))
      .map(({ location }) => location);
    if (invalidUnrestoredNotes.length > 0) {
      failures.push(`Unrestored EDOPro after blocks must include note text ${JSON.stringify(options.requireUnrestoredAfterNote)}:\n${formatList(invalidUnrestoredNotes)}`);
    }
  }
  if (options.failOnMissingSource && missingSource.length > 0) failures.push(`Expectation blocks missing source:\n${formatList(missingSource)}`);
  if (options.failOnInvalidSource && invalidSource.length > 0) failures.push(`Expectation blocks with invalid source:\n${formatList(invalidSource)}`);
  if (options.failOnMissingNote && missingNote.length > 0) failures.push(`Sourced expectation blocks missing observation note:\n${formatList(missingNote)}`);
  if (options.failOnWeakNote && weakNote.length > 0) failures.push(`Observation notes that do not reference EDOPro:\n${formatList(weakNote)}`);
  if (options.failOnBacklog && backlogBlocks > 0) failures.push(`Parity backlog expectation blocks remain: ${backlogBlocks}`);
  if (options.failOnMissingRestore && missingRestore.length > 0) failures.push(`Scripted parity fixtures missing snapshotRestore:\n${formatList(missingRestore)}`);

  if (failures.length === 0) return 0;
  console.error(failures.join("\n\n"));
  return 1;
}

function parseArgs(argv) {
  const options = {
    failOnMissingSource: false,
    failOnInvalidSource: false,
    failOnMissingNote: false,
    failOnWeakNote: false,
    failOnBacklog: false,
    failOnMissingRestore: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--test-root") options.testRoot = requireOptionValue(argv, ++index, arg);
    else if (arg === "--fail-on-missing-source") options.failOnMissingSource = true;
    else if (arg === "--fail-on-invalid-source") options.failOnInvalidSource = true;
    else if (arg === "--fail-on-missing-note") options.failOnMissingNote = true;
    else if (arg === "--fail-on-weak-note") options.failOnWeakNote = true;
    else if (arg === "--fail-on-backlog") options.failOnBacklog = true;
    else if (arg === "--fail-on-missing-restore") options.failOnMissingRestore = true;
    else if (arg === "--min-files") options.minFiles = readMinimum(argv, ++index, arg);
    else if (arg === "--min-expectation-blocks") options.minExpectationBlocks = readMinimum(argv, ++index, arg);
    else if (arg === "--min-edopro-blocks") options.minEdoproBlocks = readMinimum(argv, ++index, arg);
    else if (arg === "--min-restored-fixtures") options.minRestoredFixtures = readMinimum(argv, ++index, arg);
    else if (arg === "--min-restored-before-blocks") options.minRestoredBeforeBlocks = readMinimum(argv, ++index, arg);
    else if (arg === "--min-restored-after-blocks") options.minRestoredAfterBlocks = readMinimum(argv, ++index, arg);
    else if (arg === "--min-restored-window-blocks") options.minRestoredWindowBlocks = readMinimum(argv, ++index, arg);
    else if (arg === "--min-final-expected-blocks") options.minFinalExpectedBlocks = readMinimum(argv, ++index, arg);
    else if (arg === "--max-unrestored-before-blocks") options.maxUnrestoredBeforeBlocks = readMinimum(argv, ++index, arg);
    else if (arg === "--max-unrestored-after-blocks") options.maxUnrestoredAfterBlocks = readMinimum(argv, ++index, arg);
    else if (arg === "--max-after-only-restore-steps") options.maxAfterOnlyRestoreSteps = readMinimum(argv, ++index, arg);
    else if (arg === "--require-unrestored-after-note") options.requireUnrestoredAfterNote = requireOptionValue(argv, ++index, arg);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function requireOptionValue(argv, index, option) {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
  return value;
}

function readMinimum(argv, index, option) {
  const value = Number(requireOptionValue(argv, index, option));
  if (!Number.isInteger(value) || value < 0) throw new Error(`${option} must be a non-negative integer`);
  return value;
}

function parityFixtureFiles(testRoot) {
  return fs.readdirSync(testRoot)
    .filter((name) => /^parity-.*\.test\.ts$/.test(name) && name !== "parity-fixture-metadata.test.ts")
    .sort();
}

function expectationBlocks(lines) {
  const blocks = [];
  lines.forEach((line, index) => {
    const kind = line.match(/^\s*(before|after|expected): \{/)?.[1];
    if (kind === undefined) return;
    blocks.push({ kind, line: index + 1, snapshotRestore: snapshotRestoreMode(lines, index), text: expectationBlock(lines, index) });
  });
  return blocks;
}

function afterOnlySnapshotRestoreStepLines(lines) {
  return lines.flatMap((line, index) => /\bsnapshotRestore:\s*["']after["']/.test(line) ? [index + 1] : []);
}

function snapshotRestoreMode(lines, sourceIndex) {
  const stepOptions = containingStepOptions(lines, sourceIndex);
  return stepOptions?.match(/\bsnapshotRestore:\s*["']([^"']+)["']/)?.[1];
}

function containingStepOptions(lines, sourceIndex) {
  for (let index = sourceIndex; index >= 0 && index > sourceIndex - 120; index -= 1) {
    const line = lines[index] ?? "";
    const callIndex = line.indexOf("makeScriptedStep(");
    if (callIndex < 0) continue;
    const optionsStart = line.lastIndexOf("{");
    if (optionsStart < callIndex) return undefined;
    return blockFrom(lines, index, optionsStart);
  }
  return undefined;
}

function blockFrom(lines, sourceIndex, columnIndex) {
  let depth = 0;
  const block = [];
  for (let index = sourceIndex; index < lines.length; index += 1) {
    const line = index === sourceIndex ? (lines[index] ?? "").slice(columnIndex) : (lines[index] ?? "");
    block.push(line);
    depth += braceDelta(line);
    if (depth === 0) break;
  }
  return block.join("\n");
}

function expectationBlock(lines, sourceIndex) {
  let depth = 0;
  const block = [];
  for (let index = sourceIndex; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    block.push(line);
    depth += braceDelta(line);
    if (depth === 0) break;
  }
  return block.join("\n");
}

function braceDelta(line) {
  return [...line].reduce((total, char) => total + (char === "{" ? 1 : char === "}" ? -1 : 0), 0);
}

function sourceValue(block) {
  return block.match(/\bsource:\s*["']([^"']+)["']/)?.[1];
}

function noteValue(block) {
  return block.match(/\bnote:\s*["']([^"']*)["']/)?.[1];
}

function formatList(items) {
  return items.map((item) => `  ${item}`).join("\n");
}

function printHelp() {
  console.log(`Usage: node tools/scan-parity-fixture-provenance.mjs [options]

Options:
  --test-root <path>           Test directory to scan. Default: ${defaultTestRoot}
  --fail-on-missing-source     Fail when expectation blocks omit source
  --fail-on-invalid-source     Fail when source is not edopro or parity-backlog
  --fail-on-missing-note       Fail when sourced expectations omit notes
  --fail-on-weak-note          Fail when notes do not reference EDOPro
  --fail-on-backlog            Fail when any parity-backlog expectation remains
  --fail-on-missing-restore    Fail when scripted fixtures omit snapshotRestore
  --min-files <count>          Fail unless at least this many parity fixture files are scanned
  --min-expectation-blocks <count>
                               Fail unless at least this many expectation blocks are scanned
  --min-edopro-blocks <count>  Fail unless at least this many EDOPro blocks are scanned
  --min-restored-fixtures <count>
                               Fail unless at least this many scripted fixtures have snapshotRestore
  --min-restored-before-blocks <count>
                               Fail unless at least this many EDOPro before blocks restore snapshots
  --min-restored-after-blocks <count>
                               Fail unless at least this many EDOPro after blocks restore snapshots
  --min-restored-window-blocks <count>
                               Fail unless at least this many EDOPro before/after blocks restore snapshots
  --min-final-expected-blocks <count>
                               Fail unless at least this many EDOPro final expected blocks are scanned
  --max-unrestored-before-blocks <count>
                               Fail when more than this many EDOPro before blocks lack before/both restore
  --max-unrestored-after-blocks <count>
                               Fail when more than this many EDOPro after blocks lack after/both restore
  --max-after-only-restore-steps <count>
                               Fail when more than this many scripted steps restore only after the response
  --require-unrestored-after-note <text>
                               Fail when allowed unrestored EDOPro after blocks omit this note substring
`);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
