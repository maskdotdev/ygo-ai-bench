#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const defaultScriptRoot = ".upstream/ignis/script/official";
const promptApis = new Set(["SelectOption", "SelectYesNo", "SelectEffect", "SelectEffectYesNo"]);
const announcementApis = new Set([
  "AnnounceNumber",
  "AnnounceNumberRange",
  "AnnounceCard",
  "AnnounceType",
  "AnnounceRace",
  "AnnounceAttribute",
  "AnnounceLevel",
  "SelectCardsFromCodes",
  "SelectDisableField",
  "SelectField",
  "SelectFieldZone",
]);
const scannedApis = new Set([...promptApis, ...announcementApis]);

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return 0;
  }
  const scriptRoot = path.resolve(options.scriptRoot ?? defaultScriptRoot);
  if (!fs.existsSync(scriptRoot)) {
    console.error(`Script root not found: ${scriptRoot}`);
    return 1;
  }
  const calls = scanCalls(scriptRoot);
  const filesWithCalls = new Set(calls.map((call) => call.file)).size;
  const groups = groupByPattern(calls);
  const unclassified = calls.filter((call) => call.pattern === "unclassified");
  const report = buildReport({ scriptRoot, calls, filesWithCalls, groups, unclassified });
  if (options.json) printJsonReport(report);
  else printReport({ report, limit: options.limit });
  const failures = [];
  if (options.minFilesWithCalls !== undefined && filesWithCalls < options.minFilesWithCalls) {
    failures.push(`Files with prompt calls ${filesWithCalls} is below required ${options.minFilesWithCalls}`);
  }
  if (options.minCalls !== undefined && calls.length < options.minCalls) {
    failures.push(`Prompt calls ${calls.length} is below required ${options.minCalls}`);
  }
  if (options.minSelectOptionCalls !== undefined && countApi(calls, "SelectOption") < options.minSelectOptionCalls) {
    failures.push(`SelectOption calls ${countApi(calls, "SelectOption")} is below required ${options.minSelectOptionCalls}`);
  }
  if (options.minSelectYesNoCalls !== undefined && countApi(calls, "SelectYesNo") < options.minSelectYesNoCalls) {
    failures.push(`SelectYesNo calls ${countApi(calls, "SelectYesNo")} is below required ${options.minSelectYesNoCalls}`);
  }
  if (options.minSelectEffectCalls !== undefined && countApi(calls, "SelectEffect") < options.minSelectEffectCalls) {
    failures.push(`SelectEffect calls ${countApi(calls, "SelectEffect")} is below required ${options.minSelectEffectCalls}`);
  }
  if (options.minSelectEffectYesNoCalls !== undefined && countApi(calls, "SelectEffectYesNo") < options.minSelectEffectYesNoCalls) {
    failures.push(`SelectEffectYesNo calls ${countApi(calls, "SelectEffectYesNo")} is below required ${options.minSelectEffectYesNoCalls}`);
  }
  if (options.minAnnouncementCalls !== undefined && countAnnouncementCalls(calls) < options.minAnnouncementCalls) {
    failures.push(`Announcement helper calls ${countAnnouncementCalls(calls)} is below required ${options.minAnnouncementCalls}`);
  }
  for (const floor of options.minApiCounts ?? []) {
    const count = countApi(calls, floor.api);
    if (count < floor.count) failures.push(`${floor.api} calls ${count} is below required ${floor.count}`);
  }
  for (const floor of options.minPatternCounts ?? []) {
    const count = countPattern(calls, floor.pattern);
    if (count < floor.count) failures.push(`${floor.pattern} calls ${count} is below required ${floor.count}`);
  }
  if (unclassified.length > 0 && options.failOnUnclassified) failures.push(`Unclassified prompt calls ${unclassified.length}`);
  for (const failure of failures) console.error(failure);
  return failures.length > 0 ? 2 : 0;
}

