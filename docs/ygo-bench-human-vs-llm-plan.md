# YGO Bench Human Vs LLM Play Plan

## Goal

Add an interactive play mode where a human can play a real `ocgcore-wasm` duel against an OpenAI-controlled opponent through the browser UI.

The mode should answer:

> Can a human choose from engine-generated legal Yu-Gi-Oh actions while an OpenAI agent controls the opponent, with the same hidden-info, trace, and legal-action guarantees as the benchmark?

This is not a full EDOPro replacement. It is a controlled local duel client for the benchmark harness.

## MVP Outcome

The first playable command should be:

```sh
pnpm --filter @ygo-bench/app bench play \
  --scenario scenarios/real/smoke-duel.json \
  --opponent openai \
  --model gpt-4o-mini
```

It should start a local browser UI where:

1. Player 0 is the human.
2. Player 1 is the OpenAI agent.
3. The human sees only model-legal public/private information.
4. The human can click one legal action at each human prompt.
5. OpenAI automatically acts at its prompts.
6. The duel advances through `ocgcore-wasm`.
7. The UI shows board state, timeline, legal actions, LLM reasoning, and final result.
8. The whole session writes replayable artifacts under `benchmark-runs/play-.../`.

## What Exists Already

The current system already has most of the hard pieces:

- `runRealDuel` starts real ocgcore duels.
- `buildRealLegalActions` converts engine prompts into legal action IDs.
- `chooseRealAgentAction` can call random, greedy, oracle, or OpenAI agents.
- `normalizeMessages` produces human-readable trace events.
- `reduced-state.json` and trace frames power the viewer board.
- `bench ui` serves a React app and local API.
- WebSocket trace streaming already exists for viewer mode.

The missing piece is a stateful live duel session that can pause for human input instead of running an agent for every prompt.

## Product Scope

MVP workflows:

1. Start a human-vs-OpenAI session.
2. Choose legal human actions from the browser.
3. Watch OpenAI choose legal opponent actions.
4. Inspect each OpenAI reason after it acts.
5. Finish or concede the duel.
6. Save the session as normal benchmark artifacts.

Do not include in MVP:

- deck editor
- full matchmaking
- side decking
- best-of-three
- arbitrary board injection UI
- card art rendering
- mobile-first polish
- multiplayer over network
- human free-form move entry

## Architecture

Add an interactive play layer beside the existing benchmark runner:

```txt
Browser Play UI
  |
  | HTTP + WebSocket
  v
PlaySessionServer
  |
  v
PlaySessionManager
  |
  v
InteractiveDuelSession
  |
  v
ocgcore-wasm + Project Ignis scripts/CDB
```

The important distinction:

- Benchmark run: agent chooses every prompt until the duel ends.
- Play session: engine pauses when the current prompt belongs to the human.

## Proposed Files

```txt
apps/ygo-bench/src/
  play/
    PlaySession.ts
    PlaySessionManager.ts
    playServer.ts
    playTypes.ts
    humanAgent.ts
    sessionArtifacts.ts
    sessionLoop.ts

  viewer-app/
    components/
      PlayView.tsx
      PlayBoard.tsx
      HumanActionPanel.tsx
      OpponentThinkingPanel.tsx
      PlayTimeline.tsx
      PlaySetup.tsx
    state/
      playClient.ts
```

Refactor shared engine logic out of `edopro-wasm/realRunner.ts` only where needed. Avoid rewriting the benchmark runner.

## Session Model

```ts
export interface PlaySession {
  id: string;
  scenarioId: string;
  humanPlayer: 0 | 1;
  opponentAgent: "openai" | "greedy" | "random";
  model?: string;
  status: "starting" | "waiting_for_human" | "thinking" | "running" | "finished" | "error";
  currentPrompt?: PlayPrompt;
  legalActions: PublicLegalAction[];
  reducedState: RealReducedState;
  timeline: TraceFrame[];
  lastOpponentDecision?: {
    actionId: string;
    label: string;
    reason: string;
    tokenCount: number | null;
  };
  score?: ScenarioScore;
  runDir: string;
}
```

Hidden fields stay server-only:

```ts
interface InternalPlaySession {
  core: OcgCoreSync;
  handle: OcgDuelHandle;
  scenario: RealScenario;
  cardDb: BrowserCardDatabase;
  legalActionsById: Map<string, RealLegalAction>;
  traceWriter: TraceWriter;
}
```

The browser must never receive engine response bytes.

## API Shape

Local-only server routes:

```txt
POST /api/play/sessions
GET  /api/play/sessions
GET  /api/play/sessions/:id
POST /api/play/sessions/:id/actions
POST /api/play/sessions/:id/concede
GET  /api/play/sessions/:id/transcript
WS   /api/play/sessions/:id/live
```

Create session request:

```json
{
  "scenarioPath": "scenarios/real/smoke-duel.json",
  "humanPlayer": 0,
  "opponentAgent": "openai",
  "model": "gpt-4o-mini",
  "maxDecisions": 80
}
```

