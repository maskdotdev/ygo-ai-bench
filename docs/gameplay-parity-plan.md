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
- Lua effect label object restore now covers card references and kept-alive `Group` references captured before trigger activation or during activation condition/target checks, including pending trigger and chain-link snapshots that later restore `Effect.GetLabelObject()` during operation resolution.
- The current battle implementation covers attack declaration, explicit `BattleWindowState` sub-windows, replay decisions, damage and damage-calculation passes, damage override effects, attack negation, target/attacker leaving before damage, target-count replay, end-of-damage-step windows, and basic battle destruction. Battle fixtures now pin explicit `battleWindow` state, matching `waitingFor` response players, window IDs, grouped legal actions, battle-window quick-effect action stamps, battle-damage reason player payloads, damage-step/damage-calculation fast-effect timing, snapshot restore, stale restored pass rejection, and restored Lua battle trigger windows with stale replay rejection.
- Trigger collection now assigns explicit turn-player/opponent mandatory/optional buckets, exposes active trigger buckets through public state and snapshots, and derives `triggerOrderPrompt` state for active same-bucket trigger ordering. SEGOC, same-bucket ordering, trigger-order restore, optional/mandatory shared-count trigger restore, chainSolved-before-chainEnded trigger bucket progression through restored chain resolution, restored declines, restored mixed activation/decline handoffs, and restored cross-player optional activations, restored fast-effect priority after cross-player optional trigger activations, restored mandatory trigger-chain fast-effect pass handoff plus alternating opponent-response/returned turn-player restore, one-chain/until-chain-end limiter restore with continued trigger-player follow-up windows, and cleared one-chain limiter opponent-response restore, Lua-created trigger buckets, registry-backed Lua trigger timing restore, Lua chain-limit response-window coverage, real Project Ignis Ra summon-success source-only continuous chain-limit coverage, restored known/named/single-card/multi-card/target-card/current-chain target-card/type-mask/captured event-player action-type chain-player/source-type effect-type/source-type effect-type setcode/response-player/handler-code/multi-handler-code/response-player handler-code/response-matches-chain-player/single and combined effect-type/response-player effect-type/direct active-type/response-player active-type allow/link-monster and no-Level active-type/spell-trap non-activation response-player Lua chain-limit predicates, restored Lua trigger-timing response windows with stale replay rejection, restored engine/Lua trigger-bucket response windows, restored Lua event-trigger result action surfaces across movement, LP, overlay, battle, flip, material, and direct/generic Extra Deck return-as-`EVENT_TO_DECK` events, restored engine/Lua chain-response pass and quick-effect windows, restored Main Phase 2 phase-preserving, end-turn new-turn, post-Normal-Summon, post-Tribute-Summon, post-Tribute-Set, post-Special-Summon, post-Fusion-Summon, post-Synchro-Summon, post-Xyz-Summon, post-Link-Summon, post-Ritual-Summon, post-Monster-Set, post-Flip-Summon, post-Pendulum-Summon, post-position-change, and post-Spell/Trap-Set open fast-effect pass handoff, restored open fast-effect chain-response pass-handoff pass, chain-return, and turn-follow-up windows with one-chain and until-chain-end limits, restored post-chainEnded open fast-effect handoff windows with opponent-response and returned turn-player one-chain and until-chain-end limits through final pass-pass resolution, continued follow-up pass-resolution, and final-response resolution, restored turn-player and opponent-response one-chain plus until-chain-end open fast-effect pass-handoff windows, and cross-player plus Lua position-change/destroy-family/normal-summon-attempt/flip-summon-attempt/special-summon-attempt/normal-summon-success/flip-summon-success/special-summon-success/normal-summon-negated/flip-summon-negated/special-summon-negated/monster-set/spell-trap-set/confirmed-event/hand-confirm/coin-dice random-result/coin-dice toss-negated/custom-event/pre-draw/phase-start-end activation/decline missed timing, including `EVENT_DESTROY`/`destroying`, `EVENT_SUMMON`/`normalSummoning`, `EVENT_FLIP_SUMMON`/`flipSummoning`, `EVENT_SPSUMMON`/`specialSummoning`, `EVENT_SUMMON_SUCCESS`/`normalSummoned`, `EVENT_FLIP_SUMMON_SUCCESS`/`flipSummoned`, `EVENT_SPSUMMON_SUCCESS`/`specialSummoned`, `EVENT_SUMMON_NEGATED`/`normalSummonNegated`, `EVENT_FLIP_SUMMON_NEGATED`/`flipSummonNegated`, `EVENT_SPSUMMON_NEGATED`/`specialSummonNegated`, `EVENT_MSET`/`monsterSet`, `EVENT_SSET`/`spellTrapSet`, `EVENT_TOSS_COIN_NEGATE`/`coinTossNegated`, `EVENT_TOSS_DICE_NEGATE`/`diceTossNegated`, `EVENT_CUSTOM + n`/`customEvent`, `EVENT_PREDRAW`/`preDraw`, and `EVENT_PHASE_START+PHASE_END`/`phaseStartEnd`, have fixture coverage. It still needs broader missed timing coverage, exact fast effect windows, captured/side-effecting arbitrary Lua chain-limit closure restore, and UI consumption of engine-owned ordering prompts.
- Lua `Duel.MoveToDeckTop` and `Duel.MoveToDeckBottom` now group `EVENT_TO_DECK` only for cards that truly enter the Deck, keep pure Deck reorder operations as operated-card bookkeeping without destination triggers, and have restored missed-timing fixtures for later event boundaries.
- Lua `Duel.MoveToField`, `Duel.ActivateFieldSpell`, and `Duel.ReturnToField` have restored `EVENT_MOVE` missed-timing fixtures across later event boundaries.
- Phase event missed timing also covers `EVENT_PHASE_START+PHASE_DRAW`/`phaseStartDraw`, `EVENT_PHASE+PHASE_DRAW`/`phaseDraw`, `EVENT_PHASE+PHASE_END`/`phaseEnd`, `EVENT_PHASE_START+PHASE_STANDBY`/`phaseStartStandby`, `EVENT_PHASE+PHASE_STANDBY`/`phaseStandby`, `EVENT_PHASE_START+PHASE_MAIN1`/`phaseStartMain1`, `EVENT_PHASE+PHASE_MAIN1`/`phaseMain1`, `EVENT_PHASE_START+PHASE_BATTLE`/`phaseStartBattle`, `EVENT_PHASE+PHASE_BATTLE`/`phaseBattle`, `EVENT_PHASE_START+PHASE_MAIN2`/`phaseStartMain2`, and `EVENT_PHASE+PHASE_MAIN2`/`phaseMain2` activation and decline fixtures; break-effect missed timing covers `EVENT_BREAK_EFFECT`/`breakEffect` activation and decline fixtures; turn-end missed timing covers `EVENT_TURN_END`/`turnEnded` activation and decline fixtures; adjust missed timing covers `EVENT_ADJUST`/`adjust` activation and decline fixtures.
- Startup missed timing covers `EVENT_STARTUP`/`startup` activation and decline fixtures.
- Attack declaration missed timing covers `EVENT_ATTACK_ANNOUNCE`/`attackDeclared` activation and decline fixtures.
- Battle lifecycle missed timing covers `EVENT_BE_BATTLE_TARGET`/`battleTargeted`, `EVENT_BATTLE_START`/`battleStarted`, and `EVENT_BATTLE_CONFIRM`/`battleConfirmed` activation and decline fixtures.
- Battle destruction missed timing covers `EVENT_BATTLE_DESTROYING`/`battleDestroyed` code 1139 and `EVENT_BATTLE_DESTROYED`/`battleDestroyed` code 1140 activation and decline fixtures.
- Attack negation missed timing covers `EVENT_ATTACK_DISABLED`/`attackDisabled` activation and decline fixtures.
- Damage-step timing missed timing covers `EVENT_PRE_DAMAGE_CALCULATE`/`beforeDamageCalculation`, `EVENT_DAMAGE_CALCULATING`/`damageCalculating`, and `EVENT_BATTLED`/`afterDamageCalculation` activation and decline fixtures.
- Battle damage missed timing covers `EVENT_PRE_BATTLE_DAMAGE`/`beforeBattleDamage` and `EVENT_BATTLE_DAMAGE`/`battleDamageDealt` activation and decline fixtures with damage payloads.
- End-of-battle timing missed timing covers `EVENT_BATTLE_END`/`battleEnded` and `EVENT_DAMAGE_STEP_END`/`damageStepEnded` activation and decline fixtures.
- Lua battle-target locks now honor attacker-scoped `SetValue` card predicates for `EFFECT_CANNOT_BE_BATTLE_TARGET`, with `aux.imval1` synthetic coverage and official Soul-Absorbing Bone Tower `aux.imval2` coverage proving attackers are evaluated correctly before and after snapshot restore.
- Chain activation missed timing covers `EVENT_CHAIN_ACTIVATING`/`chainActivating` and `EVENT_CHAINING`/`chaining` activation and decline fixtures.
- Chain resolution missed timing covers `EVENT_CHAIN_SOLVING`/`chainSolving` and `EVENT_CHAIN_SOLVED`/`chainSolved` activation and decline fixtures.
- Chain negation missed timing covers `EVENT_CHAIN_NEGATED`/`chainNegated` and `EVENT_CHAIN_DISABLED`/`chainDisabled` activation and decline fixtures.
- Chain end missed timing covers `EVENT_CHAIN_END`/`chainEnded` activation and decline fixtures.
- Real Project Ignis chain-limit coverage restores summon-success handler-only, Trap-activation, cloned field Trap Hole setcode, chain-end special-summon Trap Hole setcode, monster-effect active-type, Link Monster active-type, no-Level active-type, deny-all known-global, response-player monster-effect, response-matches-chain-player, selected-handler exclusion, and multi-target handler exclusion guards from upstream scripts, including response-window legal-action filtering after restore; it also applies Battle Start Quick-Play Spell activation deny-all guards from upstream scripts. Real battle-script coverage now includes restored `EVENT_ATTACK_ANNOUNCE` Trap activation through Negate Attack, Magic Cylinder, Sakuretsu Armor, Mirror Force, Draining Shield, Scrap-Iron Scarecrow, and Dimensional Prison, restored damage-step hand Quick Effect activation through Honest with `Cost.SelfToGrave`, `Duel.GetAttacker`, `Duel.GetAttackTarget`, `Card.IsRelateToBattle`, dynamically registered `EFFECT_UPDATE_ATTACK` restore, restored post-boost battle damage calculation, restored targeted battle-damage LP application at damage calculation with `EVENT_PRE_BATTLE_DAMAGE`/`EVENT_BATTLE_DAMAGE` trigger queueing deferred through restored end-damage-step cleanup, attack negation, target-card restore, effect damage and recovery, active-attacker `Card.CanAttack`, attacker destruction and banish, non-targeting attack-position group destruction, restored Yomi Ship `EVENT_BATTLE_DESTROYED` `Card.GetReasonCard` targeting and effect destruction, restored Newdoria `EVENT_BATTLE_DESTROYED` `Duel.SelectTarget` targeting and effect destruction, restored Giant Rat mutual battle destruction with simultaneous optional `EVENT_BATTLE_DESTROYED` SEGOC ordering and reverse chain-resolution recruiter summons, restored Wall of Illusion `EVENT_BATTLED` after-damage calculation timing with battle relation APIs and post-damage attacker bounce, restored Divine Knight Ishzark `EVENT_BATTLED` `STATUS_BATTLE_DESTROYED` target banish before end-damage-step battle destruction cleanup, restored D.D. Assailant `EVENT_BATTLED` attack-position battle-destroyed status with simultaneous attacker/target banish before cleanup, restored D.D. Warrior plus Wall of Illusion simultaneous mandatory `EVENT_BATTLED` SEGOC order with grouped event payload matching and chain-order battle relation after one battle participant leaves the Monster Zone, `EFFECT_REFLECT_BATTLE_DAMAGE` through Amazoness Swords Woman, restored Speedroid Hexasaucer `EFFECT_BOTH_BATTLE_DAMAGE` plus `EFFECT_CHANGE_BATTLE_DAMAGE` static `HALF_DAMAGE` shared-damage handling, restored Number C96 `EFFECT_ALSO_BATTLE_DAMAGE` shared damage, restored Ancient Gear Golem `EFFECT_PIERCE` defense-position battle damage, restored Lesser Fiend `EFFECT_BATTLE_DESTROY_REDIRECT` banish-on-battle-destroy handling including mutual Lesser Fiend redirected battle destruction after snapshot restore, restored Gravekeeper's Vassal `EFFECT_BATTLE_DAMAGE_TO_EFFECT` effect-damage reason/log conversion, restored Machine Lord Ur `EFFECT_ATTACK_ALL` monster-only multi-attack targeting and `EFFECT_NO_BATTLE_DAMAGE` zero-damage handling, restored Rescue Warrior `EFFECT_AVOID_BATTLE_DAMAGE` controller-damage prevention, restored Pilgrim of the Ice Barrier callback-valued `EFFECT_INDESTRUCTABLE_BATTLE` opponent argument handling, restored Machina Sniper `EFFECT_CANNOT_BE_BATTLE_TARGET` setcode target filtering, activated Trap `CancelToGrave`/set-again cleanup, and Battle Phase skip cleanup.
- Real Project Ignis summon-success Trap coverage now includes restored Trap Hole, Bottomless Trap Hole, and Torrential Tribute activation from upstream scripts, event-group target restore through `Duel.SetTargetCard(eg)`, special-summon grouped `eg:Filter`/`Card.GetSummonPlayer` target handling, all-field `Duel.GetMatchingGroup(aux.TRUE, ..., LOCATION_MZONE, LOCATION_MZONE, ...)` destruction operation info, `CATEGORY_DESTROY`/`CATEGORY_REMOVE` operation info restore, regular destruction, and destination-aware `Duel.Destroy(..., LOCATION_REMOVED)` banishing of Normal Summoned and grouped Special Summoned monsters after restored chain-response passes.
- Real Project Ignis free-chain Trap coverage now includes restored Compulsory Evacuation Device activation from a chain-response window with `Card.IsAbleToHand`, `Duel.SelectTarget`, `CATEGORY_TOHAND` operation info restore, target-card relation on resolution, `Duel.SendtoHand`, `EVENT_TO_HAND` movement, and activated Trap cleanup; restored Raigeki Break activation from a chain-response window with `Card.IsDiscardable`, `Duel.DiscardHand` cost movement, discarded event/history restore, target restore, `CATEGORY_DESTROY` operation info restore, `Duel.Destroy`, and activated Trap cleanup; and restored Phoenix Wing Wind Blast activation from a chain-response window with discard-cost movement, opponent-field `Card.IsAbleToDeck` target restore, `CATEGORY_TODECK` operation info restore, `Duel.SendtoDeck(..., SEQ_DECKTOP, ...)`, `EVENT_TO_DECK` history, deck-top sequencing, and activated Trap cleanup.
- Real Project Ignis free-chain Spell coverage now includes restored Book of Moon Quick-Play activation from hand with `Duel.SelectTarget` target restore, operation info restore, chain-response handoff, and face-down Defense Position resolution; restored Mystical Space Typhoon Quick-Play activation from a chain-response window with backrow `LOCATION_ONFIELD`/`Card.IsSpellTrap` target restore, `CATEGORY_DESTROY` operation info, target-card relation on resolution, and activated Spell cleanup; restored Cosmic Cyclone Quick-Play activation from a chain-response window with `Cost.PayLP(1000)`, `Card.IsAbleToRemove`, `CATEGORY_REMOVE` operation info, LP-cost event/history restore, `Duel.Remove` banish resolution, and activated Spell cleanup; restored Twin Twisters Quick-Play activation from a chain-response window with `Card.IsDiscardable`, `Duel.DiscardHand` cost movement, discarded event/history restore, two backrow targets, grouped `CATEGORY_DESTROY` operation info restore, `Duel.GetTargetCards(e)`, and grouped `Duel.Destroy`; restored Forbidden Droplet Quick-Play activation with `Card.IsAbleToGraveAsCost`, `Duel.SendtoGrave` cost movement, `Duel.GetOperatedGroup`, captured original-type chain-limit restore, `CATEGORY_DISABLE` operation info, `EFFECT_SET_ATTACK_FINAL`/`EFFECT_DISABLE`/`EFFECT_DISABLE_EFFECT` post-resolution restore, and disabled target ATK probing; restored Forbidden Lance Quick-Play activation from hand with face-up monster target restore, `EFFECT_UPDATE_ATTACK` and `EFFECT_IMMUNE_EFFECT` registration, activated Spell cleanup, and battle damage after the real-script ATK loss; restored Shrink Quick-Play activation from hand with face-up monster target restore, `EFFECT_SET_BASE_ATTACK` registration, post-resolution value-only effect restore, activated Spell cleanup, and battle damage after the real-script base ATK halving; restored Upstart Goblin Normal Spell activation with `Duel.SetTargetPlayer`, `Duel.SetTargetParam`, `CATEGORY_DRAW`/`CATEGORY_RECOVER` operation info restore, `Duel.GetChainInfo`, `Duel.Draw`, `Duel.BreakEffect`, recovery, draw/recover event history, and post-resolution Spell cleanup; restored Change of Heart Normal Spell activation with opponent monster target restore, `CATEGORY_CONTROL` operation info, `Duel.GetControl(..., PHASE_END, 1)` control-change movement, serializable temporary-control return restore, and End Phase control return after snapshot restore; restored Reinforcement of the Army Normal Spell activation with Deck `Card.IsLevelBelow`/`Card.IsRace`/`Card.IsAbleToHand` filtering, non-targeting `CATEGORY_TOHAND` operation info restore, resolution-time `Duel.SelectMatchingCard`, `Duel.SendtoHand`, `Duel.ConfirmCards`, sent-to-hand and confirm event history, and post-resolution Spell cleanup; restored Foolish Burial Normal Spell activation with Deck `Card.IsMonster`/`Card.IsAbleToGrave` filtering, non-targeting `CATEGORY_TOGRAVE` operation info restore, resolution-time `Duel.SelectMatchingCard`, `Duel.SendtoGrave`, sent-to-Graveyard event history, and post-resolution Spell cleanup; restored Raigeki Normal Spell activation with opponent `LOCATION_MZONE` group collection, non-targeting grouped `CATEGORY_DESTROY` operation info restore, resolution-time `Duel.GetMatchingGroup`, grouped `Duel.Destroy`, destroyed event history, and post-resolution Spell cleanup while preserving the controller's monsters; restored Harpie's Feather Duster Normal Spell activation with opponent `LOCATION_ONFIELD`/`Card.IsSpellTrap` group collection, non-targeting grouped `CATEGORY_DESTROY` operation info restore, resolution-time backrow re-query, grouped `Duel.Destroy`, destroyed event history, and post-resolution Spell cleanup while preserving own backrow and opponent monsters; restored Lightning Storm Normal Spell activation with no-face-up-own-field condition, `Duel.SelectEffect` mode choice, pending-chain `Effect:SetLabel` restore, attack-position monster and Spell/Trap group branches, grouped `CATEGORY_DESTROY` operation info restore, resolution-time branch-specific re-query, grouped `Duel.Destroy`, destroyed event history, and post-resolution Spell cleanup; restored Pot of Desires Normal Spell activation with top-deck `Card.IsAbleToRemoveAsCost` checks, `Duel.DisableShuffleCheck`, ten-card face-down `Duel.Remove` cost movement/history restore, `CATEGORY_DRAW` operation info restore, `Duel.GetChainInfo`, two-card `Duel.Draw`, and post-resolution Spell cleanup; restored Pot of Extravagance Normal Spell activation with Main Phase 1/no-phase-activity gating, Extra Deck face-down `Group.RandomSelect` cost banish, `CATEGORY_DRAW` operation info restore, `Duel.GetChainInfo`, one-card `Duel.Draw`, `Duel.RegisterEffect` draw-lock registration, and post-resolution draw prevention; restored Pot of Duality Normal Spell activation with no-prior-Special-Summon cost gating, `EFFECT_CANNOT_SPECIAL_SUMMON` restoration, deck-top confirm/search, selected-card `Duel.SendtoHand` plus opponent confirm, remaining revealed cards shuffled back, and post-resolution Special Summon procedure suppression; restored Pot of Prosperity Normal Spell activation with Extra Deck face-down selectable cost banish, pending-chain effect-label restore for the excavate count, deck-top confirm/search, selected-card `Duel.SendtoHand` plus opponent confirm, remaining revealed cards moved to deck bottom, draw-lock restoration, `EFFECT_CHANGE_DAMAGE` damage halving, and post-resolution Spell cleanup; plus restored Monster Reborn Normal Spell activation with Graveyard target restore, `CATEGORY_SPECIAL_SUMMON` operation info restore, controller-changing `Duel.SpecialSummon`, and post-resolution Spell cleanup.
- Real Project Ignis Mind Control coverage now includes restored `CATEGORY_CONTROL` target operation info, temporary `Duel.GetControl(..., PHASE_END, 1)` control return, dynamically registered `EFFECT_UNRELEASABLE_SUM`/`EFFECT_UNRELEASABLE_NONSUM`/`EFFECT_CANNOT_ATTACK` restore, Lua release-helper suppression, battle attack-action suppression, and End Phase cleanup after snapshot restore.
- Real Project Ignis Brain Control coverage now includes `Cost.PayLP(800)`, restored LP-cost event history, `Card.IsSummonableCard` target filtering that skips non-summonable Extra Deck monsters, restored `CATEGORY_CONTROL` operation info, temporary control return, and End Phase cleanup after snapshot restore.
- Real Project Ignis Enemy Controller coverage now includes restored `Duel.SelectEffect` branch labels, release-as-cost control selection through `Duel.CheckReleaseGroupCost`/`Duel.SelectReleaseGroupCost`/`Duel.Release`, release event/history restore, `CATEGORY_CONTROL` operation info without the position branch, temporary control return, and End Phase cleanup after snapshot restore.
- Real Project Ignis Creature Swap coverage now includes non-targeting `CATEGORY_CONTROL` operation info, resolution-time `Duel.SelectMatchingCard` choices for both players, `Duel.SwapControl` mutual control-change event restore, cloned `EFFECT_CANNOT_CHANGE_POSITION` End Phase lock restore, Lua `Card.IsCanChangePosition`/legal-action suppression after restore, and lock cleanup while swapped control remains permanent.
- Real Project Ignis Snatch Steal coverage now includes `aux.AddEquipProcedure` targeting an opponent monster, restored `CATEGORY_CONTROL` plus `CATEGORY_EQUIP` operation info, continuous equip-sourced `EFFECT_SET_CONTROL` application after `Duel.Equip`, snapshot restore of the equipped control state, and control return when the Equip Spell leaves the field.
- Real Project Ignis Premature Burial coverage now includes `Cost.PayLP(800)`, Graveyard target Special Summon restore, `Duel.Equip` card-target binding, `GetFirstCardTarget` probing after snapshot restore, dynamic equip-limit registration, and continuous `EVENT_LEAVE_FIELD` destruction of the revived monster when the Equip Spell is destroyed.
- Real Project Ignis Call of the Haunted coverage now includes Continuous Trap activation from a Set backrow, Graveyard target restore, `Duel.SpecialSummonStep`/`Duel.SpecialSummonComplete` resolution, `Card.SetCardTarget` restore, post-resolution target probing, trap-destroyed monster cleanup, and revived-monster-destroyed trap cleanup after snapshot restore.
- Real Project Ignis Magic Jammer coverage now includes Counter Trap response activation from a restored `EVENT_CHAINING` Spell activation, `re:IsSpellEffect`, `Duel.IsChainNegatable`, discard-as-cost movement/history restore, `CATEGORY_NEGATE`/`CATEGORY_DESTROY` operation info, chain-event `eg` source grouping, `Duel.NegateActivation`, activation-source destruction, negated-chain history, and suppressed Spell draw/recover resolution after snapshot restore.
- Real Project Ignis Divine Wrath coverage now includes Counter Trap response activation from a restored monster-effect chain, `re:IsMonsterEffect` active-type matching, discard-as-cost movement/history restore, `CATEGORY_NEGATE`/`CATEGORY_DESTROY` operation info sourced from chain-event `eg`, `Duel.NegateActivation`, monster-source destruction, negated-chain history, and suppressed monster-effect resolution after snapshot restore.
- Real Project Ignis Ghost Ogre & Snow Rabbit coverage now includes hand response activation from a restored on-field monster-effect chain, `re:GetHandler():IsOnField()` plus active-type matching, `Cost.SelfToGrave`, chain-event `eg` operation-info targeting, source destruction through `Duel.Destroy(eg,REASON_EFFECT)`, and non-negating chain resolution where the destroyed source's operation still resolves after snapshot restore.
- Real Project Ignis Droll & Lock Bird coverage now includes delayed custom-event Quick Effect collection from its global `EVENT_TO_HAND` watcher, restored hand activation after an opponent Deck-to-hand movement, `Cost.SelfToGrave`, lingering `EFFECT_CANNOT_TO_HAND` and `EFFECT_CANNOT_DRAW` registration, Deck search/draw suppression after snapshot restore, and End Phase reset cleanup.
- Real Project Ignis Seven Tools of the Bandit coverage now includes Counter Trap response activation from a restored Trap activation chain, `re:IsTrapEffect` plus `EFFECT_TYPE_ACTIVATE` matching, `Cost.PayLP(1000)` movement/history restore, `CATEGORY_NEGATE`/`CATEGORY_DESTROY` operation info sourced from chain-event `eg`, `Duel.NegateActivation`, Trap-source destruction, negated-chain history, and suppressed Trap resolution after snapshot restore.
- Real Project Ignis Wiretap coverage now includes restored `EVENT_CHAINING` Counter Trap activation against Trap activations, `CATEGORY_NEGATE`/`CATEGORY_TODECK` operation info, `Duel.NegateActivation`, restored `re:GetHandler()` resolution from the responded-to chain link instead of the Counter Trap's own latest chain event, `Card.CancelToGrave`, returning the negated Trap source to Deck, activated Wiretap cleanup, negated-chain history, and suppressed negated Trap resolution after snapshot restore.
- Real Project Ignis Dark Bribe coverage now includes opponent-only activation negation through `rp~=tp`, combined `CATEGORY_NEGATE`/`CATEGORY_DESTROY`/`CATEGORY_DRAW` operation info restore, source destruction through chain-event `eg`, `Duel.NegateActivation`, the post-negation opponent draw operation, negated-chain history, and suppressed negated Spell recovery after snapshot restore.
- Real Project Ignis Black Horn of Heaven coverage now includes restored opponent-only `EVENT_SPSUMMON` Counter Trap activation with single-summon `eg` handling, summon-player payload restore for `ep==1-tp`, `CATEGORY_DISABLE_SUMMON`/`CATEGORY_DESTROY` operation info, `Duel.NegateSummon`, source destruction, activated Trap cleanup, and suppressed Special Summon success after snapshot restore.
- Real Project Ignis Grand Horn of Heaven coverage now includes restored opponent-turn/Main Phase-gated `EVENT_SPSUMMON` Counter Trap activation, `CATEGORY_DISABLE_SUMMON`/`CATEGORY_DESTROY` operation info, `Duel.NegateSummon`, source destruction, post-negation `Duel.Draw`, current-phase `Duel.SkipPhase`, activated Trap cleanup, and restored legal actions that suppress further current Main Phase actions after resolution.
- Real Project Ignis Horn of Heaven coverage now includes restored summon-attempt Counter Trap activation with `Duel.CheckReleaseGroupCost`, `Duel.SelectReleaseGroupCost`, release-as-cost movement/history restore, `CATEGORY_DISABLE_SUMMON`/`CATEGORY_DESTROY` operation info, `Duel.NegateSummon`, follow-up source destruction, activated Trap cleanup, and suppressed Special Summon success after snapshot restore.
- Real Project Ignis Solemn Judgment coverage now includes restored `EVENT_SUMMON` plus cloned `EVENT_FLIP_SUMMON` and `EVENT_SPSUMMON` Counter Trap activation from summon-attempt trigger windows and restored `EVENT_CHAINING` response to both Spell and Trap activations, `Duel.GetCurrentChain(true)` condition handling, `Duel.IsChainNegatable`, `Effect.IsHasType(EFFECT_TYPE_ACTIVATE)`, half-LP `Duel.PayLPCost`, `CATEGORY_DISABLE_SUMMON`/`CATEGORY_NEGATE`/`CATEGORY_DESTROY` operation info restore, activated Trap placement/cleanup, `Duel.NegateSummon`, `Duel.NegateActivation`, follow-up destroyed event handling, Normal, Flip, and Special Summon success cleanup, negated-chain history, and restored chain-response windows that suppress later responders after resolution.
- Real Project Ignis Solemn Strike coverage now includes restored `EVENT_SPSUMMON` Counter Trap activation from the Special Summon attempt window and restored `EVENT_CHAINING` response to monster effects, `Cost.PayLP(1500)`, `Duel.IsChainNegatable`, `Effect.IsMonsterEffect`, `CATEGORY_DISABLE_SUMMON`/`CATEGORY_NEGATE`/`CATEGORY_DESTROY` operation info restore, `Duel.NegateSummon`, `Duel.NegateActivation`, follow-up destroyed event handling, Special Summon success cleanup, activated Trap cleanup, negated-chain history, and restored chain-response windows around the summon or activation negation.
- Real Project Ignis Solemn Warning coverage now includes restored `EVENT_SUMMON` plus cloned `EVENT_FLIP_SUMMON` and `EVENT_SPSUMMON` Counter Trap activation from summon-attempt trigger windows and restored `EVENT_CHAINING` response to Spell/Trap activations and monster effects whose effect category includes `CATEGORY_SPECIAL_SUMMON`, `Duel.GetCurrentChain(true)`, `Duel.IsChainNegatable`, `Effect.IsHasType(EFFECT_TYPE_ACTIVATE)`, `Effect.IsMonsterEffect`, `Effect.IsHasCategory(CATEGORY_SPECIAL_SUMMON)`, `CheckLPCost`/`PayLPCost(2000)`, `CATEGORY_DISABLE_SUMMON`/`CATEGORY_NEGATE`/`CATEGORY_DESTROY` operation info, `Duel.NegateSummon`, `Duel.NegateActivation`, source destruction, activated Trap cleanup, and suppressed Normal Summon, Flip Summon, Special Summon, or Special Summon effect resolution after snapshot restore.
- Real Project Ignis continuous monster stat coverage now includes restored Fortune Lady Past `EFFECT_SET_ATTACK`/`EFFECT_SET_DEFENSE` callback values through `Card.GetLevel`, reloaded callback-valued continuous effects after snapshot restore, battle damage using the script-defined current ATK, and restored Fusion Devourer field-targeted `EFFECT_SET_ATTACK_FINAL` through `SetTargetRange`, battle-phase condition checks, target predicates, Lua stat reads, and battle damage calculation.
- Real Project Ignis LP conversion coverage now includes restored Prime Material Dragon `EFFECT_REVERSE_DAMAGE` with player-targeted range and callback `SetValue`, converting Tremendous Fire's `Duel.Damage(..., REASON_EFFECT)` operations into recovery events after snapshot restore; restored Bad Reaction to Simochi `EFFECT_REVERSE_RECOVER` converting Upstart Goblin's real-script recovery into effect damage; restored Des Wombat `EFFECT_NO_EFFECT_DAMAGE` preventing Tremendous Fire's real-script effect damage after snapshot restore; restored Totem Pole `EFFECT_CHANGE_DAMAGE` callback doubling Tremendous Fire's real-script effect damage after snapshot restore; and restored Nature's Reflection `EFFECT_REFLECT_DAMAGE` callback redirecting Tremendous Fire's opponent-sourced effect damage after snapshot restore.
- Dynamic Lua indestructible restore recognizes `aux.indoval` and `aux.indsval` value callbacks for reset-scoped `EFFECT_INDESTRUCTABLE_EFFECT`/`EFFECT_INDESTRUCTABLE_BATTLE` effects, with real Project Ignis Red Gardna coverage proving opponent-effect destruction remains blocked after reconnect and focused `aux.indsval` coverage proving same-player destruction remains blocked.
- Lua one-chain continuous limiter coverage restores temporary dynamically registered `EVENT_CHAINING` `SetChainLimit` response-player and known-global `aux.TRUE` predicates after self-reset cleanup, verifying the active limit survives restore while the transient watcher does not serialize.
- Lua chain-end continuous limiter coverage restores inline `EVENT_CHAIN_END` `SetChainLimitTillChainEnd` predicates, direct, current-chain-zero, and flag-gated `aux.FALSE` guards, flag-gated, chain-depth flag-gated, and resolving-chain-depth flag-gated chain-end guards, plus temporary dynamically registered chain-end and chain-depth reset watchers, verifying the next chain keeps same-player responses where allowed, blocks disallowed responders, clears marker flags, and does not serialize reset watchers.
- Lua persistent trap helper coverage now restores `aux.AddPersistentProcedure` activation targets through `EVENT_CHAIN_SOLVED`, proving `Duel.GetChainInfo(..., CHAININFO_TARGET_CARDS)`, card-target relation creation, `Card.IsHasCardTarget`, and `aux.PersistentTargetFilter` survive snapshot restore.
- Summon helpers exist for Normal, Tribute, Flip, Fusion, Synchro, Xyz, Link, Ritual, Pendulum, and summon procedures, with restored core summon, Lua summon procedure, summon-attempt trigger, summon-negated trigger, Pendulum Summon, real Project Ignis Pendulum scale activation into restored Pendulum Summon actions plus Performapal Gold Fang's restored Special Summon success trigger and ATK boost, real Project Ignis Spirit end-phase return plus cannot-be-Special-Summoned condition handling through Yata-Garasu, real Project Ignis Gemini second Normal Summon actions plus restored Evocator Eveque `Gemini.EffectStatusCondition` summon-success trigger, full-zone Extra Deck material, restored official `Synchro.AddProcedure` tuner/non-tuner material counts through Flower Cardian Boardefly's exact two non-tuner procedure plus simple tuner `Card.IsAttribute` material filters through Vylon Epsilon, simple tuner `Card.IsRace` material filters through Dinowrestler Giga Spinosavate, simple tuner `Card.IsType` material filters through Black-Winged Assault Dragon, simple non-tuner `Card.IsAttribute` material filters through Naturia Barkion, simple non-tuner `Card.IsRace` material filters through Overmind Archfiend, and simple non-tuner `Card.IsType` material filters through T.G. Blade Blaster, restored official `Xyz.AddProcedure` material counts through Tri-Edge Levia's three-material Xyz procedure plus simple `Card.IsRace` material filters through Heroic Champion - Claivesolish, simple `Card.IsAttribute` material filters through Evilswarm Nightmare, and simple `Card.IsType` material filters through Thunder End Dragon, restored official `Link.AddProcedure` min/max material counts through Baba Barber's two-material Link procedure plus simple `Card.IsType` material filters through Link Spider, simple `Card.IsRace` material filters through Clock Spartoi, ORed `Card.IsRace` material filters through Ragnaraika Selene Snapper, and simple `Card.IsAttribute` material filters through Marincess Crystal Heart, restored real Project Ignis Union procedure equip, next-turn summon-back, and Union Driver deck-equip replacement action windows through dynamic `aux.SetUnionState` effects, restored real Project Ignis Equip Spell procedure activation through Axe of Despair with target/operation info restore, equip relation, and equip ATK stat effect, restored real Project Ignis Mechquipped Angineer Xyz overlay cost detach through `Cost.DetachFromSelf(1)` into target position change and temporary indestructible single effects, restored real Project Ignis Polymerization activation through `Fusion.RegisterSummonEff`, hand-material `Duel.SelectFusionMaterial`, effect-reason material sends, `Duel.FusionSummon`, material events, and Special Summon operation info, restored real Project Ignis Miracle Fusion activation through `Fusion.CreateSummonEff` positional args, graveyard `extrafil`, `Fusion.BanishMaterial`, remove operation info, and already-moved selected-material `Duel.FusionSummon`, restored real Project Ignis Mutiny in the Sky activation through `Fusion.CreateSummonEff` graveyard `extrafil`, `Fusion.ShuffleMaterial`, and deck-returned selected Fusion materials after snapshot restore, restored real Project Ignis Primite Fusion activation through `Fusion.CreateSummonEff` table args, extra-material fcheck enforcement requiring a Normal Monster, to-Deck operation info, and no-action coverage when fcheck fails, restored real Project Ignis Secrets of Dark Magic Fusion activation through table-arg `extrafil` returning only a material check callback, `Card.IsSummonCode` enforcement requiring Dark Magician or Dark Magician Girl, and no-action coverage when the check fails, restored real Project Ignis Branded Fusion activation through Deck `extrafil`, exact-count and Albaz fcheck material selection, to-Grave operation info, effect-reason Deck material sends, and restored non-Fusion Extra Deck oath plus Clock Lizard marker effects, restored real Project Ignis Heavy Polymerization activation through `Fusion.RegisterSummonEff` table args, `mincount`, Extra Deck material `fcheck`, possible remove operation info, partial `extraop` movement that banishes only Extra Deck materials before sending remaining default Fusion materials to the Graveyard, and `stage2` LP loss from the banished materials' ATK, restored real Project Ignis Prank-Kids Pandemonium activation through positional `Fusion.CreateSummonEff`, Main Phase condition gating, post-resolution `stage2` non-Prank-Kids Normal/Special Summon oath restore, serialized `Card.IsSetCard` target-descriptor filtering, and harmless `aux.RegisterClientHint` restore, restored real Project Ignis Dark Fusion activation through `Fusion.CreateSummonEff` `stage2` protection and `aux.tgoval` opponent-targeting restore, restored real Project Ignis Necroquip Princess `Fusion.AddContactProc` into a restored Extra Deck Contact Fusion procedure action with cost/material sends, restored real Project Ignis Lady's Dragonmaid `Fusion.AddContactProc` with selected field and Graveyard materials banished as cost/material, restored real Project Ignis Arcana Force EX - The Chaos Ruler `Fusion.AddContactProc` with a face-up opponent field material sent to its controller's Graveyard, restored real Project Ignis Megalith Bethor activation through `Ritual.Target`, `Ritual.Operation`, `Cost.SelfDiscard`, equal-or-greater hand-material selection, restored Special Summon operation info, and selected-material `Duel.RitualSummon`, restored real Project Ignis Contract with the Dark Master activation through `Ritual.AddProcGreaterCode` into selected-material Ritual Summon after snapshot restore, restored real Project Ignis Earth Chant activation through `Ritual.AddProcEqual` with exact-level material selection after snapshot restore, restored real Project Ignis Prayers of the Voiceless Voice activation through `Ritual.AddProcGreater` `matfilter` constraints during material selection, restored real Project Ignis Mitsurugi Mirror activation through `Ritual.CreateProc` from `LOCATION_HAND|LOCATION_GRAVE` into a selected-material Graveyard Ritual Summon, and failed material/release rollback actions pinned to public window IDs/kinds; failed restored rollback groups are stamped for UI consumption, and stale restored core summon, procedure, attempt-trigger, negated-trigger, Pendulum Summon, and Extra Deck summon responses are rejected after the window advances. The helpers are still simplified compared with EDOPro procedure helpers.
- Lua API coverage is broad enough for smoke probing, including active effect type helpers such as `GetActiveType`/`IsActiveType`, but should continue to be driven by failing real card scripts and fixture needs.
- Contact Fusion procedure coverage also includes real Project Ignis Gladiator Beast Andabata custom `SUMMON_TYPE_SPECIAL+1` procedure summons with Deck-returned materials.
- Fusion material replacement coverage also restores real Project Ignis Goddess with the Third Eye as a one-card `EFFECT_FUSION_SUBSTITUTE` through Polymerization, including snapshot restore, Lua substitute `SetValue(function(e,fc) ...)` target predicates, no-action coverage when both listed materials would require substitutes, and core coverage that fielded substitutes are ignored while disabled unless their substitute effect has `EFFECT_FLAG_CANNOT_DISABLE`.
- Fusion helper coverage also restores real Project Ignis Dyna Base `Fusion.ForcedHandler` paths, proving target filtering rejects Fusion targets that cannot consume the activating handler and restored resolution uses that handler as material. It also restores real Project Ignis Fallen of Albaz opponent-field extra-material Fusion, proving `Fusion.CheckWithHandler(aux.FALSE)` keeps the handler as the only own material while allowing opponent face-up materials supplied by `extrafil`.
- Xyz procedure metadata also restores non-Ex `aux.FilterBoolFunction(Card.IsRace, ...)` material filters through Melffy Mommy and `Card.IsSetCard` material filters through Gimmick Puppet Gigantes Doll.
- Xyz procedure metadata also restores `Card.IsRank` material filters through Disaster, Dragon Ruler of All Apocalypses.
- Xyz procedure metadata also restores `Xyz.InfiniteMats` max-material ranges through Melffy Mommy.
- Lua `Duel.XyzSummon` default material selection now honors restored Xyz procedure type filters through Thunder End Dragon.
- Lua `Duel.XyzSummon` default material selection now skips materials locked by `EFFECT_CANNOT_BE_XYZ_MATERIAL` while using Thunder End Dragon.
- Link procedure metadata also restores `Card.IsSetCard` material filters through X-Krawler Qualiark.
- Link procedure metadata also restores `Card.IsSummonType` material filters through Clara & Rushka, the Ventriloduo.
- Link procedure metadata also restores `Card.IsLevel` material filters through Linkuriboh.
- Lua `Duel.LinkSummon` default material selection now honors restored Link procedure level filters through Linkuriboh.
- Lua `Duel.LinkSummon` default material selection now skips materials locked by `EFFECT_CANNOT_BE_LINK_MATERIAL` while using Linkuriboh.
- Link procedure metadata also restores `Card.IsLevelAbove` material filters through World Gears of Theurlogical Demiurgy.
- Synchro procedure metadata also restores tuner-side `Card.IsLevel` material filters through Despian Luluwalilith.
- Lua `Duel.SynchroSummon` default material selection now honors restored Synchro procedure tuner-level filters through The Three Brave Swordsouls.
- Lua `Duel.SynchroSummon` default material selection now skips materials locked by `EFFECT_CANNOT_BE_SYNCHRO_MATERIAL` while using The Three Brave Swordsouls.
- Synchro procedure metadata also restores tuner-side `Card.IsSetCard` material filters through Dragunity Knight - Gormfaobhar and non-tuner-side `Card.IsSetCard` material filters through Legendary Six Samurai - Shi En.
- Ritual helper coverage also restores real Project Ignis `Ritual.AddProcEqualCode` through Luminous Dragon Ritual's exact Paladin of Photon Dragon summon.
- Ritual helper coverage also honors `sumpos` masks in `Ritual.Operation` and `Duel.RitualSummon`, including face-down Defense Position ritual summons and opponent confirmation of face-down Ritual Summons.
- Ritual helper coverage also restores real Project Ignis `forcedselection` material requirements through Secrets of Dark Magic requiring Dark Magician/Dark Magician Girl as Ritual material.
- Ritual helper coverage also restores real Project Ignis `requirementfunc` material-value callbacks through Meteonis Drytron using ATK as the Ritual requirement and material value.
- Ritual helper coverage also restores real Project Ignis `specificmatfilter` material-pool pruning through Super Soldier Synthesis requiring a hand-plus-Deck LIGHT/DARK material pair.
- Ritual helper coverage also restores real Project Ignis `self=true` Ritual procedures through Miracle Raven Ritual Summoning itself from the Pendulum Zone.
- Ritual helper coverage also restores real Project Ignis `stage2` post-summon operations after normal material sends through Rebirth of Nephthys.
- Ritual helper coverage also restores real Project Ignis Deck Ritual targets, hand Normal Monster material filters, and delayed opponent End Phase `stage2` returns through High Ritual Art.
- Ritual helper coverage also restores real Project Ignis sole Extra Deck ritual materials, `forcedselection` requiring no mixed material pile, and the post-resolution Extra Deck Special Summon lock through Dogmatikalamity.
- Ritual helper coverage also restores real Project Ignis mixed hand-plus-Graveyard ritual materials and `extraop` Deck shuffle-back of Graveyard materials through Machine Angel Absolute Ritual.
- Ritual helper coverage also restores real Project Ignis positional `Ritual.CreateProc` opponent-field materials, `Duel.ReleaseRitualMaterial` `extraop`, Battle Phase cost locks, and post-summon single-card stat effects through Forbidden Arts of the Gishki.
- Spirit helper coverage now mirrors Project Ignis return markers from configured summon/flip events, skips End Phase return while `EFFECT_SPIRIT_DONOT_RETURN` applies, and restores optional return activation/decline choices while `EFFECT_SPIRIT_MAYNOT_RETURN` applies.
- Gemini helper coverage now restores real Project Ignis Evocator Eveque second Normal Summon trigger targeting, `CATEGORY_SPECIAL_SUMMON` operation info, pending chain-response windows after snapshot restore, and targeted Graveyard Special Summon resolution; it also restores real Project Ignis Gemini Spark activation with Gemini `Duel.CheckReleaseGroupCost`/`Duel.SelectReleaseGroupCost` release cost, target destruction, draw operation info, response-window grouping, and post-restore destroy-then-draw resolution.

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
- Fixture observations cover direct attack, monster attack, attack negation, target leaving, target count changing with replay, damage calculation modifiers, both-player plus half-damage modifier ordering, after-damage triggers, end-of-damage-step triggers, and snapshot restore mid-window.
- Real-script battle helper coverage now includes official Alien Hunter `EVENT_BATTLED` flag setup into `EVENT_BATTLE_DESTROYING` and restored `Duel.ChainAttack()` reopening after battle cleanup, official Nitro Warrior `EVENT_BATTLED` restoration through single-target position change and `Duel.ChainAttack(tc)` reopening a targeted follow-up battle, official Giant Orc `EVENT_PHASE|PHASE_BATTLE` Battle Phase cleanup after restore through `Card.GetAttackedCount()` and effect-driven `Duel.ChangePosition` bypassing manual battle-position lockouts, official Scrap Worm attack-declaration `RegisterFlagEffect` restore into mandatory `EVENT_PHASE|PHASE_BATTLE` trigger destruction, official Dark Elf `EFFECT_ATTACK_COST` attack declaration filtering plus restored `Duel.PayLPCost`/`Duel.AttackCostPaid()` state, official Panther Warrior `EFFECT_ATTACK_COST` release-cost filtering and restored `Duel.Release` cost movement into battle continuation, official Getsu Fuhma `EVENT_DAMAGE_STEP_END` trigger restoration through condition-time `Effect.SetLabelObject(card)` and restored `Duel.Destroy` of that stored battle target, official Des Kangaroo `EVENT_DAMAGE_STEP_END` trigger restoration through restored `Duel.GetAttackTarget()`/`Duel.GetAttacker()` condition and operation-time destruction of the attacker, official Enraged Battle Ox field `EFFECT_PIERCE` with `SetTargetRange` plus Lua race-predicate targeting restored before battle damage, official Toon Defense `EVENT_ATTACK_ANNOUNCE` targeting into restored `Duel.ChangeAttackTarget(nil)` direct-attack conversion, official Call of the Earthbound `EVENT_ATTACK_ANNOUNCE` Trap activation using restored `Card.GetAttackableTarget()` plus `Duel.ChangeAttackTarget(target)` retargeting after snapshot restore, official Totem Pole `EVENT_ATTACK_ANNOUNCE` active-Trap trigger restoration through counter-placement cost state, `Duel.NegateAttack()`, and `Card.AddCounter`, official Wind-Up Knight `EVENT_BE_BATTLE_TARGET` monster trigger restoration through `Duel.GetAttackTarget()` condition and `Duel.NegateAttack()` resolution, official Gagaga Escape Graveyard Quick Effect restoration through `Card.IsCanChangePosition` filtering that excludes already-attacked and already-position-changed "Gagaga" monsters before group `Duel.ChangePosition`, official Chocolate Magician Girl `EVENT_BE_BATTLE_TARGET` restoration through Graveyard Special Summon, forced retarget replay-baseline suppression, and battle damage from the attack-halving continuous effect, official Card Blocker `EVENT_BE_BATTLE_TARGET` field-trigger restoration through `Duel.GetAttacker():GetAttackableTarget()` and `Duel.ChangeAttackTarget(c)` retargeting to itself, official Ultimate Divine-Beast `EVENT_ATTACK_ANNOUNCE` field Trap restoration through discard cost, Graveyard DIVINE Special Summon, forced retarget replay suppression, and Defense Position battle resolution, official Gagaga Samurai `EVENT_BE_BATTLE_TARGET` restoration through position change and `Duel.CalculateDamage` full battle resolution that destroys the redirected defender and ends the original pending attack, plus official Dispatchparazzi `EVENT_BE_BATTLE_TARGET` `Duel.CalculateDamage` redirection through post-battle `Card.GetBattleTarget()` in its destroyed trigger, destroying the battle opponent and recovering LP after restore.

