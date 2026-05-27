import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evalSuite } from "./eval.js";
import { runScenario } from "./run.js";
import { validateSuite } from "./validate.js";
import { runRealEngineSmoke } from "../edopro-wasm/EdoproWasmAdapter.js";
import type { RealAgentId } from "../edopro-wasm/realAgent.js";
import { evalRealSuite } from "../edopro-wasm/realEval.js";
import { getFirstRealPrompt, stringifyRealPrompt } from "../edopro-wasm/realPrompt.js";
import { runRealDuel } from "../edopro-wasm/realRunner.js";
import { validateRealSuite } from "../edopro-wasm/realValidate.js";
import { startTraceViewerServer } from "../viewer/liveServer.js";

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
      cardDataPath: "../../public/card-data/cdb-rows.json",
      scriptRoot: "../../.upstream/ignis/script",
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
      cardDataPath: "../../public/card-data/cdb-rows.json",
      scriptRoot: "../../.upstream/ignis/script",
      maxDecisions: Number(readFlag(rest, "--max-decisions") ?? 12),
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
      cardDataPath: "../../public/card-data/cdb-rows.json",
      scriptRoot: "../../.upstream/ignis/script",
    });
    console.log(stringifyRealPrompt(result));
    return;
  }
  if (command === "real-eval") {
    const model = readFlag(rest, "--model");
    const summary = await evalRealSuite({
      agentIds: readRealAgentList(rest, "--agents", ["random", "greedy"]),
      runsPerAgent: Number(readFlag(rest, "--runs") ?? 1),
      cardDataPath: "../../public/card-data/cdb-rows.json",
      scriptRoot: "../../.upstream/ignis/script",
      maxDecisions: Number(readFlag(rest, "--max-decisions") ?? 20),
      viewer: rest.includes("--viewer"),
      suitePath: readFlag(rest, "--suite") ?? "suites/real-mvp.json",
      ...(model ? { model } : {}),
    });
    for (const row of summary.aggregate) {
      console.log(
        `${row.agentId}: runs=${row.runs} winRate=${row.winRate.toFixed(2)} avgScore=${row.averageScore.toFixed(2)} avgDecisions=${row.averageDecisions.toFixed(1)} avgLpDelta=${row.averageLpDelta.toFixed(0)}`,
      );
    }
    console.log("Summary: benchmark-runs/real-mvp-summary.json");
    return;
  }
  if (command === "real-validate") {
    await validateRealSuite({
      suitePath: rest[0] ?? "suites/real-mvp.json",
      cardDataPath: "../../public/card-data/cdb-rows.json",
      scriptRoot: "../../.upstream/ignis/script",
    });
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
  if (command === "run") {
    const scenarioPath = rest[0];
    if (!scenarioPath) throw new Error("Missing scenario path");
    const agentId = readFlag(rest, "--agent") ?? "random";
    const model = readFlag(rest, "--model");
    const viewer = rest.includes("--viewer");
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
    const scores = await evalSuite(suitePath, agentIds, viewer, model ? { model } : undefined);
    console.log(`Wrote ${scores.length} scores.`);
    return;
  }
  if (command === "validate") {
    const suitePath = rest[0] ?? "suites/mvp.json";
    await validateSuite(suitePath);
    return;
  }
  if (command === "inspect") {
    const tracePath = rest[0];
    if (!tracePath) throw new Error("Missing trace path");
    const raw = await readFile(resolve(tracePath), "utf8");
    for (const line of raw.trim().split("\n")) {
      const frame = JSON.parse(line) as { type: string; text?: string; chosen?: { actionId: string; reason: string } };
      if (frame.type === "engine") console.log(frame.text);
      if (frame.type === "decision") console.log(`Decision: ${frame.chosen?.actionId} - ${frame.chosen?.reason}`);
    }
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
  if (value === "random" || value === "greedy" || value === "openai") return value;
  throw new Error(`Unsupported real agent: ${value}`);
}

function readRealAgentList(args: string[], name: string, fallback: RealAgentId[]): RealAgentId[] {
  const value = readFlag(args, name);
  if (!value) return fallback;
  return value.split(",").filter(Boolean).map((agentId) => readRealAgentValue(agentId));
}

function readRealAgentValue(value: string): RealAgentId {
  if (value === "random" || value === "greedy" || value === "openai") return value;
  throw new Error(`Unsupported real agent: ${value}`);
}

function printRunResult(result: Awaited<ReturnType<typeof runScenario>>): void {
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
  pnpm --filter @ygo-bench/app bench real-validate suites/real-mvp.json
  pnpm --filter @ygo-bench/app bench run scenarios/lethal/lethal-001.json --agent random --viewer
  pnpm --filter @ygo-bench/app bench eval suites/mvp.json --agents random,greedy,llm --model gpt-4o-mini --viewer
  pnpm --filter @ygo-bench/app bench validate suites/mvp.json
  pnpm --filter @ygo-bench/app bench inspect benchmark-runs/<run>/trace.jsonl
  pnpm --filter @ygo-bench/app bench serve-trace benchmark-runs/<run>/trace.jsonl --port 4173`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
