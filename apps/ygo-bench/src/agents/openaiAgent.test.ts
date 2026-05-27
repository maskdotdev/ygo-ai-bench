import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiAgent, checkOpenAiConnectivity, chooseOpenAiLegalAction, parseAgentDecision } from "./openaiAgent.js";

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
      .mockResolvedValueOnce(responseWithText('{"actionId":"a_002","reason":"Recovered."}', { total_tokens: 42 }));

    await expect(
      chooseOpenAiLegalAction({
        apiKey: "test-key",
        model: "test-model",
        endpoint: "https://example.test/responses",
        observationText: "{}",
        legalActionIds: ["a_001", "a_002"],
      }),
    ).resolves.toEqual({ actionId: "a_002", reason: "Recovered.", tokenCount: 42 });
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

describe("OpenAiAgent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the configured model", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(responseWithText('{"actionId":"a_001","reason":"ok"}'));
    const agent = new OpenAiAgent({ apiKey: "test-key", model: "configured-model", endpoint: "https://example.test/responses" });

    await agent.chooseAction({
      scenarioId: "test",
      player: 0,
      turn: 1,
      phase: "MAIN1",
      prompt: { type: "idle_command", player: 0, message: "Choose." },
      publicState: {
        players: [
          { lp: 8000, handCount: 1, revealedHand: [], monsters: [], spellsTraps: [], graveyard: [], banished: [], deckCount: 0, extraDeckCount: 0 },
          { lp: 8000, handCount: 0, revealedHand: [], monsters: [], spellsTraps: [], graveyard: [], banished: [], deckCount: 0, extraDeckCount: 0 },
        ],
      },
      privateState: { hand: [] },
      legalActions: [{ id: "a_001", type: "pass", label: "Pass" }],
      transcript: [],
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ model: "configured-model" });
  });
});

describe("checkOpenAiConnectivity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("checks the models endpoint with the configured key", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
    } as Response);

    await expect(checkOpenAiConnectivity({ apiKey: "test-key", endpoint: "https://example.test/models" })).resolves.toEqual({
      ok: true,
      status: 200,
    });
    expect(fetchMock).toHaveBeenCalledWith("https://example.test/models", {
      headers: {
        Authorization: "Bearer test-key",
      },
    });
  });
});

function responseWithText(outputText: string, usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number }): Response {
  return {
    ok: true,
    json: async () => ({ output_text: outputText, ...(usage ? { usage } : {}) }),
  } as Response;
}
