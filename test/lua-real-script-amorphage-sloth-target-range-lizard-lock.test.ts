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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Amorphage Sloth target-range Clock Lizard lock", () => {
  it("restores its both-player 0xff original Amorphage Clock Lizard check", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const slothCode = "32687071";
    const amorphageCode = "32687072";
    const offSetCode = "32687073";
    const setAmorphage = 0xe0;
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === slothCode),
      { code: amorphageCode, name: "Sloth Original Amorphage Probe", kind: "extra", typeFlags: 0x41, setcodes: [setAmorphage], race: 0x2000, attribute: 0x20, level: 6, attack: 1000, defense: 1000 },
      { code: offSetCode, name: "Sloth Original Off-Set Probe", kind: "extra", typeFlags: 0x41, setcodes: [0x123], race: 0x2000, attribute: 0x20, level: 6, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 326, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [slothCode], extra: [amorphageCode, offSetCode] }, 1: { main: [] } });
    startDuel(session);
    const sloth = session.state.cards.find((card) => card.code === slothCode);
    expect(sloth).toBeDefined();
    moveDuelCard(session.state, sloth!.uid, "monsterZone", 0);
    sloth!.faceUp = true;
    sloth!.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(slothCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBeGreaterThan(0);
    const effect = session.state.effects.find((candidate) => candidate.code === 51476410);
    expect(effect).toMatchObject({
      luaTargetDescriptor: `target:not-original-setcode:${setAmorphage}`,
      range: ["monsterZone"],
      targetRange: [0xff, 0xff],
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    const restoredEffect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    const source = restored.session.state.cards.find((card) => card.code === slothCode);
    const amorphage = restored.session.state.cards.find((card) => card.code === amorphageCode);
    const offSet = restored.session.state.cards.find((card) => card.code === offSetCode);
    expect(restoredEffect).toMatchObject({
      luaTargetDescriptor: `target:not-original-setcode:${setAmorphage}`,
      range: ["monsterZone"],
      targetRange: [0xff, 0xff],
      value: 1,
    });
    expect(restoredEffect?.targetCardPredicate).toBeDefined();
    expect(source).toBeDefined();
    expect(amorphage).toBeDefined();
    expect(offSet).toBeDefined();
    const ctx = targetContext(restored.session.state, source!);
    expect(restoredEffect!.targetCardPredicate!(ctx, amorphage!)).toBe(false);
    expect(restoredEffect!.targetCardPredicate!(ctx, offSet!)).toBe(true);
  });
});
