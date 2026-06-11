# YGO Bench Long-Term Strategy Benchmark Plan

## Purpose

YGO Bench should rank models by their ability to play multi-turn Yu-Gi-Oh! strategically under a legal engine, not by their ability to solve isolated tactical prompts.

The benchmark's north star is:

> Measure which models are best at multi-turn strategy, long-term planning, resource management, adaptation, and win conversion in engine-legal Yu-Gi-Oh! scenarios.

Legal action selection is a prerequisite, not the benchmark goal. Immediate lethal puzzles, one-window chain decisions, and smoke duels are useful guardrails, but the core benchmark should reward models that form a durable plan, preserve future options, adapt after disruption, and turn long-term advantage into a win.

## Benchmark Definition

### V1 Mode

V1 should be an autonomous long-horizon benchmark:

- A fixed agent wrapper controls player 0.
- The model under test chooses player 0 actions.
- Player 1 is deterministic, scripted, or fixture-controlled.
- Scenarios are designed to last multiple decision turns unless the model finds a legitimate strategic win.
- All actions are applied through the engine's legal-action interface.
- Runs are deterministic given scenario seed, card data, scripts, model configuration, and retry policy, except for model nondeterminism that is recorded as part of the run.

This keeps the benchmark focused on model planning skill while avoiding the confounder of a second model's behavior.

### Later Modes

Agent-vs-agent play is valuable, but it should be a later mode. It introduces matchmaking, opponent variance, metagame effects, and harder attribution. The first reliable leaderboard should answer: "Given the same long-horizon task and opponent policy, which model plans and adapts best?"

## Non-Goals

- Do not optimize for immediate lethal puzzle solving as the primary leaderboard.
- Do not rank models by UI interaction speed.
- Do not compare agent scaffolds unless that is explicitly labeled as an agent benchmark.
- Do not hide fallback choices, retries, unsupported prompts, or model errors inside a normal-looking score.
- Do not treat human-vs-agent play scores as benchmark leaderboard scores.

## Core Capabilities To Measure

The benchmark should produce evidence for these abilities:

- Plan formation: the model can state a coherent multi-turn plan from the current state.
- Sequencing: the model orders actions to keep future lines open.
- Resource management: the model avoids unnecessary all-in lines, preserves cards, and values future turns.
- Tempo judgment: the model knows when to set up, pass, pressure, or push for lethal.
- Adaptation: the model revises the plan after disruption or unexpected opponent actions.
- Risk management: the model baits or avoids interruptions when appropriate.
- Hidden information handling: the model acts sensibly with incomplete knowledge.
- Win conversion: the model converts accumulated advantage into a win.

## Scenario Families

The current MVP suite can remain as a harness sanity check, but the long-term benchmark needs new scenario families.

### Setup Into Payoff

The best line spends early turns setting up a later payoff instead of taking the largest immediate action.

Examples:

- Search a future combo piece instead of summoning a medium threat.
- Set a defensive card now to protect next turn's engine starter.
- Delay activation until the payoff card is available.

Primary scoring signals:

- Plan reaches payoff state.
- Key resource is preserved.
- Model does not prematurely spend the setup piece.

### Resource Grind

The model must win by card advantage and board quality across several turns.

Examples:

- Trade one-for-one early, then generate advantage later.
- Choose between removal now and holding removal for a more valuable future threat.
- Avoid overextending into known punishment.

Primary scoring signals:

- Net card advantage over time.
- Board quality over time.
- Avoided wasteful activations.
- Win or dominant end state.

### Bait And Interruption

The best plan intentionally baits a response or avoids walking into it.

Examples:

- Present a lower-value action before committing the key starter.
- Pass with interaction instead of forcing a bad line.
- Use a low-value effect to draw out a negate.

Primary scoring signals:

- Correct bait action selected.
- Key action resolves later.
- Model's plan notes identify the interruption risk.

### Delayed Lethal

The model cannot win immediately, but can set up a lethal line over two or more turns.

Examples:

- Choose damage setup over current attack.
- Preserve battle phase or monster positioning for next turn.
- Avoid using a card that is needed for next-turn lethal.

Primary scoring signals:

