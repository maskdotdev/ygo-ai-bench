import { describe, expect, it } from "vitest";
import { renderTraceLine } from "./inspect.js";

describe("renderTraceLine", () => {
  it("prints real normalized events with turn and phase", () => {
    expect(
      renderTraceLine({
        type: "event",
        turn: 1,
        phase: "MAIN1",
        event: "CARD_MOVED",
        text: "Gagagigo moved from hand to field.",
      }),
    ).toBe("[Turn 1 / MAIN1] Gagagigo moved from hand to field.");
  });

  it("prints raw engine type names instead of undefined", () => {
    expect(renderTraceLine({ type: "engine", typeName: "SELECT_IDLECMD" })).toBe("SELECT_IDLECMD");
  });

  it("prints decisions", () => {
    expect(renderTraceLine({ type: "decision", chosen: { actionId: "a_001", reason: "Selected." } })).toBe(
      "Decision: a_001 - Selected.",
    );
  });
});
