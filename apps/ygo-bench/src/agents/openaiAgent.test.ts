import { describe, expect, it } from "vitest";
import { parseAgentDecision } from "./openaiAgent.js";

describe("parseAgentDecision", () => {
  it("accepts actionId and reason JSON", () => {
    expect(parseAgentDecision('{"actionId":"a_003","reason":"Preserve resources."}')).toEqual({
      actionId: "a_003",
      reason: "Preserve resources.",
    });
  });

  it("rejects missing actionId", () => {
    expect(() => parseAgentDecision('{"reason":"No action."}')).toThrow(/actionId/);
  });
});
