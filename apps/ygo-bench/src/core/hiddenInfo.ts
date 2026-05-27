import { renderObservationJson, renderObservationText } from "./renderObservation.js";
import type { Observation, Scenario } from "./types.js";

export function assertNoHiddenInfoLeak(scenario: Scenario, observation: Observation): void {
  const forbidden = scenario.hiddenInfoAssertions ?? [];
  if (forbidden.length === 0) return;

  const rendered = `${renderObservationJson(observation)}\n${renderObservationText(observation)}`;
  for (const value of forbidden) {
    if (rendered.includes(value)) {
      throw new Error(`Hidden information leaked into model observation: ${value}`);
    }
  }
}
