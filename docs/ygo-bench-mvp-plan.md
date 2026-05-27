# YGO Bench MVP Plan

## MVP North Star

Optimize the MVP for proof of benchmark value, not perfect full-Yu-Gi-Oh coverage.

The MVP should answer one question:

> Can we put an LLM into a real engine-backed Yu-Gi-Oh decision loop, hide private info correctly, show the duel unfolding, and score whether multi-turn strategy improves over weaker baselines?

Recommended first implementation:

- TypeScript harness.
- `ocgcore-wasm` adapter.
- Project Ignis card scripts/database data.
- Simple browser viewer that renders the engine trace.

Target command:

```sh
pnpm bench run scenarios/lethal-001.json --agent openai --viewer
```

Expected run artifacts:

```txt
benchmark-runs/
  run-2026-05-27T.../
    trace.jsonl
    final-score.json
    model-transcript.md
    engine-messages.bin
    viewer.html
```

The viewer should show a duel narrative like:

```txt
Turn 1 Main Phase:
  Player drew X.
  Player normal summoned Y.
  Player activated Z.
  Opponent responded with A.
  Chain resolved.
  Board changed.
  LLM chose action #4: activate effect of Y.
```

The MVP does not need every deck, replay format, or UI affordance. It needs to prove that engine-backed strategic evaluation is possible.

## Technical Foundation

Use this stack:

```txt
TypeScript / Node
  -> @ygo-bench/edopro-wasm adapter
  -> ocgcore-wasm
  -> Project Ignis / EDOPro ocgcore
  -> Project Ignis CardScripts + BabelCDB + LFLists
```

Why:

- EDOPro is Project Ignis's open-source automatic duel simulator and is powered by their `ocgcore` fork.
- EDOPro core can be built independently of the client and used to power server technologies.
- Project Ignis maintains canonical card scripts, card databases, and Forbidden/Limited lists.
- BabelCDB is the Project Ignis card database collection for EDOPro.
- `ocgcore-wasm` exposes the loop needed by the harness: `createCore`, `createDuel`, `startDuel`, `duelProcess`, `duelGetMessage`, and `duelSetResponse`.
- `ocgcore-wasm` supports JS/TS `cardReader` and `scriptReader` callbacks.
- Use the synchronous WASM API first; the async mode requires experimental JS Promise Integration / stack-switching flags in Node.

Later hardening path:

- Swap the WASM adapter for a native Node addon or isolated native worker around EDOPro core's C API.
- Keep the TypeScript environment, scenario format, viewer, and agent interface unchanged.

## MVP Scope

### 1. Legal-Action Loop

Goal: prove the LLM can play by choosing from engine-generated legal actions.

Environment loop:

```txt
engine runs
  -> engine asks for a response
  -> adapter parses engine message
  -> harness creates legal action IDs
  -> LLM sees observation + legal actions
  -> LLM returns one action ID
  -> harness converts action ID back to engine response bytes
  -> engine continues
```

Do not let the model produce raw free-form moves like "summon Ash Blossom". The model should only return:

```json
{ "actionId": "a_004" }
```

The harness maps `a_004` to the exact engine response.

### 2. Tactical Puzzle Suite

Goal: prove that the benchmark can distinguish good and bad reasoning.

Start with 10 to 20 fixed scenarios:

- `lethal-001`: find exact lethal this turn.
- `lethal-002`: remove negation first, then combo.
- `bait-001`: bait interruption before committing key effect.
- `resource-001`: choose non-lethal line that wins next turn.
- `defense-001`: survive opponent's next turn.

Example scenario metadata:

```json
{
  "id": "lethal-001",
  "name": "Two-step lethal through one interruption",
  "format": "custom",
  "seed": "lethal-001-v1",
  "maxDecisions": 12,
  "scoring": {
    "win": 1.0,
    "lethalThisTurn": 1.0,
    "illegalAction": -1.0,
    "missedForcedWin": -0.5
  }
}
```

### 3. Multi-Turn Mini-Match

Goal: prove that Yu-Gi-Oh stresses memory, planning, hidden information, and branching.

Use a tiny controlled environment:

- Player A: benchmark deck.
- Player B: scripted opponent deck.
- Game length cap: 3 to 5 turns.
- Scoring: win, board advantage, resource advantage, line quality.

Do not start with full best-of-three side decking. That belongs in a later benchmark tier.

## Visibility Requirements

Build visibility in three layers.

### Layer 1: Human-Readable Event Log

