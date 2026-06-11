import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { competitorIdFor, type PromptCoverage, type ScenarioScore, type ScoreComponents, type StrategyPlan } from "../core/types.js";
import { loadBrowserCardDatabase } from "./cardDb.js";
import { buildRealLegalActions } from "./legalActions.js";
import { loadOcgRuntime } from "./loadOcgRuntime.js";
import { initialRealReducedState, normalizeMessages, type RealReducedState } from "./normalizedEvents.js";
import type { OcgCoreSync, OcgDuelHandle, OcgMessage, OcgRuntime } from "./ocgTypes.js";
import { chooseRealAgentAction, type RealAgentId } from "./realAgent.js";
import { loadRealScenario, type RealScenario } from "./realScenario.js";
import { writeRealViewerHtml } from "./realViewer.js";
import { buildRealRunMetadata } from "./runMetadata.js";
import { createScriptReader, readScriptFile } from "./scriptReader.js";

export interface RealRunOptions {
  agentId: RealAgentId;
  cardDataPath: string;
  scriptRoot: string;
  maxDecisions: number;
  viewer: boolean;
  runRoot?: string;
  scenarioPath?: string;
  model?: string;
  suiteId?: string;
  runIndex?: number;
  competitorId?: string;
}

export interface RealRunResult {
  runDir: string;
  score: ScenarioScore;
}

