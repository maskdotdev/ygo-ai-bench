import { competitorIdFor, type ScenarioScore } from "../core/types.js";
import { loadBrowserCardDatabase, type CardDatabase } from "../edopro-wasm/cardDb.js";
import { buildRealLegalActions, type RealLegalAction } from "../edopro-wasm/legalActions.js";
import { loadOcgRuntime } from "../edopro-wasm/loadOcgRuntime.js";
import { initialRealReducedState, normalizeMessages, type RealNormalizedEvent, type RealReducedState } from "../edopro-wasm/normalizedEvents.js";
import type { OcgCoreSync, OcgDuelHandle, OcgMessage, OcgRuntime } from "../edopro-wasm/ocgTypes.js";
import { chooseRealAgentAction } from "../edopro-wasm/realAgent.js";
import { loadRealScenario, type RealScenario } from "../edopro-wasm/realScenario.js";
import { createScenarioDuel, isPromptMessage } from "../edopro-wasm/realRunner.js";
import { createPlayArtifactWriter, type PlayArtifactWriter } from "./sessionArtifacts.js";
import { publicLegalAction, type PlayOpponentAgent, type PlaySessionView, type PlayStatus } from "./playTypes.js";

export interface InteractiveDuelSessionOptions {
  id: string;
  scenarioPath: string;
  humanPlayer: 0 | 1;
  opponentAgent: PlayOpponentAgent;
  cardDataPath: string;
  scriptRoot: string;
  maxDecisions: number;
  model?: string;
  onChange?: (session: PlaySessionView) => void;
}

export class InteractiveDuelSession {
  readonly id: string;
  readonly humanPlayer: 0 | 1;
  readonly opponentAgent: PlayOpponentAgent;
  readonly model: string | undefined;
  readonly scenarioPath: string;
  readonly maxDecisions: number;
  readonly runDir: string;

  private readonly scenario: RealScenario;
  private readonly cardDb: CardDatabase;
  private readonly ocg: OcgRuntime;
  private readonly core: OcgCoreSync;
  private readonly handle: OcgDuelHandle;
  private readonly artifacts: PlayArtifactWriter;
  private readonly cardDataPath: string;
  private readonly scriptRoot: string;
  private readonly errors: string[];
  private readonly onChange: (session: PlaySessionView) => void;
  private readonly timeline: Array<RealNormalizedEvent | Record<string, unknown>> = [];
  private readonly legalActionsById = new Map<string, RealLegalAction>();
  private readonly reducedState = initialRealReducedState();

  private status: PlayStatus = "starting";
  private currentPrompt: { type: string; player: 0 | 1 } | undefined;
  private lastOpponentDecision: PlaySessionView["lastOpponentDecision"];
  private score: ScenarioScore | undefined;
  private decisionsTaken = 0;
  private invalidJson = 0;
  private illegalActions = 0;
  private modelErrors = 0;
  private tokenCount = 0;
  private tokenCountSeen = false;
  private latencyMs = 0;
  private winner: 0 | 1 | null = null;
  private frameId = 0;
  private destroyed = false;

  private constructor(args: {
    options: InteractiveDuelSessionOptions;
    scenario: RealScenario;
    cardDb: CardDatabase;
    ocg: OcgRuntime;
    core: OcgCoreSync;
    handle: OcgDuelHandle;
    artifacts: PlayArtifactWriter;
    errors: string[];
  }) {
    this.id = args.options.id;
    this.humanPlayer = args.options.humanPlayer;
    this.opponentAgent = args.options.opponentAgent;
    this.model = args.options.model;
    this.scenarioPath = args.options.scenarioPath;
    this.maxDecisions = args.options.maxDecisions;
    this.scenario = args.scenario;
    this.cardDb = args.cardDb;
    this.ocg = args.ocg;
    this.core = args.core;
    this.handle = args.handle;
    this.artifacts = args.artifacts;
    this.runDir = args.artifacts.runDir;
    this.errors = args.errors;
    this.onChange = args.options.onChange ?? (() => {});
    this.cardDataPath = args.options.cardDataPath;
    this.scriptRoot = args.options.scriptRoot;
    this.reducedState.players[0].lp = args.scenario.players[0].lp;
    this.reducedState.players[1].lp = args.scenario.players[1].lp;
    this.reducedState.players[0].deckCount = args.scenario.players[0].deck.length;
    this.reducedState.players[1].deckCount = args.scenario.players[1].deck.length;
    this.reducedState.players[0].extraDeckCount = args.scenario.players[0].extra?.length ?? 0;
    this.reducedState.players[1].extraDeckCount = args.scenario.players[1].extra?.length ?? 0;
  }

