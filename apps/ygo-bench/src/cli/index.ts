import { evalSuite } from "./eval.js";
import { inspectTrace } from "./inspect.js";
import { runScenario } from "./run.js";
import { validateSuite } from "./validate.js";
import { checkOpenAiConnectivity } from "../agents/openaiAgent.js";
import { runRealEngineSmoke } from "../edopro-wasm/EdoproWasmAdapter.js";
import { cardDataPathFromEnv, DEFAULT_REAL_SUITE_PATH, LEGACY_REAL_SUITE_PATH, scriptRootFromEnv } from "../edopro-wasm/realDefaults.js";
import type { RealAgentId } from "../edopro-wasm/realAgent.js";
import { evalRealSuite } from "../edopro-wasm/realEval.js";
import { getFirstRealPrompt, stringifyRealPrompt } from "../edopro-wasm/realPrompt.js";
import { runRealDuel } from "../edopro-wasm/realRunner.js";
import { loadRealScenario } from "../edopro-wasm/realScenario.js";
import { loadRealSuite } from "../edopro-wasm/realSuite.js";
import { validateRealSuite } from "../edopro-wasm/realValidate.js";
import type { ScenarioScore } from "../core/types.js";
import { startTraceViewerServer } from "../viewer/liveServer.js";
import { startBenchUiServer } from "../viewer-ui/uiServer.js";

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (!command || command === "help") {
    printHelp();
    return;
  }
  if (command === "smoke") {
    const result = await runScenario({
      scenarioPath: "scenarios/lethal/lethal-001.json",
      agentId: "oracle",
      viewer: true,
    });
    printRunResult(result);
    return;
  }
  if (command === "real-smoke") {
    const result = await runRealEngineSmoke({
      cardDataPath: cardDataPathFromEnv(),
      scriptRoot: scriptRootFromEnv(),
      outPath: "benchmark-runs/real-smoke-messages.json",
    });
    console.log(`Loaded ocgcore ${result.version.join(".")}`);
    console.log(`Processed ${result.messageCount} messages`);
    console.log(`Status: ${result.status}`);
    console.log(`Prompt: ${result.promptType ?? "none"}`);
    console.log(`Messages: ${result.outPath}`);
    return;
  }
  if (command === "real-run") {
    const scenarioPath = readFlag(rest, "--scenario") ?? "scenarios/real/smoke-duel.json";
    const model = readFlag(rest, "--model");
    const result = await runRealDuel({
      agentId: readRealAgentFlag(rest, "--agent", "greedy"),
      cardDataPath: cardDataPathFromEnv(),
      scriptRoot: scriptRootFromEnv(),
      maxDecisions: Number(readFlag(rest, "--max-decisions") ?? 80),
      viewer: rest.includes("--viewer"),
      scenarioPath,
      ...(model ? { model } : {}),
    });
    printRunResult(result);
    return;
  }
  if (command === "real-prompt") {
    const scenarioPath = readFlag(rest, "--scenario") ?? rest[0] ?? "scenarios/real/smoke-duel.json";
    const result = await getFirstRealPrompt({
      scenarioPath,
      cardDataPath: cardDataPathFromEnv(),
      scriptRoot: scriptRootFromEnv(),
    });
    console.log(stringifyRealPrompt(result));
    return;
  }
  if (command === "real-eval") {
    const model = readFlag(rest, "--model");
    const summary = await evalRealSuite({
      agentIds: readRealAgentList(rest, "--agents", ["random", "greedy"]),
      runsPerAgent: Number(readFlag(rest, "--runs") ?? 1),
      cardDataPath: cardDataPathFromEnv(),
      scriptRoot: scriptRootFromEnv(),
      maxDecisions: Number(readFlag(rest, "--max-decisions") ?? 80),
      viewer: rest.includes("--viewer"),
      suitePath: readFlag(rest, "--suite") ?? DEFAULT_REAL_SUITE_PATH,
      ...(model ? { model } : {}),
    });
    for (const row of summary.aggregate) {
      console.log(
        `${row.agentId}: runs=${row.runs} winRate=${row.winRate.toFixed(2)} avgScore=${row.averageScore.toFixed(2)} avgDecisions=${row.averageDecisions.toFixed(1)} avgLpDelta=${row.averageLpDelta.toFixed(0)}`,
      );
    }
    console.log(`Summary: benchmark-runs/${summary.suiteId}-summary.json`);
    return;
  }
  if (command === "real-validate") {
    await validateRealSuite({
      suitePath: rest[0] ?? DEFAULT_REAL_SUITE_PATH,
      cardDataPath: cardDataPathFromEnv(),
      scriptRoot: scriptRootFromEnv(),
    });
    return;
  }
  if (command === "llm-check") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is required for llm-check");
    const result = await checkOpenAiConnectivity({ apiKey });
    console.log(`OpenAI API reachable: HTTP ${result.status}`);
    return;
  }
  if (command === "serve-trace") {
    const tracePath = rest[0];
    if (!tracePath) throw new Error("Missing trace path");
    const server = await startTraceViewerServer({
      tracePath,
      port: Number(readFlag(rest, "--port") ?? 0),
    });
    console.log(`Trace viewer: ${server.url}`);
    console.log("Press Ctrl-C to stop.");
    const shutdown = async () => {
      await server.close();
      process.exit(0);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    await new Promise(() => {});
    return;
  }
  if (command === "ui") {
    const openRunId = readFlag(rest, "--run");
    const server = await startBenchUiServer({
      port: Number(readFlag(rest, "--port") ?? 0),
      ...(openRunId ? { openRunId } : {}),
    });
    console.log(`YGO Bench UI: ${server.url}`);
    console.log("Press Ctrl-C to stop.");
    const shutdown = async () => {
      await server.close();
      process.exit(0);
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    await new Promise(() => {});
    return;
  }
  if (command === "run") {
    const scenarioPath = rest[0];
    if (!scenarioPath) throw new Error("Missing scenario path");
    const agentId = readFlag(rest, "--agent") ?? "random";
    const model = readFlag(rest, "--model");
    const viewer = rest.includes("--viewer");
    if (await isRealScenario(scenarioPath)) {
      const result = await runRealDuel({
        agentId: readRealAgentValue(agentId),
        cardDataPath: cardDataPathFromEnv(),
        scriptRoot: scriptRootFromEnv(),
        maxDecisions: Number(readFlag(rest, "--max-decisions") ?? 80),
        viewer,
        scenarioPath,
        ...(model ? { model } : {}),
      });
      printRunResult(result);
      return;
    }
    const result = await runScenario({ scenarioPath, agentId, viewer, ...(model ? { model } : {}) });
    printRunResult(result);
    return;
  }
  if (command === "eval") {
    const suitePath = rest[0];
    if (!suitePath) throw new Error("Missing suite path");
    const agentIds = (readFlag(rest, "--agents") ?? "random").split(",").filter(Boolean);
    const model = readFlag(rest, "--model");
    const viewer = rest.includes("--viewer");
    if (await isRealSuite(suitePath)) {
      const summary = await evalRealSuite({
        agentIds: agentIds.map((agentId) => readRealAgentValue(agentId)),
        runsPerAgent: Number(readFlag(rest, "--runs") ?? 1),
        cardDataPath: cardDataPathFromEnv(),
        scriptRoot: scriptRootFromEnv(),
        maxDecisions: Number(readFlag(rest, "--max-decisions") ?? 80),
        viewer,
        suitePath,
        ...(model ? { model } : {}),
      });
      console.log(`Wrote ${summary.scores.length} scores.`);
      return;
    }
    const scores = await evalSuite(suitePath, agentIds, viewer, model ? { model } : undefined);
    console.log(`Wrote ${scores.length} scores.`);
    return;
  }
  if (command === "validate") {
    const suitePath = rest[0] ?? "suites/mvp.json";
    if (await isRealSuite(suitePath)) {
      await validateRealSuite({
        suitePath,
        cardDataPath: cardDataPathFromEnv(),
        scriptRoot: scriptRootFromEnv(),
      });
      return;
    }
    await validateSuite(suitePath);
    return;
  }
  if (command === "inspect") {
    const tracePath = rest[0];
    if (!tracePath) throw new Error("Missing trace path");
    for (const line of await inspectTrace(tracePath)) console.log(line);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function readRealAgentFlag(args: string[], name: string, fallback: RealAgentId): RealAgentId {
  const value = readFlag(args, name);
  if (!value) return fallback;
  if (value === "random" || value === "greedy" || value === "oracle" || value === "openai") return value;
  throw new Error(`Unsupported real agent: ${value}`);
}

function readRealAgentList(args: string[], name: string, fallback: RealAgentId[]): RealAgentId[] {
  const value = readFlag(args, name);
  if (!value) return fallback;
  return value.split(",").filter(Boolean).map((agentId) => readRealAgentValue(agentId));
}

function readRealAgentValue(value: string): RealAgentId {
  if (value === "llm") return "openai";
  if (value === "random" || value === "greedy" || value === "oracle" || value === "openai") return value;
  throw new Error(`Unsupported real agent: ${value}`);
}

async function isRealScenario(scenarioPath: string): Promise<boolean> {
  try {
    await loadRealScenario(scenarioPath);
    return true;
  } catch {
    return false;
  }
}

async function isRealSuite(suitePath: string): Promise<boolean> {
  try {
    await loadRealSuite(suitePath);
    return true;
  } catch {
    return false;
  }
}

function printRunResult(result: { score: ScenarioScore; runDir: string }): void {
  console.log(`Scenario: ${result.score.scenarioId}`);
  console.log(`Agent: ${result.score.agentId}`);
  console.log(`Won: ${result.score.won}`);
  console.log(`Objective score: ${result.score.objectiveScore.toFixed(2)}`);
  console.log(`Trace: ${result.runDir}/trace.jsonl`);
  console.log(`Score: ${result.runDir}/final-score.json`);
  console.log(`Viewer: ${result.runDir}/viewer.html`);
}

function printHelp(): void {
  console.log(`Usage:
  pnpm --filter @ygo-bench/app bench smoke
  pnpm --filter @ygo-bench/app bench real-smoke
  pnpm --filter @ygo-bench/app bench real-prompt --scenario scenarios/real/smoke-duel.json
  pnpm --filter @ygo-bench/app bench real-run --scenario scenarios/real/smoke-duel.json --agent greedy --viewer
  pnpm --filter @ygo-bench/app bench real-run --scenario scenarios/real/smoke-duel.json --agent openai --model gpt-4o-mini --viewer
  pnpm --filter @ygo-bench/app bench real-eval --agents random,greedy,openai --model gpt-4o-mini --runs 1 --viewer
  pnpm --filter @ygo-bench/app bench real-validate ${LEGACY_REAL_SUITE_PATH}
  pnpm --filter @ygo-bench/app bench llm-check
  pnpm --filter @ygo-bench/app viewer:build
  pnpm --filter @ygo-bench/app bench ui --port 4173
  pnpm --filter @ygo-bench/app bench run scenarios/lethal/lethal-001.json --agent random --viewer
  pnpm --filter @ygo-bench/app bench eval suites/mock-mvp.json --agents random,greedy,llm --model gpt-4o-mini --viewer
  pnpm --filter @ygo-bench/app bench run scenarios/real/smoke-duel.json --agent greedy --viewer
  pnpm --filter @ygo-bench/app bench eval suites/mvp.json --agents random,greedy,llm --model gpt-4o-mini --viewer
  pnpm --filter @ygo-bench/app bench eval ${LEGACY_REAL_SUITE_PATH} --agents random,greedy,llm --model gpt-4o-mini --viewer
  pnpm --filter @ygo-bench/app bench validate suites/mvp.json
  pnpm --filter @ygo-bench/app bench validate ${LEGACY_REAL_SUITE_PATH}
  pnpm --filter @ygo-bench/app bench inspect benchmark-runs/<run>/trace.jsonl
  pnpm --filter @ygo-bench/app bench serve-trace benchmark-runs/<run>/trace.jsonl --port 4173`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
