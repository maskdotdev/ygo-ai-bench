#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const defaultScriptRoot = ".upstream/ignis/script";
const apiTables = ["Duel", "Card", "Effect", "Group", "aux"];
const usagePattern = /\b(Duel|Card|Effect|Group|aux)\s*[.:]\s*([A-Za-z_][A-Za-z0-9_]*)/g;
const registrationPattern = /to_luastring\("([A-Za-z_][A-Za-z0-9_]*)"\)/g;
const quotedApiNamePattern = /"([A-Z][A-Za-z0-9_]*)"/g;
const globalPattern = /\b(Duel|Card|Effect|Group|aux)\s*=\s*\{([^}]*)\}/gs;
const tableFunctionPattern = /\b(Duel|Card|Effect|Group|aux)\.([A-Za-z_][A-Za-z0-9_]*)\s*=/g;
const namedTableFunctionPattern = /\bfunction\s+(Duel|Card|Effect|Group|aux)\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return 0;
  }
  const scriptRoot = path.resolve(options.scriptRoot ?? defaultScriptRoot);
  const sourceRoot = path.resolve(options.sourceRoot ?? "src/engine/lua");
  if (!fs.existsSync(scriptRoot)) {
    console.error(`Script root not found: ${scriptRoot}`);
    console.error("Clone ProjectIgnis/CardScripts into .upstream/ignis/script or pass --scripts <path>.");
    return 1;
  }
  if (!fs.existsSync(sourceRoot)) {
    console.error(`Lua source root not found: ${sourceRoot}`);
    return 1;
  }
  const usage = scanUsage(scriptRoot);
  const implemented = scanImplementedApis(sourceRoot);
  const rows = summarizeMissingApis(usage, implemented, options.limit);
  const failures = apiCorpusFailures({ usage, implemented, options });
  printReport({ scriptRoot, sourceRoot, usage, implemented, rows });
  if (failures.length > 0) {
    console.error(failures.join("\n"));
    return 1;
  }
  return rows.length > 0 && options.failOnMissing ? 2 : 0;
}

function parseArgs(argv) {
  const options = { limit: 40, failOnMissing: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--fail-on-missing") options.failOnMissing = true;
    else if (arg === "--scripts") options.scriptRoot = requireOptionValue(argv, ++index, arg);
    else if (arg === "--source") options.sourceRoot = requireOptionValue(argv, ++index, arg);
    else if (arg === "--limit") options.limit = Number(requireOptionValue(argv, ++index, arg));
    else if (arg === "--min-used-apis") options.minUsedApis = parseMinimum(requireOptionValue(argv, ++index, arg), arg);
    else if (arg === "--min-implemented-apis") options.minImplementedApis = parseMinimum(requireOptionValue(argv, ++index, arg), arg);
    else if (arg.startsWith("--")) throw new Error(`Unknown argument: ${arg}`);
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

function parseMinimum(value, option) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) throw new Error(`${option} must be a non-negative integer`);
  return count;
}

function printHelp() {
  console.log(`Usage: node tools/scan-lua-api-usage.mjs [script-root] [options]

Options:
  --scripts <path>       Project Ignis CardScripts script directory. Default: ${defaultScriptRoot}
  --source <path>        Local Lua host source directory. Default: src/engine/lua
  --limit <count>        Number of missing APIs to print. Default: 40
  --min-used-apis <count>
                         Fail unless upstream script usage has at least this many APIs
  --min-implemented-apis <count>
                         Fail unless local Lua source exposes at least this many APIs
  --fail-on-missing      Exit 2 when missing APIs are found
`);
}

function scanUsage(root) {
  const usage = createApiMap(() => new Map());
  for (const file of listFiles(root, ".lua")) {
    const text = stripLuaComments(fs.readFileSync(file, "utf8"));
    for (const match of text.matchAll(usagePattern)) {
      const [, table, name] = match;
      if (!table || !name) continue;
      const tableUsage = usage[table];
      tableUsage.set(name, (tableUsage.get(name) ?? 0) + 1);
    }
  }
  return usage;
}