export async function runRealDuel(options: RealRunOptions): Promise<RealRunResult> {
  const cardDb = await loadBrowserCardDatabase(options.cardDataPath);
  const scenario = await loadRealScenario(options.scenarioPath ?? "scenarios/real/smoke-duel.json");
  const ocg = await loadOcgRuntime();
  const errors: string[] = [];
  const core = await ocg.createCore({
    sync: true,
    printErr: (line: string) => errors.push(line),
  });
  const handle = createScenarioDuel(core, ocg, scenario, cardDb, options.scriptRoot, errors);
  const maxDecisions = options.maxDecisions || scenario.maxDecisions;
  const runRoot = options.runRoot ?? process.env.YGO_BENCH_RUN_ROOT ?? "benchmark-runs";
  const runDir = resolve(runRoot, `real-run-${new Date().toISOString().replaceAll(":", "-")}-${scenario.id}-${options.agentId}`);
  const tracePath = join(runDir, "trace.jsonl");
  await mkdir(runDir, { recursive: true });
  await writeFile(tracePath, "");
  const trace: unknown[] = [];
  const pushTrace = async (...lines: unknown[]) => {
    if (lines.length === 0) return;
    trace.push(...lines);
    await appendFile(tracePath, lines.map((line) => JSON.stringify(line, jsonReplacer)).join("\n") + "\n");
  };
  const transcript: string[] = [`# ${scenario.name}`, ""];
  const reducedState = initialRealReducedState();
  reducedState.players[0].lp = scenario.players[0].lp;
  reducedState.players[1].lp = scenario.players[1].lp;
  reducedState.players[0].deckCount = scenario.players[0].deck.length;
  reducedState.players[1].deckCount = scenario.players[1].deck.length;
  reducedState.players[0].extraDeckCount = scenario.players[0].extra?.length ?? 0;
  reducedState.players[1].extraDeckCount = scenario.players[1].extra?.length ?? 0;
  let decisionsTaken = 0;
  let invalidJson = 0;
  let illegalActions = 0;
  let modelErrors = 0;
  let winner: 0 | 1 | null = null;
  let frameId = 0;
  let latencyMs = 0;
  let tokenCount = 0;
  let tokenCountSeen = false;
  let lineQuality = 0;
  let lineQualityDecisions = 0;
  let planCompleteness = 0;
  let riskAwareness = 0;
  let planDecisions = 0;
  let status: ScenarioScore["status"] = "completed";
  const promptCoverage = createPromptCoverage();

  try {
    core.startDuel(handle);
    for (let frame = 0; frame < 1000; frame += 1) {
      const processStatus = core.duelProcess(handle);
      const messages = core.duelGetMessage(handle);
      await pushTrace(
        ...messages.map((message) => ({
          type: "engine",
          message,
          typeName: String(ocg.OcgMessageType[message.type]),
        })),
      );
      const events = normalizeMessages({
        messages,
        ocg,
        cardDb,
        state: reducedState,
        nextFrame: () => {
          frameId += 1;
          return frameId;
        },
      });
      await pushTrace(...events);

      const win = messages.find((message) => message.type === ocg.OcgMessageType.WIN);
      if (win?.player === 0 || win?.player === 1) winner = win.player;
      if (reducedState.winner !== null) winner = reducedState.winner;

      if (processStatus === ocg.OcgProcessResult.END) break;
      if (processStatus === ocg.OcgProcessResult.CONTINUE) continue;
      const autoPrompt = autoRespond(core, handle, messages, ocg);
      if (autoPrompt) {
        increment(promptCoverage.autoResponses, autoPrompt);
        continue;
      }

      const prompt = [...messages].reverse().find((message) => isPromptMessage(message.type, ocg));
      const promptTypeName = prompt ? String(ocg.OcgMessageType[prompt.type]) : "UNKNOWN";
      increment(promptCoverage.seen, promptTypeName);
      const legalActions = buildRealLegalActions(prompt, ocg, cardDb);
      if (legalActions.length === 0) {
        status = "unsupported-prompt";
        increment(promptCoverage.unsupported, promptTypeName);
        await pushTrace({ type: "error", status, promptType: promptTypeName, message: "Core requested a response, but no legal action builder matched the prompt." });
        break;
      }
      increment(promptCoverage.handled, promptTypeName);

      const decisionStartedAt = Date.now();
      const chosen = await chooseRealAgentAction({
        agentId: options.agentId,
        scenario,
        state: reducedState,
        prompt,
        promptTypeName,
        legalActions,
        recentEvents: events,
        ...(options.model ? { model: options.model } : {}),
      });
      latencyMs += Date.now() - decisionStartedAt;
      invalidJson += chosen.invalidJson;
      illegalActions += chosen.illegalActions;
      modelErrors += chosen.modelErrors;
      if (chosen.rawError || chosen.reason.includes("fell back")) promptCoverage.fallbackActions += 1;
      if (chosen.tokenCount !== null) {
        tokenCount += chosen.tokenCount;
        tokenCountSeen = true;
      }
      decisionsTaken += 1;
      const decisionLineQuality = scoreLineQuality(scenario, chosen.action, legalActions);
      if (decisionLineQuality !== null) {
        lineQuality += decisionLineQuality;
        lineQualityDecisions += 1;
      }
      planCompleteness += scorePlanCompleteness(chosen.plan);
      riskAwareness += scoreRiskAwareness(chosen.plan);
      planDecisions += 1;
      transcript.push(
        `## Decision ${decisionsTaken}`,
        "",
        "### Prompt Observation",
        "",
        "```json",
        JSON.stringify(chosen.observation, null, 2),
        "```",
        "",
        "### Model Response",
        "",
        "```json",
        JSON.stringify(
          {
            actionId: chosen.action.id,
            reason: chosen.reason,
            plan: chosen.plan,
            tokenCount: chosen.tokenCount,
            invalidJson: chosen.invalidJson,
            illegalActions: chosen.illegalActions,
            modelErrors: chosen.modelErrors,
            ...(chosen.rawError ? { error: chosen.rawError } : {}),
          },
          null,
          2,
        ),
        "```",
        "",
        `Chosen: \`${chosen.action.id}\``,
        "",
        chosen.action.label,
        "",
        chosen.reason,
        "",
        "### Plan",
        "",
        renderPlan(chosen.plan),
        "",
      );
      await pushTrace({
        type: "decision",
        player: typeof prompt?.player === "number" ? prompt.player : 0,
        legalActions: legalActions.map(({ response: _response, ...action }) => action),
        chosen: {
          actionId: chosen.action.id,
          reason: chosen.reason,
          plan: chosen.plan,
          tokenCount: chosen.tokenCount,
        },
        observation: chosen.observation,
        lineQuality: decisionLineQuality,
        error: chosen.rawError,
        reducedState: structuredClone(reducedState),
      });
      core.duelSetResponse(handle, chosen.action.response);

      if (decisionsTaken >= maxDecisions) break;
    }
  } finally {
    core.destroyDuel(handle);
  }

  if (modelErrors > 0 && status === "completed") status = "model-error";
  if (decisionsTaken >= maxDecisions && winner === null && status === "completed") status = "timeout";
  const lineQualityAverage = lineQualityDecisions === 0 ? null : lineQuality / lineQualityDecisions;
  const planCompletenessAverage = planDecisions === 0 ? 0 : planCompleteness / planDecisions;
  const riskAwarenessAverage = planDecisions === 0 ? 0 : riskAwareness / planDecisions;
  const components = scoreComponents({
    scenario,
    state: reducedState,
    winner,
    lpDelta: reducedState.players[0].lp - reducedState.players[1].lp,
    lineQuality: lineQualityAverage,
    planCompleteness: planCompletenessAverage,
    riskAwareness: riskAwarenessAverage,
    decisionsTaken,
    illegalActions,
    invalidJson,
    modelErrors,
    fallbackActions: promptCoverage.fallbackActions,
    unsupportedPrompts: totalCount(promptCoverage.unsupported),
  });
  const score: ScenarioScore = {
    mode: "long-horizon-eval",
    ...(options.suiteId ? { suiteId: options.suiteId } : {}),
    scenarioId: scenario.id,
    agentId: options.agentId,
    ...(options.model ? { model: options.model } : {}),
    competitorId: options.competitorId ?? competitorIdFor(options.agentId, options.model),
    ...(typeof options.runIndex === "number" ? { runIndex: options.runIndex } : {}),
    seed: scenario.seed.map(String).join(":"),
    status,
    family: scenario.family,
    won: winner === 0,
    winner,
    turnsTaken: reducedState.turn,
    decisionsTaken,
    illegalActions,
    invalidJson,
    modelErrors,
    repeatedActions: 0,
    finalLpDelta: reducedState.players[0].lp - reducedState.players[1].lp,
    objectiveScore: components.overallScore,
    components,
    scoreWeights: scoreWeightsForScenario(scenario),
    ...(scenario.scoring?.rationale ? { scoreRationale: scenario.scoring.rationale } : {}),
    promptCoverage,
    latencyMs,
    tokenCount: tokenCountSeen ? tokenCount : null,
    notes: [
      ...errors,
      ...(modelErrors === 0 ? [] : [`modelErrors=${modelErrors}`]),
      ...(lineQualityAverage === null ? [] : [`lineQuality=${lineQualityAverage.toFixed(3)}`]),
      `status=${status}`,
    ],
  };
  await writeFile(join(runDir, "final-score.json"), JSON.stringify(score, null, 2) + "\n");
  await writeFile(
    join(runDir, "metadata.json"),
    JSON.stringify(
      await buildRealRunMetadata({
        ocgcoreVersion: core.getVersion(),
        cardDataPath: options.cardDataPath,
        scriptRoot: options.scriptRoot,
        scenarioId: score.scenarioId,
        scenarioPath: options.scenarioPath ?? "scenarios/real/smoke-duel.json",
        agentId: options.agentId,
        maxDecisions,
        ...(options.model ? { model: options.model } : {}),
        ...(score.competitorId ? { competitorId: score.competitorId } : {}),
        ...(score.mode ? { mode: score.mode } : {}),
      }),
      null,
      2,
    ) + "\n",
  );
  await writeFile(join(runDir, "reduced-state.json"), JSON.stringify(reducedState, null, 2) + "\n");
  await writeFile(join(runDir, "model-transcript.md"), transcript.join("\n"));
  await writeFile(join(runDir, "engine-messages.bin"), Buffer.from(JSON.stringify(trace, jsonReplacer)));
  if (options.viewer) await writeRealViewerHtml(join(runDir, "viewer.html"), trace, reducedState, score);
  return { runDir, score };
}