- Lethal window is created.
- Model recognizes when to switch from setup to lethal.
- Win happens without throwing away the setup.

### Recovery After Disruption

The first plan is interrupted and the model must recover.

Examples:

- Opponent removes the initial threat.
- Opponent negates the first engine action.
- Model has a backup line but must recognize it.

Primary scoring signals:

- Model changes plan instead of repeating failed action.
- Backup line improves state.
- Model preserves enough resources to keep playing.

### Defensive Planning

The best line is not the most aggressive line.

Examples:

- Set pass with interruption.
- Choose defense position or conservative attack.
- Hold a board wipe until the opponent commits more resources.

Primary scoring signals:

- Survival over a defined horizon.
- Future advantage after defensive line.
- Avoided losing to obvious counterplay.

## Scenario Requirements

Each long-term scenario should declare:

- `family`: scenario family from the list above.
- `horizonTurns`: expected planning horizon, usually 2-5 turns.
- `objective`: human-readable strategic objective.
- `strategicConstraints`: things the model should preserve, avoid, or set up.
- `opponentPolicy`: deterministic opponent behavior.
- `expectedDecisionWindows`: prompt/action types expected during the scenario.
- `scoring`: explicit weights and rationale.
- `successConditions`: engine-observable outcomes that prove strategic success.
- `failureConditions`: engine-observable outcomes that prove strategic failure.
- `notes`: why this scenario tests long-term planning.

Example shape:

```json
{
  "id": "resource-grind-001",
  "family": "resource-grind",
  "horizonTurns": 4,
  "objective": "Establish recurring card advantage while preserving removal for the opponent's second threat.",
  "strategicConstraints": {
    "preserveUntil": [{ "card": "Key Removal", "turn": 3 }],
    "avoidBefore": [{ "actionType": "activate_effect", "card": "Board Wipe", "turn": 3 }]
  },
  "opponentPolicy": "scripted-resource-pressure-v1",
  "expectedDecisionWindows": ["SELECT_IDLECMD", "SELECT_CHAIN", "SELECT_BATTLECMD"],
  "scoring": {
    "win": 0.35,
    "resourceAdvantage": 0.25,
    "planConsistency": 0.15,
    "adaptation": 0.15,
    "illegalOrFallbackPenalty": 0.10
  }
}
```

## Model Interaction Contract

The prompt should ask the model for more than an action. It should ask for a compact planning state that can be audited.

Required model response:

```json
{
  "actionId": "a_003",
  "reason": "Short explanation for the current action.",
  "plan": {
    "horizon": "2-3 turns",
    "currentGoal": "Set up protected follow-up.",
    "futureLine": ["Set interaction", "Force opponent commitment", "Resolve payoff next turn"],
    "resourcesToPreserve": ["Key Starter", "Removal"],
    "risks": ["Opponent can remove the first monster"],
    "contingency": "If starter is removed, pivot to defensive line and hold removal."
  }
}
```

The harness should store the plan on every model decision. The plan text is not the only scoring source, but it gives the UI and audits a way to see whether the model had a coherent strategy or merely rationalized a local action.

## Scoring Model

The score should combine outcome, strategic progress, and behavior quality.

### Score Components

- `winScore`: 1 for win, 0 for loss, partial only for unfinished dominant states.
- `strategicProgressScore`: scenario-specific milestones reached.
- `resourceScore`: card advantage, board quality, preserved key resources.
- `adaptationScore`: response quality after opponent disruption or failed line.
- `planConsistencyScore`: whether actions match or coherently revise the stated plan.
- `riskManagementScore`: avoids known traps, baits interaction, does not overextend.
- `executionPenalty`: illegal actions, invalid JSON, fallback actions, model errors, unsupported prompt gaps, timeouts.

Suggested v1 weighting:

```text
overall =
  0.30 * winScore +
  0.25 * strategicProgressScore +
  0.15 * resourceScore +
  0.10 * adaptationScore +
  0.10 * planConsistencyScore +
  0.10 * riskManagementScore -
  executionPenalty
```

Weights should be scenario-configurable and visible in artifacts.

### Why Win Should Not Dominate

