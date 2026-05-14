#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const apiScanner = "tools/scan-lua-api-usage.mjs";
const constantScanner = "tools/scan-lua-constants.mjs";

function main(argv) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return 0;
  }

  const apiResult = runScanner(apiScanner, buildApiArgs(options));
  if (apiResult.status !== 0) return apiResult.status;
  const constantResult = runScanner(constantScanner, buildConstantArgs(options));
  return constantResult.status;
}

function parseArgs(argv) {
  const options = { failOnMissing: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--fail-on-missing") options.failOnMissing = true;
    else if (arg === "--scripts") options.scripts = requireOptionValue(argv, ++index, arg);
    else if (arg === "--upstream") options.upstream = requireOptionValue(argv, ++index, arg);
    else if (arg === "--source") options.source = requireOptionValue(argv, ++index, arg);
    else if (arg === "--limit") options.limit = requireOptionValue(argv, ++index, arg);
    else if (arg === "--min-used-apis") options.minUsedApis = requireOptionValue(argv, ++index, arg);
    else if (arg === "--min-implemented-apis") options.minImplementedApis = requireOptionValue(argv, ++index, arg);
    else if (arg === "--min-upstream-constants") options.minUpstreamConstants = requireOptionValue(argv, ++index, arg);
    else if (arg === "--min-local-constants") options.minLocalConstants = requireOptionValue(argv, ++index, arg);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function requireOptionValue(argv, index, option) {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
  return value;
}

function buildApiArgs(options) {
  return [
    ...(options.failOnMissing ? ["--fail-on-missing"] : []),
    ...(options.scripts ? ["--scripts", options.scripts] : []),
    ...(options.source ? ["--source", options.source] : []),
    ...(options.limit ? ["--limit", options.limit] : []),
    ...(options.minUsedApis ? ["--min-used-apis", options.minUsedApis] : []),
    ...(options.minImplementedApis ? ["--min-implemented-apis", options.minImplementedApis] : []),
  ];
}

function buildConstantArgs(options) {
  return [
    ...(options.failOnMissing ? ["--fail-on-missing"] : []),
    ...(options.upstream ? ["--upstream", options.upstream] : []),
    ...(options.source ? ["--source", options.source] : []),
    ...(options.minUpstreamConstants ? ["--min-upstream-constants", options.minUpstreamConstants] : []),
    ...(options.minLocalConstants ? ["--min-local-constants", options.minLocalConstants] : []),
  ];
}

function runScanner(script, args) {
  return spawnSync(process.execPath, [script, ...args], { stdio: "inherit" });
}

function printHelp() {
  console.log(`Usage: node tools/scan-lua-parity.mjs [options]

Options:
  --scripts <path>       Project Ignis CardScripts script directory for API usage
  --upstream <path>      Project Ignis constant.lua path for constants
  --source <path>        Local Lua host source directory for both scanners
  --limit <count>        Number of missing APIs to print
  --min-used-apis <count>
                         Fail unless upstream script usage has at least this many APIs
  --min-implemented-apis <count>
                         Fail unless local Lua source exposes at least this many APIs
  --min-upstream-constants <count>
                         Fail unless upstream constants have at least this many names
  --min-local-constants <count>
                         Fail unless local constants have at least this many names
  --fail-on-missing      Exit non-zero when missing APIs or constants are found
`);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
