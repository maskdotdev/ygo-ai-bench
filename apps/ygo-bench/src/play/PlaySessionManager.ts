import { cardDataPathFromEnv, scriptRootFromEnv } from "../edopro-wasm/realDefaults.js";
import { InteractiveDuelSession } from "./PlaySession.js";
import type { PlayOpponentAgent, PlaySessionCreateRequest, PlaySessionView } from "./playTypes.js";

export class PlaySessionManager {
  private readonly sessions = new Map<string, InteractiveDuelSession>();
  private readonly onChange: (session: PlaySessionView) => void;

  constructor(onChange: (session: PlaySessionView) => void = () => {}) {
    this.onChange = onChange;
  }

  list(): PlaySessionView[] {
    return [...this.sessions.values()].map((session) => session.view());
  }

  get(id: string): PlaySessionView | null {
    return this.sessions.get(id)?.view() ?? null;
  }

  async create(request: PlaySessionCreateRequest): Promise<PlaySessionView> {
    const opponentAgent = defaultOpponent(request.opponentAgent);
    if (opponentAgent === "openai" && !process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for opponentAgent=openai");
    const id = `play-${new Date().toISOString().replaceAll(":", "-")}`;
    const session = await InteractiveDuelSession.create({
      id,
      scenarioPath: request.scenarioPath ?? "scenarios/real/smoke-duel.json",
      humanPlayer: request.humanPlayer ?? 0,
      opponentAgent,
      cardDataPath: cardDataPathFromEnv(),
      scriptRoot: scriptRootFromEnv(),
      maxDecisions: request.maxDecisions ?? 80,
      ...(request.model ? { model: request.model } : {}),
      onChange: this.onChange,
    });
    this.sessions.set(id, session);
    const view = session.view();
    this.onChange(view);
    return view;
  }

  async submitHumanAction(id: string, actionId: string): Promise<PlaySessionView> {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Unknown play session: ${id}`);
    const view = await session.submitHumanAction(actionId);
    this.onChange(view);
    return view;
  }

  async concede(id: string): Promise<PlaySessionView> {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`Unknown play session: ${id}`);
    const view = await session.concede();
    this.onChange(view);
    return view;
  }

  close(): void {
    for (const session of this.sessions.values()) session.destroy();
  }
}

function defaultOpponent(value: PlayOpponentAgent | undefined): PlayOpponentAgent {
  if (value) return value;
  return process.env.OPENAI_API_KEY ? "openai" : "greedy";
}
