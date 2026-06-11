import { loadRealSuite } from "./realSuite.js";
import { runRealDuel } from "./realRunner.js";
import { loadRealScenario } from "./realScenario.js";

export async function validateRealSuite(args: {
  suitePath: string;
  cardDataPath: string;
  scriptRoot: string;
}): Promise<void> {
  const suite = await loadRealSuite(args.suitePath);
  const failures: string[] = [];
  const warnings: string[] = [];

  for (const scenarioPath of suite.scenarios) {
    const scenario = await loadRealScenario(scenarioPath);
    if (scenario.horizonTurns !== undefined) {
      if (!scenario.objective) failures.push(`${scenario.id}: long-horizon scenario is missing objective`);
      if (!scenario.opponentPolicy) failures.push(`${scenario.id}: long-horizon scenario is missing opponentPolicy`);
      if (!scenario.expectedDecisionWindows?.length) failures.push(`${scenario.id}: long-horizon scenario is missing expectedDecisionWindows`);
      if (!scenario.scoring?.rationale) failures.push(`${scenario.id}: long-horizon scenario is missing scoring.rationale`);
    }
    const result = await runRealDuel({
      agentId: "oracle",
      cardDataPath: args.cardDataPath,
      scriptRoot: args.scriptRoot,
      maxDecisions: 80,
      viewer: false,
      scenarioPath,
      suiteId: suite.id,
      competitorId: "oracle",
    });
    if (result.score.decisionsTaken === 0) {
      failures.push(`${result.score.scenarioId}: real engine did not reach a decision prompt`);
    }
    if (!result.score.won && scenario.horizonTurns === undefined) {
      failures.push(`${result.score.scenarioId}: oracle did not win within validation cap`);
    } else if (!result.score.won) {
      warnings.push(`${result.score.scenarioId}: oracle did not win; accepted because this is a long-horizon strategic scenario`);
    }
    if (result.score.illegalActions > 0) {
      failures.push(`${result.score.scenarioId}: illegal action count was non-zero`);
    }
    if ((result.score.status ?? "completed") === "unsupported-prompt") {
      failures.push(`${result.score.scenarioId}: unsupported prompt during validation`);
    }
  }

  if (failures.length > 0) throw new Error(`Real suite validation failed:\n${failures.join("\n")}`);
  for (const warning of warnings) console.warn(`Warning: ${warning}`);
  console.log(`Validated ${suite.scenarios.length} real scenario(s) with ocgcore-wasm.`);
}
