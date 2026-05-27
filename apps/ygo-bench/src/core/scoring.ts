import type { Scenario, ScenarioScore, StepResult } from "./types.js";

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
    scenarioId: args.scenario.id,
    agentId: args.agentId,
    won,
    turnsTaken: args.finalResult.observation.turn,
    decisionsTaken: args.decisionsTaken,
    illegalActions: args.illegalActions,
    invalidJson: args.invalidJson,
    repeatedActions: args.repeatedActions,
    finalLpDelta,
    objectiveScore,
    notes: args.finalResult.info.reason ? [args.finalResult.info.reason] : [],
  };
}
