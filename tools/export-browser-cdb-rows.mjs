#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printUsage();
  process.exit(0);
}
if (!options.database) fail("Missing --database <cards.cdb>");

const where = options.codes.length ? ` where id in (${options.codes.join(",")})` : "";
const datas = readSqliteJson(
  options.database,
  `select id, alias, setcode, type, atk, def, level, race, attribute from datas${where} order by id`,
);
const texts = readSqliteJson(
  options.database,
  `select id, name from texts${where} order by id`,
);
const payload = `${JSON.stringify({ datas, texts }, null, 2)}\n`;

if (options.out) {
  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.writeFileSync(options.out, payload, "utf8");
} else {
  process.stdout.write(payload);
}

function parseArgs(argv) {
  const parsed = { database: undefined, out: undefined, codes: [], help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--database") parsed.database = requireValue(argv, ++index, arg);
    else if (arg === "--out") parsed.out = requireValue(argv, ++index, arg);
    else if (arg === "--codes") parsed.codes.push(...parseCodes(requireValue(argv, ++index, arg)));
    else if (arg === "--code") parsed.codes.push(...parseCodes(requireValue(argv, ++index, arg)));
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

function readSqliteJson(databasePath, query) {
  try {
    const output = execFileSync("sqlite3", ["-readonly", "-json", databasePath, query], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return output.trim() ? JSON.parse(output) : [];
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to export CDB rows from ${databasePath}: ${detail}`);
  }
}

function fail(message) {
  console.error(message);
  printUsage();
  process.exit(1);
}

function printUsage() {
  console.log(`Usage: node tools/export-browser-cdb-rows.mjs --database <cards.cdb> [options]

Options:
  --out <path>        Write JSON payload to a file. Defaults to stdout.
  --codes <list>      Comma-separated passcodes to export. Defaults to every row.
  --code <passcode>   Add one passcode to export. Can be repeated.
  --help              Show this help.
`);
}
