import { describe, it } from "vitest";
import { expectMissedTimingDeclineFixture } from "./parity-missed-timing-decline-fixture-helper.js";

describe("EDOPro parity turn-started missed timing decline fixture", () => {
  it("returns declined optional if turn-started triggers to open fast priority while optional when remains missed", () => {
    expectMissedTimingDeclineFixture({
      eventName: "turnStarted",
      kebabName: "turn-started",
      titleName: "Turn-started",
      seed: 432,
    });
  });
});
