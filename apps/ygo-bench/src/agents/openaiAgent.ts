import { renderObservationJson } from "../core/renderObservation.js";
import type { Agent, AgentDecision, Observation } from "../core/types.js";

interface ResponsesApiResult {
  output_text?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      refusal?: string;
    }>;
  }>;
}

export interface OpenAiAgentDecision extends AgentDecision {
  tokenCount: number | null;
}

export class OpenAiAgent implements Agent {
  id = "openai";

  constructor(
    private readonly options: {
      apiKey: string;
      model: string;
      endpoint?: string;
    },
  ) {}

  async chooseAction(observation: Observation): Promise<AgentDecision> {
    return chooseOpenAiLegalAction({
      apiKey: this.options.apiKey,
      model: this.options.model,
      endpoint: this.options.endpoint ?? "https://api.openai.com/v1/responses",
      observationText: renderObservationJson(observation),
      legalActionIds: observation.legalActions.map((action) => action.id),
    });
  }
}

export async function chooseOpenAiLegalAction(args: {
  apiKey: string;
  model: string;
  observationText: string;
  legalActionIds: string[];
  endpoint?: string;
}): Promise<OpenAiAgentDecision> {
  let lastJsonError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await callResponsesApi({
      apiKey: args.apiKey,
      model: args.model,
      endpoint: args.endpoint ?? "https://api.openai.com/v1/responses",
      observationText: args.observationText,
      legalActionIds: args.legalActionIds,
    });
    try {
      const decision = parseAgentDecision(extractResponseText(result));
      const legalIds = new Set(args.legalActionIds);
      if (!legalIds.has(decision.actionId)) {
        throw new Error(`OpenAI agent returned illegal action id: ${decision.actionId}`);
      }
      return { ...decision, tokenCount: responseTokenCount(result) };
    } catch (error) {
      if (!isInvalidJsonError(error)) throw error;
      lastJsonError = error;
    }
  }
  throw lastJsonError instanceof Error ? lastJsonError : new Error("OpenAI agent returned invalid JSON");
}

export function createOpenAiAgentFromEnv(model?: string): OpenAiAgent {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for --agent openai");
  return new OpenAiAgent({
    apiKey,
    model: model ?? process.env.YGO_BENCH_OPENAI_MODEL ?? "gpt-4o-mini",
  });
}

export async function checkOpenAiConnectivity(args: {
  apiKey: string;
  endpoint?: string;
}): Promise<{ ok: true; status: number }> {
  const response = await fetch(args.endpoint ?? "https://api.openai.com/v1/models", {
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
    },
  });
  if (!response.ok) {
    throw new Error(`OpenAI API check failed: ${response.status} ${await response.text()}`);
  }
  return { ok: true, status: response.status };
}

export function parseAgentDecision(text: string): AgentDecision {
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed) || typeof parsed.actionId !== "string") {
    throw new Error("Model response must include string actionId");
  }
  return {
    actionId: parsed.actionId,
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
  };
}

function extractResponseText(result: ResponsesApiResult): string {
  if (typeof result.output_text === "string" && result.output_text.length > 0) return result.output_text;
  for (const output of result.output ?? []) {
    for (const content of output.content ?? []) {
      if (content.type === "refusal" && content.refusal) throw new Error(`Model refused: ${content.refusal}`);
      if (typeof content.text === "string") return content.text;
    }
  }
  throw new Error("OpenAI response did not contain text output");
}

function responseTokenCount(result: ResponsesApiResult): number | null {
  const total = result.usage?.total_tokens;
  if (typeof total === "number") return total;
  const input = result.usage?.input_tokens;
  const output = result.usage?.output_tokens;
  return typeof input === "number" && typeof output === "number" ? input + output : null;
}

async function callResponsesApi(args: {
  apiKey: string;
  model: string;
  endpoint: string;
  observationText: string;
  legalActionIds: string[];
}): Promise<ResponsesApiResult> {
  const response = await fetch(args.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: args.model,
      input: [
        {
          role: "system",
          content: "You are playing Yu-Gi-Oh. Choose exactly one legal action ID. Return JSON only.",
        },
        {
          role: "developer",
          content: 'You must return JSON only: { "actionId": string, "reason": string }.',
        },
        {
          role: "user",
          content: args.observationText,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "ygo_bench_action",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["actionId", "reason"],
            properties: {
              actionId: {
                type: "string",
                enum: args.legalActionIds,
              },
              reason: {
                type: "string",
              },
            },
          },
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI Responses API failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()) as ResponsesApiResult;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isInvalidJsonError(error: unknown): boolean {
  return error instanceof SyntaxError || (error instanceof Error && error.message.includes("Model response must include"));
}