Remaining deliverables:

- Continue expanding battle timing coverage beyond the current restored Negate Attack and Alien Hunter real-script fixtures to more Project Ignis scripts that use battle helper APIs.
- Deepen "during damage calculation" edge behavior for replacement effects and response priority where EDOPro distinguishes sub-steps beyond the current window kinds. Both-player plus half-damage modifier ordering now has always-on snapshot-backed fixture coverage.
- Broaden `EVENT_BATTLED`/after-damage-calculation coverage beyond the current Wall of Illusion, Divine Knight Ishzark, D.D. Assailant, and D.D. Warrior plus Wall simultaneous-trigger branches.
- Battle destruction replacement conflicts and redirected branches involving multiple competing field battle-destroy redirects now have snapshot-backed fixture coverage.
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
- Preserve active chain limits, including `Duel.SetChainLimit` and `Duel.SetChainLimitTillChainEnd`, across browser-safe snapshots. Fixture-backed limits can be restored by registry key today, and Lua-created predicates now restore when they are known globals such as `aux.TRUE`/`aux.FALSE`, direct or named literal `return true`/`return false` predicates, named card-table functions such as `s.chlimit`/`s.chainlm`/`s.climit`/`s.chainlimit` and numbered named predicates, official-style named response-player and direct effect-type predicates such as `s.climit(e,lp,tp)` and `s.chainlimit(e,rp,tp)`, Project Ignis-style single-card factory, direct captured single-card, and multi-card closures that allow or block captured cards' own handlers, Project Ignis-style target-card, current-chain target-card, current-type/direct source-type and original-type mask closures that block matching handler card types or selected target handlers, captured event-player action-type closures such as `s.limit(ep)` that allow a source type only for a derived chain player, source-type plus effect-type closures that block combinations such as Trap activations with optional source setcode exclusions, active-type plus effect-type closures that block Spell/Trap activations such as `s.elimit`, handler-code closures that capture the allowed responding effect handler code, capture multiple allowed handler codes through `IsCode(...)`, use a direct literal handler-code equality check, or combine response-player equality with handler-code checks, response-player closures that capture the allowed responding player, chain-player closures that capture the original activating player, direct and named response-player equals chain-player checks including returned inline `SetChainLimit` forms, direct response-player-or-active-type allow, response-player-or-not-effect-type, response-player-or-not-active-type, and direct or named response-player-or-source-type non-activation checks including Spell/Trap and Trap-only variants, direct `not e:IsHasType(...)` single and combined effect-type checks including compact Rush-style inline forms, direct or named `not e:IsMonsterEffect()`/spell/trap active-type checks, direct single and combined `not e:IsActiveType(TYPE_*)` checks, direct or named response-player-or-not-active-type checks, direct or named `not (e:IsMonsterEffect() and e:GetHandler():IsLinkMonster())`, direct `not (e:IsMonsterEffect() and not e:GetHandler():HasLevel())` active-type checks, and safe stateless return-only no-upvalue inline source predicates. Captured or side-effecting arbitrary Lua-created one-chain and until-chain-end predicate closures still fail closed by restoring deny-all raw guards without registry keys, hiding every Lua restore legal-action surface, and reporting explicit missing chain-limit registry diagnostics; the remaining parity work is to rebuild or serialize those broader Lua predicates without re-running costs or target selection.

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
- Replacement conflicts require a deterministic selection path or prompt. Current coverage includes falling through declined or otherwise inapplicable Lua destruction, release, and send replacement candidates to later valid candidates, prioritizing the turn player's field destroy/release/send replacement over an earlier opponent field replacement per EDOPro ocgcore `operation_replace` ordering, preserving and respecting used Lua replacement count limits across snapshot restore, gating Lua destruction, release, and send replacement eligibility through `SetValue` threatened-card predicates, exposing pending destination/reason context to single-card send replacement targets, exposing pending reason-player context to single-card destroy replacement targets, applying `EFFECT_DESTROY_SUBSTITUTE` as an EDOPro-style pre-pass before ordinary `EFFECT_DESTROY_REPLACE`, destroying each valid substitute handler for the same threatened card with `REASON_EFFECT|REASON_DESTROY|REASON_REPLACE`, supporting substitute `SetValue(e,re,r,rp)` callbacks and numeric `SetValue(1)`, applying equip-type continuous effects to their equipped monster, sending equip cards to the Graveyard with `REASON_LOST_TARGET` when their equipped monster leaves the Monster Zone, preserving and exposing `Card.GetPreviousEquipTarget`, restoring pending lost-target Lua triggers with their previous equip target, covering real Project Ignis Union procedure destroy substitute effects including old Union battle-only protection, Legendary Ebon Steed's equip destroy substitute, and Gladiator Beast's Battle Archfiend Shield lost-target return trigger, applying Lua self, destroyer-carried battle-destroy, turn-player-prioritized field battle-destroy replacement conflicts after snapshot restore, turn-player-prioritized field battle-destroy redirects including after snapshot restore, turn-player-prioritized field banish and leave-field redirects, and to-Grave callback redirects, treating field redirect, field immunity, effect-targeting restrictions, and trigger-lockout `SetTargetRange` values as card location masks unless `EFFECT_FLAG_PLAYER_TARGET` is set, and treating EDOPro player-selector `SetTargetRange(1,0)` patterns for cost-use, cost-to-grave, cannot-change-position, and battle-destroy redirect effects as player-scoped selectors. Field immunity query coverage also applies Lua `SetTarget` card predicates before `SetValue` immunity checks, `Card.IsDestructable(effect)` now treats matching immunity as non-destructible while respecting `EFFECT_FLAG_IGNORE_IMMUNE`, and effect-reason Lua movement helpers now block active-effect `Duel.Destroy`, `Duel.SendtoGrave`, `Duel.Release`, `Duel.Remove`, `Duel.SendtoHand`, `Duel.SendtoDeck`, `Duel.SendtoExtra`, generic `Duel.Sendto`, `Duel.MoveToDeckTop`, `Duel.MoveToDeckBottom`, `Duel.ReturnToField`, `Duel.SpecialSummon`, and `Duel.SpecialSummonStep` from moving immune cards unless the active effect ignores immunity, while cost-reason movement remains unblocked by effect immunity. Active-effect immunity coverage also blocks Lua control changes, control swaps, position changes, sequence changes, attack/defense/Level/Rank/Link/Scale updates, counter placement and effect-reason counter removal, `Card.CopyEffect` receivers, equips to immune targets, and overlay attachment of immune materials unless the active effect ignores immunity. Counter API coverage also includes upstream batch helpers `Card.GetAllCounters` and `Card.RemoveAllCounters`, `Card.EnableCounterPermit`/`Card.SetCounterLimit` registration, `COUNTER_WITHOUT_PERMIT`, `COUNTER_NEED_ENABLE`, `IsCanAddCounter` location probes, target-filtered counter permits, singly counter-limit clamping, silent counter cleanup when single counter-permit effects are deleted or reset, EDOPro-style permanent versus reset-while-negated counter buckets that preserve only permanent `COUNTER_WITHOUT_PERMIT` counters through card disable, and counter cleanup on EDOPro movement reset destinations.
- Complex movement still preserves zone invariants and previous-state fields.

