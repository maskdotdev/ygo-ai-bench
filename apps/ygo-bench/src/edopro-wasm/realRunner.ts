import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ScenarioScore } from "../core/types.js";
import { loadBrowserCardDatabase } from "./cardDb.js";
import { buildRealLegalActions } from "./legalActions.js";
import { loadOcgRuntime } from "./loadOcgRuntime.js";
import { initialRealReducedState, normalizeMessages } from "./normalizedEvents.js";
import type { OcgCoreSync, OcgDuelHandle, OcgMessage, OcgRuntime } from "./ocgTypes.js";
import { chooseRealAgentAction, type RealAgentId } from "./realAgent.js";
import { loadRealScenario, type RealScenario } from "./realScenario.js";
import { writeRealViewerHtml } from "./realViewer.js";
import { buildRealRunMetadata } from "./runMetadata.js";
import { createScriptReader } from "./scriptReader.js";

export interface RealRunOptions {
  agentId: RealAgentId;
  cardDataPath: string;
  scriptRoot: string;
  maxDecisions: number;
  viewer: boolean;
  scenarioPath?: string;
  model?: string;
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
  const runDir = resolve("benchmark-runs", `real-run-${new Date().toISOString().replaceAll(":", "-")}-${scenario.id}-${options.agentId}`);
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

  try {
    core.startDuel(handle);
    for (let frame = 0; frame < 1000; frame += 1) {
      const status = core.duelProcess(handle);
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

      if (status === ocg.OcgProcessResult.END) break;
      if (status === ocg.OcgProcessResult.CONTINUE) continue;
      if (autoRespond(core, handle, messages, ocg)) continue;

      const prompt = [...messages].reverse().find((message) => isPromptMessage(message.type, ocg));
      const legalActions = buildRealLegalActions(prompt, ocg, cardDb);
      if (legalActions.length === 0) {
        await pushTrace({ type: "error", message: "Core requested a response, but no MVP legal action builder matched the prompt." });
        break;
      }

      const decisionStartedAt = Date.now();
      const chosen = await chooseRealAgentAction({
        agentId: options.agentId,
        scenario,
        state: reducedState,
        prompt,
        promptTypeName: prompt ? String(ocg.OcgMessageType[prompt.type]) : "UNKNOWN",
        legalActions,
        recentEvents: events,
        ...(options.model ? { model: options.model } : {}),
      });
      latencyMs += Date.now() - decisionStartedAt;
      invalidJson += chosen.invalidJson;
      illegalActions += chosen.illegalActions;
      modelErrors += chosen.modelErrors;
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
      transcript.push(`## Decision ${decisionsTaken}`, "", `Chosen: \`${chosen.action.id}\``, "", chosen.action.label, "", chosen.reason, "");
      await pushTrace({
        type: "decision",
        player: typeof prompt?.player === "number" ? prompt.player : 0,
        legalActions: legalActions.map(({ response: _response, ...action }) => action),
        chosen: {
          actionId: chosen.action.id,
          reason: chosen.reason,
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

  const score: ScenarioScore = {
    scenarioId: scenario.id,
    agentId: options.agentId,
    family: scenario.family,
    won: winner === 0,
    turnsTaken: reducedState.turn,
    decisionsTaken,
    illegalActions,
    invalidJson,
    modelErrors,
    repeatedActions: 0,
    finalLpDelta: reducedState.players[0].lp - reducedState.players[1].lp,
    objectiveScore: scoreObjective(
      scenario,
      winner,
      reducedState.players[0].lp - reducedState.players[1].lp,
      lineQualityDecisions === 0 ? null : lineQuality / lineQualityDecisions,
    ),
    latencyMs,
    tokenCount: tokenCountSeen ? tokenCount : null,
    notes: [
      ...errors,
      ...(modelErrors === 0 ? [] : [`modelErrors=${modelErrors}`]),
      ...(lineQualityDecisions === 0 ? [] : [`lineQuality=${(lineQuality / lineQualityDecisions).toFixed(3)}`]),
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

  for (const [sequence, code] of scenario.players[0].deck.entries()) addDeckCard(core, handle, 0, code, sequence);
  for (const [sequence, code] of scenario.players[1].deck.entries()) addDeckCard(core, handle, 1, code, sequence);
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

export function autoRespond(core: OcgCoreSync, handle: OcgDuelHandle, messages: OcgMessage[], ocg: OcgRuntime): boolean {
  const prompt = [...messages].reverse().find((message) => isPromptMessage(message.type, ocg));
  if (!prompt) return false;
  if (prompt.type === ocg.OcgMessageType.SELECT_CHAIN) {
    const selects = Array.isArray(prompt.selects) ? prompt.selects : [];
    if (prompt.forced !== true || selects.length === 0) {
      core.duelSetResponse(handle, { type: ocg.OcgResponseType.SELECT_CHAIN, index: null });
      return true;
    }
  }
  if (prompt.type === ocg.OcgMessageType.SELECT_YESNO) {
    core.duelSetResponse(handle, { type: ocg.OcgResponseType.SELECT_YESNO, yes: false });
    return true;
  }
  return false;
}

export function isPromptMessage(type: number, ocg: OcgRuntime): boolean {
  return (
    type === ocg.OcgMessageType.SELECT_IDLECMD ||
    type === ocg.OcgMessageType.SELECT_BATTLECMD ||
    type === ocg.OcgMessageType.SELECT_CHAIN ||
    type === ocg.OcgMessageType.SELECT_CARD ||
    type === ocg.OcgMessageType.SELECT_PLACE ||
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

function scoreObjective(scenario: RealScenario, winner: 0 | 1 | null, lpDelta: number, lineQuality: number | null): number {
  const base = baseObjective(scenario, winner, lpDelta);
  const weight = scenario.scoring?.lineQualityWeight ?? 0;
  if (weight === 0 || lineQuality === null) return base;
  return Math.max(0, Math.min(1, base * (1 - weight) + lineQuality * weight));
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
