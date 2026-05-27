import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

export interface RealRunMetadata {
  engine: {
    adapter: "@ygo-bench/edopro-wasm";
    ocgcoreWasmVersion: string;
    ocgcoreVersion: string;
  };
  data: {
    cardDataPath: string;
    cardDataHash: string;
    cardScriptsPath: string;
    cardScriptsCommit: string | null;
    babelCdbCommit: string | null;
  };
  run: {
    scenarioId: string;
    agentId: string;
    maxDecisions: number;
    createdAt: string;
  };
}

export async function buildRealRunMetadata(args: {
  ocgcoreVersion: readonly [number, number];
  cardDataPath: string;
  scriptRoot: string;
  scenarioId: string;
  agentId: string;
  maxDecisions: number;
}): Promise<RealRunMetadata> {
  const packageJson = JSON.parse(
    await readFile(resolve("node_modules/@n1xx1/ocgcore-wasm/package.json"), "utf8"),
  ) as { version?: string };
  const cardDataPath = resolve(args.cardDataPath);
  const scriptRoot = resolve(args.scriptRoot);

  return {
    engine: {
      adapter: "@ygo-bench/edopro-wasm",
      ocgcoreWasmVersion: packageJson.version ?? "unknown",
      ocgcoreVersion: args.ocgcoreVersion.join("."),
    },
    data: {
      cardDataPath,
      cardDataHash: await sha256File(cardDataPath),
      cardScriptsPath: scriptRoot,
      cardScriptsCommit: gitCommit(scriptRoot),
      babelCdbCommit: gitCommit(resolve("../../.upstream/ignis/babelcdb")),
    },
    run: {
      scenarioId: args.scenarioId,
      agentId: args.agentId,
      maxDecisions: args.maxDecisions,
      createdAt: new Date().toISOString(),
    },
  };
}

async function sha256File(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function gitCommit(path: string): string | null {
  const result = spawnSync("git", ["-C", path, "rev-parse", "HEAD"], {
    encoding: "utf8",
  });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}
