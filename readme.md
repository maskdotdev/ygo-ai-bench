# Duel Deck Studio — Yu-Gi-Oh! Deck Builder

A polished browser app for building Yu-Gi-Oh! decks with real card data and images from the public YGOPRODeck API. The deck builder remains static, while the playtest arena now runs as a React/TanStack Router surface.

## Features

- Live card search across name, effect text, type, race, attribute, and archetype.
- Card thumbnails and detail inspector with stats, effect text, prices, and banlist status.
- Main / Extra / Side Deck zones with drag-and-drop, quantity controls, smart add, and move actions.
- Real-time deck validation:
  - Main Deck: 40–60 cards.
  - Extra Deck: up to 15 cards.
  - Side Deck: up to 15 cards.
  - Maximum copies across Main + Extra + Side.
  - TCG / OCG / GOAT Forbidden, Limited, and Semi-Limited status from the API.
  - Extra Deck monsters routed/validated correctly.
  - Token and Skill cards hidden by default.
- IndexedDB card-data cache to reduce API traffic after the first load.
- Local deck save/load.
- Standard `.ydk` import/export.
- Responsive dark UI with keyboard-friendly controls.

## How to run

For the static deck builder, open `index.html` in a browser, or serve the folder locally:

```bash
cd yugioh-deck-builder
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

For the React playtest arena, use Bun:

```bash
bun install
bun run dev
```

Then open the local Vite URL and visit `/playtest.html`.

## API notes

The app uses the YGOPRODeck Card Information endpoint at runtime. The API docs ask developers to cache downloaded data and avoid continually hotlinking images in production. This prototype caches card JSON in IndexedDB; a production deployment should re-host card images or proxy them through your own image cache.

## Agent bridge

After the page loads, the app exposes `window.duelDeckAgent` for browser agents and automation. The bridge provides structured access to card search, current deck state, deck mutation, validation, analysis, and YDK import/export without scraping the UI.

Useful calls:

```js
window.duelDeckAgent.status()
window.duelDeckAgent.searchCards('Blue-Eyes special summon', { limit: 20, full: true })
window.duelDeckAgent.getDeck({ includeCards: true })
window.duelDeckAgent.addCard('89631139', 'main', 3)
window.duelDeckAgent.validateDeck()
window.duelDeckAgent.analyzeDeck()
window.duelDeckAgent.simulateHands({ trials: 20, handSize: 5, seed: 42 })
window.duelDeckAgent.playtest.legalActionGroups()
window.duelDeckAgent.playtest.runScripted([{ type: 'normalSummon', labelIncludes: 'Magician' }])
window.duelDeckAgent.exportYdk()
window.duelDeckAgent.importYdk('#main\n89631139\n#extra\n!side\n')
```

`simulateHands()` performs a non-mutating opening-hand dry run from the current Main Deck. It draws 5 cards by default, classifies likely starters, extenders, searchers, disruption, removal, draw power, and bricks, then returns per-hand strategy lines plus aggregate consistency rates. Pass `handIds` to evaluate a specific known hand instead of drawing randomly.

## TypeScript playtest engine

The framework-agnostic playtest engine lives under `src`. The `/playtest.html` arena consumes it through a React/TanStack Router app styled with Tailwind.

```ts
import { chooseHighestPriority, parseYdk, runPlaytest, snapshot, startPlaytest } from './src/playtest';

