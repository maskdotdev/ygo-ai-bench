#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
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
  `${cdbTextSelect(options.database, "texts")}${where} order by id`,
);
const localAliases = options.localAliases ? readLocalAliases(options.localAliases) : {};
const selectedCodes = new Set(options.codes);
const supplementalRows = options.supplementalRows ? readSupplementalRows(options.supplementalRows) : { datas: [], texts: [] };
for (const row of supplementalRows.datas) {
  const code = String(row.id);
  if (selectedCodes.size && !selectedCodes.has(code)) continue;
  if (datas.some((candidate) => String(candidate.id) === code)) continue;
  datas.push(row);
}
for (const row of supplementalRows.texts) {
  const code = String(row.id);
  if (selectedCodes.size && !selectedCodes.has(code)) continue;
  if (texts.some((candidate) => String(candidate.id) === code)) continue;
  texts.push(row);
}
const supplementalAliasRows = [];
for (const [code, alias] of Object.entries(localAliases)) {
  if (selectedCodes.size && !selectedCodes.has(code)) continue;
  if (datas.some((row) => String(row.id) === code)) continue;
  const aliasData = datas.find((row) => String(row.id) === alias) ?? supplementalRows.datas.find((row) => String(row.id) === alias) ?? readSingleSqliteJson(
    options.database,
    `select id, alias, setcode, type, atk, def, level, race, attribute from datas where id = ${alias} limit 1`,
  );
  const aliasText = texts.find((row) => String(row.id) === alias) ?? supplementalRows.texts.find((row) => String(row.id) === alias) ?? readSingleSqliteJson(
    options.database,
    `${cdbTextSelect(options.database, "texts")} where id = ${alias} limit 1`,
  );
  if (!aliasData) fail(`Local alias ${code} points at missing CDB row ${alias}`);
  datas.push({ ...aliasData, id: Number(code), alias: Number(alias) });
  texts.push({ ...aliasText, id: Number(code), name: aliasText?.name ?? `Card ${code}` });
  supplementalAliasRows.push(code);
}
datas.sort((left, right) => Number(left.id) - Number(right.id));
texts.sort((left, right) => Number(left.id) - Number(right.id));
const payload = `${JSON.stringify({ datas, texts }, null, 2)}\n`;

if (options.out) {
  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.writeFileSync(options.out, payload, "utf8");
  fs.writeFileSync(path.join(path.dirname(options.out), "manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    kind: "browser-cdb-rows",
    payload: path.basename(options.out),
    selectedCodes: options.codes,
    datasRows: datas.length,
    textsRows: texts.length,
    ...(options.supplementalRows ? { supplementalRows: supplementalRows.datas.map((row) => String(row.id)).sort((left, right) => Number(left) - Number(right)) } : {}),
    ...(supplementalAliasRows.length ? { supplementalAliasRows } : {}),
    sha256: sha256(payload),
  }, null, 2)}\n`, "utf8");
} else {
  process.stdout.write(payload);
}

function parseArgs(argv) {
  const parsed = { database: undefined, out: undefined, codes: [], localAliases: undefined, supplementalRows: undefined, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--database") parsed.database = requireValue(argv, ++index, arg);
    else if (arg === "--out") parsed.out = requireValue(argv, ++index, arg);
    else if (arg === "--local-aliases") parsed.localAliases = requireValue(argv, ++index, arg);
    else if (arg === "--supplemental-rows") parsed.supplementalRows = requireValue(argv, ++index, arg);
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

function cdbTextSelect(databasePath, table) {
  const available = new Set(readSqliteJson(databasePath, `pragma table_info(${table})`).map((column) => column.name));
  const fields = ["id", "name", "desc", "str1", "str2", "str3", "str4", "str5", "str6", "str7", "str8", "str9", "str10", "str11", "str12", "str13", "str14", "str15", "str16"]
    .filter((field) => available.has(field));
  return `select ${fields.join(", ")} from ${table}`;
}

function readSingleSqliteJson(databasePath, query) {
  return readSqliteJson(databasePath, query)[0];
}

function readLocalAliases(filePath) {
  const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`Local aliases file ${filePath} must be a JSON object`);
  const aliases = {};
  for (const [code, alias] of Object.entries(value)) {
    if (!/^\d+$/.test(code) || typeof alias !== "string" || !/^\d+$/.test(alias)) {
      fail(`Local aliases file ${filePath} must map passcode strings to passcode strings`);
    }
    aliases[code] = alias;
  }
  return aliases;
}

function readSupplementalRows(filePath) {
  const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.datas) || !Array.isArray(value.texts)) {
    fail(`Supplemental rows file ${filePath} must contain datas and texts arrays`);
  }
  return { datas: value.datas, texts: value.texts };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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
  --local-aliases <path>
                      JSON object of local alternate-art passcode aliases to add to the payload.
  --supplemental-rows <path>
                      JSON object with datas/texts arrays to merge before local aliases.
  --codes <list>      Comma-separated passcodes to export. Defaults to every row.
  --code <passcode>   Add one passcode to export. Can be repeated.
  --help              Show this help.
`);
}