Winning matters, but if win/loss dominates too strongly, the benchmark becomes a tactical finish benchmark. Long-term planning scenarios should reward a model that builds the correct strategic position even if a deterministic cap, engine gap, or unfinished horizon prevents a final win.

### Required Score Fields

Scores should include:

- `mode`: `long-horizon-eval`, `human-vs-agent`, or another explicit mode.
- `suiteId`
- `scenarioId`
- `scenarioFamily`
- `agentId`
- `model`
- `competitorId`, for example `openai:gpt-4o-mini` or `greedy`.
- `runIndex`
- `seed`
- `status`: `completed`, `failed`, `unsupported-prompt`, `model-error`, `timeout`.
- `winner`
- `turnsTaken`
- `decisionsTaken`
- `overallScore`
- component scores listed above.
- error counters and penalty counters.
- prompt coverage telemetry.

## Engine And Harness Requirements

### Legal Action Coverage

Unsupported prompts must be explicit benchmark failures, not quiet low scores.

For every run, record:

- prompt types seen.
- prompt types handled.
- unsupported prompt types.
- legal action count per decision.
- fallback action count.
- auto-response count.

### Determinism Metadata

Every run should record:

- ocgcore version.
- card data hash.
- script source hash or commit.
- scenario hash.
- suite hash.
- model name.
- temperature and model parameters.
- prompt template version.
- retry policy.
- runner version or git commit.

### Opponent Policy

Player 1 should be deterministic in v1. Opponent policy should be named and recorded:

- `scripted-passive-v1`
- `scripted-pressure-v1`
- `scripted-disruption-v1`
- `scripted-resource-grind-v1`

The policy should be strong enough to create strategic pressure but simple enough that model comparisons are attributable.

### Artifact Hygiene

Generated benchmark artifacts should not pollute source-controlled tests.

Required changes:

- Tests write to temp directories.
- Normal runs write to `benchmark-runs/`.
- Committed fixture artifacts live in a separate fixture directory with clear purpose.
- `.gitignore` prevents accidental run-directory commits unless intentionally overridden.

## UI Requirements

The UI should make long-term strategy visible.

### New Eval Workspace

Add an `Eval` mode separate from `Replay` and `Play`.

Controls:

- suite selector.
- model matrix.
- runs per scenario.
- max decision cap.
- opponent policy.
- temperature/config fields.
- start/cancel buttons.

Live view:

- total progress.
- current scenario.
- current competitor.
- failures and unsupported prompts.
- aggregate leaderboard as runs complete.

### Leaderboard

Leaderboard should group by `competitorId`, not just `agentId`.

Columns:

- overall score.
- win rate.
- strategic progress.
- resource score.
- adaptation score.
- plan consistency.
- risk management.
- illegal/fallback/model-error counts.
- average tokens.
- average latency.
- cost estimate when available.

### Run Replay

Replay should show:

- current board state.
- legal actions.
- chosen action.
- model's stated plan.
- previous plan vs current action.
- plan revisions.
- component scoring notes.
- prompt coverage and engine warnings.

### Human Play

Human-vs-agent play remains useful for qualitative testing, but it should be clearly separate from benchmark scores. Its artifacts should not be included in long-horizon leaderboard summaries unless explicitly imported as qualitative examples.

## API Requirements

Add server APIs for eval execution:

- `POST /api/evals`
- `GET /api/evals`
- `GET /api/evals/:id`
- `GET /api/evals/:id/live`
- `GET /api/evals/:id/summary`
- `GET /api/evals/:id/runs`

Eval request:

```json
{
  "suitePath": "suites/long-horizon-v1.json",
  "competitors": [
    { "agentId": "openai", "model": "gpt-4o-mini", "temperature": 0 },
    { "agentId": "openai", "model": "gpt-4.1", "temperature": 0 },
    { "agentId": "greedy" }
  ],
  "runsPerScenario": 3,
  "maxDecisions": 120,
  "opponentPolicy": "scripted-resource-grind-v1"
}
```

## Implementation Roadmap

### Phase 1: Benchmark Contract

Deliverables:

- Add score schema fields for mode, model, competitorId, status, and component scores.
- Aggregate by competitorId.
- Keep existing real-eval working with backward-compatible summary loading.
- Mark human-vs-agent artifacts as non-leaderboard mode.

Acceptance criteria:

- Two OpenAI models in one eval produce two distinct leaderboard rows.
- Existing greedy/random evals still run.
- Human play no longer appears as a normal autonomous benchmark score.

### Phase 2: Long-Horizon Prompt Contract

Deliverables:

- Add versioned prompt template requiring action plus plan object.
- Store model plan per decision.
- Add plan fields to transcript and trace.
- Keep legacy agents compatible through default/synthetic plan fields.

Acceptance criteria:

- Every model decision stores action, reason, and plan.
- Replay can show the plan without parsing free-form text.

### Phase 3: Failure And Coverage Gates

Deliverables:

- Record prompt coverage telemetry.
- Convert unsupported prompt windows into explicit failed run statuses.
- Track fallback actions, auto-responses, invalid JSON, illegal action IDs, model errors, and timeouts.
- Move tests to temp artifact directories.

Acceptance criteria:

- A run summary clearly distinguishes model failure from engine/harness coverage failure.
- Test runs leave the working tree clean.

### Phase 4: Scenario Schema And First Suite

Deliverables:

- Define long-horizon scenario metadata.
- Create `suites/long-horizon-v1.json`.
- Add 10-15 scenarios across setup/payoff, grind, bait/interruption, delayed lethal, recovery, and defense.
- Add validation for scenario metadata and expected prompt coverage.

Acceptance criteria:

- The suite has no one-turn-only scenarios except controls.
- Each scenario documents why it tests long-term planning.
- `real-validate` reports scenario metadata and prompt coverage status.

### Phase 5: Strategic Scoring

Deliverables:

- Implement component scores.
- Add scenario-configurable scoring weights.
- Add scoring explanations to final artifacts.
- Show score breakdown in summary and replay UI.

Acceptance criteria:

- A run's score can be explained from artifacts without reading code.
- Tactical wins and strategic setup wins are distinguishable.

### Phase 6: Eval API

Deliverables:

- Add eval manager and eval lifecycle.
- Add API endpoints for starting, listing, streaming, and reading evals.
- Stream run completion and aggregate updates.
- Support cancellation.

Acceptance criteria:

- UI can launch a multi-model eval without shell commands.
- Closing the browser does not corrupt the eval artifacts.

### Phase 7: Eval UI

Deliverables:

- Add `Eval` mode.
- Add suite/model matrix controls.
- Add live progress and leaderboard.
- Add failure table.
- Link leaderboard rows to replay traces.

Acceptance criteria:

- A user can run and compare at least greedy, random, and one OpenAI model from the UI.
- The UI explains whether the score reflects long-term strategy, engine failure, or model invalid output.

### Phase 8: Calibration And Baselines

Deliverables:

- Run greedy, random, and oracle-like scripted baselines.
- Run at least two OpenAI models with fixed config.
- Review transcripts for false positives and false negatives.
- Adjust scenario weights and opponent policies based on observed issues.

Acceptance criteria:

- Random performs poorly.
- Greedy performs better on tactical controls but worse on long-horizon families.
- Stronger models show measurable gains in plan consistency, adaptation, and resource management.

## Milestone Definition Of Done

The long-horizon benchmark v1 is ready when:

- It has a named suite focused on 2-5 turn scenarios.
- It compares competitors by model, not only by agent wrapper.
- It records a structured plan for each model decision.
- It scores strategic progress, resource management, adaptation, plan consistency, risk management, and final outcome.
- It makes unsupported prompts and harness failures explicit.
- It has a UI path to launch, monitor, compare, and inspect evals.
- It has baseline results that demonstrate the suite is measuring more than immediate tactical action quality.

## Open Decisions

- Exact component score weights for each scenario family.
- Whether plan consistency should be rule-scored, judge-model-scored, or manually audited in v1.
- Which deterministic opponent policies are strong enough for long-horizon pressure.
- How many runs per scenario are needed for stable model rankings under nondeterministic model sampling.
- Whether v1 should force temperature 0 for all model comparisons.
- Whether to include cost-normalized leaderboard views.

