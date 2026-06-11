import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ScenarioFamily } from "../core/types.js";

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
  family: ScenarioFamily;
  version: string;
  seed: [number, number, number, number];
  maxDecisions: number;
  horizonTurns?: number;
  objective?: string;
  strategicConstraints?: Record<string, unknown>;
  opponentPolicy?: string;
  expectedDecisionWindows?: string[];
  successConditions?: string[];
  failureConditions?: string[];
  notes?: string;
  players: [RealScenarioPlayer, RealScenarioPlayer];
  scoring?: {
    primary?: "win" | "lpDelta";
    lineQualityWeight?: number;
    preferredActionTypes?: string[];
    preferHighestAttack?: boolean;
    rationale?: string;
    weights?: Record<string, number>;
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
  if (!isScenarioFamily(scenario.family)) throw new Error(`${path}: unsupported family ${String(scenario.family)}`);
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
  const weight = scenario.scoring?.lineQualityWeight;
  if (weight !== undefined && (typeof weight !== "number" || weight < 0 || weight > 1)) {
    throw new Error(`${path}: scoring.lineQualityWeight must be between 0 and 1`);
  }
  if (scenario.scoring?.preferredActionTypes !== undefined && !Array.isArray(scenario.scoring.preferredActionTypes)) {
    throw new Error(`${path}: scoring.preferredActionTypes must be an array`);
  }
  if (scenario.horizonTurns !== undefined && (!Number.isInteger(scenario.horizonTurns) || scenario.horizonTurns <= 0)) {
    throw new Error(`${path}: horizonTurns must be a positive integer`);
  }
  if (scenario.expectedDecisionWindows !== undefined && !Array.isArray(scenario.expectedDecisionWindows)) {
    throw new Error(`${path}: expectedDecisionWindows must be an array`);
  }
  if (scenario.scoring?.weights !== undefined) {
    const total = Object.values(scenario.scoring.weights).reduce((sum, value) => sum + (typeof value === "number" ? value : Number.NaN), 0);
    if (!Number.isFinite(total) || total <= 0) throw new Error(`${path}: scoring.weights must contain positive numeric weights`);
  }
}

function isScenarioFamily(value: unknown): value is ScenarioFamily {
  return (
    value === "smoke" ||
    value === "lethal" ||
    value === "interruption" ||
    value === "resource" ||
    value === "setup-payoff" ||
    value === "resource-grind" ||
    value === "bait-interruption" ||
    value === "delayed-lethal" ||
    value === "recovery" ||
    value === "defensive-planning"
  );
}
