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
  const realScriptFiles = realScriptFixtureFiles(testRoot);
  const partialChainAssertions = [];
  const broadChainObjectContainingAssertions = [];

  for (const file of realScriptFiles) {
    const text = fs.readFileSync(file, "utf8");
    for (const assertion of chainMatchObjectAssertions(text, file)) {
      partialChainAssertions.push(`${toRepoPath(file)}:${assertion.line}`);
    }
    for (const assertion of broadChainObjectContainingAssertionsIn(text, file)) {
      broadChainObjectContainingAssertions.push(`${toRepoPath(file)}:${assertion.line}`);
    }
  }

  console.log(
    `Lua real-script chain assertions: ${realScriptFiles.length} fixtures, ${partialChainAssertions.length} partial chain matchObjects, ` +
      `${broadChainObjectContainingAssertions.length} broad chain objectContaining assertions`,
  );

  const failures = [];
  if (options.minFixtures !== undefined && realScriptFiles.length < options.minFixtures) {
    failures.push(`Real-script fixtures ${realScriptFiles.length} is below required ${options.minFixtures}`);
  }
  if (options.maxPartialChainMatchObjects !== undefined && partialChainAssertions.length > options.maxPartialChainMatchObjects) {
    failures.push(
      `Partial chain matchObject assertions ${partialChainAssertions.length} is above allowed ${options.maxPartialChainMatchObjects}:\n${formatList(partialChainAssertions)}`,
    );
  }
  if (options.maxBroadChainObjectContaining !== undefined && broadChainObjectContainingAssertions.length > options.maxBroadChainObjectContaining) {
    failures.push(
      `Broad chain objectContaining assertions ${broadChainObjectContainingAssertions.length} is above allowed ${options.maxBroadChainObjectContaining}:\n${formatList(broadChainObjectContainingAssertions)}`,
    );
  }

  if (failures.length === 0) return 0;
  console.error(failures.join("\n\n"));
  return 1;
}

function parseArgs(argv) {
  const options = { help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--test-root") options.testRoot = requireOptionValue(argv, ++index, arg);
    else if (arg === "--min-fixtures") options.minFixtures = parseMinimum(requireOptionValue(argv, ++index, arg), arg);
    else if (arg === "--max-partial-chain-match-objects") options.maxPartialChainMatchObjects = parseMinimum(requireOptionValue(argv, ++index, arg), arg);
    else if (arg === "--max-broad-chain-object-containing") options.maxBroadChainObjectContaining = parseMinimum(requireOptionValue(argv, ++index, arg), arg);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function requireOptionValue(argv, index, option) {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
  return value;
}

function parseMinimum(value, option) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) throw new Error(`${option} must be a non-negative integer`);
  return count;
}

function realScriptFixtureFiles(testRoot) {
  return fs.readdirSync(testRoot)
    .filter((file) => /^lua-real-script-.*\.test\.ts$/.test(file))
    .map((file) => path.join(testRoot, file))
    .sort();
}

function chainMatchObjectAssertions(text) {
  const matches = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    if (/expect\([^)]*state\.chain(?:\[[0-9]+\])?(?![A-Za-z0-9_$])[^)]*\)\.toMatchObject\(/.test(line)) matches.push({ line: index + 1 });
  });
  return matches;
}

function broadChainObjectContainingAssertionsIn(text) {
  const matches = [];
  for (const assertion of expectAssertions(text)) {
    if (/expect\([^)]*state\.chain(?!\s*\[)[^)]*\)/.test(assertion.text) && assertion.text.includes("objectContaining(")) matches.push({ line: assertion.line });
  }
  return matches;
}

function expectAssertions(text) {
  const assertions = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const start = line.indexOf("expect(");
    if (start === -1) continue;

    let statement = line.slice(start);
    const startLine = index + 1;
    while (!statement.includes(";") && index + 1 < lines.length) {
      index += 1;
      statement += `\n${lines[index]}`;
    }
    assertions.push({ line: startLine, text: statement });
  }
  return assertions;
}

function toRepoPath(file) {
  return path.relative(process.cwd(), file).split(path.sep).join("/");
}

function formatList(items) {
  return items.map((item) => `  ${item}`).join("\n");
}

function printHelp() {
  console.log(`Usage: node tools/scan-lua-chain-assertions.mjs [options]

Options:
  --test-root <path>                       Test directory to scan. Default: ${defaultTestRoot}
  --min-fixtures <count>                   Fail unless at least this many real-script fixtures are scanned
  --max-partial-chain-match-objects <count>
                                           Fail when partial chain matchObjects exceed this count
  --max-broad-chain-object-containing <count>
                                           Fail when broad chain objectContaining assertions exceed this count
`);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