Human action request:

```json
{
  "actionId": "a_003"
}
```

Session response:

```json
{
  "id": "play-2026-05-27T...",
  "status": "waiting_for_human",
  "reducedState": {},
  "legalActions": [
    {
      "id": "a_003",
      "type": "normal_summon",
      "label": "Normal Summon Alexandrite Dragon"
    }
  ],
  "timeline": [],
  "lastOpponentDecision": null
}
```

## Engine Loop

The play loop needs to run until one of four outcomes:

1. Duel ended.
2. Engine needs a human response.
3. Engine needs an AI response and the AI is currently thinking.
4. Error or max decision/frame cap.

Pseudo-code:

```ts
async function advanceSession(session: InternalPlaySession): Promise<PlaySessionView> {
  while (true) {
    const status = core.duelProcess(handle);
    const messages = core.duelGetMessage(handle);

    writeEngineFrames(messages);
    const events = normalizeMessages(...);
    writeTrace(events);
    stateReducer.apply(events);

    if (status === END) return finishSession(session);
    if (status === CONTINUE) continue;
    if (autoRespond(core, handle, messages, ocg)) continue;

    const prompt = extractPrompt(messages);
    const legalActions = buildRealLegalActions(prompt, ocg, cardDb);
    const promptPlayer = prompt.player;

    if (promptPlayer === session.humanPlayer) {
      session.status = "waiting_for_human";
      session.legalActionsById = indexById(legalActions);
      return publicSessionView(session, legalActions);
    }

    session.status = "thinking";
    broadcast(session);

    const choice = await chooseRealAgentAction({
      agentId: session.opponentAgent,
      scenario,
      state,
      prompt,
      legalActions,
      model,
    });

    writeDecisionTrace(choice);
    core.duelSetResponse(handle, choice.action.response);
  }
}
```

Human action handling:

```ts
async function submitHumanAction(sessionId: string, actionId: string) {
  const session = manager.get(sessionId);
  assert(session.status === "waiting_for_human");

  const action = session.legalActionsById.get(actionId);
  if (!action) return invalidActionError();

  writeDecisionTrace({
    player: session.humanPlayer,
    chosen: { actionId, reason: "Human selected in UI" },
  });

  core.duelSetResponse(session.handle, action.response);
  return advanceSession(session);
}
```

## UI Shape

Add a `Play` tab or mode to the existing app.

Layout:

```txt
┌──────────────────────────────────────────────────────────────┐
│ Play Header: scenario, human side, opponent, status, score   │
├───────────────┬───────────────────────────────┬──────────────┤
│ Setup / Runs  │ Board                         │ Timeline     │
│               │ Human Action Panel            │ LLM Reason   │
└───────────────┴───────────────────────────────┴──────────────┘
```

Required UI panels:

- `PlaySetup`: start new game with scenario, opponent, model.
- `PlayBoard`: current reduced board state.
- `HumanActionPanel`: buttons for legal actions when waiting for human.
- `OpponentThinkingPanel`: shows "OpenAI thinking" and last chosen reason.
- `PlayTimeline`: chronological trace events and decisions.
- `SessionArtifactsPanel`: links to saved trace/transcript/score after finish.

Action buttons should be grouped by type:

- summon / set
- activate
- battle
- chain response
- phase / pass
- selection prompts

Each action button should show:

```txt
Normal Summon Blue-Eyes White Dragon
type: normal_summon
id: a_004
```

Do not show engine response bytes.

## Hidden Information Rules

Use the same observation filtering as the benchmark model path.

Human should see:

- own hand
- own field
- own graveyard/banished
- opponent face-up public cards
- hidden card counts
- legal actions

Human should not see:

- opponent hand card names
- opponent deck order
- opponent set card names unless revealed
- engine response bytes
- random seed internals

OpenAI should receive the same filtered observation for its player.

Add tests that assert both human and OpenAI observations exclude hidden opponent card names.

## OpenAI Behavior

Use the existing OpenAI agent adapter.

Server-side behavior:

- Require `OPENAI_API_KEY` for `opponentAgent=openai`.
- Set status to `thinking` while waiting.
- Retry once on invalid JSON.
- Fall back to a deterministic legal action after repeated model failure.
- Record:
  - raw model response
  - parsed action ID
  - reason
  - invalid JSON count
  - illegal action count
  - token count
  - latency

The human UI should show the opponent's reason only after the opponent action has been submitted to the engine.

## Artifact Output

Each play session should write:

```txt
benchmark-runs/
  play-2026-05-27T.../
    trace.jsonl
    final-score.json
    model-transcript.md
    metadata.json
    reduced-state.json
    engine-messages.bin
```

Play sessions should be inspectable later in the existing replay UI.

Metadata additions:

```json
{
  "mode": "human-vs-agent",
  "humanPlayer": 0,
  "opponentAgent": "openai",
  "model": "gpt-4o-mini"
}
```

