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
  let blocks = 0;
  let edoproBlocks = 0;
  let backlogBlocks = 0;
  let restoredFixtures = 0;

  for (const file of files) {
    const text = fs.readFileSync(path.join(testRoot, file), "utf8");
    const lines = text.split("\n");
    const fileBlocks = expectationBlocks(lines);
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
      if (note === undefined || note.length === 0) missingNote.push(`${file}:${block.line}`);
      else if (!/EDOPro/.test(note)) weakNote.push(`${file}:${block.line}`);
    }
  }

  console.log(`Parity fixture provenance: ${files.length} files, ${blocks} expectation blocks, ${edoproBlocks} EDOPro, ${backlogBlocks} backlog, ${restoredFixtures} restored scripted fixtures`);

  const failures = [];
  if (options.minFiles !== undefined && files.length < options.minFiles) failures.push(`Parity fixture files ${files.length} is below required ${options.minFiles}`);
  if (options.minExpectationBlocks !== undefined && blocks < options.minExpectationBlocks) failures.push(`Expectation blocks ${blocks} is below required ${options.minExpectationBlocks}`);
  if (options.minEdoproBlocks !== undefined && edoproBlocks < options.minEdoproBlocks) failures.push(`EDOPro expectation blocks ${edoproBlocks} is below required ${options.minEdoproBlocks}`);
  if (options.minRestoredFixtures !== undefined && restoredFixtures < options.minRestoredFixtures) failures.push(`Restored scripted fixtures ${restoredFixtures} is below required ${options.minRestoredFixtures}`);
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
    if (!/^\s*(before|after|expected): \{/.test(line)) return;
    blocks.push({ line: index + 1, text: expectationBlock(lines, index) });
  });
  return blocks;
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
`);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
