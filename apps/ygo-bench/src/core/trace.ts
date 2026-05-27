import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ScenarioScore, TraceFrame } from "./types.js";

export class TraceWriter {
  readonly frames: TraceFrame[] = [];

  constructor(readonly runDir: string) {}

  push(frame: TraceFrame): void {
    this.frames.push(frame);
  }

  async flush(score: ScenarioScore, transcript: string): Promise<void> {
    await mkdir(this.runDir, { recursive: true });
    const tracePath = join(this.runDir, "trace.jsonl");
    await writeFile(tracePath, this.frames.map((frame) => JSON.stringify(frame)).join("\n") + "\n");
    await writeFile(join(this.runDir, "final-score.json"), JSON.stringify(score, null, 2) + "\n");
    await writeFile(join(this.runDir, "model-transcript.md"), transcript);
    await writeFile(join(this.runDir, "engine-messages.bin"), Buffer.from(JSON.stringify(this.frames)));
  }
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
