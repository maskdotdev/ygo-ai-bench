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
- Legal actions are routed through `getLegalActions()` and `applyResponse()`, with pending prompts, chain links, pending triggers, and pending battle windows already serialized; grouped chain-response actions preserve UI-facing window IDs/kinds, restored prompt response actions are pinned to public prompt window IDs/kinds with stale restored prompt choices rejected after resolution, and restored Lua response/action-list fixtures now assert raw `legalActions` beside grouped UI-facing actions for the covered restored windows.
- The current battle implementation covers attack declaration, explicit `BattleWindowState` sub-windows, replay decisions, damage and damage-calculation passes, damage override effects, attack negation, target/attacker leaving before damage, target-count replay, end-of-damage-step windows, and basic battle destruction. Battle fixtures now pin explicit `battleWindow` state, matching `waitingFor` response players, window IDs, grouped legal actions, battle-window quick-effect action stamps, battle-damage reason player payloads, damage-step/damage-calculation fast-effect timing, snapshot restore, stale restored pass rejection, and restored Lua battle trigger windows with stale replay rejection.
- Trigger collection now assigns explicit turn-player/opponent mandatory/optional buckets, exposes active trigger buckets through public state and snapshots, and derives `triggerOrderPrompt` state for active same-bucket trigger ordering. SEGOC, same-bucket ordering, trigger-order restore, optional/mandatory shared-count trigger restore, chainSolved-before-chainEnded trigger bucket progression through restored chain resolution, restored declines, restored mixed activation/decline handoffs, and restored cross-player optional activations, restored fast-effect priority after cross-player optional trigger activations, restored mandatory trigger-chain fast-effect pass handoff plus alternating opponent-response/returned turn-player restore, one-chain/until-chain-end limiter restore with continued trigger-player follow-up windows, and cleared one-chain limiter opponent-response restore, Lua-created trigger buckets, registry-backed Lua trigger timing restore, Lua chain-limit response-window coverage, real Project Ignis Ra summon-success source-only continuous chain-limit coverage, restored known/named/single-card/multi-card/target-card/current-chain target-card/type-mask/captured event-player action-type chain-player/source-type effect-type/source-type effect-type setcode/response-player/handler-code/multi-handler-code/response-player handler-code/response-matches-chain-player/single and combined effect-type/response-player effect-type/direct active-type/response-player active-type allow/link-monster and no-Level active-type/spell-trap non-activation response-player Lua chain-limit predicates, restored Lua trigger-timing response windows with stale replay rejection, restored engine/Lua trigger-bucket response windows, restored Lua event-trigger result action surfaces across movement, LP, overlay, battle, flip, and material events, restored engine/Lua chain-response pass and quick-effect windows, restored Main Phase 2 phase-preserving, end-turn new-turn, post-Normal-Summon, post-Tribute-Summon, post-Tribute-Set, post-Special-Summon, post-Fusion-Summon, post-Synchro-Summon, post-Xyz-Summon, post-Link-Summon, post-Ritual-Summon, post-Monster-Set, post-Flip-Summon, post-Pendulum-Summon, post-position-change, and post-Spell/Trap-Set open fast-effect pass handoff, restored open fast-effect chain-response pass-handoff pass, chain-return, and turn-follow-up windows with one-chain and until-chain-end limits, restored post-chainEnded open fast-effect handoff windows with opponent-response and returned turn-player one-chain and until-chain-end limits through final pass-pass resolution, continued follow-up pass-resolution, and final-response resolution, restored turn-player and opponent-response one-chain plus until-chain-end open fast-effect pass-handoff windows, and cross-player plus Lua position-change/destroy-family/normal-summon-attempt/flip-summon-attempt/special-summon-attempt/normal-summon-success/flip-summon-success/special-summon-success/normal-summon-negated/flip-summon-negated/special-summon-negated/monster-set/spell-trap-set/confirmed-event/hand-confirm/coin-dice random-result/coin-dice toss-negated activation/decline missed timing, including `EVENT_DESTROY`/`destroying`, `EVENT_SUMMON`/`normalSummoning`, `EVENT_FLIP_SUMMON`/`flipSummoning`, `EVENT_SPSUMMON`/`specialSummoning`, `EVENT_SUMMON_SUCCESS`/`normalSummoned`, `EVENT_FLIP_SUMMON_SUCCESS`/`flipSummoned`, `EVENT_SPSUMMON_SUCCESS`/`specialSummoned`, `EVENT_SUMMON_NEGATED`/`normalSummonNegated`, `EVENT_FLIP_SUMMON_NEGATED`/`flipSummonNegated`, `EVENT_SPSUMMON_NEGATED`/`specialSummonNegated`, `EVENT_MSET`/`monsterSet`, `EVENT_SSET`/`spellTrapSet`, `EVENT_TOSS_COIN_NEGATE`/`coinTossNegated`, and `EVENT_TOSS_DICE_NEGATE`/`diceTossNegated`, have fixture coverage. It still needs broader missed timing coverage, exact fast effect windows, arbitrary Lua chain-limit closure restore, and UI consumption of engine-owned ordering prompts.
- Summon helpers exist for Normal, Tribute, Flip, Fusion, Synchro, Xyz, Link, Ritual, Pendulum, and summon procedures, with restored core summon, Lua summon procedure, summon-attempt trigger, summon-negated trigger, Pendulum Summon, full-zone Extra Deck material, and failed material/release rollback actions pinned to public window IDs/kinds; failed restored rollback groups are stamped for UI consumption, and stale restored core summon, procedure, attempt-trigger, negated-trigger, Pendulum Summon, and Extra Deck summon responses are rejected after the window advances. The helpers are still simplified compared with EDOPro procedure helpers.
- Lua API coverage is broad enough for smoke probing, including active effect type helpers such as `GetActiveType`/`IsActiveType`, but should continue to be driven by failing real card scripts and fixture needs.

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

