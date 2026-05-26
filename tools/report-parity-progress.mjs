#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const defaultAllScriptsRoot = ".upstream/ignis/script";
const defaultOfficialScriptsRoot = ".upstream/ignis/script/official";
const defaultTestRoot = "test";
const bridgeBundleSpecs = [
  {
    key: "playtest",
    path: "dist/playtest-engine.js",
    maxBytes: 128 * 1024,
    required: ["window.duelDeckPlaytest", "legalActions", "legalActionGroups", "runScripted"],
  },
  {
    key: "pvp",
    path: "dist/duel-pvp-engine.js",
    maxBytes: 384 * 1024,
    required: ["window.duelPvpPlaytest", "start", "state", "legalActions", "action", "visibleBattlefield", "autoRunVisible", "runVisibleScript", "serialize", "restore", "clear"],
  },
];

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
  const chainLimitPatterns = parseChainLimitPatterns(runTool("tools/scan-lua-chain-limit-patterns.mjs", ["--fail-on-unclassified"]));
  const promptPatterns = parsePromptPatterns(runTool("tools/scan-lua-prompt-patterns.mjs", ["--fail-on-unclassified"]));
  const cleanRestore = parseCleanRestore(runTool("tools/scan-lua-clean-restore.mjs", []));
  const provenance = parseProvenance(runTool("tools/scan-parity-fixture-provenance.mjs", []));
  const missedTiming = buildMissedTimingCoverage(path.resolve(root, options.testRoot));
  const bridgeBundles = buildBridgeBundleReport();

  return {
    luaParity,
    chainLimitPatterns,
    promptPatterns,
    cleanRestore,
    provenance,
    missedTiming,
    bridgeBundles,
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

function buildBridgeBundleReport() {
  return Object.fromEntries(bridgeBundleSpecs.map((spec) => {
    const fullPath = path.resolve(root, spec.path);
    if (!fs.existsSync(fullPath)) {
      return [spec.key, { path: spec.path, exists: false, maxBytes: spec.maxBytes, sizeBytes: null, missingRequired: [...spec.required], forbiddenSnippets: [] }];
    }
    const source = fs.readFileSync(fullPath, "utf8");
    return [
      spec.key,
      {
        path: spec.path,
        exists: true,
        maxBytes: spec.maxBytes,
        sizeBytes: Buffer.byteLength(source),
        missingRequired: spec.required.filter((snippet) => !source.includes(snippet)),
        forbiddenSnippets: ["child_process", "readline-sync", "node_modules/fengari", "Module \"fs\"", "from \"fs\"", "require(\"fs\")"].filter((snippet) => source.includes(snippet)),
      },
    ];
  }));
}

function buildMissedTimingCoverage(testRoot) {
  const fixtureFiles = listFiles(testRoot, (file) => /^parity-missed-timing(?:-.*)?-fixture\.test\.ts$/.test(path.basename(file)));
  const activationFixtureFiles = fixtureFiles.filter((file) => !path.basename(file).endsWith("-decline-fixture.test.ts"));
  const declineFixtureFiles = fixtureFiles.filter((file) => path.basename(file).endsWith("-decline-fixture.test.ts"));
  const multiStepFixtureFiles = fixtureFiles.filter((file) => fs.readFileSync(file, "utf8").includes("eventIsLast: false"));
  const fullSourceEffectCauseFiles = multiStepFixtureFiles.filter(hasSourceEffectCauseMetadata);
  const sourceEffectCauseEventCodeFiles = fullSourceEffectCauseFiles.filter(hasEventCodeMetadata);
  const syntheticNoEventCodeFiles = fullSourceEffectCauseFiles.filter((file) => !hasEventCodeMetadata(file));
  const sourceEffectCauseExceptionFiles = multiStepFixtureFiles.filter((file) => !hasSourceEffectCauseMetadata(file));
  const battleDamageExceptionFiles = sourceEffectCauseExceptionFiles.filter((file) => classifyMissedTimingSourceEffectCauseExceptionFamily(path.basename(file)) === "battleDamageCause");
  const phaseBoundaryExceptionFiles = sourceEffectCauseExceptionFiles.filter((file) => classifyMissedTimingSourceEffectCauseExceptionFamily(path.basename(file)) === "phaseBoundary");
  const chainExceptionFiles = sourceEffectCauseExceptionFiles.filter((file) => classifyMissedTimingSourceEffectCauseExceptionFamily(path.basename(file)) === "chainLifecycleOrigin");

  return {
    fixtures: fixtureFiles.length,
    activationFixtures: activationFixtureFiles.length,
    declineFixtures: declineFixtureFiles.length,
    multiStepFixtures: multiStepFixtureFiles.length,
    sourceEffectCauseFixtures: fullSourceEffectCauseFiles.length,
    sourceEffectCauseExceptions: multiStepFixtureFiles.length - fullSourceEffectCauseFiles.length,
    sourceEffectCauseExceptionFamilies: countMissedTimingSourceEffectCauseExceptionFamilies(sourceEffectCauseExceptionFiles),
    chainExceptionFamilies: countMissedTimingChainExceptionFamilies(sourceEffectCauseExceptionFiles),
    sourceEffectCauseEventCodeFixtures: sourceEffectCauseEventCodeFiles.length,
    sourceEffectCauseEventCodeExceptions: fullSourceEffectCauseFiles.length - sourceEffectCauseEventCodeFiles.length,
    sourceEffectCauseEventHistoryFixtures: fullSourceEffectCauseFiles.filter(hasSourceEffectCauseEventHistoryMetadata).length,
    syntheticNoEventCodeEventHistoryFixtures: syntheticNoEventCodeFiles.filter(hasSyntheticNoEventCodeEventHistoryMetadata).length,
    battleDamageExceptionEventHistoryFixtures: battleDamageExceptionFiles.filter(hasBattleDamageExceptionEventHistoryMetadata).length,
    phaseBoundaryPlayerFixtures: phaseBoundaryExceptionFiles.filter(hasPhaseBoundaryPlayerMetadata).length,
    phaseBoundaryEventHistoryFixtures: phaseBoundaryExceptionFiles.filter(hasPhaseBoundaryEventHistoryMetadata).length,
    chainExceptionEventHistoryFixtures: chainExceptionFiles.filter(hasChainExceptionEventHistoryMetadata).length,
  };
}

function countMissedTimingSourceEffectCauseExceptionFamilies(files) {
  return files.reduce(
    (counts, file) => {
      const family = classifyMissedTimingSourceEffectCauseExceptionFamily(path.basename(file));
      counts[family] += 1;
      return counts;
    },
    { battleDamageCause: 0, chainLifecycleOrigin: 0, phaseBoundary: 0 },
  );
}

function classifyMissedTimingSourceEffectCauseExceptionFamily(file) {
  if (/^parity-missed-timing-(?:before-battle-damage|battle-damage)(?:-decline)?-fixture\.test\.ts$/.test(file)) return "battleDamageCause";
  if (/^parity-missed-timing-(?:chain-activating|chain-disabled|chain-ended|chain-negated|chain-solved|chain-solving|chaining)(?:-decline)?-fixture\.test\.ts$/.test(file)) return "chainLifecycleOrigin";
  if (/^parity-missed-timing-(?:phase-(?:draw|standby|main1|battle|main2)|phase-start-(?:draw|standby|main1|battle|main2)|startup)(?:-decline)?-fixture\.test\.ts$/.test(file)) return "phaseBoundary";
  throw new Error(`Unclassified missed-timing source/effect cause exception: ${file}`);
}

function countMissedTimingChainExceptionFamilies(files) {
  return files.reduce(
    (counts, file) => {
      const base = path.basename(file);
      if (/^parity-missed-timing-chain-activating(?:-decline)?-fixture\.test\.ts$/.test(base)) counts.chainActivatingState += 1;
      else if (/^parity-missed-timing-(?:chain-disabled|chain-ended|chain-negated|chain-solved|chain-solving|chaining)(?:-decline)?-fixture\.test\.ts$/.test(base)) counts.chainLifecycleOrigin += 1;
      return counts;
    },
    { chainActivatingState: 0, chainLifecycleOrigin: 0 },
  );
}

function hasSourceEffectCauseMetadata(file) {
  const text = fs.readFileSync(file, "utf8");
  return (
    /eventReason:\s*0x(?:40|80)/.test(text) &&
    /eventReasonPlayer:\s*0/.test(text) &&
    /eventReasonCardUid:\s*["']p0-deck-100-0["']/.test(text) &&
    /eventReasonEffectId:\s*\d+/.test(text) &&
    /eventTriggerTiming:\s*["']if["']/.test(text)
  );
}

function hasEventCodeMetadata(file) {
  const text = fs.readFileSync(file, "utf8");
  return /eventCode:\s*(?:0x[0-9a-fA-F]+|\d+)/.test(text) || /\beventCode\s*,/.test(text);
}

function hasSyntheticNoEventCodeEventHistoryMetadata(file) {
  const text = fs.readFileSync(file, "utf8");
  return (
    /collectEventsOnResolve:\s*\[\s*\{[\s\S]*collectEvent:\s*["'](?:activated|phaseChanged|turnStarted)["']/.test(text) &&
    /eventHistory:\s*\[[\s\S]*eventName:\s*["'](?:activated|phaseChanged|turnStarted)["'][\s\S]*eventReason:\s*0x40[\s\S]*eventReasonPlayer:\s*0[\s\S]*eventReasonCardUid:\s*["']p0-deck-100-0["'][\s\S]*eventReasonEffectId:\s*\d+/.test(text)
  );
}

function hasSourceEffectCauseEventHistoryMetadata(file) {
  const text = fs.readFileSync(file, "utf8");
  return /eventHistory:\s*\[[\s\S]*eventReason:\s*0x(?:40|80)[\s\S]*eventReasonPlayer:\s*0[\s\S]*eventReasonCardUid:\s*["']p0-deck-100-0["'][\s\S]*eventReasonEffectId:\s*\d+/.test(text);
}

function hasBattleDamageExceptionEventHistoryMetadata(file) {
  const text = fs.readFileSync(file, "utf8");
  return /eventHistory:\s*\[[\s\S]*eventName:\s*["'](?:beforeBattleDamage|battleDamageDealt)["'][\s\S]*eventCode:\s*(?:1136|1143)[\s\S]*eventCardUid:\s*["']p0-deck-700-4["'][\s\S]*eventPlayer:\s*1[\s\S]*eventValue:\s*1800[\s\S]*eventReason:\s*0x20[\s\S]*eventReasonPlayer:\s*0[\s\S]*eventReasonCardUid:\s*["']p0-deck-700-4["']/.test(text);
}

function hasPhaseBoundaryPlayerMetadata(file) {
  const text = fs.readFileSync(file, "utf8");
  return (
    /collectEvents:\s*\[\{ collectEvent:\s*["'](?:phaseDraw|phaseStandby|phaseMain1|phaseBattle|phaseMain2|phaseStartDraw|phaseStartStandby|phaseStartMain1|phaseStartBattle|phaseStartMain2|startup)["'][\s\S]*eventPlayer:\s*0/.test(text) &&
    /pendingTriggers:\s*\[\{[\s\S]*eventName:\s*["'](?:phaseDraw|phaseStandby|phaseMain1|phaseBattle|phaseMain2|phaseStartDraw|phaseStartStandby|phaseStartMain1|phaseStartBattle|phaseStartMain2|startup)["'][\s\S]*eventPlayer:\s*0[\s\S]*eventTriggerTiming:\s*["']if["']/.test(text)
  );
}

function hasPhaseBoundaryEventHistoryMetadata(file) {
  const text = fs.readFileSync(file, "utf8");
  return /eventHistory:\s*\[\{ eventName:\s*["'](?:phaseDraw|phaseStandby|phaseMain1|phaseBattle|phaseMain2|phaseStartDraw|phaseStartStandby|phaseStartMain1|phaseStartBattle|phaseStartMain2|startup)["'],\s*eventCode:\s*(?:1000|0x1001|0x1002|0x1004|0x1008|0x1100|0x2001|0x2002|0x2004|0x2008|0x2100),\s*eventPlayer:\s*0\s*\}\]/.test(text);
}

function hasChainExceptionEventHistoryMetadata(file) {
  const text = fs.readFileSync(file, "utf8");
  const base = path.basename(file);
  if (/^parity-missed-timing-chain-activating(?:-decline)?-fixture\.test\.ts$/.test(base)) {
    return /eventHistory:\s*\[[\s\S]*eventName:\s*["']chainActivating["'][\s\S]*eventCode:\s*1021[\s\S]*eventCardUid:\s*["']p0-deck-100-0["'][\s\S]*eventReason:\s*1024[\s\S]*eventReasonPlayer:\s*0[\s\S]*relatedEffectId:\s*1[\s\S]*eventPreviousState:\s*\{[\s\S]*eventCurrentState:\s*\{/.test(text);
  }
  return /eventHistory:\s*\[[\s\S]*eventName:\s*["'](?:chaining|chainSolving|chainSolved|chainNegated|chainDisabled|chainEnded)["'][\s\S]*eventCardUid:\s*["']p0-deck-100-0["'][\s\S]*eventPlayer:\s*0[\s\S]*eventValue:\s*1[\s\S]*eventReasonPlayer:\s*0[\s\S]*relatedEffectId:\s*1[\s\S]*eventChainDepth:\s*1[\s\S]*eventChainLinkId:\s*["']fixture-chain-1["']/.test(text);
}

function runTool(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${script} failed with status ${result.status}${details ? `\n${details}` : ""}`);
  }
  return result.stdout;
}

function parseChainLimitPatterns(output) {
  return {
    filesWithCalls: requireNumber(output, /^files with calls:\s+(\d+)/m, "chain-limit files with calls"),
    calls: requireNumber(output, /^calls:\s+(\d+)/m, "chain-limit calls"),
    unclassifiedCalls: requireNumber(output, /^unclassified calls:\s+(\d+)/m, "unclassified chain-limit calls"),
  };
}

function parsePromptPatterns(output) {
  return {
    filesWithCalls: requireNumber(output, /^files with prompt calls:\s+(\d+)/m, "prompt files with calls"),
    calls: requireNumber(output, /^prompt calls:\s+(\d+)/m, "prompt calls"),
    selectOptionCalls: requireNumber(output, /^SelectOption calls:\s+(\d+)/m, "SelectOption calls"),
    selectYesNoCalls: requireNumber(output, /^SelectYesNo calls:\s+(\d+)/m, "SelectYesNo calls"),
    selectEffectCalls: requireNumber(output, /^SelectEffect calls:\s+(\d+)/m, "SelectEffect calls"),
    selectEffectYesNoCalls: requireNumber(output, /^SelectEffectYesNo calls:\s+(\d+)/m, "SelectEffectYesNo calls"),
    announcementHelperCalls: requireNumber(output, /^announcement helper calls:\s+(\d+)/m, "announcement helper calls"),
    unclassifiedCalls: requireNumber(output, /^unclassified prompt calls:\s+(\d+)/m, "unclassified prompt calls"),
  };
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
  console.log(`Chain limits: ${report.chainLimitPatterns.calls} calls in ${report.chainLimitPatterns.filesWithCalls} files, ${report.chainLimitPatterns.unclassifiedCalls} unclassified`);
  console.log(`Lua prompts: ${report.promptPatterns.calls} calls in ${report.promptPatterns.filesWithCalls} files, ${report.promptPatterns.unclassifiedCalls} unclassified`);
  console.log(`Clean restore: ${report.cleanRestore.restoredFixtures}/${report.cleanRestore.totalFixtures} fixtures (${report.cleanRestore.restorePercent.toFixed(1)}%)`);
  console.log(`Fixture provenance: ${report.provenance.files} files, ${report.provenance.expectationBlocks} expectation blocks, ${report.provenance.backlogBlocks} backlog`);
  console.log(
    `Missed timing: ${report.missedTiming.fixtures} fixtures, ${report.missedTiming.multiStepFixtures} multi-step, ` +
      `${report.missedTiming.sourceEffectCauseFixtures} source/effect cause, ${report.missedTiming.sourceEffectCauseExceptions} exceptions`,
  );
  console.log(
    `Missed timing exceptions: ${report.missedTiming.sourceEffectCauseExceptionFamilies.battleDamageCause} battle damage cause, ` +
      `${report.missedTiming.sourceEffectCauseExceptionFamilies.chainLifecycleOrigin} chain lifecycle origin, ` +
      `${report.missedTiming.sourceEffectCauseExceptionFamilies.phaseBoundary} phase boundary`,
  );
  console.log(`Battle damage exception event history: ${report.missedTiming.battleDamageExceptionEventHistoryFixtures}/${report.missedTiming.sourceEffectCauseExceptionFamilies.battleDamageCause}`);
  console.log(`Phase boundary exception player metadata: ${report.missedTiming.phaseBoundaryPlayerFixtures}/${report.missedTiming.sourceEffectCauseExceptionFamilies.phaseBoundary}`);
  console.log(`Phase boundary exception event history: ${report.missedTiming.phaseBoundaryEventHistoryFixtures}/${report.missedTiming.sourceEffectCauseExceptionFamilies.phaseBoundary}`);
  console.log(
    `Chain lifecycle exceptions: ${report.missedTiming.chainExceptionFamilies.chainActivatingState} chain-activating state, ` +
      `${report.missedTiming.chainExceptionFamilies.chainLifecycleOrigin} chain origin`,
  );
  console.log(`Chain lifecycle exception event history: ${report.missedTiming.chainExceptionEventHistoryFixtures}/${report.missedTiming.sourceEffectCauseExceptionFamilies.chainLifecycleOrigin}`);
  console.log(`Source/effect cause event history: ${report.missedTiming.sourceEffectCauseEventHistoryFixtures}/${report.missedTiming.sourceEffectCauseFixtures}`);
  console.log(`Synthetic no-code missed timing event history: ${report.missedTiming.syntheticNoEventCodeEventHistoryFixtures}/${report.missedTiming.sourceEffectCauseEventCodeExceptions}`);
  printBridgeBundleReport(report.bridgeBundles);
  console.log(`Direct real-script fixtures: ${direct.realScriptFixtures}`);
  console.log(`One-per-official-script estimate: ${direct.realScriptFixtures}/${direct.officialScripts} (${direct.officialFixturePercent.toFixed(1)}%), ${direct.remainingOfficialOnePerScript} remaining`);
  console.log(`One-per-all-script estimate: ${direct.realScriptFixtures}/${direct.allScripts} (${direct.allFixturePercent.toFixed(1)}%), ${direct.remainingAllOnePerScript} remaining`);
  console.log(direct.note);
}

function printBridgeBundleReport(bridgeBundles) {
  const playtest = bridgeBundles.playtest;
  const pvp = bridgeBundles.pvp;
  if (!playtest.exists && !pvp.exists) {
    console.log("Bridge bundles: not built");
    return;
  }
  const describe = (bundle) => bundle.exists
    ? `${bundle.sizeBytes}/${bundle.maxBytes} bytes, ${bundle.missingRequired.length} missing APIs, ${bundle.forbiddenSnippets.length} forbidden snippets`
    : "not built";
  console.log(`Bridge bundles: playtest ${describe(playtest)}; pvp ${describe(pvp)}`);
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
