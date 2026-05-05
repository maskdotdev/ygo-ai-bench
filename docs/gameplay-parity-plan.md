# Gameplay Parity Plan

This plan turns the remaining gameplay work into sequenced implementation slices. The project is effectively an EDOPro-compatible engine reimplementation: it should execute real Project Ignis card scripts and reproduce EDOPro duel behavior for real sequences. The goal is not broad engine scaffolding; the goal is repeatable EDOPro parity, with fixture coverage that prevents timing regressions.

## Parity Target

Use EDOPro behavior as the rule oracle and Project Ignis/ygopro-core assets as upstream compatibility inputs:

- Project Ignis card scripts and CDB data are upstream inputs for script/API compatibility.
- EDOPro-observed duel behavior is the parity target for timing, windows, chain construction, prompts, resets, and final state.
- Local fixtures must store observed expectations explicitly, rather than treating this engine's current behavior as proof of parity.
- When EDOPro behavior and a simplified local helper disagree, the local helper should bend toward EDOPro. Gaps are parity backlog until implemented, with an owner and fixture notes that describe the expected EDOPro behavior.

## Current Baseline

The engine already has useful surfaces to build on:

- Battle state exists across `currentAttack`, `pendingBattle`, `battleStep`, `attackPasses`, `damagePasses`, and battle damage overrides.
- Legal actions are routed through `getLegalActions()` and `applyResponse()`, with pending prompts, chain links, pending triggers, and pending battle windows already serialized.
- The current battle implementation covers attack declaration, simple attack response windows, damage and damage calculation passes, damage override effects, attack negation, target/attacker leaving before damage, and basic battle destruction.
- Trigger collection now assigns explicit turn-player/opponent mandatory/optional buckets, exposes active trigger buckets through public state and snapshots, and derives `triggerOrderPrompt` state for active same-bucket trigger ordering. SEGOC, same-bucket ordering, trigger-order restore, Lua-created trigger buckets, and cross-player missed timing have fixture coverage. It still needs broader missed timing coverage, exact fast effect windows, and UI consumption of engine-owned ordering prompts.
- Summon helpers exist for Normal, Tribute, Flip, Fusion, Synchro, Xyz, Link, Ritual, and summon procedures, but they are simplified compared with EDOPro procedure helpers.
- Lua API coverage is broad enough for smoke probing, but should continue to be driven by failing real card scripts and fixture needs.

## North Star

A fixture should be able to express a real duel sequence, run it through this engine, and compare the final state, action windows, chain contents, prompts, trigger ordering, reset behavior, and serialized restore behavior against an EDOPro-observed outcome.

Deck probes remain useful smoke tests, but fixture-authored duel sequences are the main quality bar. Every fixture expectation that claims parity should be tied to an EDOPro-observed behavior, a Project Ignis script requirement, or a parity-backlog note that points back to the missing EDOPro behavior.

## Phase 0: Parity Fixture Harness

The harness should become the main development workflow before broad timing rewrites land. Battle, chain, summon, and reset work need intermediate-window assertions, not only final-state checks.

Deliverables:

- Extend scripted fixtures so each step can assert:
  - current window kind and window ID
  - legal actions by type, card code, label, effect ID, trigger ID, and player
  - chain contents
  - pending triggers or trigger buckets
  - pending prompts
  - battle state/window state
  - expected log/state deltas
- Add snapshot/restore checks at meaningful points inside fixtures, not only at the end.
- Store EDOPro-observed expectations as explicit JSON or TypeScript fixture data.
- Add fixture utilities for stepping legal actions by labels, card codes, window IDs, prompt IDs, grouped UI action buckets, and expected chain links.
- Keep real deck probes as smoke coverage, separate from parity fixture assertions.
- CI must run parity fixtures without network access. Upstream scripts/data used by fixtures should be vendored, locally cached, or represented by minimal test scripts.

Implementation files likely touched:

