#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

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
const files = [];
const sourceCounts = {};
const fallbackKindCounts = {};

fs.mkdirSync(options.out, { recursive: true });
for (const name of names) {
  const candidate = scriptCandidates(options.scripts, name).find((scriptCandidate) => fs.existsSync(scriptCandidate.path));
  if (!candidate) {
    missing.push(name);
    continue;
  }
  const text = fs.readFileSync(candidate.path, "utf8");
  const fallbackKind = candidate.source === "local-fallback" ? localFallbackKind(text) : undefined;
  fs.writeFileSync(path.join(options.out, name), text, "utf8");
  copied.push(name);
  sourceCounts[candidate.source] = (sourceCounts[candidate.source] ?? 0) + 1;
  if (fallbackKind) fallbackKindCounts[fallbackKind] = (fallbackKindCounts[fallbackKind] ?? 0) + 1;
  files.push({ name, source: candidate.source, ...(fallbackKind ? { fallbackKind } : {}), bytes: Buffer.byteLength(text), sha256: sha256(text) });
}

const summary = { copied, missing };
fs.writeFileSync(path.join(options.out, "manifest.json"), `${JSON.stringify({
  schemaVersion: 1,
  kind: "browser-lua-scripts",
  selectedCodes: options.codes,
  copiedCount: copied.length,
  missingCount: missing.length,
  sourceCounts,
  fallbackKindCounts,
  copied,
  missing,
  files,
}, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
const localFallbacks = sourceCounts["local-fallback"] ?? 0;
const aliasFallbacks = fallbackKindCounts.alias ?? 0;
const provisionalFallbacks = fallbackKindCounts.provisional ?? 0;
const otherFallbacks = fallbackKindCounts.other ?? 0;
if (options.maxLocalFallbacks !== undefined && localFallbacks > options.maxLocalFallbacks) failWithoutUsage(`Local fallback scripts ${localFallbacks} is above allowed ${options.maxLocalFallbacks}`);
if (options.maxLocalAliasFallbacks !== undefined && aliasFallbacks > options.maxLocalAliasFallbacks) failWithoutUsage(`Local alias fallback scripts ${aliasFallbacks} is above allowed ${options.maxLocalAliasFallbacks}`);
if (options.maxLocalProvisionalFallbacks !== undefined && provisionalFallbacks > options.maxLocalProvisionalFallbacks) failWithoutUsage(`Local provisional fallback scripts ${provisionalFallbacks} is above allowed ${options.maxLocalProvisionalFallbacks}`);
if (options.maxLocalOtherFallbacks !== undefined && otherFallbacks > options.maxLocalOtherFallbacks) failWithoutUsage(`Local other fallback scripts ${otherFallbacks} is above allowed ${options.maxLocalOtherFallbacks}`);
if (missing.length && !options.allowMissing) process.exit(1);

function parseArgs(argv) {
  const parsed = { scripts: undefined, localScripts: undefined, out: undefined, codes: [], allowMissing: false, maxLocalFallbacks: undefined, maxLocalAliasFallbacks: undefined, maxLocalProvisionalFallbacks: undefined, maxLocalOtherFallbacks: undefined, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--scripts") parsed.scripts = requireValue(argv, ++index, arg);
    else if (arg === "--local-scripts") parsed.localScripts = requireValue(argv, ++index, arg);
    else if (arg === "--out") parsed.out = requireValue(argv, ++index, arg);
    else if (arg === "--codes") parsed.codes.push(...parseCodes(requireValue(argv, ++index, arg)));
    else if (arg === "--code") parsed.codes.push(...parseCodes(requireValue(argv, ++index, arg)));
    else if (arg === "--allow-missing") parsed.allowMissing = true;
    else if (arg === "--max-local-fallbacks") parsed.maxLocalFallbacks = parseNonNegativeInteger(requireValue(argv, ++index, arg), arg);
    else if (arg === "--max-local-alias-fallbacks") parsed.maxLocalAliasFallbacks = parseNonNegativeInteger(requireValue(argv, ++index, arg), arg);
    else if (arg === "--max-local-provisional-fallbacks") parsed.maxLocalProvisionalFallbacks = parseNonNegativeInteger(requireValue(argv, ++index, arg), arg);
    else if (arg === "--max-local-other-fallbacks") parsed.maxLocalOtherFallbacks = parseNonNegativeInteger(requireValue(argv, ++index, arg), arg);
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

function parseNonNegativeInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) fail(`${flag} must be a non-negative integer`);
  return parsed;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) fail(`Missing value for ${flag}`);
  return value;
}

function discoverScriptNames(scriptRoot) {
  const names = new Set();
  for (const { dir } of scriptSearchDirs(scriptRoot, options.localScripts)) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && /^c\d+\.lua$/.test(entry.name)) names.add(entry.name);
    }
  }
  return [...names].sort((left, right) => Number(left.slice(1, -4)) - Number(right.slice(1, -4)));
}

function scriptCandidates(scriptRoot, name) {
  return scriptSearchDirs(scriptRoot, options.localScripts).map((candidate) => ({ ...candidate, path: path.join(candidate.dir, name) }));
}

function scriptSearchDirs(scriptRoot, localScriptRoot) {
  return [
    ...(localScriptRoot ? [
      { dir: path.join(localScriptRoot, "overrides", "official"), source: "local-override" },
      { dir: path.join(localScriptRoot, "overrides"), source: "local-override" },
    ] : []),
    { dir: path.join(scriptRoot, "official"), source: "upstream-official" },
    { dir: scriptRoot, source: "upstream-root" },
    { dir: path.join(scriptRoot, "pre-release"), source: "upstream-pre-release" },
    ...(localScriptRoot ? [
      { dir: path.join(localScriptRoot, "fallbacks", "official"), source: "local-fallback" },
      { dir: path.join(localScriptRoot, "fallbacks"), source: "local-fallback" },
    ] : []),
  ];
}

function localFallbackKind(source) {
  if (source.includes("local-fallback-provisional")) return "provisional";
  if (/Duel\.LoadCardScriptAlias\(\d+\)/.test(source)) return "alias";
  return "other";
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fail(message) {
  console.error(message);
  printUsage();
  process.exit(1);
}

function failWithoutUsage(message) {
  console.error(message);
  process.exit(1);
}

function printUsage() {
  console.log(`Usage: node tools/export-browser-lua-scripts.mjs --scripts <script-root> --out <dir> [options]

Options:
  --codes <list>      Comma-separated passcodes to export. Defaults to all c*.lua scripts.
  --code <passcode>   Add one passcode to export. Can be repeated.
  --local-scripts <dir>
                      Include local overrides/fallbacks using runtime candidate order.
  --max-local-fallbacks <count>
                      Fail when exported local fallback scripts exceed count.
  --max-local-alias-fallbacks <count>
                      Fail when exported alias fallback scripts exceed count.
  --max-local-provisional-fallbacks <count>
                      Fail when exported provisional fallback scripts exceed count.
  --max-local-other-fallbacks <count>
                      Fail when exported unclassified fallback scripts exceed count.
  --allow-missing     Exit successfully even when selected scripts are missing.
  --help              Show this help.
`);
}