## Phase 5: Lua Compatibility Driven By Real Cards

Lua work should follow fixture failures and deck probes. Avoid implementing APIs only because they exist upstream; prioritize APIs that unblock real scripts and parity fixtures.

Deliverables:

- Keep running the API usage scanner against Project Ignis scripts.
- Add missing `Duel.*`, `Card.*`, `Effect.*`, `Group.*`, and `aux.*` APIs only with a failing script or fixture reference.
- Deepen procedure helper families:
  - persistent trap variants beyond restored target-relation helper coverage
  - union
  - equip
  - Spirit
  - Gemini
  - Pendulum
  - Ritual and Fusion helpers; common `Ritual.Target`/`Ritual.Operation`, `Ritual.AddProcGreaterCode`, `Ritual.AddProcEqual`, `Ritual.AddProcGreater` `matfilter`, `Ritual.CreateProc`/`Ritual.AddProcGreater` `requirementfunc` material-value callbacks, `Ritual.Operation` `sumpos` handling and face-down confirmation, `Ritual.CreateProc` hand-or-Graveyard and Deck target locations, `Ritual.CreateProc` `self=true` Pendulum Zone target procedures, `Ritual.CreateProc` `stage2` post-summon operations through Rebirth of Nephthys, High Ritual Art, and Dogmatikalamity, `Ritual.CreateProc` `forcedselection` and `specificmatfilter` material requirements through Super Soldier Synthesis and Dogmatikalamity, `Ritual.CreateProc` extra material groups through Advanced Ritual Art, Nekroz Divinemirror, Dogmatikalamity, and Machine Angel Absolute Ritual, positional `Ritual.CreateProc` opponent-field release materials through Forbidden Arts of the Gishki, `Ritual.CreateProc` custom operations through Vendread Reunion, `Fusion.RegisterSummonEff` hand-material paths, table-arg `mincount` and partial `extraop` material movement through Heavy Polymerization, positional Fusion helper `stage2` summon oaths through Prank-Kids Pandemonium, forced-handler material requirements through Dyna Base, opponent-field `extrafil` Fusion materials through Fallen of Albaz, Contact Fusion procedure sends, banishes, and custom summon types through Necroquip Princess, Lady's Dragonmaid, Arcana Force EX - The Chaos Ruler, and Gladiator Beast Andabata, table-arg `Fusion.CreateSummonEff` material-check-only `extrafil` callbacks through Secrets of Dark Magic, and `Fusion.CreateSummonEff` graveyard extra-material banish, shuffle, Deck `extrafil`, exact-count, `extrafil` fcheck, and `stage2` protection paths now have real-script or focused helper fixtures, while broader ritual and Fusion procedure variants still need coverage.
