import type { Agent, AgentDecision, Observation, Scenario } from "../core/types.js";
import { createOpenAiAgentFromEnv } from "./openaiAgent.js";

export function createAgent(id: string, scenario?: Scenario): Agent {
  if (id === "random") return new RandomAgent();
  if (id === "greedy") return new GreedyAgent();
  if (id === "oracle") return new OracleAgent(scenario);
  if (id === "llm") return new LlmStubAgent();
  if (id === "openai") return createOpenAiAgentFromEnv();
  throw new Error(`Unknown agent: ${id}`);
}

class RandomAgent implements Agent {
  id = "random";

  async chooseAction(observation: Observation): Promise<AgentDecision> {
    const action = observation.legalActions[Math.floor(Math.random() * observation.legalActions.length)];
    if (!action) throw new Error("No legal actions available");
    return { actionId: action.id, reason: "Random legal baseline." };
  }
}

class GreedyAgent implements Agent {
  id = "greedy";

  async chooseAction(observation: Observation): Promise<AgentDecision> {
    const ranked =
      observation.legalActions.find((action) => /lethal|attack for game|win/i.test(action.label)) ??
      observation.legalActions.find((action) => action.type === "activate_effect") ??
      observation.legalActions.find((action) => action.type === "normal_summon") ??
      observation.legalActions.find((action) => action.type === "attack") ??
      observation.legalActions[0];
    if (!ranked) throw new Error("No legal actions available");
    return { actionId: ranked.id, reason: "Greedy priority selected the strongest visible action." };
  }
}

class OracleAgent implements Agent {
  id = "oracle";
  private index = 0;

  constructor(private readonly scenario?: Scenario) {}

  async chooseAction(observation: Observation): Promise<AgentDecision> {
    const scripted = this.scenario?.oracle[this.index];
    this.index += 1;
    const fallback = observation.legalActions[0]?.id;
    const actionId = scripted ?? fallback;
    if (!actionId) throw new Error("No legal actions available");
    return { actionId, reason: "Scripted oracle solution." };
  }
}

class LlmStubAgent implements Agent {
  id = "llm";

  async chooseAction(observation: Observation): Promise<AgentDecision> {
    const action =
      observation.legalActions.find((candidate) => /preserve|resource/i.test(candidate.label)) ??
      observation.legalActions.find(
        (candidate) => candidate.type === "activate_effect" && /bait|force response|remove negation/i.test(candidate.label),
      ) ??
      observation.legalActions.find((candidate) => /lethal|attack for game|win/i.test(candidate.label)) ??
      observation.legalActions.find((candidate) => candidate.type === "activate_effect") ??
      observation.legalActions[0];
    if (!action) throw new Error("No legal actions available");
    return {
      actionId: action.id,
      reason: "LLM stub chose the action with the best strategic label. Replace with OpenAI adapter.",
    };
  }
}