Every engine message becomes a normalized event:

```json
{
  "frame": 42,
  "turn": 1,
  "phase": "MAIN1",
  "event": "CARD_MOVED",
  "card": {
    "code": 83764718,
    "name": "Example Card"
  },
  "from": "HAND",
  "to": "MZONE",
  "player": 0
}
```

Terminal output:

```txt
[Turn 1 / Main 1] Player 0 normal summoned Example Card.
[Turn 1 / Main 1] Player 0 activated Example Card effect.
[Chain 1] Opponent chose not to respond.
[Resolve] Example Card searched Another Card.
```

### Layer 2: Local Browser Board Viewer

Build a simple Vite app:

```txt
apps/viewer/
  src/
    Board.tsx
    Zone.tsx
    Card.tsx
    Timeline.tsx
    ActionPanel.tsx
```

It reads `trace.jsonl` live over WebSocket:

```txt
Node benchmark runner
  -> WebSocket
Browser viewer
```

The viewer needs:

- LP totals.
- Turn and phase.
- Both fields.
- Hand count and revealed hand.
- Graveyard.
- Banished.
- Extra deck count.
- Current prompt.
- Legal actions.
- Chosen action.
- Timeline.
- LLM explanation.

No fancy animations are required for MVP.

### Layer 3: Optional EDOPro Replay Path

Treat native `.yrpX` export as a stretch goal. The MVP can already show action through the trace viewer. Later, if `.yrpX` emission is reliable, replays can open in EDOPro or flow through tools like EDOPro Replay2Video.

## Proposed Repository Layout

```txt
ygo-bench/
  package.json
  pnpm-workspace.yaml
  turbo.json

  packages/
    core/
      src/
        types.ts
        scenario.ts
        observation.ts
        scoring.ts
        trace.ts

    edopro-wasm/
      src/
        EdoproWasmAdapter.ts
        loadCardDb.ts
        loadScripts.ts
        messageParser.ts
        responseEncoder.ts
        queryState.ts

    env/
      src/
        YugiohEnv.ts
        legalActions.ts
        hiddenInfo.ts
        renderObservation.ts
        stateReducer.ts

    agents/
      src/
        Agent.ts
        RandomAgent.ts
        ScriptedAgent.ts
        LlmAgent.ts
        ReActAgent.ts

    scenarios/
      src/
        loadScenario.ts
        validateScenario.ts
      data/
        lethal/
        bait/
        resource/
        mini-match/

  apps/
    cli/
      src/
        run.ts
        eval.ts
        inspect.ts

    viewer/
      src/
        App.tsx
        Board.tsx
        Timeline.tsx
        ActionPanel.tsx

  data/
    cards/
      official.cdb
      prerelease.cdb
    scripts/
      official/
      utility.lua
    banlists/
      custom-mvp.lflist.conf

  benchmark-runs/
    .gitkeep
```

## Core TypeScript Interfaces

### `YugiohEnv`

```ts
export interface YugiohEnv {
  reset(scenario: Scenario): Promise<Observation>;
  legalActions(): LegalAction[];
  step(actionId: string): Promise<StepResult>;
  close(): Promise<void>;
}
```

### `Observation`

```ts
export interface Observation {
  scenarioId: string;
  player: 0 | 1;
  turn: number;
  phase: PhaseName;
  prompt: Prompt;
  publicState: PublicDuelState;
  privateState: PrivatePlayerState;
  legalActions: ModelLegalAction[];
  transcript: TurnEvent[];
}
```

### `LegalAction`

```ts
export interface LegalAction {
  id: string;

  /**
   * Shown to the model.
   */
  label: string;

  /**
   * Structured action info shown to the model.
   */
  model: ModelLegalAction;

  /**
   * Hidden from the model.
   * Used to answer ocgcore.
   */
  engineResponse: Uint8Array;
}
```

### `StepResult`

```ts
export interface StepResult {
  observation: Observation;
  reward: number;
  done: boolean;
  info: {
    winner?: 0 | 1 | null;
    reason?: string;
    chosenAction?: LegalAction;
    engineFrames: EngineFrame[];
  };
}
```

## Critical Adapter Loop

```ts
while (true) {
  const status = await core.duelProcess(handle);

  const rawMessages = core.duelGetMessage(handle);
  const frames = parseEngineMessages(rawMessages);

  traceWriter.write(frames);
  stateReducer.apply(frames);

  if (status === "END") {
    return finishDuel();
  }

  if (status === "CONTINUE") {
    continue;
  }

  if (status === "AWAITING") {
    const prompt = extractPrompt(frames);
    const legalActions = buildLegalActions(prompt, state);

    return {
      observation: buildObservation(state, prompt, legalActions),
      legalActions,
    };
  }
}
```

