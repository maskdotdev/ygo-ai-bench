#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const defaultTestRoot = "test";

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return 0;
  }

  const testRoot = path.resolve(options.testRoot ?? defaultTestRoot);
  const minPercent = options.minPercent ?? 75;
  const realScriptFiles = realScriptFixtureFiles(testRoot);
  const completeDiagnostics = realScriptFiles.filter((file) => {
    const text = readTestFile(file);
    return text.includes("restoreComplete") && text.includes('incompleteReasons.join("; ")');
  });
  const cleanRestored = realScriptFiles.filter((file) => readTestFile(file).includes("missingRegistryKeys).toEqual([])"));
  const chainLimitCleanRestored = realScriptFiles.filter((file) => readTestFile(file).includes("missingChainLimitRegistryKeys).toEqual([])"));
  const coverageFiles = restoreCoverageFiles(testRoot);
  const referenced = restoreCoverageReferences(testRoot, realScriptFiles, coverageFiles);
  const unreferenced = cleanRestored.filter((file) => !referenced.has(toRepoPath(file)));
  const percent = realScriptFiles.length === 0 ? 100 : (cleanRestored.length / realScriptFiles.length) * 100;

  console.log(`Lua real-script clean restore coverage: ${cleanRestored.length}/${realScriptFiles.length} (${percent.toFixed(1)}%), chain-limit ${chainLimitCleanRestored.length}/${realScriptFiles.length}, diagnostics ${completeDiagnostics.length}/${realScriptFiles.length}, ${coverageFiles.length} coverage files`);

  const failures = [];
  if (options.minFixtures !== undefined && realScriptFiles.length < options.minFixtures) failures.push(`Real-script fixtures ${realScriptFiles.length} is below required ${options.minFixtures}`);
  if (options.minCoverageFiles !== undefined && coverageFiles.length < options.minCoverageFiles) failures.push(`Restore coverage files ${coverageFiles.length} is below required ${options.minCoverageFiles}`);
  if (percent < minPercent) failures.push(`Coverage ${percent.toFixed(1)}% is below required ${minPercent.toFixed(1)}%`);
  if (options.failOnMissing && cleanRestored.length !== realScriptFiles.length) {
    const missing = realScriptFiles.filter((file) => !cleanRestored.includes(file)).map(toRepoPath);
    failures.push(`Fixtures missing clean restore assertions:\n${formatList(missing)}`);
  }
  if (options.failOnMissing && chainLimitCleanRestored.length !== realScriptFiles.length) {
    const missing = realScriptFiles.filter((file) => !chainLimitCleanRestored.includes(file)).map(toRepoPath);
    failures.push(`Fixtures missing chain-limit clean restore assertions:\n${formatList(missing)}`);
  }
  if (options.failOnMissingDiagnostics && completeDiagnostics.length !== realScriptFiles.length) {
    const missing = realScriptFiles.filter((file) => !completeDiagnostics.includes(file)).map(toRepoPath);
    failures.push(`Fixtures missing complete restore diagnostics:\n${formatList(missing)}`);
  }
  if (options.failOnUnreferenced && unreferenced.length > 0) {
    failures.push(`Clean-restored fixtures missing restore coverage ownership:\n${formatList(unreferenced.map(toRepoPath))}`);
  }

  if (failures.length === 0) return 0;
  console.error(failures.join("\n\n"));
  return 1;
}

function parseArgs(argv) {
  const options = { failOnMissing: false, failOnMissingDiagnostics: false, failOnUnreferenced: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--test-root") options.testRoot = requireOptionValue(argv, ++index, arg);
    else if (arg === "--min-percent") options.minPercent = parsePercent(requireOptionValue(argv, ++index, arg));
    else if (arg === "--min-fixtures") options.minFixtures = parseMinimum(requireOptionValue(argv, ++index, arg), arg);
    else if (arg === "--min-coverage-files") options.minCoverageFiles = parseMinimum(requireOptionValue(argv, ++index, arg), arg);
    else if (arg === "--fail-on-missing") options.failOnMissing = true;
    else if (arg === "--fail-on-missing-diagnostics") options.failOnMissingDiagnostics = true;
    else if (arg === "--fail-on-unreferenced") options.failOnUnreferenced = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function requireOptionValue(argv, index, option) {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
  return value;
}

function parsePercent(value) {
  const percent = Number(value);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error(`Invalid --min-percent value: ${value}`);
  return percent;
}

function parseMinimum(value, option) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) throw new Error(`${option} must be a non-negative integer`);
  return count;
}

function realScriptFixtureFiles(testRoot) {
  return fs.readdirSync(testRoot)
    .filter((file) => /^lua-real-script-.*\.test\.ts$/.test(file))
    .map((file) => path.join(testRoot, file))
    .sort();
}

function restoreCoverageReferences(testRoot, realScriptFiles, coverageFiles = restoreCoverageFiles(testRoot)) {
  const references = new Set();
  for (const file of coverageFiles) {
    const text = readTestFile(path.join(testRoot, file));
    for (const match of text.matchAll(/(?:file:\s*)?["']((?:test\/)?lua-real-script-[^"']+\.test\.ts)["']/g)) {
      const fixture = match[1].startsWith("test/") ? match[1] : `test/${match[1]}`;
      references.add(fixture);
    }
  }
  for (const file of realScriptFiles.filter((fixture) => /chain-limit/.test(fixture))) {
    references.add(toRepoPath(file));
  }
  return references;
}

function restoreCoverageFiles(testRoot) {
  return fs.readdirSync(testRoot).filter((file) =>
    /^lua-real-.*restore-coverage\.test\.ts$/.test(file)
    || file === "lua-chain-limit-restore-coverage.test.ts"
    || file === "lua-grouped-event-restore-coverage.test.ts"
    || file === "lua-source-only-event-coverage.test.ts"
    || file === "lua-event-reason-source-coverage.test.ts",
  );
}

function readTestFile(file) {
  return fs.readFileSync(file, "utf8");
}

function toRepoPath(file) {
  return path.relative(process.cwd(), file).split(path.sep).join("/");
}

function formatList(items) {
  return items.map((item) => `  ${item}`).join("\n");
}

function printHelp() {
  console.log(`Usage: node tools/scan-lua-clean-restore.mjs [options]

Options:
  --test-root <path>         Test directory to scan. Default: ${defaultTestRoot}
  --min-percent <number>     Required clean-restore percentage. Default: 75
  --min-fixtures <count>     Fail unless at least this many real-script fixtures are scanned
  --min-coverage-files <count>
                              Fail unless at least this many restore coverage files are scanned
  --fail-on-missing          Exit non-zero unless every real-script fixture asserts clean restore
  --fail-on-missing-diagnostics
                              Exit non-zero unless every real-script fixture asserts restoreComplete diagnostics
  --fail-on-unreferenced     Exit non-zero when clean-restored fixtures lack restore coverage ownership
`);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