## Phase 1: Battle Pipeline Depth

Battle timing remains high priority because it touches fast effects, Lua APIs, legal actions, UI prompts, serialization, and many real cards. The initial pipeline refactor is already in place; remaining work should focus on exact EDOPro edge cases and real-card failures.

Completed baseline:

- A serializable `BattleWindowState` model represents:
  - attack declaration
  - attack target confirmation
  - attack negation response timing
  - replay decision
  - start of damage step
  - before damage calculation
  - during damage calculation
  - after damage calculation
  - end of damage step
- Attack target loss and target set changes are represented as replay candidates.
- Attack negation is tracked separately from battle continuation failures.
- Quick effects are gated by battle sub-window, including damage-step-only and damage-calculation-only windows.
- Battle window state is preserved through `serializeDuel()` and `restoreDuel()`.
- Fixture observations cover direct attack, monster attack, attack negation, target leaving, target count changing with replay, damage calculation modifiers, after-damage triggers, end-of-damage-step triggers, and snapshot restore mid-window.

Remaining deliverables:

- Expand battle timing coverage from fixture-local effects to more real Project Ignis scripts that use battle helper APIs.
- Deepen "during damage calculation" edge behavior for modifiers, replacement effects, and response priority where EDOPro distinguishes sub-steps beyond the current window kinds.
- Add fixtures for battle destruction replacement conflicts and simultaneous post-battle triggers when multiple cards are destroyed or redirected.
- Keep compatibility helpers for existing `battleStep` users until UI and script consumers fully migrate to `battleWindow`.

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
- New fixtures cover each newly discovered EDOPro battle edge before implementation changes land.
- Legal actions expose only the responses valid for the active battle sub-window.

## Phase 2: Chain And Timing Depth

Once battle windows are explicit, the next slice is exact timing and trigger ordering. The initial trigger bucket foundation is already in place; remaining work should deepen event payload accuracy, fast-effect priority, missed timing coverage, and Lua predicate restore.

Completed baseline:

- Trigger collection assigns explicit serializable EDOPro-style buckets:
  - turn player mandatory
  - non-turn player mandatory
  - turn player optional
  - non-turn player optional
- Public state derives `triggerOrderPrompt` for active same-player buckets with multiple triggers.
- Snapshot restore preserves pending trigger buckets and derived ordering prompt state.
- Optional trigger declines, optional trigger activations, and mandatory trigger handoff are restored without exposing later buckets early.
- SEGOC fixtures pin turn-player mandatory before non-turn mandatory, and same-player mandatory before optional.
- Lua-created trigger buckets, restored Lua trigger timing windows, and restored trigger-bucket chain windows have fixture coverage.
- Event history, pending triggers, and chain links can carry serialized event-card previous/current state packets and moved-card reason flags/player/card/effect IDs. Pending trigger/chain payloads preserve explicit `if`/`when` trigger timing and chain events carry explicit chain depth/link IDs, with snapshot coverage for moved-card and Lua chain-event trigger payloads.

