import fs from "node:fs";
import path from "node:path";
import { bootstrapPvpDuel } from "../src/playtest-app/pvp-arena.js";
import { placementAwareModelClient, runPvpModelMatch } from "../src/playtest-app/pvp-model-agent.js";

interface CliOptions {
  p0Deck: string;
  p1Deck: string;
  seed: string;
  handSize: number;
  maxSteps: number;
  out?: string;
}

const options = parseArgs(process.argv.slice(2));
const p0DeckText = fs.readFileSync(options.p0Deck, "utf8");
const p1DeckText = fs.readFileSync(options.p1Deck, "utf8");
const session = bootstrapPvpDuel(p0DeckText, p1DeckText, options.seed, options.handSize);
const result = await runPvpModelMatch({
  session,
  agents: { 0: placementAwareModelClient, 1: placementAwareModelClient },
  maxSteps: options.maxSteps,
});

const report = {
  seed: options.seed,
  model: "placement-aware-mock",
  decks: { p0: options.p0Deck, p1: options.p1Deck },
  ok: result.ok,
  winner: result.finalObservation.status === "ended" ? session.state.winner : undefined,
  steps: result.history.length,
  errors: result.errors,
  history: result.history,
  finalObservation: result.finalObservation,
};

const json = `${JSON.stringify(report, null, 2)}\n`;
if (options.out) {
  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.writeFileSync(options.out, json);
} else {
  process.stdout.write(json);
}

function parseArgs(args: string[]): CliOptions {
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i];
    if (!key?.startsWith("--")) continue;
    const value = args[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    flags.set(key.slice(2), value);
    i += 1;
  }
  return {
    p0Deck: flags.get("p0-deck") ?? "top_tier_dark_magician_primite_azamina.ydk",
    p1Deck: flags.get("p1-deck") ?? "top_tier_dark_magician_primite_azamina.ydk",
    seed: flags.get("seed") ?? "pvp-model-smoke",
    handSize: numberFlag(flags, "hand-size", 5),
    maxSteps: numberFlag(flags, "max-steps", 20),
    ...(flags.get("out") === undefined ? {} : { out: flags.get("out")! }),
  };
}

function numberFlag(flags: Map<string, string>, name: string, fallback: number): number {
  const value = flags.get(name);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`--${name} must be a non-negative integer`);
  return parsed;
}