- `src/engine/parity.ts`
- `src/engine/duel/types.ts`
- `test/full-duel-engine-fixtures.ts`
- `test/duel-trigger-fixtures.ts`
- `test/lua-chain-fixtures.ts`
- `test/engine-harness*.test.ts`
- new `test/parity-fixtures/**` helpers

Acceptance gates:

- Fixtures fail with useful messages that name the expected window/action/state difference.
- A fixture can assert raw legal actions and grouped UI-facing legal actions before and after an action is applied, including actions/groups that must be absent.
- A fixture can snapshot/restore mid-chain, mid-trigger-bucket, and mid-battle-window.
- Fixture expectations can distinguish "matches observed EDOPro" from "known parity backlog" through `source`, and backlog expectations can carry a `note` that points to the missing EDOPro behavior.

## Phase 1: Battle Pipeline Refactor

Battle timing is the highest-priority missing feature because it touches fast effects, Lua APIs, legal actions, UI prompts, serialization, and many real cards.

Deliverables:

- Replace the coarse `battleStep` string with a serializable `BattleWindowState` model that can represent:
  - attack declaration
  - attack target confirmation
  - attack negation response timing
  - replay decision
  - start of damage step
  - before damage calculation
  - during damage calculation
  - after damage calculation
  - end of damage step
- Keep compatibility helpers for existing `battleStep` users until tests and UI are migrated.
- Model attack target loss and target set changes as replay candidates instead of always skipping resolution.
- Separate "attack was negated" from "attack stopped because battle cannot continue".
- Gate quick effects by battle sub-window instead of only broad damage-step flags.
- Preserve all battle window state in `serializeDuel()` and `restoreDuel()`.
- Add fixture observations for the EDOPro timing points before changing broad behavior.

Implementation files likely touched:

- `src/engine/duel/types.ts`
- `src/engine/duel/battle.ts`
- `src/engine/duel/core-battle.ts`
- `src/engine/duel/battle-continuation.ts`
- `src/engine/duel/attack-response-window.ts`
- `src/engine/duel/battle-window-actions.ts`
- `src/engine/duel/quick-effect-actions.ts`
- `src/engine/duel/snapshot.ts`
- `src/engine/lua/duel-api/battle.ts`
- `test/duel-battle.test.ts`
- new battle parity fixtures

Acceptance gates:

- Existing battle tests still pass.
- New fixtures cover direct attack, monster attack, attack negation, target leaving, target count changing with replay, damage calculation modifier, after damage calculation trigger, end of damage step trigger, and snapshot restore mid-window.
- Legal actions expose only the responses valid for the active battle sub-window.

## Phase 2: Chain And Timing Model

Once battle windows are explicit, the next slice is exact timing and trigger ordering.

Deliverables:

- Introduce an event/timing packet that records cause, previous location/state, current location/state, reason, reason player, chain context, and whether a trigger is "when" or "if".
- Replace implicit flat-list trigger ordering with explicit serializable EDOPro-style buckets:
  - turn player mandatory
  - non-turn player mandatory
  - turn player optional
  - non-turn player optional
- Keep deriving ordering prompt state for buckets with multiple same-player triggers instead of relying on registration order, and drive UI ordering from that engine-owned prompt state.
- Broaden missed timing coverage for "when optional" triggers after multi-step effects.
- Handle simultaneous events and SEGOC ordering consistently.
- Revisit fast effect response player selection after every action and chain resolution.
- Preserve active chain limits, including `Duel.SetChainLimit` and `Duel.SetChainLimitTillChainEnd`, across browser-safe snapshots. Fixture-backed limits can be restored by registry key today. Lua-created predicate limits currently fail closed with explicit missing chain-limit registry diagnostics; the remaining parity work is to rebuild or serialize those Lua predicates without re-running costs or target selection.

Implementation files likely touched:

