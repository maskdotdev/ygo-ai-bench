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
window.duelDeckAgent.exportYdk()
window.duelDeckAgent.importYdk('#main\n89631139\n#extra\n!side\n')
```

`simulateHands()` performs a non-mutating opening-hand dry run from the current Main Deck. It draws 5 cards by default, classifies likely starters, extenders, searchers, disruption, removal, draw power, and bricks, then returns per-hand strategy lines plus aggregate consistency rates. Pass `handIds` to evaluate a specific known hand instead of drawing randomly.

## TypeScript playtest engine

The framework-agnostic playtest engine lives under `src`. The `/playtest.html` arena consumes it through a React/TanStack Router app styled with Tailwind.

```ts
import { chooseHighestPriority, parseYdk, runPlaytest, startPlaytest } from './src/playtest';

const ydk = parseYdk(deckText);
const session = startPlaytest({ deck: ydk.main, extraDeck: ydk.extra, seed: 42, handSize: 5 });
const result = runPlaytest(session, chooseHighestPriority, 10);
```

Run checks with:

```bash
bun run typecheck
bun run test
bun run build
```

`bun run build` emits the React playtest page and `dist/playtest-engine.js`, which exposes `window.duelDeckPlaytest` in the browser. If that bundle is loaded, the existing `window.duelDeckAgent.playtest` bridge can start, inspect, step, and auto-run playtest sessions from the current deck.

## Included decks

- `dark-magical-blast-master-duel-day1.ydk` — 40-card Master Duel Day 1 Dark Magician upgrade path for two Dark Magical Blast structure decks plus Dragoon/Verte staples.
- `dark-magical-blast-tcg-branded-dm.ydk` — TCG-valid Branded Dark Magician variant for the app's TCG validator.

## Files

- `index.html` — app shell and accessible markup.
- `styles.css` — responsive, polished UI.
- `app.js` — card loading, deck state, validation, import/export, drag/drop.
- `playtest.html` — React/TanStack Router playtest arena shell.
- `src/playtestApp` — Tailwind-styled playtest UI.
