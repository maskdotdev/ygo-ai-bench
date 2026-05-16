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

  const payloadPath = path.join(dir, manifest.payload);
  const payloadText = readText(payloadPath, "CDB rows payload");
  if (sha256(payloadText) !== manifest.sha256) fail(`CDB rows payload hash mismatch for ${payloadPath}`);
  const payload = parseJson(payloadText, `CDB rows payload ${payloadPath}`);
  if (!isRecord(payload) || !Array.isArray(payload.datas) || !Array.isArray(payload.texts)) {
    fail("CDB rows payload must contain datas and texts arrays");
  }
  if (payload.datas.length !== manifest.datasRows) fail(`CDB rows manifest datasRows ${manifest.datasRows} does not match payload ${payload.datas.length}`);
  if (payload.texts.length !== manifest.textsRows) fail(`CDB rows manifest textsRows ${manifest.textsRows} does not match payload ${payload.texts.length}`);
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
    !Array.isArray(manifest.files) ||
    !manifest.files.every(isLuaScriptFileManifest)
  ) {
    fail("Lua script manifest must describe browser-lua-scripts payload metadata");
  }
  if (manifest.copiedCount !== manifest.copied.length) fail(`Lua script manifest copiedCount ${manifest.copiedCount} does not match copied ${manifest.copied.length}`);
  if (manifest.missingCount !== manifest.missing.length) fail(`Lua script manifest missingCount ${manifest.missingCount} does not match missing ${manifest.missing.length}`);
  if (manifest.files.length !== manifest.copied.length) fail(`Lua script manifest files ${manifest.files.length} does not match copied ${manifest.copied.length}`);

  const copied = new Set(manifest.copied);
  for (const file of manifest.files) {
    if (!copied.has(file.name)) fail(`Lua script manifest file ${file.name} is not listed in copied scripts`);
    const scriptPath = path.join(dir, file.name);
    const text = readText(scriptPath, `Lua script ${file.name}`);
    const bytes = Buffer.byteLength(text);
    if (bytes !== file.bytes) fail(`Lua script ${file.name} byte count ${bytes} does not match manifest ${file.bytes}`);
    if (sha256(text) !== file.sha256) fail(`Lua script ${file.name} hash does not match manifest`);
  }
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
  return isRecord(value) && typeof value.name === "string" && Number.isInteger(value.bytes) && isSha256(value.sha256);
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