This maps to the EDOPro core model: process the state machine, read binary duel messages, and set the next response.

## Message Parser MVP

Do not parse every possible message immediately. Start with the message types required for simple scenarios.

Must parse:

- `MSG_NEW_TURN`
- `MSG_NEW_PHASE`
- `MSG_MOVE`
- `MSG_DRAW`
- `MSG_DAMAGE`
- `MSG_LPUPDATE`
- `MSG_SELECT_IDLECMD`
- `MSG_SELECT_BATTLECMD`
- `MSG_SELECT_CHAIN`
- `MSG_SELECT_CARD`
- `MSG_SELECT_YESNO`
- `MSG_SELECT_OPTION`
- `MSG_WIN`

Nice to have:

- `MSG_SUMMONING`
- `MSG_SUMMONED`
- `MSG_SPSUMMONING`
- `MSG_SPSUMMONED`
- `MSG_CHAINING`
- `MSG_CHAIN_SOLVING`
- `MSG_CHAIN_END`
- `MSG_ATTACK`
- `MSG_BATTLE`

The parser should output:

1. Semantic events for viewer/scoring.
2. Legal-action prompts for the model.

## Action Abstraction

Model-visible action:

```json
{
  "id": "a_003",
  "type": "activate_effect",
  "label": "Activate effect of Sky Striker Mobilize - Engage!",
  "card": {
    "name": "Sky Striker Mobilize - Engage!",
    "zone": "HAND"
  }
}
```

Hidden harness action:

```ts
{
  id: "a_003",
  label: "Activate effect of Sky Striker Mobilize - Engage!",
  model: { ... },
  engineResponse: Uint8Array.from([3, 0, 0, 0])
}
```

This prevents the benchmark from becoming a protocol-memorization task.

## Scenario Format

Use JSON for scenario definitions.

```json
{
  "id": "lethal-001",
  "name": "Simple lethal through one monster",
  "format": "mvp-custom",
  "seed": [1, 1, 1, 1],
  "masterRule": "MR5",
  "players": [
    {
      "lp": 8000,
      "deck": [11111111, 22222222, 33333333],
      "extra": [],
      "hand": [44444444, 55555555],
      "field": {
        "monsters": [],
        "spellsTraps": []
      },
      "graveyard": []
    },
    {
      "lp": 3000,
      "deck": [66666666, 77777777],
      "extra": [],
      "hand": [],
      "field": {
        "monsters": [
          {
            "code": 88888888,
            "position": "attack"
          }
        ],
        "spellsTraps": []
      },
      "graveyard": []
    }
  ],
  "visibility": {
    "hideOpponentHand": true,
    "hideOpponentDeck": true
  },
  "limits": {
    "maxDecisions": 12,
    "maxEngineFrames": 1000
  },
  "scoring": {
    "primary": "win",
    "secondary": ["turnsToWin", "damageDealt", "resourcesRemaining"]
  }
}
```

For early MVP, either initialize normal decks and let the duel draw into the scenario, or use engine-supported debug/puzzle-style setup later. The first vertical slice can be deck-driven because it avoids needing perfect arbitrary state injection.

## Agent Harness

Implement four agents immediately.

### Random Legal Agent

Chooses a random legal action.

Purpose: sanity baseline.

```ts
class RandomAgent implements Agent {
  async chooseAction({ legalActions }) {
    return { actionId: sample(legalActions).id };
  }
}
```

### Greedy Heuristic Agent

Simple rules:

- Take lethal if available.
- Activate search effects before summons.
- Summon biggest monster.
- Attack if profitable.
- Otherwise pass.

Purpose: non-LLM baseline.

### Scripted Oracle Agent

Hard-coded solution for each scenario.

Purpose: verify the scenario is solvable and the engine wrapper works.

### LLM Agent

Prompt contract:

```txt
system:
  You are playing Yu-Gi-Oh. Choose exactly one legal action ID.

developer:
  You must return JSON only: { "actionId": string, "reason": string }

user:
  observation JSON
```

Expected response:

```json
{
  "actionId": "a_003",
  "reason": "This starts the search line while preserving normal summon."
}
```

Scoring should record both the action and reason, but only the action affects the engine.

## Observation Rendering

Have two renderers.

