import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadBrowserCardDatabase, type CardDatabase } from "./cardDb.js";
import { buildRealLegalActions } from "./legalActions.js";
import { loadOcgRuntime } from "./loadOcgRuntime.js";
import type { OcgCoreSync, OcgDuelHandle, OcgMessage, OcgRuntime } from "./ocgTypes.js";
import { buildRealRunMetadata } from "./runMetadata.js";
import { createScriptReader } from "./scriptReader.js";

export interface RealSmokeOptions {
  cardDataPath: string;
  scriptRoot: string;
  outPath: string;
}

export interface RealSmokeResult {
  version: readonly [number, number];
  status: number;
  messageCount: number;
  promptType?: string;
  outPath: string;
}

export async function runRealEngineSmoke(options: RealSmokeOptions): Promise<RealSmokeResult> {
  const cardDb = await loadBrowserCardDatabase(options.cardDataPath);
  const ocg = await loadOcgRuntime();
  const errors: string[] = [];
  const core = await ocg.createCore({
    sync: true,
    printErr: (line: string) => errors.push(line),
  });
  const scriptReader = createScriptReader(options.scriptRoot);
  const flags =
    requiredBigInt(ocg.OcgDuelMode.MODE_MR5, "MODE_MR5") |
    requiredBigInt(ocg.OcgDuelMode.PSEUDO_SHUFFLE, "PSEUDO_SHUFFLE") |
    requiredBigInt(ocg.OcgDuelMode.FIRST_TURN_DRAW, "FIRST_TURN_DRAW");
  const handle = core.createDuel({
    flags,
    seed: [1n, 1n, 1n, 1n],
    team1: {
      drawCountPerTurn: 1,
      startingDrawCount: 5,
      startingLP: 8000,
    },
    team2: {
      drawCountPerTurn: 1,
      startingDrawCount: 5,
      startingLP: 8000,
    },
    cardReader: (code) => cardDb.cards.get(code) ?? null,
    scriptReader,
    errorHandler: (type: unknown, text: string) => errors.push(`${type}: ${text}`),
  });

  if (!handle) throw new Error("ocgcore-wasm failed to create a duel");

  try {
    addTinyDeck(core, handle);
    core.startDuel(handle);
    const messages: OcgMessage[] = [];
    let status = ocg.OcgProcessResult.CONTINUE;
    for (let i = 0; i < 200; i += 1) {
      status = core.duelProcess(handle);
      const batch = core.duelGetMessage(handle);
      messages.push(...batch);
      if (status === ocg.OcgProcessResult.WAITING && autoRespond(core, handle, batch, ocg)) {
        continue;
      }
      if (status === ocg.OcgProcessResult.WAITING || status === ocg.OcgProcessResult.END) break;
    }

    const prompt = [...messages].reverse().find((message) => isPromptMessage(message.type, ocg));
    const legalActions = buildRealLegalActions(prompt, ocg, cardDb);
    const outPath = resolve(options.outPath);
    await writeFile(
      outPath,
      JSON.stringify(
        {
          version: core.getVersion(),
          status,
          promptType: prompt ? ocg.OcgMessageType[prompt.type] : undefined,
          legalActions: legalActions.map(({ response: _response, ...action }) => action),
          errors,
          messages: messages.map((message) => annotateMessage(message, cardDb, ocg)),
        },
        (_, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
        2,
      ) + "\n",
    );
    await writeFile(
      resolve("benchmark-runs/real-smoke-metadata.json"),
      JSON.stringify(
        await buildRealRunMetadata({
          ocgcoreVersion: core.getVersion(),
          cardDataPath: options.cardDataPath,
          scriptRoot: options.scriptRoot,
          scenarioId: "real-smoke",
          agentId: "none",
          maxDecisions: 0,
        }),
        null,
        2,
      ) + "\n",
    );

    const result: RealSmokeResult = {
      version: core.getVersion(),
      status: status ?? -1,
      messageCount: messages.length,
      outPath,
    };
    if (prompt) result.promptType = String(ocg.OcgMessageType[prompt.type]);
    return result;
  } finally {
    core.destroyDuel(handle);
  }
}

function requiredBigInt(value: bigint | undefined, name: string): bigint {
  if (value === undefined) throw new Error(`ocgcore-wasm missing OcgDuelMode.${name}`);
  return value;
}

function autoRespond(core: OcgCoreSync, handle: OcgDuelHandle, messages: OcgMessage[], ocg: OcgRuntime): boolean {
  const prompt = [...messages].reverse().find((message) => isPromptMessage(message.type, ocg));
  if (!prompt) return false;

  if (prompt.type === ocg.OcgMessageType.SELECT_CHAIN) {
    const selects = Array.isArray(prompt.selects) ? prompt.selects : [];
    const forced = prompt.forced === true;
    if (!forced || selects.length === 0) {
      core.duelSetResponse(handle, {
        type: ocg.OcgResponseType.SELECT_CHAIN,
        index: null,
      });
      return true;
    }
  }

  if (prompt.type === ocg.OcgMessageType.SELECT_YESNO) {
    core.duelSetResponse(handle, {
      type: ocg.OcgResponseType.SELECT_YESNO,
      yes: false,
    });
    return true;
  }

  return false;
}

function addTinyDeck(core: OcgCoreSync, handle: OcgDuelHandle): void {
  const location = { deck: 1 };
  const position = { facedownDefense: 8 };
  const playerDeck = [89631139, 46986414, 49003308, 70781052, 89631139, 46986414];
  const opponentDeck = [70781052, 49003308, 46986414, 89631139, 70781052, 49003308];

  for (const [sequence, code] of playerDeck.entries()) {
    core.duelNewCard(handle, {
      team: 0,
      duelist: 0,
      code,
      controller: 0,
      location: location.deck,
      sequence,
      position: position.facedownDefense,
    });
  }
  for (const [sequence, code] of opponentDeck.entries()) {
    core.duelNewCard(handle, {
      team: 1,
      duelist: 0,
      code,
      controller: 1,
      location: location.deck,
      sequence,
      position: position.facedownDefense,
    });
  }
}

function isPromptMessage(type: number, ocg: OcgRuntime): boolean {
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

function annotateMessage(message: OcgMessage, cardDb: CardDatabase, ocg: OcgRuntime): unknown {
  return {
    ...message,
    typeName: ocg.OcgMessageType[message.type],
    cardNames: collectCodes(message).map((code) => ({ code, name: cardDb.names.get(code) ?? `#${code}` })),
  };
}

function collectCodes(value: unknown): number[] {
  if (typeof value !== "object" || value === null) return [];
  const codes = new Set<number>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const record = node as Record<string, unknown>;
    if (typeof record.code === "number" && record.code > 0) codes.add(record.code);
    for (const child of Object.values(record)) visit(child);
  };
  visit(value);
  return [...codes];
}
