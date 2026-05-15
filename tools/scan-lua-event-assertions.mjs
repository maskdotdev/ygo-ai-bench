#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const defaultTestRoot = "test";
const broadEventMatcherStart = "expect.objectContaining({";

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return 0;
  }

  const testRoot = path.resolve(options.testRoot ?? defaultTestRoot);
  const realScriptFiles = realScriptFixtureFiles(testRoot);
  const broadMatchers = [];
  const partialEventMatchObjects = [];

  for (const file of realScriptFiles) {
    const text = fs.readFileSync(file, "utf8");
    for (const matcher of broadEventMatchers(text)) {
      broadMatchers.push(`${toRepoPath(file)}:${lineNumber(text, matcher.index)}`);
    }
    for (const matcher of partialEventToMatchObjects(text)) {
      partialEventMatchObjects.push(`${toRepoPath(file)}:${lineNumber(text, matcher.index)}`);
    }
  }

  console.log(
    `Lua real-script event assertions: ${realScriptFiles.length} fixtures, ${broadMatchers.length} broad event matchers, ${partialEventMatchObjects.length} partial event matchObjects`,
  );

  const failures = [];
  if (options.minFixtures !== undefined && realScriptFiles.length < options.minFixtures) {
    failures.push(`Real-script fixtures ${realScriptFiles.length} is below required ${options.minFixtures}`);
  }
  if (options.maxBroadEventMatchers !== undefined && broadMatchers.length > options.maxBroadEventMatchers) {
    failures.push(`Broad event matchers ${broadMatchers.length} is above allowed ${options.maxBroadEventMatchers}:\n${formatList(broadMatchers)}`);
  }
  if (options.failOnBroadEventMatchers && broadMatchers.length > 0) {
    failures.push(`Broad event matchers must use exact event payload assertions:\n${formatList(broadMatchers)}`);
  }
  if (options.maxPartialEventMatchObjects !== undefined && partialEventMatchObjects.length > options.maxPartialEventMatchObjects) {
    failures.push(
      `Partial event matchObject assertions ${partialEventMatchObjects.length} is above allowed ${options.maxPartialEventMatchObjects}:\n${formatList(partialEventMatchObjects)}`,
    );
  }
  if (options.failOnPartialEventMatchObjects && partialEventMatchObjects.length > 0) {
    failures.push(`Partial event matchObject assertions must use exact event payload assertions:\n${formatList(partialEventMatchObjects)}`);
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
    else if (arg === "--max-broad-event-matchers") options.maxBroadEventMatchers = parseMinimum(requireOptionValue(argv, ++index, arg), arg);
    else if (arg === "--max-partial-event-match-objects") options.maxPartialEventMatchObjects = parseMinimum(requireOptionValue(argv, ++index, arg), arg);
    else if (arg === "--fail-on-broad-event-matchers") options.failOnBroadEventMatchers = true;
    else if (arg === "--fail-on-partial-event-match-objects") options.failOnPartialEventMatchObjects = true;
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

function broadEventMatchers(text) {
  const matches = [];
  let searchIndex = 0;
  while (searchIndex < text.length) {
    const index = text.indexOf(broadEventMatcherStart, searchIndex);
    if (index === -1) break;
    const end = matchingCallEnd(text, index + broadEventMatcherStart.length);
    if (end === -1) {
      searchIndex = index + broadEventMatcherStart.length;
      continue;
    }
    const body = text.slice(index, end);
    if (/\beventName\s*:/.test(body)) matches.push({ index });
    searchIndex = end;
  }
  return matches;
}

function partialEventToMatchObjects(text) {
  const matches = [];
  let searchIndex = 0;
  const marker = ".toMatchObject({";
  while (searchIndex < text.length) {
    const index = text.indexOf(marker, searchIndex);
    if (index === -1) break;
    const end = matchingCallEnd(text, index + marker.length);
    if (end === -1) {
      searchIndex = index + marker.length;
      continue;
    }
    const body = text.slice(index, end);
    if (/\beventName\s*:/.test(body) || /\beventCode\s*:/.test(body)) matches.push({ index });
    searchIndex = end;
  }
  return matches;
}

function matchingCallEnd(text, index) {
  let depth = 1;
  let quote = "";
  let escaped = false;
  for (let cursor = index; cursor < text.length; cursor += 1) {
    const char = text[cursor];
    if (quote !== "") {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return cursor + 1;
    }
  }
  return -1;
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
  --max-broad-event-matchers <count>  Fail when broad event matchers exceed this count
  --max-partial-event-match-objects <count>
                                      Fail when partial event matchObjects exceed this count
  --fail-on-broad-event-matchers      Fail when real-script tests use broad eventName objectContaining matchers
  --fail-on-partial-event-match-objects
                                      Fail when real-script tests use event toMatchObject partials
`);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