Remaining deliverables:

- Continue enriching the event/timing packet with broader cause metadata beyond moved-card and chain-origin context.
- Broaden missed timing coverage for "when optional" triggers after multi-step effects.
- Revisit fast effect response player selection after every action and chain resolution.
- Preserve active chain limits, including `Duel.SetChainLimit` and `Duel.SetChainLimitTillChainEnd`, across browser-safe snapshots. Fixture-backed limits can be restored by registry key today, and Lua-created predicates now restore when they are known globals such as `aux.TRUE`/`aux.FALSE`, direct or named literal `return true`/`return false` predicates, named card-table functions such as `s.chlimit`/`s.chainlm`/`s.climit`/`s.chainlimit` and numbered named predicates, official-style named response-player and direct effect-type predicates such as `s.climit(e,lp,tp)` and `s.chainlimit(e,rp,tp)`, Project Ignis-style single-card factory, direct captured single-card, and multi-card closures that allow or block captured cards' own handlers, Project Ignis-style target-card, current-chain target-card, and type-mask factory or direct source-type closures that block matching handler card types or selected target handlers, captured event-player action-type closures such as `s.limit(ep)` that allow a source type only for a derived chain player, source-type plus effect-type closures that block combinations such as Trap activations with optional source setcode exclusions, active-type plus effect-type closures that block Spell/Trap activations such as `s.elimit`, handler-code closures that capture the allowed responding effect handler code, capture multiple allowed handler codes through `IsCode(...)`, use a direct literal handler-code equality check, or combine response-player equality with handler-code checks, response-player closures that capture the allowed responding player, chain-player closures that capture the original activating player, direct and named response-player equals chain-player checks, direct response-player-or-active-type allow, response-player-or-not-effect-type, response-player-or-not-active-type, and direct or named response-player-or-source-type non-activation checks including Spell/Trap and Trap-only variants, direct `not e:IsHasType(...)` single and combined effect-type checks, direct or named `not e:IsMonsterEffect()`/spell/trap active-type checks, direct single and combined `not e:IsActiveType(TYPE_*)` checks, direct or named response-player-or-not-active-type checks, direct or named `not (e:IsMonsterEffect() and e:GetHandler():IsLinkMonster())`, or direct `not (e:IsMonsterEffect() and not e:GetHandler():HasLevel())` active-type checks. Arbitrary Lua-created one-chain and until-chain-end predicate closures still fail closed by restoring deny-all raw guards without registry keys, hiding every Lua restore legal-action surface, and reporting explicit missing chain-limit registry diagnostics; the remaining parity work is to rebuild or serialize those broader Lua predicates without re-running costs or target selection.

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
- New missed timing fixtures distinguish "when optional" from "if optional" for each newly covered multi-step operation family.
- Snapshot restore preserves pending trigger buckets and derived ordering prompt state.
- Snapshot restore preserves or explicitly reports active chain-limit predicates so reconnects cannot silently expose illegal chain responses.
- Existing trigger bucket tests and SEGOC fixtures should continue to assert explicit bucket state, grouped legal actions, shared count-code trigger progression, and snapshot restore behavior.

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
- Replacement conflicts require a deterministic selection path or prompt. Current coverage includes falling through declined or otherwise inapplicable Lua destruction, release, and send replacement candidates to later valid candidates, preserving and respecting used Lua replacement count limits across snapshot restore, gating Lua destruction, release, and send replacement eligibility through `SetValue` threatened-card predicates, exposing pending destination/reason context to single-card send replacement targets, exposing pending reason-player context to single-card destroy replacement targets, applying Lua self, destroyer-carried battle-destroy, and to-Grave callback redirects, treating field redirect, field immunity, effect-targeting restrictions, and trigger-lockout `SetTargetRange` values as card location masks unless `EFFECT_FLAG_PLAYER_TARGET` is set, and treating EDOPro player-selector `SetTargetRange(1,0)` patterns for cost-use, cost-to-grave, cannot-change-position, and battle-destroy redirect effects as player-scoped selectors. Field immunity query coverage also applies Lua `SetTarget` card predicates before `SetValue` immunity checks, `Card.IsDestructable(effect)` now treats matching immunity as non-destructible while respecting `EFFECT_FLAG_IGNORE_IMMUNE`, and effect-reason Lua movement helpers now block active-effect `Duel.Destroy`, `Duel.SendtoGrave`, `Duel.Release`, `Duel.Remove`, `Duel.SendtoHand`, `Duel.SendtoDeck`, `Duel.SendtoExtra`, generic `Duel.Sendto`, `Duel.MoveToDeckTop`, `Duel.MoveToDeckBottom`, `Duel.ReturnToField`, `Duel.SpecialSummon`, and `Duel.SpecialSummonStep` from moving immune cards unless the active effect ignores immunity, while cost-reason movement remains unblocked by effect immunity. Active-effect immunity coverage also blocks Lua control changes, control swaps, position changes, sequence changes, attack/defense/Level/Rank/Link/Scale updates, counter placement and effect-reason counter removal, `Card.CopyEffect` receivers, equips to immune targets, and overlay attachment of immune materials unless the active effect ignores immunity. Counter API coverage also includes upstream batch helpers `Card.GetAllCounters` and `Card.RemoveAllCounters`, `Card.EnableCounterPermit`/`Card.SetCounterLimit` registration, `COUNTER_WITHOUT_PERMIT`, `COUNTER_NEED_ENABLE`, `IsCanAddCounter` location probes, target-filtered counter permits, singly counter-limit clamping, silent counter cleanup when single counter-permit effects are deleted or reset, EDOPro-style permanent versus reset-while-negated counter buckets that preserve only permanent `COUNTER_WITHOUT_PERMIT` counters through card disable, and counter cleanup on EDOPro movement reset destinations.
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
- Continue replacing transient Lua function-ref chain-limit predicates with serializable descriptors when the upstream script shape permits it; known globals, direct or named literal true/false predicates, named card-table one-link and until-chain-end predicates, captured handler equality/exclusion closures, multi-card handler-exclusion closures, target-card, current-chain target-card, and type-mask response-player closures, captured event-player action-type/chain-player closures, source-type plus effect-type closures with optional source setcode exclusions, active-type plus effect-type Spell/Trap activation blocks, single-code and multi-code handler-code closures, inline literal handler-code equality checks, response-player-or-handler-code checks, response-player closures, chain-player closures, direct or named response-player equals chain-player checks, direct or named response-player-or-active-type allow, response-player-or-not-effect-type, response-player-or-not-active-type, and direct or named response-player-or-Spell/Trap and Trap-only non-activation checks, direct `not e:IsHasType(...)` single and combined effect-type checks, direct or named `not e:IsMonsterEffect()`/spell/trap active-type checks, direct single and combined `not e:IsActiveType(TYPE_*)` and direct or named response-player-or-not-active-type checks, and direct or named Link Monster/no-Level active-type checks are covered, while broader arbitrary closure predicates still need descriptor work.
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
- Lua `Duel.SetChainLimit*` restore should keep fail-closed missing-registry diagnostics and deny-all raw restore guards for predicate shapes that do not yet have a serializable descriptor, so reconnects never expose illegal chain responses.

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

2. Battle pipeline depth:
   - add real-script battle helper fixtures for cards that depend on exact Battle Step/Damage Step timing
   - deepen damage-calculation modifier and replacement conflict fixtures
   - keep every new battle sub-window serializable and stale-response guarded

3. Chain and timing depth:
   - add richer event/timing payload fixtures for previous/current state, reason player, chain context, and related effect data
   - broaden optional `when` missed-timing fixtures by real operation family
   - revisit fast-effect priority after chain resolution and battle sub-windows
   - continue serializing Lua chain-limit predicate descriptors only where semantics are known

## Working Rules

- Add or update fixtures before broad implementation when the expected behavior can be expressed.
- Prefer narrow compatibility APIs that unblock named scripts over large speculative Lua surfaces.
- Do not treat deck probes as correctness proof; they are smoke tests.
- Every new pending window must be serializable and restorable before it is considered complete.
- Keep legal action display and engine legal action generation aligned; UI should not invent legality rules.
