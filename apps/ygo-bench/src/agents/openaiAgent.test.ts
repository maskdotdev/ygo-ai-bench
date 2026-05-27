import { afterEach, describe, expect, it, vi } from "vitest";
import { chooseOpenAiLegalAction, parseAgentDecision } from "./openaiAgent.js";

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

describe("chooseOpenAiLegalAction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("retries once after invalid JSON", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(responseWithText("not-json"))
      .mockResolvedValueOnce(responseWithText('{"actionId":"a_002","reason":"Recovered."}'));

    await expect(
      chooseOpenAiLegalAction({
        apiKey: "test-key",
        model: "test-model",
        endpoint: "https://example.test/responses",
        observationText: "{}",
        legalActionIds: ["a_001", "a_002"],
      }),
    ).resolves.toEqual({ actionId: "a_002", reason: "Recovered." });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects illegal action IDs without retrying", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(responseWithText('{"actionId":"a_999","reason":"Bad."}'));

    await expect(
      chooseOpenAiLegalAction({
        apiKey: "test-key",
        model: "test-model",
        endpoint: "https://example.test/responses",
        observationText: "{}",
        legalActionIds: ["a_001"],
      }),
    ).rejects.toThrow(/illegal action id/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

function responseWithText(outputText: string): Response {
  return {
    ok: true,
    json: async () => ({ output_text: outputText }),
  } as Response;
}
