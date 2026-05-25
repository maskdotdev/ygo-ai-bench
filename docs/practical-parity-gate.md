# Practical Parity Gate

The active goal is a reliable, fixture-proven, EDOPro-compatible duel engine that can drive a browser playtest arena. That does not require one fixture for every official script or 100% behavior-signature coverage before the engine is useful.

Use the full Project Ignis script set as a compatibility map. Use representative fixtures, curated deck probes, and browser arena checks as the quality gate.

## Release Gate

A browser-playtest-ready milestone is reached when all of these are true:

- `bun run check` passes from a clean checkout with vendored or locally cached upstream data.
- `bun run report:parity-progress` reports no missing Lua APIs/constants, no unclassified prompt or chain-limit patterns, 100% clean restore for the guarded fixture inventory, and green fixture provenance/legal-action evidence.
- The curated browser card pool has no local fallback scripts or stub card data in the tested deck paths.
- The PvP/browser arena can load the curated decks, expose legal actions, execute a scripted smoke duel, survive snapshot restore, and continue play after chain, trigger, battle, and phase transitions.
- Representative fixtures cover the mechanics needed by the curated pool: summons, costs, targeting, chains, prompts, battle, movement, control changes, stat changes, resets, delayed effects, and restore.
- Known unsupported mechanics are documented as excluded from the curated pool or linked to a failing fixture/backlog item.

## Signature Coverage Role

`tools/report-lua-behavior-signatures.mjs` is a selection and risk tool, not the launch definition.

Use it to:

- find uncovered behavior shapes that combine APIs in new ways
- choose the next high-leverage representative fixture
- notice when a family has no direct real-script coverage
- track broad progress over time

Do not use it to:

- require all 12k+ behavior signatures before the browser arena can be considered useful
- treat one covered signature as proof that every card in that signature is correct
- prioritize count growth over fixtures that unblock curated decks or browser playtest flows

## Slice Priority

Prefer work in this order:

1. Fix failures that block curated deck probes or the browser arena.
2. Add real-script fixtures for mechanics used by curated decks.
3. Add representative fixtures for high-risk engine families: timing windows, chain response, battle, summon procedures, restore, prompts, and control/movement.
4. Use uncovered signatures to find new behavior combinations after the playable milestone remains green.

This keeps the long-term EDOPro parity path intact while giving the repo a practical, testable definition of "reliable enough to playtest."