### JSON Renderer

Used for structured LLM input.

```json
{
  "turn": 1,
  "phase": "MAIN1",
  "you": {
    "lp": 8000,
    "hand": [
      { "id": "h0", "name": "Card A" },
      { "id": "h1", "name": "Card B" }
    ],
    "field": {
      "monsters": [],
      "spellsTraps": []
    },
    "graveyard": []
  },
  "opponent": {
    "lp": 3000,
    "handCount": 0,
    "field": {
      "monsters": [
        { "id": "om0", "name": "Card C", "atk": 2000, "position": "attack" }
      ],
      "spellsTraps": []
    },
    "graveyard": []
  },
  "legalActions": [
    {
      "id": "a_001",
      "type": "normal_summon",
      "label": "Normal Summon Card A"
    },
    {
      "id": "a_002",
      "type": "activate_effect",
      "label": "Activate Card B"
    },
    {
      "id": "a_003",
      "type": "pass",
      "label": "End Main Phase"
    }
  ]
}
```

### Text Renderer

Used for weaker models or debugging.

```txt
Turn 1, Main Phase 1.

Your LP: 8000.
Opponent LP: 3000.

Your hand:
- h0: Card A
- h1: Card B

Opponent field:
- om0: Card C, ATK 2000, attack position

Legal actions:
- a_001: Normal Summon Card A
- a_002: Activate Card B
- a_003: End Main Phase

Return JSON only:
{ "actionId": "..." }
```

## Viewer Design

The viewer should consume the same trace used by scoring:

```txt
trace.jsonl
  -> state reducer
  -> board view
  -> timeline
  -> LLM decision panel
```

Decision trace line:

```json
{
  "frame": 17,
  "type": "decision",
  "player": 0,
  "observation": {},
  "legalActions": [],
  "chosen": {
    "actionId": "a_002",
    "reason": "I need to remove the monster before attacking."
  }
}
```

UI layout:

- Left: board.
- Right: timeline.
- Bottom: current prompt and legal actions.
- Drawer: full LLM prompt/response.

This proves the benchmark idea to humans because they can watch the model succeed or fail in concrete game states.

## Scoring

### Per-Scenario Score

```ts
export interface ScenarioScore {
  scenarioId: string;
  agentId: string;
  won: boolean;
  turnsTaken: number;
  decisionsTaken: number;
  illegalActions: number;
  invalidJson: number;
  repeatedActions: number;
  finalLpDelta: number;
  objectiveScore: number;
  notes: string[];
}
```

### Aggregate Score

Use weighted average by scenario family:

- Tactical lethal: 30%.
- Interruption navigation: 30%.
- Multi-turn resource: 30%.
- Rule/legal robustness: 10%.

Important metrics:

- Win rate.
- Lethal found rate.
- Average decisions to win.
- Illegal / invalid action rate.
- Branch recovery rate.
- Hidden-info leakage failures.
- Token count per decision.
- Latency per decision.
- Self-consistency variance across seeds.

Most interesting LLM benchmark signals:

- Did it identify the tactical line?
- Did it preserve resources?
- Did it bait interaction?
- Did it adapt after the opponent responded?
- Did it remember what happened three decisions ago?
- Did it avoid making illegal assumptions about hidden cards?

## MVP Milestones

### Milestone 1: Engine Boots From TypeScript

Deliverable:

```sh
pnpm cli smoke
```

Expected result:

```txt
Loaded card database.
Loaded scripts.
Created duel.
Started duel.
Processed until first prompt.
Printed raw engine messages.
```

Implementation tasks:

- Install `ocgcore-wasm`.
- Load `official.cdb`.
- Load card scripts from local folder.
- Create duel with deterministic seed.
- Add two tiny decks.
- Start duel.
- Call `duelProcess` loop.
- Dump `duelGetMessage` output.
- Destroy duel.

Acceptance criteria:

- Duel starts deterministically.
- No missing script errors for chosen test cards.
- First player prompt is reached.
- Raw messages are saved to disk.

### Milestone 2: Parse Enough Messages To Render A Board

Deliverable:

```sh
pnpm cli inspect runs/latest/trace.jsonl
```

Expected result:

```txt
Turn 1 Draw Phase
Player 0 drew 1 card.
Turn 1 Standby Phase
Turn 1 Main Phase 1
Player 0 has 5 cards in hand.
```

Implementation tasks:

- Parse new turn.
- Parse new phase.
- Parse card movement.
- Parse draw.
- Parse LP updates.
- Parse win.
- Maintain reduced state.
- Map card codes to names from CDB.
- Write `trace.jsonl`.

