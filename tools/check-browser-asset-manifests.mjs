#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const options = parseArgs(process.argv.slice(2));
if (options.help) {
  printUsage();
  process.exit(0);
}
if (!options.cardData && !options.cardScripts) fail("Expected --card-data <dir>, --card-scripts <dir>, or both");

const checked = [];
if (options.cardData) {
  checkCardDataManifest(options.cardData);
  checked.push(`card data ${options.cardData}`);
}
if (options.cardScripts) {
  checkCardScriptsManifest(options.cardScripts);
  checked.push(`card scripts ${options.cardScripts}`);
}

process.stdout.write(`Browser asset manifest check passed: ${checked.join(", ")}\n`);

function checkCardDataManifest(dir) {
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = readJson(manifestPath, "CDB rows manifest");
  if (
    !isRecord(manifest) ||
    manifest.schemaVersion !== 1 ||
    manifest.kind !== "browser-cdb-rows" ||
    typeof manifest.payload !== "string" ||
    !Array.isArray(manifest.selectedCodes) ||
    !manifest.selectedCodes.every((code) => typeof code === "string") ||
    !Number.isInteger(manifest.datasRows) ||
    !Number.isInteger(manifest.textsRows) ||
    !isSha256(manifest.sha256)
  ) {
    fail("CDB rows manifest must describe browser-cdb-rows payload metadata");
  }
  if (manifest.payload !== path.basename(manifest.payload)) fail(`CDB rows manifest payload must be a file name, got ${manifest.payload}`);
  const expectedDataFiles = new Set(["manifest.json", manifest.payload]);
  const extraDataFiles = directoryFiles(dir)
    .filter((name) => name.endsWith(".json"))
    .filter((name) => !expectedDataFiles.has(name));
  if (extraDataFiles.length) fail(`CDB rows export contains unlisted JSON files: ${extraDataFiles.join(", ")}`);

  const payloadPath = path.join(dir, manifest.payload);
  const payloadText = readText(payloadPath, "CDB rows payload");
  if (sha256(payloadText) !== manifest.sha256) fail(`CDB rows payload hash mismatch for ${payloadPath}`);
  const payload = parseJson(payloadText, `CDB rows payload ${payloadPath}`);
  if (!isRecord(payload) || !Array.isArray(payload.datas) || !Array.isArray(payload.texts)) {
    fail("CDB rows payload must contain datas and texts arrays");
  }
  if (payload.datas.length !== manifest.datasRows) fail(`CDB rows manifest datasRows ${manifest.datasRows} does not match payload ${payload.datas.length}`);
  if (payload.texts.length !== manifest.textsRows) fail(`CDB rows manifest textsRows ${manifest.textsRows} does not match payload ${payload.texts.length}`);
  const dataCodes = rowIds(payload.datas, "datas");
  const textCodes = rowIds(payload.texts, "texts");
  if (!sameStrings(dataCodes, textCodes)) {
    fail(`CDB rows payload datas ids ${dataCodes.join(",")} do not match texts ids ${textCodes.join(",")}`);
  }
  if (manifest.selectedCodes.length) {
    const selected = normalizedUniqueStrings(manifest.selectedCodes);
    if (selected.length !== manifest.selectedCodes.length) fail("CDB rows manifest selectedCodes contains duplicate passcodes");
    if (!sameStrings(selected, dataCodes)) {
      fail(`CDB rows manifest selectedCodes ${selected.join(",")} does not match payload datas ids ${dataCodes.join(",")}`);
    }
    if (!sameStrings(selected, textCodes)) {
      fail(`CDB rows manifest selectedCodes ${selected.join(",")} does not match payload texts ids ${textCodes.join(",")}`);
    }
  }
}