function parseArgs(argv) {
  const options = { failOnUnclassified: false, help: false, json: false, limit: 40 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--fail-on-unclassified") options.failOnUnclassified = true;
    else if (arg === "--scripts") options.scriptRoot = requireOptionValue(argv, ++index, arg);
    else if (arg === "--limit") options.limit = readNonNegativeInteger(argv, ++index, arg);
    else if (arg === "--min-files-with-calls") options.minFilesWithCalls = readNonNegativeInteger(argv, ++index, arg);
    else if (arg === "--min-calls") options.minCalls = readNonNegativeInteger(argv, ++index, arg);
    else if (arg === "--min-select-option-calls") options.minSelectOptionCalls = readNonNegativeInteger(argv, ++index, arg);
    else if (arg === "--min-select-yes-no-calls") options.minSelectYesNoCalls = readNonNegativeInteger(argv, ++index, arg);
    else if (arg === "--min-select-effect-calls") options.minSelectEffectCalls = readNonNegativeInteger(argv, ++index, arg);
    else if (arg === "--min-select-effect-yes-no-calls") options.minSelectEffectYesNoCalls = readNonNegativeInteger(argv, ++index, arg);
    else if (arg === "--min-announcement-calls") options.minAnnouncementCalls = readNonNegativeInteger(argv, ++index, arg);
    else if (arg === "--min-api-count") {
      const api = requireOptionValue(argv, ++index, arg);
      if (!scannedApis.has(api)) throw new Error(`Unknown scanned API for ${arg}: ${api}`);
      const count = readNonNegativeInteger(argv, ++index, arg);
      options.minApiCounts = [...(options.minApiCounts ?? []), { api, count }];
    }
    else if (arg === "--min-pattern-count") {
      const pattern = requireOptionValue(argv, ++index, arg);
      const count = readNonNegativeInteger(argv, ++index, arg);
      options.minPatternCounts = [...(options.minPatternCounts ?? []), { pattern, count }];
    }
    else if (!options.scriptRoot) options.scriptRoot = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  options.limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.floor(options.limit) : 40;
  return options;
}

function requireOptionValue(argv, index, option) {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
  return value;
}

function readNonNegativeInteger(argv, index, option) {
  const raw = requireOptionValue(argv, index, option);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${option} must be a non-negative integer`);
  return value;
}

function scanCalls(root) {
  const calls = [];
  for (const file of listFiles(root, ".lua")) {
    const source = stripLuaComments(fs.readFileSync(file, "utf8"));
    for (const match of source.matchAll(/\bDuel\s*\.\s*(SelectOption|SelectYesNo|SelectEffect|SelectEffectYesNo|AnnounceNumber|AnnounceNumberRange|AnnounceCard|AnnounceType|AnnounceRace|AnnounceAttribute|AnnounceLevel|SelectCardsFromCodes|SelectDisableField|SelectField|SelectFieldZone)\s*\(/g)) {
      const openIndex = match.index + match[0].length - 1;
      const call = readBalancedCall(source, openIndex);
      if (!call) continue;
      const args = splitArguments(call.inner);
      calls.push({
        file,
        card: path.basename(file, ".lua").replace(/^c/, ""),
        api: match[1],
        line: lineNumber(source, match.index),
        pattern: classifyPromptCall(match[1], args),
        args: args.join(", "),
      });
    }
  }
  return calls;
}

function classifyPromptCall(api, args) {
  if (announcementApis.has(api)) return classifyAnnouncementCall(api, args);
  if (api === "SelectYesNo" || api === "SelectEffectYesNo") return args.length >= 2 ? "description" : "missing-description";
  if (api === "SelectEffect") return args.some((arg) => /\{/.test(arg)) ? "effect-table-options" : "dynamic-options";
  if (api !== "SelectOption") return "unclassified";
  const optionArgs = args.slice(1);
  if (optionArgs.length === 0) return "no-options";
  if (/^false$|^true$/.test(optionArgs[0])) {
    if (optionArgs.length === 1) return "leading-boolean-empty";
    if (optionArgs.some((arg) => /\btable\.unpack\s*\(/.test(arg))) return "leading-boolean-table-unpack";
    return "leading-boolean-literals";
  }
  if (optionArgs.some((arg) => /\btable\.unpack\s*\(/.test(arg))) return "table-unpack";
  if (optionArgs.some((arg) => /\.\.\./.test(arg))) return "vararg";
  return "literal-options";
}

function classifyAnnouncementCall(api, args) {
  if (args.some((arg) => /\btable\.unpack\s*\(/.test(arg))) return "table-unpack";
  if (api === "SelectCardsFromCodes") return args.some((arg) => /\{/.test(arg)) ? "code-table" : "code-literals";
  if (api === "SelectDisableField" || api === "SelectField" || api === "SelectFieldZone") return "zone-mask";
  if (args.some((arg) => /\{/.test(arg))) return "table-options";
  if (args.length <= 1) return "default";
  return "literal-options";
}

function splitArguments(inner) {
  const args = [];
  let depth = 0;
  let quote = undefined;
  let start = 0;
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    const previous = inner[index - 1];
    if (quote) {
      if (char === quote && previous !== "\\") quote = undefined;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "{" || char === "[") depth += 1;
    else if (char === ")" || char === "}" || char === "]") depth -= 1;
    else if (char === "," && depth === 0) {
      args.push(inner.slice(start, index).trim());
      start = index + 1;
    }
  }
  const last = inner.slice(start).trim();
  if (last.length > 0) args.push(last);
  return args;
}

function readBalancedCall(source, openIndex) {
  let depth = 0;
  let quote = undefined;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    const previous = source[index - 1];
    if (quote) {
      if (char === quote && previous !== "\\") quote = undefined;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) return { inner: source.slice(openIndex + 1, index), end: index };
    }
  }
  return undefined;
}

function stripLuaComments(source) {
  return source.replace(/--\[\[[\s\S]*?\]\]/g, "").replace(/--.*$/gm, "");
}

function listFiles(root, extension) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(full, extension));
    else if (entry.isFile() && entry.name.endsWith(extension)) files.push(full);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function groupByPattern(calls) {
  const groups = new Map();
  for (const call of calls) {
    const key = `${call.api}:${call.pattern}`;
    const group = groups.get(key) ?? { key, count: 0, samples: [] };
    group.count += 1;
    if (group.samples.length < 5) group.samples.push(call);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function countApi(calls, api) {
  return calls.filter((call) => call.api === api).length;
}

function countPattern(calls, pattern) {
  return calls.filter((call) => `${call.api}:${call.pattern}` === pattern).length;
}

function countAnnouncementCalls(calls) {
  return calls.filter((call) => announcementApis.has(call.api)).length;
}

function lineNumber(source, index) {
  return source.slice(0, index).split("\n").length;
}

function buildReport({ scriptRoot, calls, filesWithCalls, groups, unclassified }) {
  return {
    scriptRoot,
    filesWithCalls,
    promptCalls: calls.length,
    apiCounts: Object.fromEntries([...scannedApis].map((api) => [api, countApi(calls, api)])),
    announcementCalls: countAnnouncementCalls(calls),
    unclassifiedPromptCalls: unclassified.length,
    patternCounts: Object.fromEntries(groups.map((group) => [group.key, group.count])),
    groups,
  };
}

function printJsonReport(report) {
  console.log(JSON.stringify(report, null, 2));
}

function printReport({ report, limit }) {
  console.log("Lua prompt pattern scan");
  console.log(`scripts: ${report.scriptRoot}`);
  console.log(`files with prompt calls: ${report.filesWithCalls}`);
  console.log(`prompt calls: ${report.promptCalls}`);
  for (const api of scannedApis) console.log(`${api} calls: ${report.apiCounts[api] ?? 0}`);
  console.log(`announcement helper calls: ${report.announcementCalls}`);
  console.log(`unclassified prompt calls: ${report.unclassifiedPromptCalls}`);
  console.log("");
  for (const group of report.groups.slice(0, limit)) {
    console.log(`${String(group.count).padStart(5)}  ${group.key}`);
    for (const sample of group.samples) console.log(`       ${sample.card}:${sample.line} ${sample.args}`);
  }
}

function printHelp() {
  console.log(`Usage: node tools/scan-lua-prompt-patterns.mjs [--scripts path] [options]

Options:
  --min-files-with-calls N
  --min-calls N
  --min-select-option-calls N
  --min-select-yes-no-calls N
  --min-select-effect-calls N
  --min-select-effect-yes-no-calls N
  --min-announcement-calls N
  --min-api-count API N
  --min-pattern-count API:pattern N
  --json
  --fail-on-unclassified
  --limit N`);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
