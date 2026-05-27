import { loadRealSuite } from "./realSuite.js";
import { runRealDuel } from "./realRunner.js";

export async function validateRealSuite(args: {
  suitePath: string;
  cardDataPath: string;
  scriptRoot: string;
}): Promise<void> {
  const suite = await loadRealSuite(args.suitePath);
  const failures: string[] = [];

  for (const scenarioPath of suite.scenarios) {
    const result = await runRealDuel({
      agentId: "oracle",
      cardDataPath: args.cardDataPath,
      scriptRoot: args.scriptRoot,
      maxDecisions: 4,
      viewer: false,
      scenarioPath,
    });
    if (result.score.decisionsTaken === 0) {
      failures.push(`${result.score.scenarioId}: real engine did not reach a decision prompt`);
    }
    if (result.score.illegalActions > 0) {
      failures.push(`${result.score.scenarioId}: illegal action count was non-zero`);
    }
  }

  if (failures.length > 0) throw new Error(`Real suite validation failed:\n${failures.join("\n")}`);
  console.log(`Validated ${suite.scenarios.length} real scenario(s) with ocgcore-wasm.`);
}