function scanImplementedApis(root) {
  const implemented = createApiMap(() => new Set());
  for (const file of listFiles(root, ".ts")) {
    const text = fs.readFileSync(file, "utf8");
    const table = tableForLocalFile(file);
    if (table) {
      for (const match of text.matchAll(registrationPattern)) {
        const name = match[1];
        if (name && !isInternalApiName(name)) implemented[table].add(name);
      }
      for (const match of text.matchAll(quotedApiNamePattern)) {
        const name = match[1];
        if (name && !isInternalApiName(name)) implemented[table].add(name);
      }
    }
    for (const match of text.matchAll(tableFunctionPattern)) {
      const [, globalName, name] = match;
      if (globalName && name && !isInternalApiName(name)) implemented[globalName].add(name);
    }
    for (const match of text.matchAll(namedTableFunctionPattern)) {
      const [, globalName, name] = match;
      if (globalName && name && !isInternalApiName(name)) implemented[globalName].add(name);
    }
    for (const match of text.matchAll(globalPattern)) {
      const [, globalName, body] = match;
      if (!globalName || !body) continue;
      for (const field of body.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*=/g)) {
        const name = field[1];
        if (name && !isInternalApiName(name)) implemented[globalName].add(name);
      }
    }
  }
  return implemented;
}

function summarizeMissingApis(usage, implemented, limit) {
  const rows = [];
  for (const table of apiTables) {
    for (const [name, count] of usage[table]) {
      if (!implemented[table].has(name)) rows.push({ table, name, count });
    }
  }
  return rows.sort((a, b) => b.count - a.count || `${a.table}.${a.name}`.localeCompare(`${b.table}.${b.name}`)).slice(0, limit);
}

function printReport({ scriptRoot, sourceRoot, usage, implemented, rows }) {
  const usedTotal = apiTables.reduce((total, table) => total + usage[table].size, 0);
  const implementedTotal = apiTables.reduce((total, table) => total + implemented[table].size, 0);
  console.log(`Lua API corpus scan`);
  console.log(`scripts: ${scriptRoot}`);
  console.log(`source:  ${sourceRoot}`);
  console.log(`used APIs: ${usedTotal}`);
  console.log(`implemented APIs found: ${implementedTotal}`);
  console.log("");
  if (rows.length === 0) {
    console.log("No missing API usages found.");
    return;
  }
  console.log("Top missing APIs:");
  for (const row of rows) console.log(`${String(row.count).padStart(6, " ")}  ${row.table}.${row.name}`);
}

function apiCorpusFailures({ usage, implemented, options }) {
  const usedTotal = apiTables.reduce((total, table) => total + usage[table].size, 0);
  const implementedTotal = apiTables.reduce((total, table) => total + implemented[table].size, 0);
  const failures = [];
  if (options.minUsedApis !== undefined && usedTotal < options.minUsedApis) failures.push(`Used APIs ${usedTotal} is below required ${options.minUsedApis}`);
  if (options.minImplementedApis !== undefined && implementedTotal < options.minImplementedApis) failures.push(`Implemented APIs ${implementedTotal} is below required ${options.minImplementedApis}`);
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

function tableForLocalFile(file) {
  const normalized = file.split(path.sep).join("/");
  if (normalized.endsWith("/card-api.ts") || /\/card-[a-z0-9-]+-api\.ts$/.test(normalized)) return "Card";
  if (normalized.endsWith("/group-api.ts")) return "Group";
  if (normalized.endsWith("/basic-api.ts") || normalized.endsWith("/aux-api.ts")) return "aux";
  if (normalized.endsWith("/host.ts") || normalized.endsWith("/host-effect-api.ts")) return "Effect";
  if (normalized.includes("/duel-api/")) return "Duel";
  return undefined;
}

function isInternalApiName(name) {
  return (name.startsWith("__") && name !== "__tostring") || name === "initial_effect";
}

function createApiMap(factory) {
  return Object.fromEntries(apiTables.map((table) => [table, factory()]));
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
