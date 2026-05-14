#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const defaultRoots = ["src", "test", "tools", "docs"];
const defaultLimit = 1000;
const checkedExtensions = new Set([".ts", ".tsx", ".mjs", ".md"]);

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return 0;
  }

  const rows = options.roots.flatMap((root) => scanRoot(path.resolve(root), options.limit));
  rows.sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file));

  if (rows.length === 0) {
    console.log(`File LOC check passed. No files over ${options.limit} lines.`);
    return 0;
  }

  console.error(`File LOC check failed. ${rows.length} file(s) over ${options.limit} lines:`);
  for (const row of rows) console.error(`${String(row.lines).padStart(5, " ")}  ${path.relative(process.cwd(), row.file)}`);
  return 2;
}

function parseArgs(argv) {
  const options = { roots: [], limit: defaultLimit, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--limit") options.limit = Number(requireOptionValue(argv, ++index, arg));
    else if (arg === "--root") options.roots.push(requireOptionValue(argv, ++index, arg));
    else options.roots.push(arg);
  }
  if (options.roots.length === 0) options.roots = [...defaultRoots];
  options.limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.floor(options.limit) : defaultLimit;
  return options;
}

function requireOptionValue(argv, index, option) {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
  return value;
}

function printHelp() {
  console.log(`Usage: node tools/check-file-loc.mjs [roots...] [options]

Options:
  --root <path>      Directory or file to check. May be repeated.
  --limit <lines>    Maximum allowed lines per file. Default: ${defaultLimit}
`);
}

function scanRoot(root, limit) {
  if (!fs.existsSync(root)) return [];
  const stat = fs.statSync(root);
  if (stat.isFile()) return shouldCheck(root) ? overLimit(root, limit) : [];
  if (!stat.isDirectory()) return [];

  const rows = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) rows.push(...scanRoot(fullPath, limit));
    else if (entry.isFile() && shouldCheck(fullPath)) rows.push(...overLimit(fullPath, limit));
  }
  return rows;
}

function shouldCheck(file) {
  return checkedExtensions.has(path.extname(file));
}

function overLimit(file, limit) {
  const lines = countLines(fs.readFileSync(file, "utf8"));
  return lines > limit ? [{ file, lines }] : [];
}

function countLines(text) {
  if (text.length === 0) return 0;
  return text.split("\n").filter((line) => line.trim().length > 0).length;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
