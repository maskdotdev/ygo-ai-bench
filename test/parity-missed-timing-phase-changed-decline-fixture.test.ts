import { describe, it } from "vitest";
import { expectMissedTimingDeclineFixture } from "./parity-missed-timing-decline-fixture-helper.js";

describe("EDOPro parity phase-changed missed timing decline fixture", () => {
  it("returns declined optional if phase-changed triggers to open fast priority while optional when remains missed", () => {
    expectMissedTimingDeclineFixture({
      eventName: "phaseChanged",
      kebabName: "phase-changed",
      titleName: "Phase-changed",
      seed: 431,
    });
  });
});