  static async create(options: InteractiveDuelSessionOptions): Promise<InteractiveDuelSession> {
    const cardDb = await loadBrowserCardDatabase(options.cardDataPath);
    const scenario = await loadRealScenario(options.scenarioPath);
    const ocg = await loadOcgRuntime();
    const errors: string[] = [];
    const core = await ocg.createCore({ sync: true, printErr: (line: string) => errors.push(line) });
    const handle = createScenarioDuel(core, ocg, scenario, cardDb, options.scriptRoot, errors);
    const artifacts = await createPlayArtifactWriter({ scenarioId: scenario.id, scenarioName: scenario.name, opponentAgent: options.opponentAgent });
    const session = new InteractiveDuelSession({ options, scenario, cardDb, ocg, core, handle, artifacts, errors });
    core.startDuel(handle);
    await session.advance();
    return session;
  }

  async submitHumanAction(actionId: string): Promise<PlaySessionView> {
    if (this.status !== "waiting_for_human") throw new Error(`Session is not waiting for a human action; status=${this.status}`);
    const action = this.legalActionsById.get(actionId);
    if (!action) throw new Error(`Illegal action id: ${actionId}`);
    const decision = {
      type: "decision",
      player: this.humanPlayer,
      legalActions: [...this.legalActionsById.values()].map(publicLegalAction),
      chosen: { actionId, reason: "Human selected in UI", tokenCount: null },
      reducedState: this.publicReducedState(),
    };
    this.timeline.push(decision);
    await this.artifacts.pushTrace(decision);
    this.artifacts.transcript.push(`## Human Decision ${this.decisionsTaken + 1}`, "", `Chosen: \`${action.id}\``, "", action.label, "");
    this.decisionsTaken += 1;
    this.core.duelSetResponse(this.handle, action.response);
    return this.advance();
  }

  async concede(): Promise<PlaySessionView> {
    this.winner = this.humanPlayer === 0 ? 1 : 0;
    this.status = "finished";
    await this.finish();
    return this.view();
  }

