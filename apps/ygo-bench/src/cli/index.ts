import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evalSuite } from "./eval.js";
import { runScenario } from "./run.js";
import { validateSuite } from "./validate.js";
import { runRealEngineSmoke } from "../edopro-wasm/EdoproWasmAdapter.js";

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
  if (command === "run") {
    const scenarioPath = rest[0];
    if (!scenarioPath) throw new Error("Missing scenario path");
    const agentId = readFlag(rest, "--agent") ?? "random";
    const viewer = rest.includes("--viewer");
    const result = await runScenario({ scenarioPath, agentId, viewer });
    printRunResult(result);
    return;
  }
  if (command === "eval") {
    const suitePath = rest[0];
    if (!suitePath) throw new Error("Missing suite path");
    const agentIds = (readFlag(rest, "--agents") ?? "random").split(",").filter(Boolean);
    const viewer = rest.includes("--viewer");
    const scores = await evalSuite(suitePath, agentIds, viewer);
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
  pnpm --filter @ygo-bench/app bench run scenarios/lethal/lethal-001.json --agent random --viewer
  pnpm --filter @ygo-bench/app bench eval suites/mvp.json --agents random,greedy,llm --viewer
  pnpm --filter @ygo-bench/app bench validate suites/mvp.json
  pnpm --filter @ygo-bench/app bench inspect benchmark-runs/<run>/trace.jsonl`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