function checkCardScriptsManifest(dir) {
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = readJson(manifestPath, "Lua script manifest");
  if (
    !isRecord(manifest) ||
    manifest.schemaVersion !== 1 ||
    manifest.kind !== "browser-lua-scripts" ||
    !Array.isArray(manifest.selectedCodes) ||
    !manifest.selectedCodes.every((code) => typeof code === "string") ||
    !Number.isInteger(manifest.copiedCount) ||
    !Number.isInteger(manifest.missingCount) ||
    !Array.isArray(manifest.copied) ||
    !manifest.copied.every((name) => typeof name === "string") ||
    !Array.isArray(manifest.missing) ||
    !manifest.missing.every((name) => typeof name === "string") ||
    !isCountRecord(manifest.sourceCounts) ||
    !isCountRecord(manifest.fallbackKindCounts) ||
    !Array.isArray(manifest.files) ||
    !manifest.files.every(isLuaScriptFileManifest)
  ) {
    fail("Lua script manifest must describe browser-lua-scripts payload metadata");
  }
  if (manifest.copiedCount !== manifest.copied.length) fail(`Lua script manifest copiedCount ${manifest.copiedCount} does not match copied ${manifest.copied.length}`);
  if (manifest.missingCount !== manifest.missing.length) fail(`Lua script manifest missingCount ${manifest.missingCount} does not match missing ${manifest.missing.length}`);
  if (manifest.missing.length) fail(`Lua script manifest lists missing exported scripts: ${manifest.missing.join(", ")}`);
  if (manifest.files.length !== manifest.copied.length) fail(`Lua script manifest files ${manifest.files.length} does not match copied ${manifest.copied.length}`);
  for (const name of [...manifest.copied, ...manifest.missing, ...manifest.files.map((file) => file.name)]) scriptCodeFromName(name);
  if (manifest.selectedCodes.length) {
    const selected = normalizedUniqueStrings(manifest.selectedCodes);
    if (selected.length !== manifest.selectedCodes.length) fail("Lua script manifest selectedCodes contains duplicate passcodes");
    const listedCodes = normalizedUniqueStrings([...manifest.copied, ...manifest.missing].map(scriptCodeFromName));
    if (!sameStrings(selected, listedCodes)) fail(`Lua script manifest selectedCodes ${selected.join(",")} does not match copied/missing script codes ${listedCodes.join(",")}`);
  }
  if (new Set(manifest.copied).size !== manifest.copied.length) fail("Lua script manifest copied list contains duplicate names");
  if (new Set(manifest.files.map((file) => file.name)).size !== manifest.files.length) fail("Lua script manifest files list contains duplicate names");
  const copied = new Set(manifest.copied);
  const unlistedScriptFiles = directoryFiles(dir)
    .filter((name) => /^c\d+\.lua$/u.test(name))
    .filter((name) => !copied.has(name));
  if (unlistedScriptFiles.length) fail(`Lua script export contains unlisted scripts: ${unlistedScriptFiles.join(", ")}`);
  const actualSourceCounts = countBy(manifest.files, (file) => file.source);
  const actualFallbackKindCounts = countBy(
    manifest.files.filter((file) => file.source === "local-fallback"),
    (file) => file.fallbackKind,
  );
  if (!sameCountRecord(manifest.sourceCounts, actualSourceCounts)) {
    fail(`Lua script manifest sourceCounts ${formatCountRecord(manifest.sourceCounts)} do not match files ${formatCountRecord(actualSourceCounts)}`);
  }
  if (!sameCountRecord(manifest.fallbackKindCounts, actualFallbackKindCounts)) {
    fail(`Lua script manifest fallbackKindCounts ${formatCountRecord(manifest.fallbackKindCounts)} do not match local fallback files ${formatCountRecord(actualFallbackKindCounts)}`);
  }

  for (const file of manifest.files) {
    if (!copied.has(file.name)) fail(`Lua script manifest file ${file.name} is not listed in copied scripts`);
    if (file.source === "local-fallback") {
      if (!file.fallbackKind) fail(`Lua script manifest local fallback ${file.name} is missing fallbackKind`);
    } else if (file.fallbackKind !== undefined) {
      fail(`Lua script manifest non-fallback ${file.name} must not include fallbackKind`);
    }
    const scriptPath = path.join(dir, file.name);
    const text = readText(scriptPath, `Lua script ${file.name}`);
    const bytes = Buffer.byteLength(text);
    if (bytes !== file.bytes) fail(`Lua script ${file.name} byte count ${bytes} does not match manifest ${file.bytes}`);
    if (sha256(text) !== file.sha256) fail(`Lua script ${file.name} hash does not match manifest`);
  }
  for (const name of copied) {
    if (!manifest.files.some((file) => file.name === name)) fail(`Lua script manifest copied script ${name} is missing file metadata`);
  }
}

