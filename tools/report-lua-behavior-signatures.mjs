#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const defaultScriptsRoot = ".upstream/ignis/script/official";

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return 0;
  }

  const report = buildReport(options);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printReport(report, options);
  return 0;
}

function parseArgs(argv) {
  const options = {
    scriptsRoot: defaultScriptsRoot,
    json: false,
    help: false,
    top: 20,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--scripts") options.scriptsRoot = requireOptionValue(argv, ++index, arg);
    else if (arg === "--top") options.top = requirePositiveInt(requireOptionValue(argv, ++index, arg), arg);
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function requireOptionValue(argv, index, option) {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
  return value;
}

function requirePositiveInt(value, option) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${option} must be a positive integer`);
  return parsed;
}

function buildReport(options) {
  const scriptsRoot = path.resolve(process.cwd(), options.scriptsRoot);
  const scriptFiles = listFiles(scriptsRoot, (file) => /^c\d+\.lua$/.test(path.basename(file)));
  const buckets = new Map();

  for (const file of scriptFiles) {
    const source = fs.readFileSync(file, "utf8");
    const analysis = analyzeScript(source);
    const key = [
      `categories=${analysis.categories.join("+") || "none"}`,
      `effectTypes=${analysis.effectTypes.join("+") || "none"}`,
      `eventCodes=${analysis.eventCodes.join("+") || "none"}`,
      `duelApis=${analysis.duelApis.join("+") || "none"}`,
      `cardApis=${analysis.cardApis.join("+") || "none"}`,
      `helpers=${analysis.helpers.join("+") || "none"}`,
      `prompts=${analysis.prompts.join("+") || "none"}`,
    ].join("|");

    const relativeFile = path.relative(process.cwd(), file);
    const bucket = buckets.get(key) ?? {
      key,
      count: 0,
      examples: [],
      categories: analysis.categories,
      effectTypes: analysis.effectTypes,
      eventCodes: analysis.eventCodes,
      duelApis: analysis.duelApis,
      cardApis: analysis.cardApis,
      helpers: analysis.helpers,
      prompts: analysis.prompts,
    };
    bucket.count += 1;
    if (bucket.examples.length < 5) bucket.examples.push(relativeFile);
    buckets.set(key, bucket);
  }

  const signatures = [...buckets.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  return {
    scriptsRoot: path.relative(process.cwd(), scriptsRoot) || ".",
    totalScripts: scriptFiles.length,
    uniqueSignatures: signatures.length,
    largestSignatureSize: signatures[0]?.count ?? 0,
    singletonSignatures: signatures.filter((signature) => signature.count === 1).length,
    signatures,
    note: "Behavior signatures group scripts by coarse Lua categories, effect types, event codes, Duel/Card APIs, helpers, and prompt APIs. They guide fixture selection; they are not a proof of full EDOPro parity.",
  };
}

function analyzeScript(source) {
  const withoutComments = source.replace(/--[^\n\r]*/g, "");
  return {
    categories: collectMatches(withoutComments, /\bCATEGORY_[A-Z0-9_]+/g),
    effectTypes: collectMatches(withoutComments, /\bEFFECT_TYPE_[A-Z0-9_]+/g),
    eventCodes: [
      ...new Set([
        ...collectMatches(withoutComments, /\bEVENT_[A-Z0-9_]+/g),
        ...collectMatches(withoutComments, /\bEFFECT_(?!TYPE_)[A-Z0-9_]+/g),
      ]),
    ].sort(),
    duelApis: collectMatches(withoutComments, /\bDuel\.([A-Za-z_][A-Za-z0-9_]*)/g),
    cardApis: collectMatches(withoutComments, /\bCard\.([A-Za-z_][A-Za-z0-9_]*)/g),
    helpers: collectMatches(withoutComments, /\b(?:Fusion|Synchro|Xyz|Link|Pendulum|Ritual|Gemini|Spirit|Union|aux|Cost|Effect)\.([A-Za-z_][A-Za-z0-9_]*)/g),
    prompts: collectMatches(
      withoutComments,
      /\bDuel\.(Select(?:MatchingCard|Target|YesNo|Option|Effect|EffectYesNo|DisableField|FieldZone|CardsFromCodes)|Announce(?:Number|NumberRange|Card|Race|Attribute|Level))/g,
    ),
  };
}

function collectMatches(source, pattern) {
  const values = new Set();
  for (const match of source.matchAll(pattern)) values.add(match[1] ?? match[0]);
  return [...values].sort();
}

function listFiles(dir, predicate) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(fullPath, predicate));
    else if (entry.isFile() && predicate(fullPath)) files.push(fullPath);
  }
  return files;
}

function printReport(report, options) {
  console.log("Lua behavior signature report");
  console.log(`Scripts: ${report.totalScripts}`);
  console.log(`Unique signatures: ${report.uniqueSignatures}`);
  console.log(`Largest signature: ${report.largestSignatureSize} scripts`);
  console.log(`Singleton signatures: ${report.singletonSignatures}`);
  console.log(`Top signatures: ${Math.min(options.top, report.signatures.length)}`);
  for (const signature of report.signatures.slice(0, options.top)) {
    console.log(`- ${signature.count} scripts`);
    console.log(`  categories: ${signature.categories.join(", ") || "none"}`);
    console.log(`  effect types: ${signature.effectTypes.join(", ") || "none"}`);
    console.log(`  event/effect codes: ${signature.eventCodes.join(", ") || "none"}`);
    console.log(`  Duel APIs: ${signature.duelApis.join(", ") || "none"}`);
    console.log(`  Card APIs: ${signature.cardApis.join(", ") || "none"}`);
    console.log(`  helpers: ${signature.helpers.join(", ") || "none"}`);
    console.log(`  prompts: ${signature.prompts.join(", ") || "none"}`);
    console.log(`  examples: ${signature.examples.join(", ")}`);
  }
  console.log(report.note);
}

function printHelp() {
  console.log(`Usage: node tools/report-lua-behavior-signatures.mjs [options]

Options:
  --json             Print machine-readable JSON
  --scripts <path>   Project Ignis script root. Default: ${defaultScriptsRoot}
  --top <count>      Number of largest signatures to print. Default: 20
`);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
