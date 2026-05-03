#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const defaultUpstreamConstants = ".upstream/ignis/script/constant.lua";
const defaultSourceRoot = "src/engine/lua";

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return 0;
  }
  const upstreamFile = path.resolve(options.upstreamConstants ?? defaultUpstreamConstants);
  const sourceRoot = path.resolve(options.sourceRoot ?? defaultSourceRoot);
  if (!fs.existsSync(upstreamFile)) {
    console.error(`Upstream constants file not found: ${upstreamFile}`);
    return 1;
  }
  if (!fs.existsSync(sourceRoot)) {
    console.error(`Lua source root not found: ${sourceRoot}`);
    return 1;
  }

  const upstream = scanUpstreamConstants(upstreamFile);
  const local = scanLocalConstants(sourceRoot);
  const missing = [...upstream].filter((name) => !local.has(name)).sort((a, b) => a.localeCompare(b));
  printReport({ upstreamFile, sourceRoot, upstream, local, missing });
  return missing.length > 0 && options.failOnMissing ? 2 : 0;
}

function parseArgs(argv) {
  const options = { failOnMissing: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--fail-on-missing") options.failOnMissing = true;
    else if (arg === "--upstream") options.upstreamConstants = requireOptionValue(argv, ++index, arg);
    else if (arg === "--source") options.sourceRoot = requireOptionValue(argv, ++index, arg);
    else if (!options.upstreamConstants) options.upstreamConstants = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function requireOptionValue(argv, index, option) {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
  return value;
}

function printHelp() {
  console.log(`Usage: node tools/scan-lua-constants.mjs [constant.lua] [options]

Options:
  --upstream <path>      Project Ignis constant.lua path. Default: ${defaultUpstreamConstants}
  --source <path>        Local Lua host source directory. Default: ${defaultSourceRoot}
  --fail-on-missing      Exit 2 when upstream constants are missing locally
`);
}

function scanUpstreamConstants(file) {
  const source = stripLuaComments(fs.readFileSync(file, "utf8"));
  return new Set([...source.matchAll(/^\s*([A-Z][A-Z0-9_]+)\s*=/gm)].map((match) => match[1]).filter(Boolean));
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

function printReport({ upstreamFile, sourceRoot, upstream, local, missing }) {
  console.log("Lua constant corpus scan");
  console.log(`upstream: ${upstreamFile}`);
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
