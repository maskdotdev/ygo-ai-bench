import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, destroyDuelCard, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Gachi Gachi SelectEffectYesNo", () => {
  it("restores SelectEffectYesNo destroy replacement into Xyz material detach", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const gachiCode = "10002346";
    const materialCode = "10002347";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === gachiCode),
      { code: materialCode, name: "Gachi Gachi Xyz Material", kind: "monster", typeFlags: typeMonster, level: 2, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 100, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode], extra: [gachiCode] }, 1: { main: [] } });
    startDuel(session);

    const gachi = requireCard(session, gachiCode);
    const material = requireCard(session, materialCode);
    moveDuelCard(session.state, gachi.uid, "monsterZone", 0);
    moveDuelCard(session.state, material.uid, "overlay", 0);
    gachi.overlayUids.push(material.uid);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gachiCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);

    const destroyed = destroyDuelCard(restored.session.state, gachi.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(destroyed).toMatchObject({
      uid: gachi.uid,
      location: "monsterZone",
      overlayUids: [],
    });
    expect(restored.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect,
    });
    expect(restored.host.promptDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        api: "SelectEffectYesNo",
        player: 0,
        description: 96,
        returned: true,
      }),
    ]));

    const restoredAfterReplacement = restoreDuelWithLuaScripts(serializeDuel(restored.session), workspace, reader);
    expect(restoredAfterReplacement.restoreComplete, restoredAfterReplacement.incompleteReasons.join("; ")).toBe(true);
    expect(restoredAfterReplacement.missingRegistryKeys).toEqual([]);

    const secondDestroy = destroyDuelCard(restoredAfterReplacement.session.state, gachi.uid, 0, duelReason.effect | duelReason.destroy, 1);
    expect(secondDestroy).toMatchObject({
      uid: gachi.uid,
      location: "graveyard",
      reason: duelReason.effect | duelReason.destroy,
    });
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
