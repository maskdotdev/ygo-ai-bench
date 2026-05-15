#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const defaultTestRoot = "test";
const broadEventMatcherPattern = /expect\.objectContaining\(\{\s*eventName:\s*["'][^"']+["']/g;

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return 0;
  }

  const testRoot = path.resolve(options.testRoot ?? defaultTestRoot);
  const realScriptFiles = realScriptFixtureFiles(testRoot);
  const broadMatchers = [];

  for (const file of realScriptFiles) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(broadEventMatcherPattern)) {
      broadMatchers.push(`${toRepoPath(file)}:${lineNumber(text, match.index ?? 0)}`);
    }
  }

  console.log(`Lua real-script event assertions: ${realScriptFiles.length} fixtures, ${broadMatchers.length} broad event matchers`);

  const failures = [];
  if (options.minFixtures !== undefined && realScriptFiles.length < options.minFixtures) {
    failures.push(`Real-script fixtures ${realScriptFiles.length} is below required ${options.minFixtures}`);
  }
  if (options.failOnBroadEventMatchers && broadMatchers.length > 0) {
    failures.push(`Broad event matchers must use exact event payload assertions:\n${formatList(broadMatchers)}`);
  }

  if (failures.length === 0) return 0;
  console.error(failures.join("\n\n"));
  return 1;
}

function parseArgs(argv) {
  const options = { failOnBroadEventMatchers: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--test-root") options.testRoot = requireOptionValue(argv, ++index, arg);
    else if (arg === "--min-fixtures") options.minFixtures = parseMinimum(requireOptionValue(argv, ++index, arg), arg);
    else if (arg === "--fail-on-broad-event-matchers") options.failOnBroadEventMatchers = true;
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

function lineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

function toRepoPath(file) {
  return path.relative(process.cwd(), file).split(path.sep).join("/");
}

function formatList(items) {
  return items.map((item) => `  ${item}`).join("\n");
}

function printHelp() {
  console.log(`Usage: node tools/scan-lua-event-assertions.mjs [options]

Options:
  --test-root <path>                  Test directory to scan. Default: ${defaultTestRoot}
  --min-fixtures <count>              Fail unless at least this many real-script fixtures are scanned
  --fail-on-broad-event-matchers      Fail when real-script tests use broad eventName objectContaining matchers
`);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
