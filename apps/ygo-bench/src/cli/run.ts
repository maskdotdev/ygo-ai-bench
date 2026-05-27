import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createAgent } from "../agents/agents.js";
import { assertNoHiddenInfoLeak } from "../core/hiddenInfo.js";
import { loadScenario } from "../core/scenario.js";
import { scoreRun } from "../core/scoring.js";
import { TraceWriter } from "../core/trace.js";
import type { AgentDecision, DecisionFrame, ScenarioScore, StepResult } from "../core/types.js";
import { MockYugiohEnv } from "../env/YugiohEnv.js";
import { writeViewerHtml } from "../viewer/html.js";

export interface RunOptions {
  scenarioPath: string;
  agentId: string;
  viewer: boolean;
  model?: string;
}

export async function runScenario(options: RunOptions): Promise<{ runDir: string; score: ScenarioScore }> {
  const scenario = await loadScenario(options.scenarioPath);
  const runDir = resolve("benchmark-runs", `run-${new Date().toISOString().replaceAll(":", "-")}-${scenario.id}-${options.agentId}`);
  const trace = new TraceWriter(runDir);
  const env = new MockYugiohEnv();
  const agent = createAgent(options.agentId, scenario, options.model ? { model: options.model } : undefined);
  let observation = await env.reset(scenario);
  assertNoHiddenInfoLeak(scenario, observation);
  let decisionsTaken = 0;
  let illegalActions = 0;
  let invalidJson = 0;
  let repeatedActions = 0;
  const seen = new Set<string>();
  const transcript: string[] = [`# ${scenario.name}`, ""];
  let finalResult: StepResult | null = null;

  while (decisionsTaken < scenario.maxDecisions) {
    const decision = await agent.chooseAction(observation);
    decisionsTaken += 1;
    if (seen.has(decision.actionId)) repeatedActions += 1;
    seen.add(decision.actionId);
    const legalIds = new Set(observation.legalActions.map((action) => action.id));
    if (!legalIds.has(decision.actionId)) illegalActions += 1;

    const decisionFrame: DecisionFrame = {
      frame: trace.frames.length + 1,
      type: "decision",
      player: observation.player,
      observation,
      legalActions: observation.legalActions,
      chosen: normalizeDecision(decision),
    };
    trace.push(decisionFrame);
    transcript.push(`## Decision ${decisionsTaken}`, "", `Chosen: \`${decision.actionId}\``, "", decision.reason, "");

    const result = await env.step(decision.actionId);
    for (const frame of result.info.engineFrames) trace.push(frame);
    observation = result.observation;
    assertNoHiddenInfoLeak(scenario, observation);
    finalResult = result;
    if (result.done) break;
  }

  if (!finalResult) {
    finalResult = {
      observation,
      reward: 0,
      done: true,
      info: { winner: null, reason: "Decision cap reached", engineFrames: [] },
    };
  }

  const score = scoreRun({
    scenario,
    agentId: agent.id,
    decisionsTaken,
    illegalActions,
    invalidJson,
    repeatedActions,
    finalResult,
  });
  await mkdir(runDir, { recursive: true });
  await trace.flush(score, transcript.join("\n"));
  if (options.viewer) await writeViewerHtml(join(runDir, "viewer.html"), trace.frames, score);
  await env.close();
  return { runDir, score };
}

function normalizeDecision(decision: AgentDecision): AgentDecision {
  if (!decision || typeof decision.actionId !== "string") {
    return { actionId: "", reason: "Invalid agent response." };
  }
  return {
    actionId: decision.actionId,
    reason: decision.reason ?? "",
  };
}