  view(): PlaySessionView {
    return {
      id: this.id,
      scenarioId: this.scenario.id,
      humanPlayer: this.humanPlayer,
      opponentAgent: this.opponentAgent,
      ...(this.model ? { model: this.model } : {}),
      status: this.status,
      ...(this.currentPrompt ? { currentPrompt: this.currentPrompt } : {}),
      legalActions: this.status === "waiting_for_human" ? [...this.legalActionsById.values()].map(publicLegalAction) : [],
      reducedState: this.publicReducedState(),
      timeline: this.timeline.slice(-200),
      ...(this.lastOpponentDecision ? { lastOpponentDecision: this.lastOpponentDecision } : {}),
      ...(this.score ? { score: this.score } : {}),
      runDir: this.runDir,
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.core.destroyDuel(this.handle);
  }

  private async advance(): Promise<PlaySessionView> {
    this.status = "running";
    this.currentPrompt = undefined;
    this.legalActionsById.clear();
    try {
      for (let frame = 0; frame < 1000; frame += 1) {
        const status = this.core.duelProcess(this.handle);
        const messages = this.core.duelGetMessage(this.handle);
        await this.recordMessages(messages);
        const win = messages.find((message) => message.type === this.ocg.OcgMessageType.WIN);
        if (win?.player === 0 || win?.player === 1) this.winner = win.player;
        if (this.reducedState.winner !== null) this.winner = this.reducedState.winner;
        if (status === this.ocg.OcgProcessResult.END) {
          this.status = "finished";
          await this.finish();
          return this.view();
        }
        if (status === this.ocg.OcgProcessResult.CONTINUE) continue;
        if (this.autoRespondEmptyChain(messages)) continue;

        const prompt = [...messages].reverse().find((message) => isPromptMessage(message.type, this.ocg));
        const promptPlayer = prompt?.player === 1 ? 1 : 0;
        const legalActions = buildRealLegalActions(prompt, this.ocg, this.cardDb);
        if (!prompt || legalActions.length === 0) throw new Error("Core requested a response, but no legal action builder matched the prompt.");
        this.currentPrompt = { type: String(this.ocg.OcgMessageType[prompt.type] ?? prompt.type), player: promptPlayer };
        if (promptPlayer === this.humanPlayer) {
          this.status = "waiting_for_human";
          for (const action of legalActions) this.legalActionsById.set(action.id, action);
          return this.view();
        }
        await this.chooseOpponentAction(prompt, legalActions);
        if (this.decisionsTaken >= this.maxDecisions) {
          this.status = "finished";
          await this.finish();
          return this.view();
        }
      }
      throw new Error("Frame cap exceeded before the duel reached a stable state.");
    } catch (error) {
      this.status = "error";
      const message = error instanceof Error ? error.message : String(error);
      await this.artifacts.pushTrace({ type: "error", message });
      return { ...this.view(), error: message };
    }
  }

  private async chooseOpponentAction(prompt: OcgMessage, legalActions: RealLegalAction[]): Promise<void> {
    this.status = "thinking";
    this.onChange(this.view());
    const startedAt = Date.now();
    const chosen = await chooseRealAgentAction({
      agentId: this.opponentAgent,
      scenario: this.scenario,
      state: this.reducedState,
      prompt,
      promptTypeName: String(this.ocg.OcgMessageType[prompt.type] ?? prompt.type),
      legalActions,
      recentEvents: this.timeline.filter((item): item is RealNormalizedEvent => item.type === "event").slice(-12),
      ...(this.model ? { model: this.model } : {}),
      allowPlayerOneAgent: true,
    });
    this.latencyMs += Date.now() - startedAt;
    this.invalidJson += chosen.invalidJson;
    this.illegalActions += chosen.illegalActions;
    this.modelErrors += chosen.modelErrors;
    if (chosen.tokenCount !== null) {
      this.tokenCount += chosen.tokenCount;
      this.tokenCountSeen = true;
    }
    this.decisionsTaken += 1;
    this.lastOpponentDecision = {
      actionId: chosen.action.id,
      label: chosen.action.label,
      reason: chosen.reason,
      tokenCount: chosen.tokenCount,
    };
    const decision = {
      type: "decision",
      player: prompt.player === 1 ? 1 : 0,
      legalActions: legalActions.map(publicLegalAction),
      chosen: { actionId: chosen.action.id, reason: chosen.reason, tokenCount: chosen.tokenCount },
      observation: chosen.observation,
      error: chosen.rawError,
      reducedState: this.publicReducedState(),
    };
    this.timeline.push(decision);
    await this.artifacts.pushTrace(decision);
    this.artifacts.transcript.push(
      `## Opponent Decision ${this.decisionsTaken}`,
      "",
      "```json",
      JSON.stringify({ actionId: chosen.action.id, reason: chosen.reason, tokenCount: chosen.tokenCount }, null, 2),
      "```",
      "",
      chosen.action.label,
      "",
    );
    this.core.duelSetResponse(this.handle, chosen.action.response);
  }

  private async recordMessages(messages: OcgMessage[]): Promise<void> {
    await this.artifacts.pushTrace(
      ...messages.map((message) => ({
        type: "engine",
        message,
        typeName: String(this.ocg.OcgMessageType[message.type]),
      })),
    );
    const events = normalizeMessages({
      messages,
      ocg: this.ocg,
      cardDb: this.cardDb,
      state: this.reducedState,
      nextFrame: () => {
        this.frameId += 1;
        return this.frameId;
      },
    });
    this.timeline.push(...events);
    await this.artifacts.pushTrace(...events);
  }

  private autoRespondEmptyChain(messages: OcgMessage[]): boolean {
    const prompt = [...messages].reverse().find((message) => isPromptMessage(message.type, this.ocg));
    if (!prompt || prompt.type !== this.ocg.OcgMessageType.SELECT_CHAIN) return false;
    if (Array.isArray(prompt.selects) && prompt.selects.length > 0) return false;
    this.core.duelSetResponse(this.handle, { type: this.ocg.OcgResponseType.SELECT_CHAIN, index: null });
    return true;
  }

  private async finish(): Promise<void> {
    if (this.score) return;
    this.score = {
      mode: "human-vs-agent",
      scenarioId: this.scenario.id,
      agentId: "human",
      competitorId: `human-vs-${competitorIdFor(this.opponentAgent, this.model)}`,
      status: "completed",
      family: this.scenario.family,
      won: this.winner === this.humanPlayer,
      winner: this.winner,
      turnsTaken: this.reducedState.turn,
      decisionsTaken: this.decisionsTaken,
      illegalActions: this.illegalActions,
      invalidJson: this.invalidJson,
      modelErrors: this.modelErrors,
      repeatedActions: 0,
      finalLpDelta: this.reducedState.players[0].lp - this.reducedState.players[1].lp,
      objectiveScore: this.winner === this.humanPlayer ? 1 : 0,
      components: {
        winScore: this.winner === this.humanPlayer ? 1 : 0,
        strategicProgressScore: this.winner === this.humanPlayer ? 1 : 0,
        resourceScore: Math.max(0, Math.min(1, 0.5 + (this.reducedState.players[0].lp - this.reducedState.players[1].lp) / 16000)),
        adaptationScore: 0,
        planConsistencyScore: 0,
        riskManagementScore: 0,
        executionPenalty: this.modelErrors + this.illegalActions + this.invalidJson > 0 ? 1 : 0,
        overallScore: this.winner === this.humanPlayer ? 1 : 0,
      },
      promptCoverage: {
        seen: {},
        handled: {},
        unsupported: {},
        autoResponses: {},
        fallbackActions: this.modelErrors,
      },
      latencyMs: this.latencyMs,
      tokenCount: this.tokenCountSeen ? this.tokenCount : null,
      notes: this.errors,
    };
    await this.artifacts.writeFinal({
      score: this.score,
      reducedState: this.publicReducedState(),
      metadata: {
        ocgcoreVersion: this.core.getVersion(),
        cardDataPath: this.cardDataPath,
        scriptRoot: this.scriptRoot,
        scenarioId: this.scenario.id,
        scenarioPath: this.scenarioPath,
        maxDecisions: this.maxDecisions,
        humanPlayer: this.humanPlayer,
        opponentAgent: this.opponentAgent,
        ...(this.model ? { model: this.model } : {}),
      },
    });
    this.destroy();
  }

  private publicReducedState(): RealReducedState {
    const clone = structuredClone(this.reducedState);
    const opponent = this.humanPlayer === 0 ? 1 : 0;
    clone.players[opponent].hand = [];
    for (const zone of [clone.players[opponent].monsters, clone.players[opponent].spellsTraps]) {
      for (const card of zone) {
        if (typeof card.position === "number" && (card.position & 0x8) !== 0) {
          card.name = "Set card";
          card.code = 0;
        }
      }
    }
    return clone;
  }
}
