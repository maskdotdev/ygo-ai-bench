import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runScenario } from "./run.js";

interface SuiteFile {
  id: string;
  scenarios: string[];
}

export async function validateSuite(suitePath: string): Promise<void> {
  const suite = JSON.parse(await readFile(resolve(suitePath), "utf8")) as SuiteFile;
  const failures: string[] = [];

  for (const scenarioPath of suite.scenarios) {
    const result = await runScenario({ scenarioPath, agentId: "oracle", viewer: false });
    if (!result.score.won) {
      failures.push(`${result.score.scenarioId}: oracle did not win`);
    }
    if (result.score.illegalActions > 0) {
      failures.push(`${result.score.scenarioId}: oracle selected illegal action`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Suite validation failed:\n${failures.join("\n")}`);
  }

  console.log(`Validated ${suite.scenarios.length} scenarios with oracle agent.`);
}