const ydk = parseYdk(deckText);
const session = startPlaytest({ deck: ydk.main, extraDeck: ydk.extra, seed: 42, handSize: 5 });
const view = snapshot(session);
const result = runPlaytest(session, chooseHighestPriority, 10);
```

`snapshot(session)` and `applyAction(session, action)` return `legalActions` plus `legalActionGroups`. UI and browser agents should render or choose from those engine-provided actions directly; grouping is presentation metadata, not a separate legality system.

The full duel engine exposes the same pattern through `getDuelLegalActions(session, player)`, `groupDuelLegalActions(actions)`, and the convenience `getGroupedDuelLegalActions(session, player)`. Grouped full-duel actions preserve `windowId` and `windowKind`, so UI code can render prompt, chain-response, trigger-bucket, battle, and open-game windows without rebuilding timing rules.

Full-duel automation can reuse the fixture selector path with `selectDuelActionBySelector(actions, selector, cards)` or apply a sequence with `runScriptedDuelResponses(session, selectors)`. The scripted runner returns `failedStep`, `failure`, `divergencePlayer`, `divergenceWindowId`, `divergenceWindowKind`, `divergenceGroupKey`, and `divergenceGroupLabel` when the legal-action window diverges.

Run checks with:

```bash
bun run check
```

Or run individual checks with:

```bash
bun run check:loc
bun run scan:lua-parity
bun run typecheck
bun run test
bun run build
```

`bun run check` includes the combined Lua parity scanner and the official chain-limit predicate-shape scanner. To inspect missing EDOPro Lua APIs, constants, or unclassified chain-limit predicates against a local Project Ignis card-script checkout, clone scripts into the ignored upstream workspace and run the scanners directly:

```bash
git clone --depth 1 https://github.com/ProjectIgnis/CardScripts .upstream/ignis/script
bun run scan:lua-api -- --limit 50
bun run scan:lua-constants -- --fail-on-missing
bun run scan:lua-chain-limits -- --limit 80 --fail-on-unclassified
bun run scan:lua-parity
```

These scanners are parity guardrails. Missing APIs or constants should become implementation work or fixture-backed parity backlog, not permanent exclusions from the engine target.
The chain-limit scanner classifies official `Duel.SetChainLimit` and `Duel.SetChainLimitTillChainEnd` predicate shapes so restore coverage can be compared against the current Project Ignis corpus.

`bun run build` emits the React playtest page and `dist/playtest-engine.js`, which exposes `window.duelDeckPlaytest` in the browser. If that bundle is loaded, the existing `window.duelDeckAgent.playtest` bridge can start, inspect, step, and auto-run playtest sessions from the current deck.

For browser automation, `window.duelDeckAgent.playtest.runScripted(steps, sessionId)` accepts fixture-style action selectors (`type`, `uid`, `id`, `effectId`, `labelIncludes`, `occurrence`) and returns `failedStep`, `failure`, `divergenceGroupKey`, and `divergenceGroupLabel` when the current legal-action group diverges from the script.

## Duel snapshot persistence

The full duel engine exposes `serializeDuel(session)` and `restoreDuel(snapshot)` for deterministic test fixtures, browser handoff, and long-running playtest state. Snapshots contain serializable duel state only; callback functions are intentionally stripped.

Current restore behavior:

- Static continuous effects persist automatically when they have no callback-driven activation, cost, target, or operation.
- Lua card effects should be restored with `restoreDuelWithLuaScripts(snapshot, source, cardReader)`. The helper reloads required card scripts, registers their `initial_effect` functions, keeps only Lua registry keys that existed in the snapshot, and reports `restoreComplete`, `restoredRegistryKeys`, `missingRegistryKeys`, and Lua chain-limit predicate diagnostics. Browser reconnect code should treat `restoreComplete === false` as unsafe for legal-action display because missing Lua callbacks can expose illegal responses.
- Manual TypeScript effects with callbacks must provide a stable `registryKey` and be restored with a `DuelEffectRestoreRegistry` passed to `restoreDuel(snapshot, cardReader, registry)`.
- Effects without a static shape or registry key are omitted from snapshots by design, because replaying arbitrary closures would not be browser-safe or deterministic.

Minimal Lua restore guard:

```ts
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts, serializeDuel } from './src/engine';

const snapshot = serializeDuel(session);
const restored = restoreDuelWithLuaScripts(snapshot, scriptSource, cardReader);

if (!restored.restoreComplete) {
  // Do not expose legal actions from this session until the missing scripts or callbacks are resolved.
  console.warn(restored.missingRegistryKeys, restored.missingChainLimitRegistryKeys);
}

const legalActions = getLuaRestoreLegalActions(restored, 0);
const legalActionGroups = getLuaRestoreLegalActionGroups(restored, 0);
```

Minimal manual registry example:

```ts
import { restoreDuel, serializeDuel, type DuelEffectRestoreRegistry } from './src/engine';

const snapshot = serializeDuel(session);
const registry: DuelEffectRestoreRegistry = {
  'manual:draw-once': (saved) => ({
    ...saved,
    operation: ({ session }) => {
      session.state.log.push({ type: 'effect', message: 'restored manual effect resolved' });
    },
  }),
};

const restored = restoreDuel(snapshot, cardReader, registry);
```

## Parity fixture metadata

Scripted duel fixtures should label committed expectation blocks with `source: 'edopro'` when they are meant to prove parity:

```ts
after: {
  source: 'edopro',
  note: 'EDOPro keeps optional if triggers available after mandatory when triggers enter the chain',
  legalActionCounts: { 0: 1, 1: 0 },
  legalActionGroupCounts: { 0: 1, 1: 0 },
  legalActions: [{ type: 'activateTrigger', player: 0, effectId: 'fixture-optional-if', count: 1 }],
  legalActionGroups: [
    {
      player: 0,
      label: 'Trigger Activations',
      windowKind: 'triggerBucket',
      actions: [{ type: 'activateTrigger', player: 0, effectId: 'fixture-optional-if', count: 1 }],
    },
  ],
  absentLegalActionGroups: [
    {
      player: 0,
      label: 'Trigger Declines',
      windowKind: 'triggerBucket',
      actions: [{ type: 'declineTrigger', player: 0, effectId: 'fixture-mandatory-when' }],
    },
  ],
}
```

Use `source: 'edopro'` only for expectations backed by observed EDOPro behavior. `source: 'parity-backlog'` is reserved for scanner diagnostics or temporary local investigation; committed parity fixtures are currently gated to zero backlog blocks. Every sourced expectation block should include a `note` that names the EDOPro behavior being preserved so the fixture stays attached to implementation work. For UI-facing timing behavior, assert raw `legalActions`, aggregate `legalActionCounts`, grouped `legalActionGroups`, and aggregate `legalActionGroupCounts`; use `absentLegalActions` and `absentLegalActionGroups` when an illegal response must not be exposed.

## Included decks

- `dark-magical-blast-master-duel-day1.ydk` — 40-card Master Duel Day 1 Dark Magician upgrade path for two Dark Magical Blast structure decks plus Dragoon/Verte staples.
- `dark-magical-blast-tcg-branded-dm.ydk` — TCG-valid Branded Dark Magician variant for the app's TCG validator.

## Files

- `index.html` — app shell and accessible markup.
- `styles.css` — responsive, polished UI.
- `app.js` — card loading, deck state, validation, import/export, drag/drop.
- `playtest.html` — React/TanStack Router playtest arena shell.
- `src/playtest-app` — Tailwind-styled playtest UI.
