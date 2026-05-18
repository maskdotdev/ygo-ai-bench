# Parity Completion Audit

Audit date: 2026-05-18

## End-State Goal

Achieve a working Yu-Gi-Oh! duel engine with EDOPro/Project Ignis behavioral parity for real gameplay:

- execute upstream Project Ignis card scripts through the local Lua bridge
- preserve correct timing, windows, chains, prompts, resets, summons, battle, control, movement, and restore semantics
- keep parity guardrails green
- prove behavior through targeted representative fixtures and deck probes, not one fixture per card

## Current Evidence

- `bun run check` passes after the upstream refresh and expectation fixes. The check gates Lua parity scans, prompt/chain-limit scans, clean restore, event/chain/effect assertion scans, fixture provenance, legal-action evidence, deck probes, browser asset manifests, typecheck, tests, builds, and bridge bundle limits.
- `bun run report:parity-progress` reports:
  - Lua APIs: 898 upstream-used, 1222 implemented, 0 missing
  - Lua constants: 1777 upstream, 1818 local, 0 missing
  - Clean restore: 772/772 fixtures, 100.0%
  - Fixture provenance: 945 files, 4939 expectation blocks, 0 backlog
  - Direct real-script fixtures: 772
- The package guardrails reject committed parity backlog blocks, missing fixture provenance, broad event/chain/effect assertions, missing legal-action evidence, missing browser assets, local fallback scripts in deck probes, and oversized bridge bundles.
- The gameplay parity plan records broad restored coverage across battle timing, trigger buckets, open fast effects, Lua prompts, summon procedures, movement/control helpers, real-script families, and app-facing restore paths.

## Requirement Checklist

| Requirement | Current artifact evidence | Audit status |
| --- | --- | --- |
| Execute upstream Project Ignis scripts through the local Lua bridge | `bun run scan:lua-parity` is part of `bun run check`; `bun run report:parity-progress` reports 898 upstream-used Lua APIs, 1222 implemented APIs, 1777 upstream constants, 1818 local constants, and 0 missing APIs/constants. Deck probes require upstream scripts and reject local overrides/fallbacks. | Strong baseline, still fixture-driven for behavior. |
| Preserve timing/windows/chains/prompts/resets/summons/battle/control/movement/restore semantics | Parity fixture scanners require sourced EDOPro expectations, raw/grouped legal actions, public window IDs/kinds, clean restore, event/chain/effect assertions, and zero backlog. `test/parity-open-fast-coverage.test.ts` ratchets 431 open-fast/quick-effect response-player fixture files with 1380 turn-player `waitingFor` proofs, 823 opponent `waitingFor` proofs, 127 turn-player battle-window `responsePlayer` proofs, 188 opponent battle-window `responsePlayer` proofs, 318 pass-handoff files, 62 pass-resolution files, and 49 chain-resolution files. `test/parity-missed-timing-event-coverage.test.ts` ratchets 166 multi-step missed-timing fixtures, all 166 optional `when` versus optional `if` proofs, 126 full source/cost cause fixtures, 123 canonical event-code source/cause fixtures, 3 family-guarded synthetic source/cause event-code exceptions, and a classified exception inventory split across battle-damage cause, chain-lifecycle origin, phase-boundary, synthetic activation-boundary, and synthetic phase/turn-boundary payload families. | Strong baseline, with remaining gaps listed below. |
| Keep parity guardrails green | `bun run check` passes, including scans, probes, tests, typecheck, build, browser assets, and bridge bundle checks. | Satisfied for current known coverage. |
| Prove behavior through targeted representative fixtures and deck probes rather than one fixture per card | Fixture provenance reports 945 files and 4939 EDOPro expectation blocks with 0 backlog. Direct real-script fixtures are 772; the progress report explicitly treats one-fixture-per-script counts as an estimate, not the quality bar. | Satisfied as a strategy, not exhaustive proof. |

## Completion Decision

Status: not complete.

The engine is in a strong parity baseline, but the documented end-state requires closing or explicitly bounding the remaining behavior gaps below. Passing the guardrails proves the current known coverage is internally consistent and has no scanner-visible regressions; it does not prove full EDOPro parity for all real gameplay paths.

## Remaining Gaps