Acceptance criteria:

- The state reducer can reconstruct LP, phase, hand counts, field zones, graveyard, and winner from trace events.

### Milestone 3: Build Legal Actions

Deliverable:

```sh
pnpm cli prompt scenarios/basic-001.json
```

Expected result:

```json
{
  "prompt": {
    "type": "idle_command",
    "player": 0
  },
  "legalActions": [
    {
      "id": "a_001",
      "type": "normal_summon",
      "label": "Normal Summon Alexandrite Dragon"
    },
    {
      "id": "a_002",
      "type": "set_monster",
      "label": "Set Alexandrite Dragon"
    },
    {
      "id": "a_003",
      "type": "end_phase",
      "label": "End Phase"
    }
  ]
}
```

Implementation tasks:

- Parse `SELECT_IDLECMD`.
- Parse `SELECT_BATTLECMD`.
- Parse `SELECT_CHAIN`.
- Parse `SELECT_CARD`.
- Parse `SELECT_YESNO`.
- Parse `SELECT_OPTION`.
- Create stable action IDs.
- Store hidden engine response bytes.

Acceptance criteria:

- A human can choose an action ID.
- The harness sends the mapped response to the engine.
- The duel advances.

### Milestone 4: Random Agent Can Complete A Duel

Deliverable:

```sh
pnpm bench run scenarios/smoke-duel.json --agent random
```

Expected result:

```txt
Scenario: smoke-duel
Agent: random
Result: completed
Winner: player 1
Decisions: 73
Illegal actions: 0
Trace: benchmark-runs/.../trace.jsonl
```

Implementation tasks:

- Randomly choose legal action IDs.
- Auto-continue until next prompt.
- Cap max decisions.
- Cap max engine frames.
- Save final score.

Acceptance criteria:

- No free-form move generation.
- No invalid engine responses.
- Every decision has an observation and legal-action list.

### Milestone 5: Browser Viewer

Deliverable:

```sh
pnpm bench run scenarios/smoke-duel.json --agent random --viewer
```

Expected result:

- A local browser page shows LP.
- Turn and phase are visible.
- Field, hand count, graveyard, banished, timeline, and chosen actions are visible.

Implementation tasks:

- Vite React app.
- WebSocket stream from CLI.
- Trace replay mode.
- Board reducer shared with CLI.
- Card name rendering.
- Simple zone layout.
- Timeline panel.

Acceptance criteria:

- A viewer can watch the duel progress live or replay it from `trace.jsonl`.

### Milestone 6: LLM Agent Chooses Legal Actions

Deliverable:

```sh
pnpm bench run scenarios/basic-001.json --agent llm --model ...
```

Expected result:

- Model selected a legal action ID.
- Engine accepted the response.
- Trace includes prompt, model response, chosen action, and board result.

Implementation tasks:

- LLM adapter.
- JSON schema validation.
- Retry once on invalid JSON.
- Fallback action on repeated invalid output.
- Prompt renderer.
- Private-info filter.
- Transcript recorder.

Acceptance criteria:

- The model never directly controls engine bytes.
- Invalid JSON is counted.
- Invalid action IDs are counted.
- Legal action IDs advance the engine.

### Milestone 7: First Benchmark Suite

Deliverable:

```sh
pnpm bench eval suites/mvp.json --agents random,greedy,llm
```

Expected result:

```txt
Suite: mvp
Scenarios: 20

Agent      WinRate  LethalFound  InvalidAction  AvgDecisions
random     0.10     0.05         0.00           18.2
greedy     0.35     0.25         0.00           11.4
llm        0.60     0.50         0.03           9.7
```

Implementation tasks:

- 10 tactical scenarios.
- 5 interruption scenarios.
- 5 multi-turn scenarios.
- Suite runner.
- CSV/JSON output.
- HTML report.
- Viewer links for each run.

Acceptance criteria:

- The benchmark separates random, greedy, and LLM behavior.
- At least some scenarios require more than one decision.
- At least some scenarios punish locally obvious but strategically bad lines.

## MVP Scenario Design

Start with simple, controlled cards. Avoid huge modern archetypes until the harness is stable.

Good first categories:

- Normal summon beatdown.
- Simple spell removal.
- Simple battle traps.
- One search effect.
- One graveyard recursion effect.
- One negate.
- One forced chain decision.
- One target-selection decision.

Then graduate into real archetype mini-scenarios.