export function createScenarioDuel(
  core: OcgCoreSync,
  ocg: OcgRuntime,
  scenario: RealScenario,
  cardDb: Awaited<ReturnType<typeof loadBrowserCardDatabase>>,
  scriptRoot: string,
  errors: string[],
): OcgDuelHandle {
  const handle = core.createDuel({
    flags:
      requiredBigInt(ocg.OcgDuelMode.MODE_MR5, "MODE_MR5") |
      requiredBigInt(ocg.OcgDuelMode.PSEUDO_SHUFFLE, "PSEUDO_SHUFFLE") |
      requiredBigInt(ocg.OcgDuelMode.FIRST_TURN_DRAW, "FIRST_TURN_DRAW"),
    seed: scenario.seed.map((value) => BigInt(value)) as [bigint, bigint, bigint, bigint],
    team1: {
      startingLP: scenario.players[0].lp,
      startingDrawCount: scenario.players[0].startingDrawCount,
      drawCountPerTurn: scenario.players[0].drawCountPerTurn,
    },
    team2: {
      startingLP: scenario.players[1].lp,
      startingDrawCount: scenario.players[1].startingDrawCount,
      drawCountPerTurn: scenario.players[1].drawCountPerTurn,
    },
    cardReader: (code) => cardDb.cards.get(code) ?? null,
    scriptReader: createScriptReader(scriptRoot),
    errorHandler: (type, text) => errors.push(`${type}: ${text}`),
  });
  if (!handle) throw new Error("ocgcore-wasm failed to create a duel");
  preloadProjectIgnisScripts(core, handle, scriptRoot, errors);

  for (const [sequence, code] of scenario.players[0].deck.entries()) addDeckCard(core, handle, 0, code, sequence);
  for (const [sequence, code] of scenario.players[1].deck.entries()) addDeckCard(core, handle, 1, code, sequence);
  for (const [sequence, code] of (scenario.players[0].extra ?? []).entries()) addExtraDeckCard(core, handle, 0, code, sequence);
  for (const [sequence, code] of (scenario.players[1].extra ?? []).entries()) addExtraDeckCard(core, handle, 1, code, sequence);
  return handle;
}