- Exact fast-effect response-player selection has strong inventory coverage for the current action families, but the invariant still needs to be maintained for every newly added action or chain-resolution family.
- Missed timing coverage is broad but not finished. The remaining work is to add real EDOPro-observed source/cost cause metadata where an event family exposes more context than the current battle-damage, chain-lifecycle, and phase-boundary exception payloads. Chain-lifecycle exception fixtures now additionally pin the originating event-card UID and related-effect ID alongside chain depth/link origin metadata.
- Battle parity still has edge work. Current coverage ratchets 25 battle-timing restore fixtures, including continuous `EVENT_BATTLED` disable timing, field-sourced damage-calculation ATK boosts, event-code assertions, and source event-card UID evidence, explicitly ratchets restored Project Ignis `Duel.ChainAttack` behavior across Alien Hunter, Element Doom, and Nitro Warrior with event-code and source event-card UID evidence, family-guards 4 restored real-script `Duel.CalculateDamage` recalculation fixtures across attack-negation and battle-target paths with event-code and source event-card UID evidence, pins 6 upstream `Duel.ChangeAttackTarget` call shapes across restored retarget variants with event-code and source event-card UID evidence, restores official Hero Signal's `EVENT_BATTLE_DESTROYED` Trap activation window after deferred battle destruction cleanup into Deck/hand HERO Special Summon operation info and event identity, and restores official Ally of Justice Omni-Weapon's `EVENT_BATTLED` label state into a later `EVENT_BATTLE_DESTROYED` draw plus optional DARK Special Summon through `Duel.GetOperatedGroup` and `Duel.SelectYesNo`. The plan still calls for more battle-helper fixtures, deeper during-damage-calculation sub-step behavior, and broader after-damage-calculation real-script coverage.
- Lua chain-limit predicate restore is intentionally bounded and now guarded. Known descriptor-backed predicates restore, tampered descriptor snapshots report missing chain-limit registry keys and hide restored legal actions, while arbitrary captured or side-effecting closures fail closed and hide restored legal actions because browser snapshots cannot safely replay arbitrary Lua functions.
- Summon/procedure helpers are broad but still simplified compared with EDOPro helpers. Equip restore now ratchets representative procedure, relation, operation-info, probe, continuation, and leave-field cleanup fixtures; cleanup fixtures pin previous equip targets plus event-code and event-card UID evidence. Focused Special Summon procedure fixtures now require restored event identity for summon outcomes and cost movement, including a Deck-sourced two-material Familiar-Possessed procedure with `aux.SelectUnselectGroup`, cost sends, Deck shuffle, and post-summon piercing grant. Release-cost hand Special Summon coverage now includes Storming Wynn's full-zone release cost, hand Attribute target selection, and target-owned `EVENT_LEAVE_FIELD` destroy watcher after restore. Court of Justice coverage now restores Continuous Spell activation into SZONE ignition, Level 1 Fairy field condition, hand Fairy selection, operation info, and Special Summon event identity after restore. Mayhem Fur Hire coverage now restores once-per-turn targeted Graveyard setcode revival, target operation info, chain response suppression, and face-up Defense Position Special Summon event identity after restore. Darklord Contact coverage now restores once-per-turn non-targeting Graveyard setcode revival, `SelectMatchingCard` operation info with `LOCATION_GRAVE`, chain response suppression, and face-up Defense Position Special Summon event identity after restore. Representative Ritual/Fusion helper fixtures now also guard restored summon and material-movement event identity across Ritual material movement, Fusion Deck/opponent/grave material paths, contact Fusion, and stage2 protection. Persistent Trap coverage now pins Safe Zone and Spellbinding Circle cleanup through restored `destroyed` event-code/card UID evidence. To-Deck movement coverage now restores official Des Feral Imp's Flip target selection from Graveyard plus official Outstanding Dog Marron's mandatory `EVENT_TO_GRAVE` self-shuffle trigger, operation info, chain response suppression, and `SendtoDeck(..., SEQ_DECKSHUFFLE, REASON_EFFECT)` event identity after restore. Ritual, Fusion, Pendulum, Union, Equip, Spirit, Gemini, persistent Trap, movement, and long-tail procedure variants still need fixture-driven expansion.
- Direct real-script fixtures are representative, not exhaustive. The current progress report estimates 772 direct real-script fixtures against 13,299 official scripts, and explicitly notes that the estimate is not proof of unique per-card EDOPro parity.

## Practical Next Goal

Drive the active goal through concrete parity slices instead of count chasing:

1. Pick one remaining family from this audit.
2. Add or identify an EDOPro-observed representative fixture that fails or exposes a missing behavior boundary.
3. Implement the smallest engine/Lua/app change needed for that fixture.
4. Ratchet the relevant scanner or inventory so the behavior cannot regress.
5. Run `bun run check` and `bun run report:parity-progress`.

Recommended next slice: reduce missed-timing source/cost metadata exceptions where EDOPro exposes additional cause context. It has an explicit inventory, concrete exception list, and a clear pass/fail shape for fixture-driven work.
