import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ScenarioScore } from "../core/types.js";
import { jsonReplacer } from "../edopro-wasm/realRunner.js";
import { buildRealRunMetadata } from "../edopro-wasm/runMetadata.js";
import type { PlayOpponentAgent } from "./playTypes.js";

export interface PlayArtifactWriter {
  runDir: string;
  trace: unknown[];
  transcript: string[];
  pushTrace(...lines: unknown[]): Promise<void>;
  writeFinal(args: {
    score: ScenarioScore;
    reducedState: unknown;
    metadata: {
      ocgcoreVersion: readonly [number, number];
      cardDataPath: string;
      scriptRoot: string;
      scenarioId: string;
      scenarioPath: string;
      maxDecisions: number;
      humanPlayer: 0 | 1;
      opponentAgent: PlayOpponentAgent;
      model?: string;
    };
  }): Promise<void>;
}

export async function createPlayArtifactWriter(args: {
  scenarioId: string;
  scenarioName: string;
  opponentAgent: PlayOpponentAgent;
}): Promise<PlayArtifactWriter> {
  const runDir = resolve("benchmark-runs", `play-${new Date().toISOString().replaceAll(":", "-")}-${args.scenarioId}-${args.opponentAgent}`);
  const tracePath = join(runDir, "trace.jsonl");
  await mkdir(runDir, { recursive: true });
  await writeFile(tracePath, "");
  const trace: unknown[] = [];
  const transcript = [`# ${args.scenarioName}`, "", "Mode: human-vs-agent", ""];
  return {
    runDir,
    trace,
    transcript,
    async pushTrace(...lines) {
      if (lines.length === 0) return;
      trace.push(...lines);
      await appendFile(tracePath, lines.map((line) => JSON.stringify(line, jsonReplacer)).join("\n") + "\n");
    },
    async writeFinal({ score, reducedState, metadata }) {
      await writeFile(join(runDir, "final-score.json"), JSON.stringify(score, null, 2) + "\n");
      await writeFile(join(runDir, "reduced-state.json"), JSON.stringify(reducedState, null, 2) + "\n");
      await writeFile(join(runDir, "model-transcript.md"), transcript.join("\n"));
      await writeFile(join(runDir, "engine-messages.bin"), Buffer.from(JSON.stringify(trace, jsonReplacer)));
      const base = await buildRealRunMetadata({
        ocgcoreVersion: metadata.ocgcoreVersion,
        cardDataPath: metadata.cardDataPath,
        scriptRoot: metadata.scriptRoot,
        scenarioId: metadata.scenarioId,
        scenarioPath: metadata.scenarioPath,
        agentId: metadata.opponentAgent,
        maxDecisions: metadata.maxDecisions,
      });
      await writeFile(
        join(runDir, "metadata.json"),
        JSON.stringify(
          {
            ...base,
            mode: "human-vs-agent",
            humanPlayer: metadata.humanPlayer,
            opponentAgent: metadata.opponentAgent,
            ...(metadata.model ? { model: metadata.model } : {}),
          },
          null,
          2,
        ) + "\n",
      );
    },
  };
}
