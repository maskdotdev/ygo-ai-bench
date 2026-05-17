#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const defaultAllScriptsRoot = ".upstream/ignis/script";
const defaultOfficialScriptsRoot = ".upstream/ignis/script/official";
const defaultTestRoot = "test";

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return 0;
  }

  const report = buildReport(options);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printReport(report);
  return 0;
}

function parseArgs(argv) {
  const options = {
    allScriptsRoot: defaultAllScriptsRoot,
    officialScriptsRoot: defaultOfficialScriptsRoot,
    testRoot: defaultTestRoot,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--scripts") options.allScriptsRoot = requireOptionValue(argv, ++index, arg);
    else if (arg === "--official-scripts") options.officialScriptsRoot = requireOptionValue(argv, ++index, arg);
    else if (arg === "--test-root") options.testRoot = requireOptionValue(argv, ++index, arg);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function requireOptionValue(argv, index, option) {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
  return value;
}

function buildReport(options) {
  const allScriptFiles = listFiles(path.resolve(root, options.allScriptsRoot), (file) => /^c\d+\.lua$/.test(path.basename(file)));
  const officialScriptFiles = listFiles(path.resolve(root, options.officialScriptsRoot), (file) => /^c\d+\.lua$/.test(path.basename(file)));
  const realScriptFixtureFiles = listFiles(path.resolve(root, options.testRoot), (file) => /^lua-real-script-.*\.test\.ts$/.test(path.basename(file)));
  const luaParity = parseLuaParity(runTool("tools/scan-lua-parity.mjs", ["--fail-on-missing"]));
  const cleanRestore = parseCleanRestore(runTool("tools/scan-lua-clean-restore.mjs", []));
  const provenance = parseProvenance(runTool("tools/scan-parity-fixture-provenance.mjs", []));

  return {
    luaParity,
    cleanRestore,
    provenance,
    directScriptFixtureEstimate: {
      realScriptFixtures: realScriptFixtureFiles.length,
      officialScripts: officialScriptFiles.length,
      allScripts: allScriptFiles.length,
      officialFixturePercent: percent(realScriptFixtureFiles.length, officialScriptFiles.length),
      allFixturePercent: percent(realScriptFixtureFiles.length, allScriptFiles.length),
      remainingOfficialOnePerScript: Math.max(officialScriptFiles.length - realScriptFixtureFiles.length, 0),
      remainingAllOnePerScript: Math.max(allScriptFiles.length - realScriptFixtureFiles.length, 0),
      note: "This is a one-fixture-per-script estimate, not a proof of unique per-card EDOPro parity.",
    },
  };
}

function runTool(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${script} failed with status ${result.status}${details ? `\n${details}` : ""}`);
  }
  return result.stdout;
}

function parseLuaParity(output) {
  return {
    usedApis: requireNumber(output, /used APIs:\s+(\d+)/, "used APIs"),
    implementedApis: requireNumber(output, /implemented APIs found:\s+(\d+)/, "implemented APIs"),
    missingApiUsages: output.includes("No missing API usages found.") ? 0 : null,
    upstreamConstants: requireNumber(output, /upstream constants:\s+(\d+)/, "upstream constants"),
    localConstants: requireNumber(output, /local constants:\s+(\d+)/, "local constants"),
    missingConstants: output.includes("No missing constants found.") ? 0 : null,
  };
}

function parseCleanRestore(output) {
  const match = output.match(/Lua real-script clean restore coverage:\s+(\d+)\/(\d+)\s+\(([\d.]+)%\), chain-limit\s+(\d+)\/(\d+), diagnostics\s+(\d+)\/(\d+), legal-actions\s+(\d+)\/(\d+),\s+(\d+)\s+coverage files/);
  if (!match) throw new Error("Could not parse clean restore report");
  return {
    restoredFixtures: Number(match[1]),
    totalFixtures: Number(match[2]),
    restorePercent: Number(match[3]),
    chainLimitRestoredFixtures: Number(match[4]),
    chainLimitTotalFixtures: Number(match[5]),
    diagnosticFixtures: Number(match[6]),
    diagnosticTotalFixtures: Number(match[7]),
    legalActionFixtures: Number(match[8]),
    legalActionTotalFixtures: Number(match[9]),
    coverageFiles: Number(match[10]),
  };
}

function parseProvenance(output) {
  const match = output.match(/Parity fixture provenance:\s+(\d+)\s+files,\s+(\d+)\s+expectation blocks,\s+(\d+)\s+EDOPro,\s+(\d+)\s+backlog,\s+(\d+)\s+restored scripted fixtures,\s+(\d+)\s+restored before blocks,\s+(\d+)\s+restored after blocks,\s+(\d+)\s+restored window blocks,\s+(\d+)\s+final expected blocks,\s+(\d+)\s+after-only restore steps/);
  if (!match) throw new Error("Could not parse parity fixture provenance report");
  return {
    files: Number(match[1]),
    expectationBlocks: Number(match[2]),
    edoproBlocks: Number(match[3]),
    backlogBlocks: Number(match[4]),
    restoredScriptedFixtures: Number(match[5]),
    restoredBeforeBlocks: Number(match[6]),
    restoredAfterBlocks: Number(match[7]),
    restoredWindowBlocks: Number(match[8]),
    finalExpectedBlocks: Number(match[9]),
    afterOnlyRestoreSteps: Number(match[10]),
  };
}

function requireNumber(text, pattern, label) {
  const match = text.match(pattern);
  if (!match) throw new Error(`Could not parse ${label}`);
  return Number(match[1]);
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

function printReport(report) {
  const direct = report.directScriptFixtureEstimate;
  console.log("Parity progress report");
  console.log(`Lua APIs: ${report.luaParity.usedApis} upstream-used, ${report.luaParity.implementedApis} implemented, ${report.luaParity.missingApiUsages} missing`);
  console.log(`Lua constants: ${report.luaParity.upstreamConstants} upstream, ${report.luaParity.localConstants} local, ${report.luaParity.missingConstants} missing`);
  console.log(`Clean restore: ${report.cleanRestore.restoredFixtures}/${report.cleanRestore.totalFixtures} fixtures (${report.cleanRestore.restorePercent.toFixed(1)}%)`);
  console.log(`Fixture provenance: ${report.provenance.files} files, ${report.provenance.expectationBlocks} expectation blocks, ${report.provenance.backlogBlocks} backlog`);
  console.log(`Direct real-script fixtures: ${direct.realScriptFixtures}`);
  console.log(`One-per-official-script estimate: ${direct.realScriptFixtures}/${direct.officialScripts} (${direct.officialFixturePercent.toFixed(1)}%), ${direct.remainingOfficialOnePerScript} remaining`);
  console.log(`One-per-all-script estimate: ${direct.realScriptFixtures}/${direct.allScripts} (${direct.allFixturePercent.toFixed(1)}%), ${direct.remainingAllOnePerScript} remaining`);
  console.log(direct.note);
}

function printHelp() {
  console.log(`Usage: node tools/report-parity-progress.mjs [options]

Options:
  --json                    Print machine-readable JSON
  --scripts <path>          Project Ignis script root. Default: ${defaultAllScriptsRoot}
  --official-scripts <path> Official Project Ignis script root. Default: ${defaultOfficialScriptsRoot}
  --test-root <path>        Test root. Default: ${defaultTestRoot}
`);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