function addDeckCard(core: OcgCoreSync, handle: OcgDuelHandle, player: 0 | 1, code: number, sequence: number): void {
  core.duelNewCard(handle, {
    team: player,
    duelist: 0,
    code,
    controller: player,
    location: 1,
    sequence,
    position: 8,
  });
}

function addExtraDeckCard(core: OcgCoreSync, handle: OcgDuelHandle, player: 0 | 1, code: number, sequence: number): void {
  core.duelNewCard(handle, {
    team: player,
    duelist: 0,
    code,
    controller: player,
    location: 64,
    sequence,
    position: 8,
  });
}

function preloadProjectIgnisScripts(core: OcgCoreSync, handle: OcgDuelHandle, scriptRoot: string, errors: string[]): void {
  for (const name of ["constant.lua", "utility.lua"]) {
    const content = readScriptFile(scriptRoot, name);
    if (content === null) {
      errors.push(`Missing Project Ignis preload script: ${name}`);
      continue;
    }
    const loaded = core.loadScript(handle, name, content);
    if (!loaded) errors.push(`ocgcore-wasm failed to load Project Ignis preload script: ${name}`);
  }
}

export function autoRespond(core: OcgCoreSync, handle: OcgDuelHandle, messages: OcgMessage[], ocg: OcgRuntime): string | null {
  const prompt = [...messages].reverse().find((message) => isPromptMessage(message.type, ocg));
  if (!prompt) return null;
  const promptTypeName = String(ocg.OcgMessageType[prompt.type]);
  if (prompt.type === ocg.OcgMessageType.SELECT_CHAIN) {
    const selects = Array.isArray(prompt.selects) ? prompt.selects : [];
    if (selects.length === 0) {
      core.duelSetResponse(handle, { type: ocg.OcgResponseType.SELECT_CHAIN, index: null });
      return promptTypeName;
    }
  }
  if (prompt.type === ocg.OcgMessageType.SELECT_YESNO) {
    core.duelSetResponse(handle, { type: ocg.OcgResponseType.SELECT_YESNO, yes: false });
    return promptTypeName;
  }
  return null;
}

