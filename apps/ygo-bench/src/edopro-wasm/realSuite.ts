import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadRealScenario } from "./realScenario.js";

export interface RealSuite {
  id: string;
  scenarios: string[];
}

export async function loadRealSuite(path: string): Promise<RealSuite> {
  const suite = JSON.parse(await readFile(resolve(path), "utf8")) as RealSuite;
  if (!suite.id) throw new Error(`${path}: missing suite id`);
  if (!Array.isArray(suite.scenarios) || suite.scenarios.length === 0) {
    throw new Error(`${path}: expected at least one real scenario`);
  }
  for (const scenarioPath of suite.scenarios) {
    await loadRealScenario(scenarioPath);
  }
  return suite;
}