function directoryFiles(dir) {
  if (!fs.existsSync(dir)) fail(`Asset directory ${dir} does not exist`);
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
}

function scriptCodeFromName(name) {
  const match = /^c(\d+)\.lua$/u.exec(name);
  if (!match) fail(`Lua script manifest contains invalid script filename ${name}`);
  return match[1];
}

function normalizedUniqueStrings(values) {
  return [...new Set(values.map(String))].sort((left, right) => Number(left) - Number(right) || left.localeCompare(right));
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function rowIds(rows, label) {
  const ids = rows.map((row) => row?.id);
  if (ids.some((id) => id === undefined)) fail(`CDB rows payload ${label} rows must include ids`);
  const normalized = normalizedUniqueStrings(ids.map(String));
  if (normalized.length !== rows.length) fail(`CDB rows payload ${label} rows contain duplicate ids`);
  return normalized;
}

function parseArgs(argv) {
  const parsed = { cardData: undefined, cardScripts: undefined, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--card-data") parsed.cardData = requireValue(argv, ++index, arg);
    else if (arg === "--card-scripts") parsed.cardScripts = requireValue(argv, ++index, arg);
    else fail(`Unknown argument ${arg}`);
  }
  return parsed;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) fail(`Missing value for ${flag}`);
  return value;
}

function readJson(file, label) {
  return parseJson(readText(file, label), `${label} ${file}`);
}

function readText(file, label) {
  if (!fs.existsSync(file)) fail(`${label} ${file} does not exist`);
  return fs.readFileSync(file, "utf8");
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(`${label} is not valid JSON: ${detail}`);
  }
}

function isLuaScriptFileManifest(value) {
  return isRecord(value) &&
    typeof value.name === "string" &&
    isLuaScriptSource(value.source) &&
    (value.fallbackKind === undefined || isLuaScriptFallbackKind(value.fallbackKind)) &&
    Number.isInteger(value.bytes) &&
    isSha256(value.sha256);
}

function isLuaScriptSource(value) {
  return [
    "local-override",
    "upstream-official",
    "upstream-root",
    "upstream-pre-release",
    "local-fallback",
  ].includes(value);
}

function isLuaScriptFallbackKind(value) {
  return ["alias", "provisional", "other"].includes(value);
}

function isCountRecord(value) {
  return isRecord(value) && Object.values(value).every((count) => Number.isInteger(count) && count >= 0);
}

function countBy(values, keyForValue) {
  const counts = {};
  for (const value of values) {
    const key = keyForValue(value);
    if (key === undefined) continue;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function sameCountRecord(left, right) {
  const leftKeys = Object.keys(left).filter((key) => left[key] !== 0).sort();
  const rightKeys = Object.keys(right).filter((key) => right[key] !== 0).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}

function formatCountRecord(counts) {
  return JSON.stringify(Object.fromEntries(Object.entries(counts).filter(([, count]) => count !== 0).sort(([left], [right]) => left.localeCompare(right))));
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}

function fail(message) {
  console.error(message);
  printUsage();
  process.exit(1);
}

function printUsage() {
  console.log(`Usage: node tools/check-browser-asset-manifests.mjs [options]

Options:
  --card-data <dir>      Directory containing cdb-rows.json and manifest.json.
  --card-scripts <dir>   Directory containing exported c*.lua files and manifest.json.
  --help                 Show this help.
`);
}
