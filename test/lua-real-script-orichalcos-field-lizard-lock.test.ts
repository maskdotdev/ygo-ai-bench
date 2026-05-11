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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Seal of Orichalcos Field Zone Clock Lizard lock", () => {
  it("restores its default Field Zone Clock Lizard check", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const orichalcosCode = "48179391";
    const extraProbeCode = "48179392";
    const deckProbeCode = "48179393";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === orichalcosCode),
      { code: extraProbeCode, name: "Orichalcos Extra Probe", kind: "extra", typeFlags: 0x41, race: 0x2000, attribute: 0x20, level: 6, attack: 1000, defense: 1000 },
      { code: deckProbeCode, name: "Orichalcos Deck Probe", kind: "monster", typeFlags: 0x1, race: 0x2000, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 481, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [orichalcosCode, deckProbeCode], extra: [extraProbeCode] }, 1: { main: [] } });
    startDuel(session);
    const orichalcos = session.state.cards.find((card) => card.code === orichalcosCode);
    expect(orichalcos).toBeDefined();
    moveDuelCard(session.state, orichalcos!.uid, "spellTrapZone", 0);
    orichalcos!.faceUp = true;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(orichalcosCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    const effect = session.state.effects.find((candidate) => candidate.code === 51476410);
    expect(effect).toMatchObject({
      range: ["spellTrapZone"],
      targetRange: [0xff, 0],
      value: 1,
    });
    expect(effect?.luaTargetDescriptor).toBeUndefined();

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredEffect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    const source = restored.session.state.cards.find((card) => card.code === orichalcosCode);
    const extraProbe = restored.session.state.cards.find((card) => card.code === extraProbeCode);
    const deckProbe = restored.session.state.cards.find((card) => card.code === deckProbeCode);
    expect(restoredEffect).toMatchObject({
      range: ["spellTrapZone"],
      targetRange: [0xff, 0],
      value: 1,
    });
    expect(restoredEffect?.luaTargetDescriptor).toBeUndefined();
    expect(restoredEffect?.targetCardPredicate).toBeDefined();
    expect(source).toBeDefined();
    expect(extraProbe).toBeDefined();
    expect(deckProbe).toBeDefined();
    const ctx = targetContext(restored.session.state, source!);
    expect(restoredEffect!.targetCardPredicate!(ctx, extraProbe!)).toBe(true);
    expect(restoredEffect!.targetCardPredicate!(ctx, deckProbe!)).toBe(true);
  });
});
