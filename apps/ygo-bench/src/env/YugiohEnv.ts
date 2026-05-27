import type {
  EngineFrame,
  LegalAction,
  Observation,
  PlayerId,
  PublicDuelState,
  Scenario,
  ScenarioPlayer,
  StepResult,
  TurnEvent,
} from "../core/types.js";

export interface YugiohEnv {
  reset(scenario: Scenario): Promise<Observation>;
  legalActions(): LegalAction[];
  step(actionId: string): Promise<StepResult>;
  close(): Promise<void>;
}

export class MockYugiohEnv implements YugiohEnv {
  private scenario: Scenario | null = null;
  private stepIndex = 0;
  private frame = 0;
  private turn = 1;
  private phase: Observation["phase"] = "MAIN1";
  private transcript: TurnEvent[] = [];
  private publicState: PublicDuelState | null = null;
  private privateHands: [ScenarioPlayer["hand"], ScenarioPlayer["hand"]] | null = null;
  private lastObservation: Observation | null = null;

  async reset(scenario: Scenario): Promise<Observation> {
    this.scenario = scenario;
    this.stepIndex = 0;
    this.frame = 0;
    this.turn = 1;
    this.phase = "MAIN1";
    this.transcript = [];
    this.privateHands = [scenario.players[0].hand, scenario.players[1].hand];
    this.publicState = {
      players: [toPublicPlayer(scenario.players[0]), toPublicPlayer(scenario.players[1])],
    };
    this.lastObservation = this.buildObservation();
    return this.lastObservation;
  }

  legalActions(): LegalAction[] {
    const step = this.currentStep();
    return step.actions.map((action, index) => ({
      ...action,
      engineResponse: Uint8Array.from(action.engineResponse ?? [index]),
    }));
  }

  async step(actionId: string): Promise<StepResult> {
    const scenario = this.requireScenario();
    const step = this.currentStep();
    const action = this.legalActions().find((candidate) => candidate.id === actionId);
    if (!action) {
      const observation = this.lastObservation ?? this.buildObservation();
      return {
        observation,
        reward: -1,
        done: true,
        info: {
          winner: null,
          reason: `Illegal action id: ${actionId}`,
          engineFrames: [],
        },
      };
    }

    const rawEvents = step.eventsByAction[actionId] ?? [
      { event: "ACTION", player: step.prompt.player, text: `${step.prompt.player} chose ${action.label}.` },
    ];
    const engineFrames: EngineFrame[] = rawEvents.map((event) => this.applyEvent(event));
    this.stepIndex += 1;

    const done = step.doneByAction?.[actionId] ?? this.stepIndex >= scenario.steps.length;
    const winner = step.winnerByAction?.[actionId] ?? (done ? null : undefined);
    const reward = step.rewards?.[actionId] ?? (winner === 0 ? 1 : winner === 1 ? -1 : 0);
    const observation = this.buildObservation(done, winner ?? null);

    const info: StepResult["info"] = {
      reason: done ? "Scenario complete" : "Awaiting next decision",
      chosenAction: action,
      engineFrames,
    };
    if (winner !== undefined) info.winner = winner;

    return {
      observation,
      reward,
      done,
      info,
    };
  }

  async close(): Promise<void> {}

  private buildObservation(done = false, winner: PlayerId | null = null): Observation {
    const scenario = this.requireScenario();
    const publicState = this.requirePublicState();
    const prompt = done
      ? { type: "game_over" as const, player: 0 as const, message: winner === null ? "Game ended." : `Player ${winner} won.` }
      : this.currentStep().prompt;
    const player = prompt.player;
    const observation: Observation = {
      scenarioId: scenario.id,
      player,
      turn: this.turn,
      phase: this.phase,
      prompt,
      publicState,
      privateState: {
        hand: this.privateHands?.[player] ?? [],
      },
      legalActions: done ? [] : this.legalActions().map((action) => action.model),
      transcript: [...this.transcript],
    };
    this.lastObservation = observation;
    return observation;
  }

  private applyEvent(event: Omit<EngineFrame, "frame" | "turn" | "phase" | "type">): EngineFrame {
    this.frame += 1;
    if (event.event === "LP_UPDATE" && typeof event.payload === "object" && event.payload !== null) {
      const payload = event.payload as { player?: PlayerId; lp?: number };
      if (payload.player !== undefined && payload.lp !== undefined) {
        this.requirePublicState().players[payload.player].lp = payload.lp;
      }
    }
    if (event.event === "NEW_PHASE" && typeof event.payload === "object" && event.payload !== null) {
      const payload = event.payload as { phase?: Observation["phase"] };
      if (payload.phase) this.phase = payload.phase;
    }
    const frame: EngineFrame = {
      ...event,
      frame: this.frame,
      turn: this.turn,
      phase: this.phase,
      type: "engine",
    };
    this.transcript.push(frame);
    return frame;
  }

  private currentStep() {
    const scenario = this.requireScenario();
    return scenario.steps[Math.min(this.stepIndex, scenario.steps.length - 1)]!;
  }

  private requireScenario(): Scenario {
    if (!this.scenario) throw new Error("Environment has not been reset");
    return this.scenario;
  }

  private requirePublicState(): PublicDuelState {
    if (!this.publicState) throw new Error("Environment has not been reset");
    return this.publicState;
  }
}

function toPublicPlayer(player: ScenarioPlayer) {
  return {
    lp: player.lp,
    handCount: player.hand.length,
    revealedHand: player.hand.filter((card) => card.revealed),
    monsters: player.monsters ?? [],
    spellsTraps: player.spellsTraps ?? [],
    graveyard: player.graveyard ?? [],
    banished: player.banished ?? [],
    deckCount: player.deck.length,
    extraDeckCount: 0,
  };
}
