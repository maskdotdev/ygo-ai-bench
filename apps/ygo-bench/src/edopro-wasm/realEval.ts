import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ScenarioScore } from "../core/types.js";
import { runRealDuel } from "./realRunner.js";

export interface RealEvalOptions {
  agentIds: Array<"random" | "greedy">;
  runsPerAgent: number;
  maxDecisions: number;
  viewer: boolean;
  cardDataPath: string;
  scriptRoot: string;
}

export interface RealEvalSummary {
  suiteId: "real-mvp";
  generatedAt: string;
  scores: ScenarioScore[];
  aggregate: Array<{
    agentId: string;
    runs: number;
    winRate: number;
    averageScore: number;
    averageDecisions: number;
    averageLpDelta: number;
  }>;
}

export async function evalRealSuite(options: RealEvalOptions): Promise<RealEvalSummary> {
  const scores: ScenarioScore[] = [];
  for (const agentId of options.agentIds) {
    for (let run = 0; run < options.runsPerAgent; run += 1) {
      const result = await runRealDuel({
        agentId,
        cardDataPath: options.cardDataPath,
        scriptRoot: options.scriptRoot,
        maxDecisions: options.maxDecisions,
        viewer: options.viewer,
      });
      scores.push(result.score);
      console.log(`real-mvp ${agentId} run ${run + 1}: score=${result.score.objectiveScore.toFixed(2)} decisions=${result.score.decisionsTaken}`);
    }
  }

  const summary: RealEvalSummary = {
    suiteId: "real-mvp",
    generatedAt: new Date().toISOString(),
    scores,
    aggregate: aggregateScores(scores),
  };
  await mkdir(resolve("benchmark-runs"), { recursive: true });
  await writeFile(resolve("benchmark-runs", "real-mvp-summary.json"), JSON.stringify(summary, null, 2) + "\n");
  return summary;
}

function aggregateScores(scores: ScenarioScore[]): RealEvalSummary["aggregate"] {
  const agentIds = [...new Set(scores.map((score) => score.agentId))];
  return agentIds.map((agentId) => {
    const agentScores = scores.filter((score) => score.agentId === agentId);
    return {
      agentId,
      runs: agentScores.length,
      winRate: average(agentScores.map((score) => (score.won ? 1 : 0))),
      averageScore: average(agentScores.map((score) => score.objectiveScore)),
      averageDecisions: average(agentScores.map((score) => score.decisionsTaken)),
      averageLpDelta: average(agentScores.map((score) => score.finalLpDelta)),
    };
  });
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
