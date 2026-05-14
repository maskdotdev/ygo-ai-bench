#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const defaultUpstreamConstants = [
  ".upstream/ignis/script/constant.lua",
  ".upstream/ignis/script/archetype_setcode_constants.lua",
  ".upstream/ignis/script/card_counter_constants.lua",
];
const defaultSourceRoot = "src/engine/lua";

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return 0;
  }
  const configuredUpstream = options.upstreamConstants?.length ? options.upstreamConstants : defaultUpstreamConstants;
  const upstreamFiles = configuredUpstream.map((file) => path.resolve(file));
  const sourceRoot = path.resolve(options.sourceRoot ?? defaultSourceRoot);
  const missingUpstream = upstreamFiles.filter((file) => !fs.existsSync(file));
  if (missingUpstream.length > 0) {
    console.error(`Upstream constants file not found: ${missingUpstream[0]}`);
    return 1;
  }
  if (!fs.existsSync(sourceRoot)) {
    console.error(`Lua source root not found: ${sourceRoot}`);
    return 1;
  }

  const upstream = scanUpstreamConstants(upstreamFiles);
  const local = scanLocalConstants(sourceRoot);
  const missing = [...upstream].filter((name) => !local.has(name)).sort((a, b) => a.localeCompare(b));
  printReport({ upstreamFiles, sourceRoot, upstream, local, missing });
  const failures = constantCorpusFailures({ upstream, local, options });
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    return 1;
  }
  return missing.length > 0 && options.failOnMissing ? 2 : 0;
}

function parseArgs(argv) {
  const options = { failOnMissing: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--fail-on-missing") options.failOnMissing = true;
    else if (arg === "--upstream") (options.upstreamConstants ??= []).push(requireOptionValue(argv, ++index, arg));
    else if (arg === "--source") options.sourceRoot = requireOptionValue(argv, ++index, arg);
    else if (arg === "--min-upstream-constants") options.minUpstreamConstants = parseMinimum(requireOptionValue(argv, ++index, arg), arg);
    else if (arg === "--min-local-constants") options.minLocalConstants = parseMinimum(requireOptionValue(argv, ++index, arg), arg);
    else if (!options.upstreamConstants?.length) options.upstreamConstants = [arg];
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

function printHelp() {
  console.log(`Usage: node tools/scan-lua-constants.mjs [constant.lua] [options]

Options:
  --upstream <path>      Project Ignis constants path. Can be repeated.
                         Default: ${defaultUpstreamConstants.join(", ")}
  --source <path>        Local Lua host source directory. Default: ${defaultSourceRoot}
  --min-upstream-constants <count>
                         Fail unless upstream constants have at least this many names
  --min-local-constants <count>
                         Fail unless local constants have at least this many names
  --fail-on-missing      Exit 2 when upstream constants are missing locally
`);
}

function scanUpstreamConstants(files) {
  const constants = new Set();
  for (const file of files) {
    const source = stripLuaComments(fs.readFileSync(file, "utf8"));
    for (const match of source.matchAll(/^\s*([A-Z][A-Z0-9_]+)\s*=\s*([^\n\r]+)/gm)) {
      if (match[2]?.trim().startsWith("{")) continue;
      if (match[1]) constants.add(match[1]);
    }
  }
  return constants;
}

function scanLocalConstants(root) {
  const constants = new Set();
  for (const file of listFiles(root, ".ts")) {
    if (!/\/basic-[a-z0-9-]*constant-data\.ts$/.test(file.split(path.sep).join("/"))) continue;
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/\b([A-Z][A-Z0-9_]+)\s*:/g)) {
      if (match[1]) constants.add(match[1]);
    }
  }
  return constants;
}

function printReport({ upstreamFiles, sourceRoot, upstream, local, missing }) {
  console.log("Lua constant corpus scan");
  console.log(`upstream: ${upstreamFiles.join(", ")}`);
  console.log(`source:   ${sourceRoot}`);
  console.log(`upstream constants: ${upstream.size}`);
  console.log(`local constants:    ${local.size}`);
  console.log("");
  if (missing.length === 0) {
    console.log("No missing constants found.");
    return;
  }
  console.log("Missing constants:");
  for (const name of missing) console.log(`  ${name}`);
}

function constantCorpusFailures({ upstream, local, options }) {
  const failures = [];
  if (options.minUpstreamConstants !== undefined && upstream.size < options.minUpstreamConstants) failures.push(`Upstream constants ${upstream.size} is below required ${options.minUpstreamConstants}`);
  if (options.minLocalConstants !== undefined && local.size < options.minLocalConstants) failures.push(`Local constants ${local.size} is below required ${options.minLocalConstants}`);
  return failures;
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

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
