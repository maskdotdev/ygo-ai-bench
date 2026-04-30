import { expect } from "vitest";
import { createDuel, loadDecks, startDuel } from "#duel/core.js";
import { createCardReader } from "#engine/data-loaders.js";
import type { DuelCardData, DuelPlayerDeck, PlayerId } from "#duel/types.js";
import { createLuaScriptHost } from "#lua/host.js";

interface LuaChainFixtureOptions {
  cards: DuelCardData[];
  decks: Record<PlayerId, DuelPlayerDeck>;
  expectedEffects: number;
  script: string;
  scriptName: string;
  seed: number;
  startingHandSize: number;
}

export function setupLuaChainFixture(options: LuaChainFixtureOptions) {
  const session = createDuel({ seed: options.seed, startingHandSize: options.startingHandSize, cardReader: createCardReader(options.cards) });
  loadDecks(session, options.decks);
  startDuel(session);

  const host = createLuaScriptHost(session);
  const result = host.loadScript(options.script, options.scriptName);

  expect(result.ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(options.expectedEffects);

  return { session, host };
}