- `src/engine/duel/triggers.ts`
- `src/engine/duel/pending-trigger-actions.ts`
- `src/engine/duel/effect-activation.ts`
- `src/engine/duel/event-history.ts`
- `src/engine/duel/core.ts`
- `src/engine/duel/response-dispatch.ts`
- `src/engine/lua/event-code.ts`
- `test/duel-trigger.test.ts`
- `test/lua-trigger-chain-window.test.ts`
- new SEGOC fixture file

Acceptance gates:

- Mandatory triggers cannot be declined.
- Optional triggers can be ordered or declined in legal bucket order.
- Simultaneous trigger fixtures match EDOPro-observed chains.
- Missed timing fixtures distinguish "when optional" from "if optional".
- Snapshot restore preserves pending trigger buckets and derived ordering prompt state.
- Snapshot restore preserves or explicitly reports active chain-limit predicates so reconnects cannot silently expose illegal chain responses.
- Existing trigger bucket tests and SEGOC fixtures should continue to assert explicit bucket state, grouped legal actions, and snapshot restore behavior.

## Phase 3: Summon Procedure Parity

Summoning parity should build on the improved chain/timing model because summon negation and summon-success triggers depend on exact windows.

Deliverables:

- Add summon attempt state separate from completed summon state.
- Add summon negation windows for Normal, Flip, inherent Special, and effect Special Summons where applicable.
- Deepen helper support for:
  - Fusion and contact Fusion materials
  - alternate material replacement
  - Synchro tuner/non-tuner constraints
  - Xyz overlay and rank constraints
  - Link rating/material counting
  - Ritual material amount and location constraints
  - Pendulum summon zones and face-up Extra Deck constraints
- Model zone pressure explicitly, especially Extra Monster Zone and linked zones if the project targets MR4/MR5 parity.
- Continue keeping simple card-data material helpers, but route Lua procedure helpers through the richer procedure model.

Implementation files likely touched:

- `src/engine/duel/summon.ts`
- `src/engine/duel/summon-materials.ts`
- `src/engine/lua/*procedure-api.ts`
- `src/engine/lua/*summonable.ts`
- `src/engine/lua/duel-api/summon.ts`
- `test/duel-fusion.test.ts`
- `test/duel-synchro.test.ts`
- `test/duel-xyz.test.ts`
- `test/duel-link.test.ts`
- `test/duel-ritual.test.ts`
- `test/duel-pendulum.test.ts`

Acceptance gates:

- Summon legality, material selection, material movement, and summon-success triggers are fixture-tested separately.
- Summon negation leaves cards in EDOPro-matching locations.
- Serialization works during material selection, summon attempt, summon negation window, and summon-success trigger windows.

## Phase 4: Continuous, Replacement, Immunity, And Reset Depth

This phase turns one-off continuous checks into a more complete conflict-resolution layer.

Deliverables:

- Define replacement selection order for destruction, release, send, banish, and battle destruction redirects.
- Add conflict handling when multiple replacements or redirects apply.
- Model immunity checks before costs, targets, operations, and continuous modifications where EDOPro distinguishes them.
- Expand lingering effect and reset semantics across phase, turn, location, chain, battle, and standard reset flags.
- Preserve replacement decisions and lingering effect state in snapshots when a prompt/window is pending.

Implementation files likely touched:

- `src/engine/duel/continuous-effects.ts`
- `src/engine/duel/replacement-effects.ts`
- `src/engine/duel/core-movement.ts`
- `src/engine/duel/effect-reset.ts`
- `src/engine/duel/reset-flags.ts`
- `src/engine/lua/effect-compatibility-api.ts`
- `src/engine/lua/card-effect-query-api.ts`
- `test/duel-destruction.test.ts`
- `test/duel-effect-reset.test.ts`
- `test/lua-continuous-effects.test.ts`

Acceptance gates:

- Fixtures cover indestructible effects, replacement effects, redirects, immunity, lingering stat/effect changes, and reset timing.
- Replacement conflicts require a deterministic selection path or prompt.
- Complex movement still preserves zone invariants and previous-state fields.

## Phase 5: Lua Compatibility Driven By Real Cards

