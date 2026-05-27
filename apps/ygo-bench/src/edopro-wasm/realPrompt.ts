import { loadBrowserCardDatabase } from "./cardDb.js";
import { buildRealLegalActions } from "./legalActions.js";
import { loadOcgRuntime } from "./loadOcgRuntime.js";
import { initialRealReducedState, normalizeMessages, type RealReducedState } from "./normalizedEvents.js";
import type { OcgMessage } from "./ocgTypes.js";
import { loadRealScenario } from "./realScenario.js";
import { autoRespond, createScenarioDuel, isPromptMessage, jsonReplacer } from "./realRunner.js";

export interface RealPromptOptions {
  scenarioPath: string;
  cardDataPath: string;
  scriptRoot: string;
}

export interface RealPromptResult {
  scenarioId: string;
  prompt: {
    type: string;
    player: 0 | 1;
    raw: OcgMessage;
  };
  state: RealReducedState;
  legalActions: Array<{
    id: string;
    type: string;
    label: string;
  }>;
}

export async function getFirstRealPrompt(options: RealPromptOptions): Promise<RealPromptResult> {
  const cardDb = await loadBrowserCardDatabase(options.cardDataPath);
  const scenario = await loadRealScenario(options.scenarioPath);
  const ocg = await loadOcgRuntime();
  const errors: string[] = [];
  const core = await ocg.createCore({
    sync: true,
    printErr: (line: string) => errors.push(line),
  });
  const handle = createScenarioDuel(core, ocg, scenario, cardDb, options.scriptRoot, errors);
  const state = initialRealReducedState();
  state.players[0].lp = scenario.players[0].lp;
  state.players[1].lp = scenario.players[1].lp;
  state.players[0].deckCount = scenario.players[0].deck.length;
  state.players[1].deckCount = scenario.players[1].deck.length;
  state.players[0].extraDeckCount = scenario.players[0].extra?.length ?? 0;
  state.players[1].extraDeckCount = scenario.players[1].extra?.length ?? 0;
  let frameId = 0;

  try {
    core.startDuel(handle);
    for (let frame = 0; frame < 1000; frame += 1) {
      const status = core.duelProcess(handle);
      const messages = core.duelGetMessage(handle);
      normalizeMessages({
        messages,
        ocg,
        cardDb,
        state,
        nextFrame: () => {
          frameId += 1;
          return frameId;
        },
      });

      if (status === ocg.OcgProcessResult.END) throw new Error("Duel ended before a legal-action prompt was reached.");
      if (status === ocg.OcgProcessResult.CONTINUE) continue;
      if (autoRespond(core, handle, messages, ocg)) continue;

      const prompt = [...messages].reverse().find((message) => isPromptMessage(message.type, ocg));
      const legalActions = buildRealLegalActions(prompt, ocg, cardDb);
      if (!prompt || legalActions.length === 0) {
        throw new Error("Core requested a response, but no MVP legal action builder matched the prompt.");
      }
      return {
        scenarioId: scenario.id,
        prompt: {
          type: String(ocg.OcgMessageType[prompt.type]),
          player: prompt.player === 1 ? 1 : 0,
          raw: prompt,
        },
        state,
        legalActions: legalActions.map(({ response: _response, ...action }) => action),
      };
    }
  } finally {
    core.destroyDuel(handle);
  }

  throw new Error(`No legal-action prompt reached. Engine errors: ${errors.join("; ")}`);
}

export function stringifyRealPrompt(result: RealPromptResult): string {
  return JSON.stringify(result, jsonReplacer, 2);
}