export function isPromptMessage(type: number, ocg: OcgRuntime): boolean {
  return (
    type === ocg.OcgMessageType.SELECT_IDLECMD ||
    type === ocg.OcgMessageType.SELECT_BATTLECMD ||
    type === ocg.OcgMessageType.SELECT_CHAIN ||
    type === ocg.OcgMessageType.SELECT_CARD ||
    type === ocg.OcgMessageType.SELECT_PLACE ||
    type === ocg.OcgMessageType.SELECT_TRIBUTE ||
    type === ocg.OcgMessageType.SELECT_YESNO ||
    type === ocg.OcgMessageType.SELECT_OPTION ||
    type === ocg.OcgMessageType.SELECT_POSITION
  );
}

function requiredBigInt(value: bigint | undefined, name: string): bigint {
  if (value === undefined) throw new Error(`ocgcore-wasm missing OcgDuelMode.${name}`);
  return value;
}

export function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function scoreComponents(args: {
  scenario: RealScenario;
  state: RealReducedState;
  winner: 0 | 1 | null;
  lpDelta: number;
  lineQuality: number | null;
  planCompleteness: number;
  riskAwareness: number;
  decisionsTaken: number;
  illegalActions: number;
  invalidJson: number;
  modelErrors: number;
  fallbackActions: number;
  unsupportedPrompts: number;
}): ScoreComponents {
  const winScore = baseObjective(args.scenario, args.winner, args.lpDelta);
  const strategicProgressScore = args.lineQuality ?? winScore;
  const resourceScore = scoreResourceState(args.state);
  const adaptationScore = args.planCompleteness;
  const planConsistencyScore = args.planCompleteness;
  const riskManagementScore = args.riskAwareness;
  const decisionDenominator = Math.max(1, args.decisionsTaken);
  const executionPenalty = clamp(
    (args.illegalActions + args.invalidJson + args.modelErrors + args.fallbackActions + args.unsupportedPrompts) / decisionDenominator,
  );
  const weights = scoreWeightsForScenario(args.scenario);
  const weightTotal = weights.win + weights.strategicProgress + weights.resource + weights.adaptation + weights.planConsistency + weights.risk;
  const overallScore = clamp(
    (weights.win * winScore +
      weights.strategicProgress * strategicProgressScore +
      weights.resource * resourceScore +
      weights.adaptation * adaptationScore +
      weights.planConsistency * planConsistencyScore +
      weights.risk * riskManagementScore) /
      weightTotal -
      executionPenalty,
  );
  return {
    winScore,
    strategicProgressScore,
    resourceScore,
    adaptationScore,
    planConsistencyScore,
    riskManagementScore,
    executionPenalty,
    overallScore,
  };
}

