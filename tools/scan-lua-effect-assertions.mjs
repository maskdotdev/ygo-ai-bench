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
  const broadCollectionAssertions = [];

  for (const file of realScriptFiles) {
    const text = fs.readFileSync(file, "utf8");
    for (const assertion of broadEffectCollectionAssertions(text)) {
      broadCollectionAssertions.push(`${toRepoPath(file)}:${assertion.line}`);
    }
  }

  console.log(`Lua real-script effect assertions: ${realScriptFiles.length} fixtures, ${broadCollectionAssertions.length} broad effect collection assertions`);

  const failures = [];
  if (options.minFixtures !== undefined && realScriptFiles.length < options.minFixtures) {
    failures.push(`Real-script fixtures ${realScriptFiles.length} is below required ${options.minFixtures}`);
  }
  if (options.maxBroadEffectCollectionAssertions !== undefined && broadCollectionAssertions.length > options.maxBroadEffectCollectionAssertions) {
    failures.push(
      `Broad effect collection assertions ${broadCollectionAssertions.length} is above allowed ${options.maxBroadEffectCollectionAssertions}:\n${formatList(broadCollectionAssertions)}`,
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
    else if (arg === "--max-broad-effect-collection-assertions") {
      options.maxBroadEffectCollectionAssertions = parseMinimum(requireOptionValue(argv, ++index, arg), arg);
    } else throw new Error(`Unknown argument: ${arg}`);
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

function broadEffectCollectionAssertions(text) {
  const matches = [];
  for (const assertion of expectAssertions(text)) {
    if (
      /expect\([^)]*state\.effects(?!\s*\.)[^)]*\)/.test(assertion.text) &&
      /expect\.(?:arrayContaining|objectContaining)\(|toContainEqual\(\s*expect\.objectContaining\(/.test(assertion.text)
    ) {
      matches.push({ line: assertion.line });
    }
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
  console.log(`Usage: node tools/scan-lua-effect-assertions.mjs [options]

Options:
  --test-root <path>                                Test directory to scan. Default: ${defaultTestRoot}
  --min-fixtures <count>                            Fail unless at least this many real-script fixtures are scanned
  --max-broad-effect-collection-assertions <count>  Fail when broad effect collection assertions exceed this count
`);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
