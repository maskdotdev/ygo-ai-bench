import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface RealScenarioPlayer {
  lp: number;
  startingDrawCount: number;
  drawCountPerTurn: number;
  deck: number[];
  extra?: number[];
}

export interface RealScenario {
  id: string;
  name: string;
  family: "smoke" | "lethal" | "interruption" | "resource";
  version: string;
  seed: [number, number, number, number];
  maxDecisions: number;
  players: [RealScenarioPlayer, RealScenarioPlayer];
  scoring?: {
    primary?: "win" | "lpDelta";
  };
}

export async function loadRealScenario(path: string): Promise<RealScenario> {
  const scenario = JSON.parse(await readFile(resolve(path), "utf8")) as RealScenario;
  validateRealScenario(scenario, path);
  return scenario;
}

export function validateRealScenario(scenario: RealScenario, path = "real scenario"): void {
  if (!scenario.id) throw new Error(`${path}: missing id`);
  if (!scenario.name) throw new Error(`${path}: missing name`);
  if (!Array.isArray(scenario.seed) || scenario.seed.length !== 4 || scenario.seed.every((value) => value === 0)) {
    throw new Error(`${path}: seed must be four non-zero-safe numbers`);
  }
  if (!Array.isArray(scenario.players) || scenario.players.length !== 2) {
    throw new Error(`${path}: expected two players`);
  }
  for (const [index, player] of scenario.players.entries()) {
    if (!Number.isInteger(player.lp) || player.lp <= 0) throw new Error(`${path}: player ${index} must have positive lp`);
    if (!Array.isArray(player.deck) || player.deck.length === 0) throw new Error(`${path}: player ${index} must have a deck`);
    if (player.deck.length < player.startingDrawCount) {
      throw new Error(`${path}: player ${index} deck is smaller than starting draw count`);
    }
  }
}
