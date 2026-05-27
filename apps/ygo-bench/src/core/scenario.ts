import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Scenario } from "./types.js";

export async function loadScenario(path: string): Promise<Scenario> {
  const absolutePath = resolve(path);
  const raw = await readFile(absolutePath, "utf8");
  const scenario = JSON.parse(raw) as Scenario;
  validateScenario(scenario, path);
  return scenario;
}

export function validateScenario(scenario: Scenario, path = "scenario"): void {
  if (!scenario.id) throw new Error(`${path}: missing id`);
  if (!scenario.name) throw new Error(`${path}: missing name`);
  if (!Array.isArray(scenario.players) || scenario.players.length !== 2) {
    throw new Error(`${path}: expected exactly two players`);
  }
  if (!Array.isArray(scenario.steps) || scenario.steps.length === 0) {
    throw new Error(`${path}: expected at least one scripted step`);
  }
  if (!Array.isArray(scenario.oracle) || scenario.oracle.length === 0) {
    throw new Error(`${path}: expected an oracle action list`);
  }
}
