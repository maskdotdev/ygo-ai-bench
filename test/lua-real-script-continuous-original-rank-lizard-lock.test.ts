import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelCardInstance, DuelEffectContext } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script continuous original Type and Rank Clock Lizard lock", () => {
  it("restores Palm Ryzeal's continuous original Rank 4 Xyz Clock Lizard check", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const palmCode = "61116514";
    const rank4Code = "61116515";
    const rank5Code = "61116516";
    const fusionCode = "61116517";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === palmCode),
      { code: rank4Code, name: "Continuous Original Rank 4 Xyz Probe", kind: "extra", typeFlags: 0x800001, race: 0x2000, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
      { code: rank5Code, name: "Continuous Original Rank 5 Xyz Probe", kind: "extra", typeFlags: 0x800001, race: 0x2000, attribute: 0x20, level: 5, attack: 1000, defense: 1000 },
      { code: fusionCode, name: "Continuous Original Fusion Probe", kind: "extra", typeFlags: 0x41, race: 0x2000, attribute: 0x20, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 611, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [palmCode], extra: [rank4Code, rank5Code, fusionCode] }, 1: { main: [] } });
    startDuel(session);
    const palm = session.state.cards.find((card) => card.code === palmCode);
    expect(palm).toBeDefined();
    moveDuelCard(session.state, palm!.uid, "monsterZone", 0);
    palm!.faceUp = true;
    palm!.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(palmCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const effect = session.state.effects.find((candidate) => candidate.code === 51476410);
    expect(effect).toMatchObject({
      luaTargetDescriptor: "target:not-original-type-rank:8388608:4",
      range: ["monsterZone"],
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const restoredEffect = restored.session.state.effects.find((candidate) => candidate.code === 51476410);
    const source = restored.session.state.cards.find((card) => card.code === palmCode);
    const rank4 = restored.session.state.cards.find((card) => card.code === rank4Code);
    const rank5 = restored.session.state.cards.find((card) => card.code === rank5Code);
    const fusion = restored.session.state.cards.find((card) => card.code === fusionCode);
    expect(restoredEffect?.targetCardPredicate).toBeDefined();
    expect(source).toBeDefined();
    expect(rank4).toBeDefined();
    expect(rank5).toBeDefined();
    expect(fusion).toBeDefined();
    const ctx = targetContext(restored.session.state, source!);
    expect(restoredEffect!.targetCardPredicate!(ctx, rank4!)).toBe(false);
    expect(restoredEffect!.targetCardPredicate!(ctx, rank5!)).toBe(true);
    expect(restoredEffect!.targetCardPredicate!(ctx, fusion!)).toBe(true);
  });
});