## CLI

Add:

```sh
pnpm --filter @ygo-bench/app bench play
```

Flags:

```txt
--scenario scenarios/real/smoke-duel.json
--human-player 0
--opponent openai
--model gpt-4o-mini
--max-decisions 80
--port 4173
```

Default:

```txt
scenario: scenarios/real/smoke-duel.json
human-player: 0
opponent: greedy if OPENAI_API_KEY is missing, otherwise openai
port: 4173 or first available
```

## Implementation Milestones

### Milestone 1: Extract Interactive Engine Driver

Deliverable:

```sh
pnpm --filter @ygo-bench/app test -- play
```

Tasks:

- Extract reusable duel setup from `runRealDuel`.
- Create `InteractiveDuelSession`.
- Implement `advanceSession`.
- Pause at human prompts.
- Continue through auto-responses.

Acceptance:

- A test can start a session and reach a `waiting_for_human` prompt.
- Legal action IDs are available.
- No engine response bytes are exposed in public session JSON.

### Milestone 2: Human Action Submission

Deliverable:

```ts
await session.submitHumanAction("a_001");
```

Tasks:

- Store legal actions by ID server-side.
- Validate action ID.
- Submit hidden response to ocgcore.
- Advance to next human prompt or finish.
- Write human decision trace frames.

Acceptance:

- Human legal action advances the duel.
- Invalid action is rejected without touching the engine.
- Trace includes human decision frames.

### Milestone 3: AI Opponent Turn

Deliverable:

```txt
Human submits action -> OpenAI/greedy responds automatically -> human prompt returns.
```

Tasks:

- Route non-human prompts to existing `chooseRealAgentAction`.
- Add status `thinking`.
- Broadcast status over WebSocket.
- Record model reason and metrics.

Acceptance:

- Greedy opponent works without API key.
- OpenAI opponent works with API key.
- Model failures fall back to a legal action.

### Milestone 4: Play API Server

Deliverable:

```sh
pnpm --filter @ygo-bench/app bench play --opponent greedy
```

Tasks:

- Add `playServer.ts`.
- Add session manager.
- Add local HTTP routes.
- Add WebSocket live updates.
- Add session cleanup on process exit.

Acceptance:

- Browser can create a session.
- Browser can submit action IDs.
- Browser receives live state updates.

### Milestone 5: Browser Play UI

Deliverable:

```txt
Play mode appears in the UI and can complete a short smoke duel.
```

Tasks:

- Add Play tab/mode.
- Add setup controls.
- Add current board.
- Add legal action panel.
- Add opponent thinking/reason panel.
- Add timeline.
- Add finished-session artifact links.

Acceptance:

- Human can click legal actions.
- OpenAI/greedy acts automatically.
- UI clearly indicates whose turn/prompt it is.
- Finished session can be opened in replay mode.

### Milestone 6: Tests And Hardening

Deliverable:

```sh
pnpm --filter @ygo-bench/app test
pnpm --filter @ygo-bench/app build
pnpm --filter @ygo-bench/app viewer:build
```

Tasks:

- Unit tests for session state transitions.
- API tests for create/action/concede.
- Hidden-info tests for human and OpenAI views.
- Regression test that play trace can be replayed.
- Timeout/fallback test for AI opponent.

Acceptance:

- Test suite passes.
- No hidden engine response bytes in API payloads.
- Completed play session appears in run browser.

## Main Risks

### Risk 1: Prompt Ownership Is Ambiguous

Some engine prompts may not map cleanly to player 0 or 1.

Mitigation:

- Start with prompt types already handled by `buildRealLegalActions`.
- Auto-respond to empty chain/yes-no prompts as benchmark runner already does.
- Log unknown prompt frames explicitly.

### Risk 2: Session State Can Diverge From Trace

If board state updates only in memory and trace writing fails, the replay becomes untrustworthy.

Mitigation:

- Write trace frames before broadcasting UI updates.
- Rebuild public state from the same reducer used by replay.
- Add trace replay regression tests.

### Risk 3: OpenAI Latency Makes The UI Feel Frozen

Mitigation:

- Broadcast `thinking` immediately.
- Show spinner/status and last prompt.
- Use request timeout and fallback action.

### Risk 4: Human UI Is Too Verbose

Mitigation:

- Group actions by type.
- Show labels first, IDs second.
- Keep full prompt JSON behind an expandable panel.

## Definition Of Done

Human-vs-LLM play mode is done when:

1. `bench play` starts a local playable UI.
2. A human can play as Player 0 by clicking legal action IDs.
3. OpenAI can play as Player 1.
4. Greedy/random opponents work without API keys.
5. Hidden info is filtered for both human and OpenAI observations.
6. The engine accepts every submitted action.
7. The UI shows board, timeline, legal actions, opponent reason, and final score.
8. Finished sessions write normal run artifacts.
9. Finished sessions can be inspected in the existing replay UI.
10. Build and tests pass.