The goal is not perfect meta simulation yet. It is:

- Engine-backed legality.
- Branching decisions.
- Memory across turns.
- Visible play trace.
- Measurable differences between agents.

## Data Pinning

Every run should record exact data versions:

```json
{
  "engine": {
    "adapter": "@ygo-bench/edopro-wasm",
    "ocgcoreWasmVersion": "0.1.3",
    "ocgcoreCommit": "..."
  },
  "data": {
    "cardScriptsCommit": "...",
    "babelCdbCommit": "...",
    "lfListsCommit": "...",
    "banlistHash": "..."
  },
  "scenario": {
    "id": "lethal-001",
    "version": "1.0.0",
    "hash": "..."
  }
}
```

This matters because Project Ignis update repositories are generated from canonical card scripts and BabelCDB, and EDOPro distributions retrieve updates for new cards, bug fixes, and `ocgcore` from that update flow.

## Hidden Information Policy

The engine knows everything. The model must not.

Create three state layers:

- Engine state: exact cards everywhere.
- Judge state: exact cards, seeds, scoring, full trace.
- Model observation: own hand, public field, known revealed cards, hidden-zone counts, legal actions only.

MVP strict visibility rules:

- Own hand: visible.
- Own field: visible.
- Own graveyard/banished: visible.
- Opponent field face-up cards: visible.
- Opponent set cards: hidden unless revealed.
- Opponent hand: count only.
- Opponent deck: count only.
- Opponent extra deck: count only unless revealed.
- Random selections: visible only if engine reveals them.

Required test:

```ts
expect(renderObservation(judgeState).text).not.toContain("Opponent hidden card name");
```

## Testing Strategy

Use snapshot-heavy tests:

- Message parser tests: raw binary message -> parsed frame.
- State reducer tests: frames -> public board state.
- Legal action tests: prompt -> legal actions + response bytes.
- Visibility tests: judge state -> model observation with hidden info removed.
- Scenario tests: oracle agent solves scenario.
- Regression tests: same seed + same agent -> same trace hash.

Most important test:

```txt
oracle agent can solve every benchmark scenario
```

If the oracle cannot solve it, the scenario is either broken, underspecified, or not benchmark-ready.

## Intentionally Deferred

Do not include these in the MVP:

- Full native Node addon.
- Full EDOPro network protocol.
- Full `.yrpX` replay writer.
- All modern top-tier decks.
- Side decking.
- Best-of-three matches.
- Deck-building optimization.
- RL training.
- Large-scale parallel execution.
- Card-art rendering.
- Mobile viewer.

These are valuable, but they are distractions before the core benchmark loop is proven.

## Main Risks

### Risk 1: Message Parsing Takes Longer Than Expected

Mitigation: parse only the messages needed for the first scenarios. The MVP can focus on prompt, movement, phase, LP, draw, attack, chain, and win messages.

### Risk 2: Arbitrary Scenario Setup Is Hard

Mitigation: start with deterministic deck-driven scenarios. Instead of injecting a complex board state immediately, use tiny decks and fixed seeds so the desired state appears naturally.

### Risk 3: LLM Gets Overwhelmed By Card Text

Mitigation: start with curated scenarios and compact card summaries. Later, add full official text as an ablation.

### Risk 4: Viewer Becomes A Product Rabbit Hole

Mitigation: render zones and timeline only. No animations needed.

### Risk 5: Licensing / Redistribution

Mitigation: pin dependencies, preserve licenses, and be cautious about redistributing Project Ignis data or assets. EDOPro and EDOPro core are AGPL-licensed, and the project states it is not affiliated with or endorsed by Shueisha or Konami.

## Final MVP Definition Of Done

The MVP is successful when this command runs:

```sh
pnpm bench eval suites/mvp.json --agents random,greedy,llm --viewer
```

And produces:

1. Engine-backed duels.
2. LLM chooses only legal action IDs.
3. Hidden information is filtered.
4. A browser viewer shows the duel unfold.
5. Every run produces a replayable trace.
6. Random, greedy, and LLM agents get meaningfully different scores.
7. At least one scenario requires multi-step planning.
8. At least one scenario requires adapting after an opponent response.
9. At least one scenario requires preserving resources across turns.
10. Oracle agent solves every scenario.

That proves the benchmark idea works.

After that, the next serious upgrade is replacing the WASM adapter with a native Node API or isolated C++ worker while keeping the TypeScript environment, scenario format, viewer, and agent interface unchanged.
