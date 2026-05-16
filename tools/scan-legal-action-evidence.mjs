#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const defaultTestRoot = "test";

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return 0;
  }

  const testRoot = path.resolve(options.testRoot ?? defaultTestRoot);
  const fixtureFiles = parityFixtureFiles(testRoot);
  const missing = [];
  const empty = [];
  const zeroOnly = [];
  const zeroEvidence = [];
  const unpairedAbsent = [];
  const emptyAbsent = [];
  const missingWindowEvidence = [];
  const missingTopLevelWindowEvidence = [];
  let edoproBlocks = 0;
  let actionEvidenceBlocks = 0;
  let groupEvidenceBlocks = 0;
  let windowEvidenceBlocks = 0;
  let topLevelWindowEvidenceBlocks = 0;
  let absentActionEvidenceBlocks = 0;
  let absentGroupEvidenceBlocks = 0;
  let pairedAbsentEvidenceBlocks = 0;

  for (const file of fixtureFiles) {
    const lines = readFixtureLines(testRoot, file);
    for (const block of expectationBlocks(lines)) {
      if (!/source:\s*["']edopro["']/.test(block.text)) continue;
      edoproBlocks += 1;
      const hasAbsentActions = block.text.includes("absentLegalActions:");
      const hasAbsentGroups = block.text.includes("absentLegalActionGroups:");
      if (block.text.includes("legalActions:")) actionEvidenceBlocks += 1;
      if (block.text.includes("legalActionGroups:")) groupEvidenceBlocks += 1;
      if (hasWindowEvidence(block.text)) windowEvidenceBlocks += 1;
      else missingWindowEvidence.push(`${file}:${block.line}`);
      if (hasTopLevelWindowEvidence(block.text)) topLevelWindowEvidenceBlocks += 1;
      else missingTopLevelWindowEvidence.push(`${file}:${block.line}`);
      if (hasAbsentActions) absentActionEvidenceBlocks += 1;
      if (hasAbsentGroups) absentGroupEvidenceBlocks += 1;
      if (hasAbsentActions && hasAbsentGroups) pairedAbsentEvidenceBlocks += 1;
      if (hasAbsentActions !== hasAbsentGroups) unpairedAbsent.push(`${file}:${block.line}`);
      emptyAbsent.push(...emptyAbsentEvidence(file, block));
      missing.push(...missingAggregateEvidence(file, block));
      empty.push(...emptyAggregateEvidence(file, block));
      zeroOnly.push(...zeroOnlyAggregateEvidence(file, block));
      zeroEvidence.push(...zeroCountEvidence(file, block));
    }
  }

  console.log(`EDOPro legal-action evidence: ${fixtureFiles.length} parity files, ${edoproBlocks} EDOPro expectation blocks, ${actionEvidenceBlocks} action evidence blocks, ${groupEvidenceBlocks} group evidence blocks, ${windowEvidenceBlocks} window evidence blocks, ${topLevelWindowEvidenceBlocks} top-level window evidence blocks, ${absentActionEvidenceBlocks} absent action evidence blocks, ${absentGroupEvidenceBlocks} absent group evidence blocks, ${pairedAbsentEvidenceBlocks} paired absent evidence blocks`);

  const failures = [];
  if (options.minFiles !== undefined && fixtureFiles.length < options.minFiles) failures.push(`Parity fixture files ${fixtureFiles.length} is below required ${options.minFiles}`);
  if (options.minEdoproBlocks !== undefined && edoproBlocks < options.minEdoproBlocks) failures.push(`EDOPro expectation blocks ${edoproBlocks} is below required ${options.minEdoproBlocks}`);
  if (options.minActionEvidenceBlocks !== undefined && actionEvidenceBlocks < options.minActionEvidenceBlocks) failures.push(`Action evidence blocks ${actionEvidenceBlocks} is below required ${options.minActionEvidenceBlocks}`);
  if (options.minGroupEvidenceBlocks !== undefined && groupEvidenceBlocks < options.minGroupEvidenceBlocks) failures.push(`Group evidence blocks ${groupEvidenceBlocks} is below required ${options.minGroupEvidenceBlocks}`);
  if (options.minWindowEvidenceBlocks !== undefined && windowEvidenceBlocks < options.minWindowEvidenceBlocks) failures.push(`Window evidence blocks ${windowEvidenceBlocks} is below required ${options.minWindowEvidenceBlocks}`);
  if (options.minTopLevelWindowEvidenceBlocks !== undefined && topLevelWindowEvidenceBlocks < options.minTopLevelWindowEvidenceBlocks) failures.push(`Top-level window evidence blocks ${topLevelWindowEvidenceBlocks} is below required ${options.minTopLevelWindowEvidenceBlocks}`);
  if (options.minAbsentActionEvidenceBlocks !== undefined && absentActionEvidenceBlocks < options.minAbsentActionEvidenceBlocks) failures.push(`Absent action evidence blocks ${absentActionEvidenceBlocks} is below required ${options.minAbsentActionEvidenceBlocks}`);
  if (options.minAbsentGroupEvidenceBlocks !== undefined && absentGroupEvidenceBlocks < options.minAbsentGroupEvidenceBlocks) failures.push(`Absent group evidence blocks ${absentGroupEvidenceBlocks} is below required ${options.minAbsentGroupEvidenceBlocks}`);
  if (options.minPairedAbsentEvidenceBlocks !== undefined && pairedAbsentEvidenceBlocks < options.minPairedAbsentEvidenceBlocks) failures.push(`Paired absent evidence blocks ${pairedAbsentEvidenceBlocks} is below required ${options.minPairedAbsentEvidenceBlocks}`);
  const actionEvidencePercent = percentage(actionEvidenceBlocks, edoproBlocks);
  const groupEvidencePercent = percentage(groupEvidenceBlocks, edoproBlocks);
  if (options.minActionEvidencePercent !== undefined && actionEvidencePercent < options.minActionEvidencePercent) failures.push(`Action evidence coverage ${actionEvidencePercent.toFixed(1)}% is below required ${options.minActionEvidencePercent.toFixed(1)}%`);
  if (options.minGroupEvidencePercent !== undefined && groupEvidencePercent < options.minGroupEvidencePercent) failures.push(`Group evidence coverage ${groupEvidencePercent.toFixed(1)}% is below required ${options.minGroupEvidencePercent.toFixed(1)}%`);
  if (options.failOnMissing && missing.length > 0) failures.push(`Aggregate counts missing concrete legal-action evidence:\n${formatList(missing)}`);
  if (options.failOnEmpty && empty.length > 0) failures.push(`Positive aggregate counts with empty legal-action evidence:\n${formatList(empty)}`);
  if (options.failOnZeroOnly && zeroOnly.length > 0) failures.push(`Positive aggregate counts with only zero-count legal-action evidence:\n${formatList(zeroOnly)}`);
  if (options.failOnZeroEvidence && zeroEvidence.length > 0) failures.push(`Zero-count legal-action evidence must move to absent expectations:\n${formatList(zeroEvidence)}`);
  if (options.failOnUnpairedAbsent && unpairedAbsent.length > 0) failures.push(`Absent legal-action evidence must include both raw and grouped assertions:\n${formatList(unpairedAbsent)}`);
  if (options.failOnEmptyAbsent && emptyAbsent.length > 0) failures.push(`Absent legal-action evidence arrays must not be empty:\n${formatList(emptyAbsent)}`);
  if (options.failOnMissingWindowEvidence && missingWindowEvidence.length > 0) failures.push(`EDOPro blocks missing windowId/windowKind evidence:\n${formatList(missingWindowEvidence)}`);
  if (options.failOnMissingTopLevelWindowEvidence && missingTopLevelWindowEvidence.length > 0) failures.push(`EDOPro blocks missing top-level windowId/windowKind evidence:\n${formatList(missingTopLevelWindowEvidence)}`);

  if (failures.length === 0) return 0;
  console.error(failures.join("\n\n"));
  return 1;
}

function parseArgs(argv) {
  const options = {
    failOnMissing: false,
    failOnEmpty: false,
    failOnZeroOnly: false,
    failOnZeroEvidence: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--test-root") options.testRoot = requireOptionValue(argv, ++index, arg);
    else if (arg === "--fail-on-missing") options.failOnMissing = true;
    else if (arg === "--fail-on-empty") options.failOnEmpty = true;
    else if (arg === "--fail-on-zero-only") options.failOnZeroOnly = true;
    else if (arg === "--fail-on-zero-evidence") options.failOnZeroEvidence = true;
    else if (arg === "--fail-on-unpaired-absent") options.failOnUnpairedAbsent = true;
    else if (arg === "--fail-on-empty-absent") options.failOnEmptyAbsent = true;
    else if (arg === "--fail-on-missing-window-evidence") options.failOnMissingWindowEvidence = true;
    else if (arg === "--fail-on-missing-top-level-window-evidence") options.failOnMissingTopLevelWindowEvidence = true;
    else if (arg === "--min-files") options.minFiles = readMinimum(argv, ++index, arg);
    else if (arg === "--min-edopro-blocks") options.minEdoproBlocks = readMinimum(argv, ++index, arg);
    else if (arg === "--min-action-evidence-blocks") options.minActionEvidenceBlocks = readMinimum(argv, ++index, arg);
    else if (arg === "--min-group-evidence-blocks") options.minGroupEvidenceBlocks = readMinimum(argv, ++index, arg);
    else if (arg === "--min-window-evidence-blocks") options.minWindowEvidenceBlocks = readMinimum(argv, ++index, arg);
    else if (arg === "--min-top-level-window-evidence-blocks") options.minTopLevelWindowEvidenceBlocks = readMinimum(argv, ++index, arg);
    else if (arg === "--min-absent-action-evidence-blocks") options.minAbsentActionEvidenceBlocks = readMinimum(argv, ++index, arg);
    else if (arg === "--min-absent-group-evidence-blocks") options.minAbsentGroupEvidenceBlocks = readMinimum(argv, ++index, arg);
    else if (arg === "--min-paired-absent-evidence-blocks") options.minPairedAbsentEvidenceBlocks = readMinimum(argv, ++index, arg);
    else if (arg === "--min-action-evidence-percent") options.minActionEvidencePercent = readPercent(argv, ++index, arg);
    else if (arg === "--min-group-evidence-percent") options.minGroupEvidencePercent = readPercent(argv, ++index, arg);
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

function readPercent(argv, index, option) {
  const value = Number(requireOptionValue(argv, index, option));
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(`${option} must be a percentage from 0 to 100`);
  return value;
}

function percentage(part, total) {
  return total === 0 ? 100 : (part / total) * 100;
}

function parityFixtureFiles(testRoot) {
  return fs.readdirSync(testRoot)
    .filter((name) => /^parity-.*\.test\.ts$/.test(name) && name !== "parity-fixture-metadata.test.ts")
    .sort();
}

function readFixtureLines(testRoot, file) {
  return fs.readFileSync(path.join(testRoot, file), "utf8").split("\n");
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

function missingAggregateEvidence(file, block) {
  const missing = [];
  if (block.text.includes("legalActionCounts:") && !block.text.includes("legalActions:")) missing.push(`${file}:${block.line}`);
  if (block.text.includes("legalActionGroupCounts:") && !block.text.includes("legalActionGroups:")) missing.push(`${file}:${block.line}`);
  return [...new Set(missing)];
}

function emptyAggregateEvidence(file, block) {
  const empty = [];
  if (aggregateCountTotal(block.text, "legalActionCounts") > 0 && hasEmptyArray(block.text, "legalActions")) empty.push(`${file}:${block.line}`);
  if (aggregateCountTotal(block.text, "legalActionGroupCounts") > 0 && hasEmptyArray(block.text, "legalActionGroups")) empty.push(`${file}:${block.line}`);
  return [...new Set(empty)];
}

function zeroOnlyAggregateEvidence(file, block) {
  const zeroOnly = [];
  if (aggregateCountTotal(block.text, "legalActionCounts") > 0 && hasOnlyZeroCountEvidence(block.text, "legalActions")) zeroOnly.push(`${file}:${block.line}`);
  if (aggregateCountTotal(block.text, "legalActionGroupCounts") > 0 && hasOnlyZeroCountEvidence(block.text, "legalActionGroups")) zeroOnly.push(`${file}:${block.line}`);
  return [...new Set(zeroOnly)];
}

function zeroCountEvidence(file, block) {
  const zero = [];
  if (hasZeroCountEvidence(block.text, "legalActions")) zero.push(`${file}:${block.line}`);
  if (hasZeroCountEvidence(block.text, "legalActionGroups")) zero.push(`${file}:${block.line}`);
  return [...new Set(zero)];
}

function emptyAbsentEvidence(file, block) {
  const empty = [];
  if (hasEmptyArray(block.text, "absentLegalActions")) empty.push(`${file}:${block.line}`);
  if (hasEmptyArray(block.text, "absentLegalActionGroups")) empty.push(`${file}:${block.line}`);
  return [...new Set(empty)];
}

function hasWindowEvidence(block) {
  return /\bwindowId:\s*/.test(block) && /\bwindowKind:\s*/.test(block);
}

function hasTopLevelWindowEvidence(block) {
  return /^\s*windowId:\s*/m.test(block) && /^\s*windowKind:\s*/m.test(block);
}

function aggregateCountTotal(block, key) {
  const counts = block.match(new RegExp(`${key}:\\s*\\{([^}]*)\\}`))?.[1];
  return counts === undefined ? 0 : [...counts.matchAll(/:\s*(\d+)/g)].reduce((total, match) => total + Number(match[1]), 0);
}

function hasEmptyArray(block, key) {
  return new RegExp(`${key}:\\s*\\[\\s*\\]`).test(block);
}

function hasOnlyZeroCountEvidence(block, key) {
  const evidence = block.match(new RegExp(`${key}:\\s*\\[([\\s\\S]*?)\\]\\s*,?`))?.[1];
  if (evidence === undefined) return false;
  const counts = [...evidence.matchAll(/count:\s*(\d+)/g)].map((match) => Number(match[1]));
  return counts.length > 0 && counts.every((count) => count === 0);
}

function hasZeroCountEvidence(block, key) {
  const evidence = block.match(new RegExp(`${key}:\\s*\\[([\\s\\S]*?)\\]\\s*,?`))?.[1];
  return evidence !== undefined && /count:\s*0\b/.test(evidence);
}

function formatList(items) {
  return items.map((item) => `  ${item}`).join("\n");
}

function printHelp() {
  console.log(`Usage: node tools/scan-legal-action-evidence.mjs [options]

Options:
  --test-root <path>          Test directory to scan. Default: ${defaultTestRoot}
  --fail-on-missing           Fail when aggregate legal-action counts lack concrete evidence
  --fail-on-empty             Fail when positive aggregate counts have empty evidence arrays
  --fail-on-zero-only         Fail when positive aggregate counts only have zero-count evidence
  --fail-on-zero-evidence     Fail when legal-action evidence uses count: 0 instead of absent expectations
  --fail-on-unpaired-absent   Fail when absent raw/grouped legal-action evidence is not paired
  --fail-on-empty-absent      Fail when absent evidence arrays are empty
  --fail-on-missing-window-evidence
                              Fail when EDOPro blocks omit windowId/windowKind evidence
  --fail-on-missing-top-level-window-evidence
                              Fail when EDOPro blocks omit top-level windowId/windowKind evidence
  --min-files <count>         Fail unless at least this many parity fixture files are scanned
  --min-edopro-blocks <count> Fail unless at least this many EDOPro blocks are scanned
  --min-action-evidence-blocks <count>
                              Fail unless at least this many action evidence blocks are scanned
  --min-group-evidence-blocks <count>
                              Fail unless at least this many group evidence blocks are scanned
  --min-window-evidence-blocks <count>
                              Fail unless at least this many EDOPro blocks carry window evidence
  --min-top-level-window-evidence-blocks <count>
                              Fail unless at least this many EDOPro blocks carry top-level window evidence
  --min-absent-action-evidence-blocks <count>
                              Fail unless at least this many absent-action evidence blocks are scanned
  --min-absent-group-evidence-blocks <count>
                              Fail unless at least this many absent-group evidence blocks are scanned
  --min-paired-absent-evidence-blocks <count>
                              Fail unless at least this many blocks have both raw and grouped absent evidence
  --min-action-evidence-percent <percent>
                              Fail unless this percentage of EDOPro blocks has action evidence
  --min-group-evidence-percent <percent>
                              Fail unless this percentage of EDOPro blocks has group evidence
`);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
