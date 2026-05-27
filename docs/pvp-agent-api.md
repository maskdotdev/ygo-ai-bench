# PvP Agent API

The PvP agent API gives bots and tests a stable way to play through the same rule-enforced duel engine used by the PvP UI. Agents should not mutate duel state directly and should not scrape DOM labels when a `DuelSession` is available.

## Entry Points

```ts
import {
  observePvpAgent,
  applyPvpAgentAction,
  replayPvpAgentActions,
  runPvpAgentLoop,
} from "../src/playtest-app/pvp-agent-api.js";
```

Use `observePvpAgent(session, player)` to get the current public observation for one seat. Use `applyPvpAgentAction(session, player, actionId, params)` to apply one legal action by ID.

```ts
const obs = observePvpAgent(session, 0);
const summon = obs.legalActions.find((action) => action.type === "normalSummon");
if (summon?.placement?.kind === "monsterZone") {
  applyPvpAgentAction(session, 0, summon.id, { summonSequence: 4 });
}
```

## Observation Shape

An observation contains:

- duel status, turn, phase, waiting player, and window kind
- public zone state for self and opponent
- chain links
- prompt or trigger-order state when present
- canonical legal actions
- UI-oriented action groups
- recent log entries

Zones are normalized into fixed slots:

- `monsterZone`: five entries, each card or `null`
- `spellTrapZone`: five entries, each card or `null`
- `fieldZone`: one card or `null`
- `hand`, `graveyard`, `banished`
- `deck` and `extraDeck` pile views

Visibility is seat-aware. A player sees their own hand identities. Opponent hand cards are hidden unless they are revealed by game state.

## Legal Actions

Each legal action has:

- `id`: canonical action ID
- `type`: engine action type
- `label`: display-only text
- `source`: primary card reference when available
- `anchors`: related card references
- `placement`: required zone placement, when applicable
- `params`: accepted or required parameter schema
- `raw`: copied engine action for debugging

Agents should apply actions by `id`, not by labels.

## Placement Params

Actions that place cards expose `placement`.

Monster placement actions require:

```ts
{ summonSequence: 0 | 1 | 2 | 3 | 4 }
```

Spell/Trap placement actions require:

```ts
{ spellTrapSequence: 0 | 1 | 2 | 3 | 4 }
```

Field Spells report `fieldZone` placement and do not require a normal Spell/Trap sequence.

The agent API validates requested zones before calling the engine, and the engine still enforces the final legality.

## Replay

Replay steps are action IDs plus params:

```ts
replayPvpAgentActions(session, [
  { player: 0, actionId: summon.id, params: { summonSequence: 4 } },
]);
```

Optional `observationHash` values can detect divergent state before a replay step is applied.

## Browser Bridge

In dev builds, the PvP page exposes:

```ts
window.__YGO_PVP_AGENT__.observe(player)
window.__YGO_PVP_AGENT__.act(player, actionId, params)
window.__YGO_PVP_AGENT__.state()
```

This is intended for local browser automation and debugging. Production code should import the module API directly.

## Minimal Policy Loop

`runPvpAgentLoop` runs player policies until the duel ends, a policy declines to act, an action fails, or `maxSteps` is reached.

```ts
await runPvpAgentLoop(session, {
  0: firstLegalPvpAgentPolicy,
  1: firstLegalPvpAgentPolicy,
}, { maxSteps: 20 });
```

The bundled first-legal policy is only a smoke-test policy. Real gameplay agents should inspect `legalActions`, prompts, chain state, and board zones before choosing.
