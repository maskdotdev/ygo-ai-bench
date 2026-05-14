#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const defaultScriptRoot = ".upstream/ignis/script/official";

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
  const unclassified = calls.filter((call) => isUnclassifiedPattern(call.pattern));
  printReport({ scriptRoot, calls, filesWithCalls, groups, limit: options.limit, unclassified });
  const failures = [];
  if (options.minFilesWithCalls !== undefined && filesWithCalls < options.minFilesWithCalls) {
    failures.push(`Files with calls ${filesWithCalls} is below required ${options.minFilesWithCalls}`);
  }
  if (options.minCalls !== undefined && calls.length < options.minCalls) {
    failures.push(`Calls ${calls.length} is below required ${options.minCalls}`);
  }
  if (unclassified.length > 0 && options.failOnUnclassified) {
    failures.push(`Unclassified calls ${unclassified.length}`);
  }
  for (const failure of failures) console.error(failure);
  return failures.length > 0 ? 2 : 0;
}

function parseArgs(argv) {
  const options = { failOnUnclassified: false, help: false, limit: 40 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--fail-on-unclassified") options.failOnUnclassified = true;
    else if (arg === "--scripts") options.scriptRoot = requireOptionValue(argv, ++index, arg);
    else if (arg === "--limit") options.limit = Number(requireOptionValue(argv, ++index, arg));
    else if (arg === "--min-files-with-calls") options.minFilesWithCalls = readNonNegativeInteger(argv, ++index, arg);
    else if (arg === "--min-calls") options.minCalls = readNonNegativeInteger(argv, ++index, arg);
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
    const source = fs.readFileSync(file, "utf8");
    const stripped = stripLuaComments(source);
    const functions = scanCardFunctions(stripped);
    for (const match of stripped.matchAll(/\bDuel\s*\.\s*(SetChainLimit(?:TillChainEnd)?)\s*\(/g)) {
      const openIndex = match.index + match[0].length - 1;
      const call = readBalancedCall(stripped, openIndex);
      if (!call) continue;
      const arg = firstArgument(call.inner);
      calls.push({
        file,
        card: path.basename(file, ".lua").replace(/^c/, ""),
        api: match[1],
        line: lineNumber(stripped, match.index),
        arg,
        pattern: classifyArgument(arg, functions),
      });
    }
  }
  return calls;
}

function scanCardFunctions(source) {
  const functions = new Map();
  for (const match of source.matchAll(/\bfunction\s+([cs]\d*\.[A-Za-z_]\w*)\s*\(/g)) {
    const openIndex = source.indexOf("(", match.index);
    const body = readLuaFunctionSource(source, match.index, openIndex);
    if (match[1] && body) functions.set(match[1], body);
  }
  for (const match of source.matchAll(/\b([cs]\d*\.[A-Za-z_]\w*)\s*=\s*function\s*\(/g)) {
    const openIndex = source.indexOf("(", match.index);
    const body = readLuaFunctionSource(source, match.index, openIndex);
    if (match[1] && body) functions.set(match[1], body);
  }
  return functions;
}

function readLuaFunctionSource(source, startIndex, openIndex) {
  const args = readBalancedCall(source, openIndex);
  if (!args) return undefined;
  let depth = 1;
  let quote = undefined;
  for (let index = args.end + 1; index < source.length; index += 1) {
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
    const rest = source.slice(index);
    if (/^function\b/.test(rest) || /^(?:if|for|while|repeat)\b/.test(rest)) depth += 1;
    else if (/^end\b/.test(rest)) {
      depth -= 1;
      if (depth === 0) return source.slice(startIndex, index + 3);
    }
    else if (/^until\b/.test(rest)) depth -= 1;
  }
  return undefined;
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

function firstArgument(inner) {
  let depth = 0;
  let quote = undefined;
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
    else if (char === "," && depth === 0) return inner.slice(0, index).trim();
  }
  return inner.trim();
}

function classifyArgument(arg, functions) {
  const compact = arg.replace(/\s+/g, " ").trim();
  if (compact === "aux.TRUE" || compact === "aux.FALSE") return compact;
  if (/^function\s*\(/.test(compact)) return `inline:${classifyFunctionBody(compact)}`;
  const namedCardFunction = compact.match(/^([cs]\d*\.[A-Za-z_]\w*)$/)?.[1];
  if (namedCardFunction) return `named:${classifyFunctionBody(functions.get(namedCardFunction) ?? "")}`;
  if (/^[A-Za-z_]\w*$/.test(compact)) return "local-or-global-function";
  const cardFactory = compact.match(/^([cs]\d*\.[A-Za-z_]\w*)\s*\(/)?.[1];
  if (cardFactory) return `factory:${classifyFunctionBody(functions.get(cardFactory) ?? "")}`;
  if (/^[A-Za-z_]\w*\s*\(/.test(compact)) return "function-factory";
  return "other";
}

function classifyFunctionBody(source) {
  const body = source.replace(/\s+/g, " ");
  if (body.length === 0) return "unresolved";
  if (/\breturn\s+(?:true|false)\b/.test(body)) return "constant";
  if (/\breturn\b[\s\S]*(?:\b(?:rp|ep|_rp|_ep)\s*==\s*(?:tp|_tp)\b|\b(?:tp|_tp)\s*==\s*(?:rp|ep|_rp|_ep)\b)/.test(body)) return "response-chain-player";
  if (/:IsHasType\s*\(/.test(body)) return "effect-type";
  if (/:IsActiveType\s*\(/.test(body) || /:Is(?:Monster|Spell|Trap)Effect\s*\(/.test(body)) return "active-type";
  if (/:GetHandler\s*\(\s*\)\s*:\s*IsCode\s*\(/.test(body)) return "handler-code";
  if (/GetTargetCards\s*\([^)]*\)\s*:\s*IsContains\s*\([^)]*:GetHandler\s*\(\s*\)\s*\)/.test(body)) return "target-card-handler-exclusion";
  if (/:GetHandler\s*\(\s*\)\s*==/.test(body) || /==\s*[^ ]+:GetHandler\s*\(\s*\)/.test(body)) return "handler-only";
  if (/:GetHandler\s*\(\s*\)\s*~=/.test(body) || /~=\s*[^ ]+:GetHandler\s*\(\s*\)/.test(body) || /\blocal\s+\w+\s*=\s*\w+:GetHandler\s*\(\s*\)[\s\S]*\breturn\b[\s\S]*\w+\s*~=/.test(body)) return "handler-exclusion";
  return "unclassified-inline";
}

function groupByPattern(calls) {
  const groups = new Map();
  for (const call of calls) {
    const key = `${call.api}:${call.pattern}`;
    const group = groups.get(key) ?? { key, api: call.api, pattern: call.pattern, count: 0, samples: [] };
    group.count += 1;
    if (group.samples.length < 5) group.samples.push(call);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

function isUnclassifiedPattern(pattern) {
  return pattern === "other"
    || pattern === "local-or-global-function"
    || pattern === "function-factory"
    || pattern.endsWith(":unresolved")
    || pattern.endsWith(":unclassified-inline");
}

function printReport({ scriptRoot, calls, filesWithCalls, groups, limit, unclassified }) {
  console.log("Lua chain-limit pattern scan");
  console.log(`scripts: ${scriptRoot}`);
  console.log(`files with calls: ${filesWithCalls}`);
  console.log(`calls: ${calls.length}`);
  console.log(`unclassified calls: ${unclassified.length}`);
  console.log("");
  for (const group of groups.slice(0, limit)) {
    console.log(`${String(group.count).padStart(5, " ")}  ${group.key}`);
    for (const sample of group.samples) {
      console.log(`       ${sample.card}:${sample.line} ${sample.arg.slice(0, 140)}`);
    }
  }
}

function listFiles(root, extension) {
  const files = [];
  const entries = fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(fullPath, extension));
    else if (entry.isFile() && entry.name.endsWith(extension)) files.push(fullPath);
  }
  return files;
}

function stripLuaComments(text) {
  return text
    .replace(/--\[\[[\s\S]*?\]\]/g, "")
    .replace(/--[^\n\r]*/g, "");
}

function lineNumber(source, index) {
  return source.slice(0, index).split(/\r\n|\r|\n/).length;
}

function printHelp() {
  console.log(`Usage: node tools/scan-lua-chain-limit-patterns.mjs [options]

Options:
  --scripts <path>   Project Ignis Lua script directory. Default: ${defaultScriptRoot}
  --limit <count>    Number of pattern groups to print. Default: 40
  --min-files-with-calls <count>
                     Exit 2 when fewer files contain SetChainLimit calls
  --min-calls <count>
                     Exit 2 when fewer SetChainLimit calls are found
  --fail-on-unclassified
                     Exit 2 when a SetChainLimit predicate shape is not classified
`);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