- Improve remaining label object and group behavior, operation info, hints, selection prompts, field ID edge cases, and query helpers.
- Continue replacing transient Lua function-ref chain-limit predicates with serializable descriptors when the upstream script shape permits it; known globals, direct or named literal true/false predicates, named card-table one-link and until-chain-end predicates, captured handler equality/exclusion closures, multi-card handler-exclusion closures, target-card, current-chain target-card, current-type and original-type mask response-player closures, captured event-player action-type/chain-player closures, source-type plus effect-type closures with optional source setcode exclusions, active-type plus effect-type Spell/Trap activation blocks, single-code and multi-code handler-code closures, inline literal handler-code equality checks, response-player-or-handler-code checks, response-player closures, chain-player closures, direct or named response-player equals chain-player checks including returned inline `SetChainLimit` forms, direct or named response-player-or-active-type allow, response-player-or-not-effect-type, response-player-or-not-active-type, and direct or named response-player-or-Spell/Trap and Trap-only non-activation checks, direct `not e:IsHasType(...)` single and combined effect-type checks, direct or named `not e:IsMonsterEffect()`/spell/trap active-type checks, direct single and combined `not e:IsActiveType(TYPE_*)` and direct or named response-player-or-not-active-type checks, direct or named Link Monster/no-Level active-type checks, and safe stateless return-only no-upvalue inline source predicates are covered, while broader captured or side-effecting arbitrary closure predicates still need descriptor work.
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
