import { describe, it } from "vitest";
import { expectMissedTimingDeclineFixture } from "./parity-missed-timing-decline-fixture-helper.js";

describe("EDOPro parity activated missed timing decline fixture", () => {
  it("returns declined optional if activated triggers to open fast priority while optional when remains missed", () => {
    expectMissedTimingDeclineFixture({
      eventName: "activated",
      kebabName: "activated",
      titleName: "Activated",
      seed: 430,
    });
  });
});
