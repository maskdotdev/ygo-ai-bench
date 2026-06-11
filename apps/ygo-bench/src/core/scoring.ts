import { competitorIdFor, type Scenario, type ScenarioScore, type StepResult } from "./types.js";

export function scoreRun(args: {
  scenario: Scenario;
  agentId: string;
  decisionsTaken: number;
  illegalActions: number;
  invalidJson: number;
  repeatedActions: number;
  finalResult: StepResult;
}): ScenarioScore {
  const player = 0;
  const opponent = 1;
  const finalState = args.finalResult.observation.publicState;
  const finalLpDelta = finalState.players[player].lp - finalState.players[opponent].lp;
  const won = args.finalResult.info.winner === player;
  const lost = args.finalResult.info.winner === opponent;
  const objectiveScore = won ? 1 : lost ? 0 : Math.max(0, Math.min(0.75, finalLpDelta / 8000));

  return {
    mode: "mock-eval",
    scenarioId: args.scenario.id,
    agentId: args.agentId,
    competitorId: competitorIdFor(args.agentId),
    status: "completed",
    family: args.scenario.family,
    won,
    winner: args.finalResult.info.winner ?? null,
    turnsTaken: args.finalResult.observation.turn,
    decisionsTaken: args.decisionsTaken,
    illegalActions: args.illegalActions,
    invalidJson: args.invalidJson,
    modelErrors: 0,
    repeatedActions: args.repeatedActions,
    finalLpDelta,
    objectiveScore,
    scoreWeights: {
      win: 1,
      strategicProgress: 0,
      resource: 0,
      adaptation: 0,
      planConsistency: 0,
      risk: 0,
    },
    scoreRationale: "Mock scenarios use their legacy objective score as the only benchmark score.",
    components: {
      winScore: objectiveScore,
      strategicProgressScore: objectiveScore,
      resourceScore: Math.max(0, Math.min(1, 0.5 + finalLpDelta / 16000)),
      adaptationScore: 0,
      planConsistencyScore: 0,
      riskManagementScore: 0,
      executionPenalty: args.illegalActions + args.invalidJson + args.repeatedActions > 0 ? 1 : 0,
      overallScore: objectiveScore,
    },
    promptCoverage: {
      seen: {},
      handled: {},
      unsupported: {},
      autoResponses: {},
      fallbackActions: args.invalidJson,
    },
    latencyMs: 0,
    tokenCount: null,
    notes: args.finalResult.info.reason ? [args.finalResult.info.reason] : [],
  };
}