function scoreWeightsForScenario(scenario: RealScenario): {
  win: number;
  strategicProgress: number;
  resource: number;
  adaptation: number;
  planConsistency: number;
  risk: number;
} {
  const weights = scenario.scoring?.weights ?? {};
  return {
    win: positiveWeight(weights.win, 0.3),
    strategicProgress: positiveWeight(weights.strategicProgress, 0.25),
    resource: positiveWeight(weights.resource, 0.15),
    adaptation: positiveWeight(weights.adaptation, 0.1),
    planConsistency: positiveWeight(weights.planConsistency, 0.1),
    risk: positiveWeight(weights.risk, 0.1),
  };
}

function positiveWeight(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function scoreResourceState(state: RealReducedState): number {
  const player = resourceValue(state.players[0]);
  const opponent = resourceValue(state.players[1]);
  return clamp(0.5 + (player - opponent) / 20);
}

function resourceValue(player: RealReducedState["players"][number]): number {
  return (
    player.handCount * 1.1 +
    player.monsters.length * 1.6 +
    player.spellsTraps.length * 1.2 +
    player.graveyard.length * 0.2 +
    player.banished.length * 0.1 +
    player.deckCount * 0.03 +
    player.extraDeckCount * 0.05
  );
}

function createPromptCoverage(): PromptCoverage {
  return {
    seen: {},
    handled: {},
    unsupported: {},
    autoResponses: {},
    fallbackActions: 0,
  };
}

function increment(record: Record<string, number>, key: string): void {
  record[key] = (record[key] ?? 0) + 1;
}

function totalCount(record: Record<string, number>): number {
  return Object.values(record).reduce((sum, value) => sum + value, 0);
}

function scorePlanCompleteness(plan: StrategyPlan): number {
  const parts = [
    plan.horizon.trim(),
    plan.currentGoal.trim(),
    plan.futureLine.length > 0 ? "futureLine" : "",
    plan.contingency.trim(),
  ];
  return parts.filter(Boolean).length / parts.length;
}

function scoreRiskAwareness(plan: StrategyPlan): number {
  const parts = [
    plan.resourcesToPreserve.length > 0 ? "resources" : "",
    plan.risks.length > 0 ? "risks" : "",
    plan.contingency.trim(),
  ];
  return parts.filter(Boolean).length / parts.length;
}

function renderPlan(plan: StrategyPlan): string {
  return [
    `Horizon: ${plan.horizon}`,
    `Current goal: ${plan.currentGoal}`,
    `Future line: ${plan.futureLine.length === 0 ? "none stated" : plan.futureLine.join(" -> ")}`,
    `Resources to preserve: ${plan.resourcesToPreserve.length === 0 ? "none stated" : plan.resourcesToPreserve.join(", ")}`,
    `Risks: ${plan.risks.length === 0 ? "none stated" : plan.risks.join(", ")}`,
    `Contingency: ${plan.contingency || "none stated"}`,
  ].join("\n");
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function baseObjective(scenario: RealScenario, winner: 0 | 1 | null, lpDelta: number): number {
  if (winner === 0) return 1;
  if (winner === 1) return 0;
  if (scenario.scoring?.primary === "lpDelta") return Math.max(0, Math.min(0.75, lpDelta / 8000));
  return 0;
}

function scoreLineQuality(scenario: RealScenario, action: { type: string; attack?: number }, legalActions: Array<{ type: string; attack?: number }>): number | null {
  const scoring = scenario.scoring;
  if (!scoring?.lineQualityWeight) return null;
  let score = 0;
  let components = 0;
  if (scoring.preferredActionTypes?.length) {
    components += 1;
    score += scoring.preferredActionTypes.includes(action.type) ? 1 : 0;
  }
  if (scoring.preferHighestAttack) {
    const attackActions = legalActions.filter((candidate) => typeof candidate.attack === "number");
    if (attackActions.length > 0 && typeof action.attack === "number") {
      const highest = Math.max(...attackActions.map((candidate) => candidate.attack ?? 0));
      components += 1;
      score += highest <= 0 ? 0 : action.attack / highest;
    }
  }
  return components === 0 ? null : score / components;
}
