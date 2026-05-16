import { describe, expect, it } from "vitest";
import { malformedFixtureEffectListExpectations } from "#engine/parity-fixture-effect-validation.js";

describe("engine harness fixture effect validation", () => {
  it("requires trigger effects to declare trigger timing", () => {
    expect(malformedFixtureEffectListExpectations({
      id: "missing-trigger-timing",
      player: 0,
      code: "100",
      location: "hand",
      event: "trigger",
      triggerEvent: "normalSummoned",
      range: ["hand"],
    })).toContain("effect.triggerTiming is required when triggerEvent is set");
  });
});
