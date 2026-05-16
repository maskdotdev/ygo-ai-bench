#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printUsage();
  process.exit(0);
}
if (!options.scripts) fail("Missing --scripts <path>");
if (!options.out) fail("Missing --out <path>");

const names = options.codes.length ? options.codes.map((code) => `c${code}.lua`) : discoverScriptNames(options.scripts);
const copied = [];
const missing = [];

fs.mkdirSync(options.out, { recursive: true });
for (const name of names) {
  const source = scriptCandidates(options.scripts, name).find((candidate) => fs.existsSync(candidate));
  if (!source) {
    missing.push(name);
    continue;
  }
  fs.copyFileSync(source, path.join(options.out, name));
  copied.push(name);
}

const summary = { copied, missing };
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (missing.length && !options.allowMissing) process.exit(1);

function parseArgs(argv) {
  const parsed = { scripts: undefined, out: undefined, codes: [], allowMissing: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--scripts") parsed.scripts = requireValue(argv, ++index, arg);
    else if (arg === "--out") parsed.out = requireValue(argv, ++index, arg);
    else if (arg === "--codes") parsed.codes.push(...parseCodes(requireValue(argv, ++index, arg)));
    else if (arg === "--code") parsed.codes.push(...parseCodes(requireValue(argv, ++index, arg)));
    else if (arg === "--allow-missing") parsed.allowMissing = true;
    else fail(`Unknown argument ${arg}`);
  }
  parsed.codes = [...new Set(parsed.codes)].sort((left, right) => Number(left) - Number(right));
  return parsed;
}

function parseCodes(value) {
  return value.split(",").map((code) => {
    const trimmed = code.trim();
    if (!/^\d+$/.test(trimmed)) fail(`Invalid passcode ${code}`);
    return trimmed;
  }).filter(Boolean);
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) fail(`Missing value for ${flag}`);
  return value;
}

function discoverScriptNames(scriptRoot) {
  const names = new Set();
  for (const dir of [path.join(scriptRoot, "official"), scriptRoot, path.join(scriptRoot, "pre-release")]) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && /^c\d+\.lua$/.test(entry.name)) names.add(entry.name);
    }
  }
  return [...names].sort((left, right) => Number(left.slice(1, -4)) - Number(right.slice(1, -4)));
}

function scriptCandidates(scriptRoot, name) {
  return [
    path.join(scriptRoot, "official", name),
    path.join(scriptRoot, name),
    path.join(scriptRoot, "pre-release", name),
  ];
}

function fail(message) {
  console.error(message);
  printUsage();
  process.exit(1);
}

function printUsage() {
  console.log(`Usage: node tools/export-browser-lua-scripts.mjs --scripts <script-root> --out <dir> [options]

Options:
  --codes <list>      Comma-separated passcodes to export. Defaults to all c*.lua scripts.
  --code <passcode>   Add one passcode to export. Can be repeated.
  --allow-missing     Exit successfully even when selected scripts are missing.
  --help              Show this help.
`);
}