Lua work should follow fixture failures and deck probes. Avoid implementing APIs only because they exist upstream; prioritize APIs that unblock real scripts and parity fixtures.

Deliverables:

- Keep running the API usage scanner against Project Ignis scripts.
- Add missing `Duel.*`, `Card.*`, `Effect.*`, `Group.*`, and `aux.*` APIs only with a failing script or fixture reference.
- Deepen procedure helper families:
  - persistent trap
  - union
  - equip
  - Spirit
  - Gemini
  - Pendulum
  - Ritual and Fusion helpers
- Improve label object and group behavior, operation info, hints, selection prompts, field IDs, and query helpers.
- Rebuild transient Lua callback state needed for active chain-limit predicates during snapshot restore, or replace the current Lua function-ref representation with a serializable predicate descriptor when the upstream script shape permits it.
- Add battle helper APIs after Phase 1 so they map to real battle sub-windows.

Implementation files likely touched:

- `src/engine/lua/**`
- `tools/scan-lua-api-usage.mjs`
- `tools/probe-lua-deck.ts`
- `test/lua-*.test.ts`
- curated Lua fixture files

Acceptance gates:

- Each new API has a small unit test plus at least one real-script or fixture motivation.
- Deck probes report fewer missing APIs without masking semantic failures.
- Lua prompt/selection APIs round-trip through browser-safe serialized prompts.
- Lua `Duel.SetChainLimit*` restore should keep the existing fail-closed missing-registry diagnostics until predicate restoration can preserve legal actions after reconnect.

## Phase 6: App-Facing Gameplay

UI work should follow stable engine windows so the app does not grow one-off state for timing rules that the engine should own.

Deliverables:

- Display legal actions grouped by current window: phase action, chain response, trigger order, attack response, damage-step response, replay choice, target/material selection.
- Add scripted autoplay that can execute fixture-style sequences through the browser playtest surface.
- Add UI for pending prompts:
  - yes/no
  - option selection
  - target selection
  - material selection
  - trigger ordering
  - battle replay decisions
- Lazy-load upstream scripts/data cleanly in browser mode without bundling unnecessary script payloads into the default app path.

Implementation files likely touched:

- `src/playtest-app/main.tsx`
- `src/playtest/api.ts`
- `src/playtest/agent-bridge.ts`
- `src/browser-playtest.ts`
- `vite.bridge.config.ts`
- browser playtest tests

Acceptance gates:

- The browser app can drive a battle fixture from start to finish using visible legal actions.
- Agent bridge can run scripted autoplay and report the exact diverging action/window on failure.
- Browser mode can load needed Lua scripts/data lazily and deterministically.

## Suggested First Pull Requests

1. Parity fixture harness upgrade:
   - add intermediate legal-action/window assertions
   - add snapshot/restore checks inside scripted fixtures
   - add EDOPro-observed expectation metadata with `source` and `note`
   - keep CI network-free

2. Battle window type migration:
   - add a serializable `BattleWindowState`
   - adapt current attack/damage pass logic to the new shape
   - keep existing behavior passing
   - add snapshot tests for each current battle sub-window

3. Replay and post-damage timing:
   - add replay decision state and legal actions
   - split damage calculation from after-damage and end-of-damage-step windows
   - add fixtures for target leaving, target count changing, damage calculation modifier, battle destruction trigger timing

4. Trigger bucket foundation:
   - replace implicit flat-list bucket behavior with explicit serializable pending trigger buckets
   - preserve current simple cases
   - add SEGOC fixtures for mandatory/optional, turn/non-turn player ordering

## Working Rules

- Add or update fixtures before broad implementation when the expected behavior can be expressed.
- Prefer narrow compatibility APIs that unblock named scripts over large speculative Lua surfaces.
- Do not treat deck probes as correctness proof; they are smoke tests.
- Every new pending window must be serializable and restorable before it is considered complete.
- Keep legal action display and engine legal action generation aligned; UI should not invent legality rules.
