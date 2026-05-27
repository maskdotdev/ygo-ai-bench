import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runScenario } from "./run.js";
import type { ScenarioScore } from "../core/types.js";

interface SuiteFile {
  id: string;
  scenarios: string[];
}

export async function evalSuite(suitePath: string, agentIds: string[], viewer: boolean): Promise<ScenarioScore[]> {
  const suite = JSON.parse(await readFile(resolve(suitePath), "utf8")) as SuiteFile;
  const scores: ScenarioScore[] = [];
  for (const agentId of agentIds) {
    for (const scenarioPath of suite.scenarios) {
      const result = await runScenario({ scenarioPath, agentId, viewer });
      scores.push(result.score);
      console.log(`${suite.id} ${agentId} ${result.score.scenarioId}: ${result.score.objectiveScore.toFixed(2)}`);
    }
  }
  await writeFile(resolve("benchmark-runs", `${suite.id}-summary.json`), JSON.stringify(scores, null, 2) + "\n");
  return scores;
}
