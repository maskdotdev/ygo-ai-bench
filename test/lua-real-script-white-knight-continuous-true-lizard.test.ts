import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelCardInstance, DuelEffectContext } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

function targetContext(duel: DuelEffectContext["duel"], source: DuelCardInstance): DuelEffectContext {
  return {
    duel,
    source,
    player: 0,
    targetUids: [],
    log: () => {},
    moveCard: () => source,
    negateChainLink: () => false,
    setTargets: () => {},
    getTargets: () => [],
    setTargetPlayer: () => {},
    setTargetParam: () => {},
  };
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script White Knight continuous all-card Clock Lizard lock", () => {
  it("restores its default continuous Clock Lizard check", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const whiteKnightCode = "40352445";
    const extraProbeCode = "40352446";
    const deckProbeCode = "40352447";
    const cards: DuelCardData[] = [
      { code: whiteKnightCode, name: "White Knight of Dogmatika", kind: "monster", typeFlags: 0x81, race: 0x1000, attribute: 0x10, level: 8, attack: 500, defense: 2500 },
      { code: extraProbeCode, name: "White Knight Extra Probe", kind: "extra", typeFlags: 0x41, race: 0x2000, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
      { code: deckProbeCode, name: "White Knight Deck Probe", kind: "monster", typeFlags: 0x1, race: 0x2000, attribute: 0x10, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 403, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [whiteKnightCode, deckProbeCode], extra: [extraProbeCode] }, 1: { main: [] } });
    startDuel(session);
    const whiteKnight = session.state.cards.find((card) => card.code === whiteKnightCode);
    expect(whiteKnight).toBeDefined();
    moveDuelCard(session.state, whiteKnight!.uid, "monsterZone", 0);
    whiteKnight!.faceUp = true;
    whiteKnight!.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(whiteKnightCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const effect = session.state.effects.find((candidate) => candidate.code === 51476410);
    expect(effect).toMatchObject({
      range: ["monsterZone"],
      value: 1,
    });
    expect(effect?.luaTargetDescriptor).toBeUndefined();

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    const restoredEffect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    expect(restoredEffect).toMatchObject({
      range: ["monsterZone"],
      value: 1,
    });
    expect(restoredEffect?.luaTargetDescriptor).toBeUndefined();
    const restoredWhiteKnight = restored.session.state.cards.find((card) => card.code === whiteKnightCode);
    const extraProbe = restored.session.state.cards.find((card) => card.code === extraProbeCode);
    const deckProbe = restored.session.state.cards.find((card) => card.code === deckProbeCode);
    expect(restoredEffect?.targetCardPredicate).toBeDefined();
    expect(restoredWhiteKnight).toBeDefined();
    expect(extraProbe).toBeDefined();
    expect(deckProbe).toBeDefined();
    const ctx = targetContext(restored.session.state, restoredWhiteKnight!);
    expect(restoredEffect!.targetCardPredicate!(ctx, extraProbe!)).toBe(true);
    expect(restoredEffect!.targetCardPredicate!(ctx, deckProbe!)).toBe(true);
  });
});
