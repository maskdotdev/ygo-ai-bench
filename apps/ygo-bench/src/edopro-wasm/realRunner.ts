import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ScenarioScore } from "../core/types.js";
import { loadBrowserCardDatabase } from "./cardDb.js";
import { buildRealLegalActions, type RealLegalAction } from "./legalActions.js";
import { loadOcgRuntime } from "./loadOcgRuntime.js";
import { initialRealReducedState, normalizeMessages } from "./normalizedEvents.js";
import type { OcgCoreSync, OcgDuelHandle, OcgMessage, OcgRuntime } from "./ocgTypes.js";
import { writeRealViewerHtml } from "./realViewer.js";
import { createScriptReader } from "./scriptReader.js";

export interface RealRunOptions {
  agentId: "random" | "greedy";
  cardDataPath: string;
  scriptRoot: string;
  maxDecisions: number;
  viewer: boolean;
}

export interface RealRunResult {
  runDir: string;
  score: ScenarioScore;
}

export async function runRealDuel(options: RealRunOptions): Promise<RealRunResult> {
  const cardDb = await loadBrowserCardDatabase(options.cardDataPath);
  const ocg = await loadOcgRuntime();
  const errors: string[] = [];
  const core = await ocg.createCore({
    sync: true,
    printErr: (line: string) => errors.push(line),
  });
  const handle = createTinyDuel(core, ocg, cardDb, options.scriptRoot, errors);
  const runDir = resolve("benchmark-runs", `real-run-${new Date().toISOString().replaceAll(":", "-")}-${options.agentId}`);
  const trace: unknown[] = [];
  const transcript: string[] = ["# Real ocgcore-wasm duel", ""];
  const reducedState = initialRealReducedState();
  reducedState.players[0].deckCount = 8;
  reducedState.players[1].deckCount = 8;
  let decisionsTaken = 0;
  let winner: 0 | 1 | null = null;
  let frameId = 0;

  try {
    core.startDuel(handle);
    for (let frame = 0; frame < 1000; frame += 1) {
      const status = core.duelProcess(handle);
      const messages = core.duelGetMessage(handle);
      trace.push(
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
      trace.push(...events);

      const win = messages.find((message) => message.type === ocg.OcgMessageType.WIN);
      if (win?.player === 0 || win?.player === 1) winner = win.player;
      if (reducedState.winner !== null) winner = reducedState.winner;

      if (status === ocg.OcgProcessResult.END) break;
      if (status === ocg.OcgProcessResult.CONTINUE) continue;
      if (autoRespond(core, handle, messages, ocg)) continue;

      const prompt = [...messages].reverse().find((message) => isPromptMessage(message.type, ocg));
      const legalActions = buildRealLegalActions(prompt, ocg, cardDb);
      if (legalActions.length === 0) {
        trace.push({ type: "error", message: "Core requested a response, but no MVP legal action builder matched the prompt." });
        break;
      }

      const chosen = chooseRealAction(legalActions, options.agentId);
      decisionsTaken += 1;
      transcript.push(`## Decision ${decisionsTaken}`, "", `Chosen: \`${chosen.id}\``, "", chosen.label, "");
      trace.push({
        type: "decision",
        player: typeof prompt?.player === "number" ? prompt.player : 0,
        legalActions: legalActions.map(({ response: _response, ...action }) => action),
        chosen: {
          actionId: chosen.id,
          reason: `${options.agentId} selected ${chosen.label}`,
        },
        reducedState: structuredClone(reducedState),
      });
      core.duelSetResponse(handle, chosen.response);

      if (decisionsTaken >= options.maxDecisions) break;
    }
  } finally {
    core.destroyDuel(handle);
  }

  await mkdir(runDir, { recursive: true });
  const score: ScenarioScore = {
    scenarioId: "real-smoke-duel",
    agentId: options.agentId,
    won: winner === 0,
    turnsTaken: reducedState.turn,
    decisionsTaken,
    illegalActions: 0,
    invalidJson: 0,
    repeatedActions: 0,
    finalLpDelta: reducedState.players[0].lp - reducedState.players[1].lp,
    objectiveScore: winner === 0 ? 1 : 0,
    notes: errors,
  };
  await writeFile(join(runDir, "trace.jsonl"), trace.map((line) => JSON.stringify(line, jsonReplacer)).join("\n") + "\n");
  await writeFile(join(runDir, "final-score.json"), JSON.stringify(score, null, 2) + "\n");
  await writeFile(join(runDir, "reduced-state.json"), JSON.stringify(reducedState, null, 2) + "\n");
  await writeFile(join(runDir, "model-transcript.md"), transcript.join("\n"));
  await writeFile(join(runDir, "engine-messages.bin"), Buffer.from(JSON.stringify(trace, jsonReplacer)));
  if (options.viewer) await writeRealViewerHtml(join(runDir, "viewer.html"), trace, reducedState, score);
  return { runDir, score };
}

function createTinyDuel(
  core: OcgCoreSync,
  ocg: OcgRuntime,
  cardDb: Awaited<ReturnType<typeof loadBrowserCardDatabase>>,
  scriptRoot: string,
  errors: string[],
): OcgDuelHandle {
  const handle = core.createDuel({
    flags:
      requiredBigInt(ocg.OcgDuelMode.MODE_MR5, "MODE_MR5") |
      requiredBigInt(ocg.OcgDuelMode.PSEUDO_SHUFFLE, "PSEUDO_SHUFFLE") |
      requiredBigInt(ocg.OcgDuelMode.FIRST_TURN_DRAW, "FIRST_TURN_DRAW"),
    seed: [1n, 1n, 1n, 1n],
    team1: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
    team2: { startingLP: 8000, startingDrawCount: 5, drawCountPerTurn: 1 },
    cardReader: (code) => cardDb.cards.get(code) ?? null,
    scriptReader: createScriptReader(scriptRoot),
    errorHandler: (type, text) => errors.push(`${type}: ${text}`),
  });
  if (!handle) throw new Error("ocgcore-wasm failed to create a duel");

  const playerDeck = [89631139, 46986414, 49003308, 70781052, 89631139, 46986414, 49003308, 70781052];
  const opponentDeck = [70781052, 49003308, 46986414, 89631139, 70781052, 49003308, 46986414, 89631139];
  for (const [sequence, code] of playerDeck.entries()) addDeckCard(core, handle, 0, code, sequence);
  for (const [sequence, code] of opponentDeck.entries()) addDeckCard(core, handle, 1, code, sequence);
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

function chooseRealAction(actions: RealLegalAction[], agentId: "random" | "greedy"): RealLegalAction {
  if (agentId === "random") return actions[Math.floor(Math.random() * actions.length)] ?? actions[0]!;
  return (
    actions.find((action) => action.type === "normal_summon") ??
    actions.find((action) => action.type === "to_battle") ??
    actions.find((action) => action.type === "end_phase") ??
    actions[0]!
  );
}

function autoRespond(core: OcgCoreSync, handle: OcgDuelHandle, messages: OcgMessage[], ocg: OcgRuntime): boolean {
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

function isPromptMessage(type: number, ocg: OcgRuntime): boolean {
  return (
    type === ocg.OcgMessageType.SELECT_IDLECMD ||
    type === ocg.OcgMessageType.SELECT_BATTLECMD ||
    type === ocg.OcgMessageType.SELECT_CHAIN ||
    type === ocg.OcgMessageType.SELECT_CARD ||
    type === ocg.OcgMessageType.SELECT_PLACE ||
    type === ocg.OcgMessageType.SELECT_YESNO ||
    type === ocg.OcgMessageType.SELECT_OPTION
  );
}

function requiredBigInt(value: bigint | undefined, name: string): bigint {
  if (value === undefined) throw new Error(`ocgcore-wasm missing OcgDuelMode.${name}`);
  return value;
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
