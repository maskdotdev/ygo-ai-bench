#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const defaultScriptsRoot = ".upstream/ignis/script/official";
const defaultTestRoot = "test";

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
    testRoot: defaultTestRoot,
    json: false,
    help: false,
    uncoveredOnly: false,
    top: 20,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--uncovered-only") options.uncoveredOnly = true;
    else if (arg === "--scripts") options.scriptsRoot = requireOptionValue(argv, ++index, arg);
    else if (arg === "--test-root") options.testRoot = requireOptionValue(argv, ++index, arg);
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
  const testRoot = path.resolve(process.cwd(), options.testRoot);
  const scriptFiles = listFiles(scriptsRoot, (file) => /^c\d+\.lua$/.test(path.basename(file)));
  const realScriptFixtureFiles = listFiles(testRoot, (file) => /^lua-real-script-.*\.test\.ts$/.test(path.basename(file)));
  const scriptCodes = new Set(scriptFiles.map(scriptCodeFromFile));
  const fixtureCodes = collectFixtureScriptCodes(realScriptFixtureFiles, scriptCodes);
  const buckets = new Map();
  const codeToSignatureKey = new Map();

  for (const file of scriptFiles) {
    const code = scriptCodeFromFile(file);
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
    codeToSignatureKey.set(code, key);

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
      scriptCodes: [],
    };
    bucket.count += 1;
    bucket.scriptCodes.push(code);
    if (bucket.examples.length < 5) bucket.examples.push(relativeFile);
    buckets.set(key, bucket);
  }

  const signatures = [...buckets.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const coveredSignatureKeys = new Set([...fixtureCodes].map((code) => codeToSignatureKey.get(code)).filter(Boolean));
  const fixtureCodesBySignatureKey = new Map();
  for (const code of fixtureCodes) {
    const key = codeToSignatureKey.get(code);
    if (!key) continue;
    const codes = fixtureCodesBySignatureKey.get(key) ?? [];
    codes.push(code);
    fixtureCodesBySignatureKey.set(key, codes);
  }
  for (const signature of signatures) {
    const coveredCodes = fixtureCodesBySignatureKey.get(signature.key) ?? [];
    signature.fixtureCovered = coveredCodes.length > 0;
    signature.fixtureCoveredScripts = coveredCodes.sort((a, b) => Number(a) - Number(b));
  }
  const uncoveredSignatures = signatures.filter((signature) => !coveredSignatureKeys.has(signature.key));

  return {
    scriptsRoot: path.relative(process.cwd(), scriptsRoot) || ".",
    testRoot: path.relative(process.cwd(), testRoot) || ".",
    totalScripts: scriptFiles.length,
    uniqueSignatures: signatures.length,
    largestSignatureSize: signatures[0]?.count ?? 0,
    singletonSignatures: signatures.filter((signature) => signature.count === 1).length,
    fixtureCoverage: {
      realScriptFixtureFiles: realScriptFixtureFiles.length,
      coveredScripts: fixtureCodes.size,
      coveredSignatures: coveredSignatureKeys.size,
      signatureCoveragePercent: percent(coveredSignatureKeys.size, signatures.length),
      uncoveredSignatures: uncoveredSignatures.length,
      topUncoveredSignatures: uncoveredSignatures.slice(0, 10).map(publicSignature),
      note: "A signature is covered when at least one official script in that signature has a real-script fixture. This does not prove every card in the signature is equivalent.",
    },
    signatures,
    note: "Behavior signatures group scripts by coarse Lua categories, effect types, event codes, Duel/Card APIs, helpers, and prompt APIs. They guide fixture selection; they are not a proof of full EDOPro parity.",
  };
}

function scriptCodeFromFile(file) {
  return path.basename(file).match(/^c(\d+)\.lua$/)?.[1] ?? "";
}

function collectFixtureScriptCodes(files, validScriptCodes) {
  const codes = new Set();
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/\b(?:const|let|var)\s+[A-Za-z0-9_]*Code\s*=\s*["'](\d+)["']/g)) {
      const code = match[1];
      if (validScriptCodes.has(code)) codes.add(code);
    }
  }
  return codes;
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

function percent(part, total) {
  if (total === 0) return 0;
  return Number(((part / total) * 100).toFixed(1));
}

function publicSignature(signature) {
  return {
    count: signature.count,
    examples: signature.examples,
    categories: signature.categories,
    effectTypes: signature.effectTypes,
    eventCodes: signature.eventCodes,
    duelApis: signature.duelApis,
    cardApis: signature.cardApis,
    helpers: signature.helpers,
    prompts: signature.prompts,
  };
}

function printReport(report, options) {
  console.log("Lua behavior signature report");
  console.log(`Scripts: ${report.totalScripts}`);
  console.log(`Unique signatures: ${report.uniqueSignatures}`);
  console.log(`Largest signature: ${report.largestSignatureSize} scripts`);
  console.log(`Singleton signatures: ${report.singletonSignatures}`);
  console.log(`Fixture-covered signatures: ${report.fixtureCoverage.coveredSignatures}/${report.uniqueSignatures} (${report.fixtureCoverage.signatureCoveragePercent.toFixed(1)}%)`);
  console.log(`Fixture-covered scripts: ${report.fixtureCoverage.coveredScripts}/${report.totalScripts}`);
  const signatures = options.uncoveredOnly ? report.signatures.filter((signature) => !signature.fixtureCovered) : report.signatures;
  console.log(`${options.uncoveredOnly ? "Top uncovered signatures" : "Top signatures"}: ${Math.min(options.top, signatures.length)}`);
  for (const signature of signatures.slice(0, options.top)) {
    console.log(`- ${signature.count} scripts`);
    console.log(`  fixture covered: ${signature.fixtureCovered ? "yes" : "no"}`);
    if (signature.fixtureCoveredScripts.length > 0) console.log(`  fixture codes: ${signature.fixtureCoveredScripts.join(", ")}`);
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
  console.log(report.fixtureCoverage.note);
}

function printHelp() {
  console.log(`Usage: node tools/report-lua-behavior-signatures.mjs [options]

Options:
  --json             Print machine-readable JSON
  --scripts <path>   Project Ignis script root. Default: ${defaultScriptsRoot}
  --test-root <path> Test root for real-script fixture coverage. Default: ${defaultTestRoot}
  --uncovered-only   Print only signatures without a representative real-script fixture
  --top <count>      Number of largest signatures to print. Default: 20
`);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
