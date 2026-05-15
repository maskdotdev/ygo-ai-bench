import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, linkSummonDuelCard, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Anger Knuckle Link material lock", () => {
  it("restores official EFFECT_CANNOT_BE_LINK_MATERIAL and removes Link Summon actions", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const angerCode = "146746";
    const targetLinkCode = "900000248";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === angerCode),
      {
        code: targetLinkCode,
        name: "Anger Knuckle Material Check Link",
        kind: "extra",
        typeFlags: 0x4000001,
        level: 2,
        attack: 1800,
        linkMaterials: [angerCode],
        linkMaterialMin: 1,
        linkMaterialMax: 1,
      },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 146, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [], extra: [angerCode, targetLinkCode] }, 1: { main: [] } });
    startDuel(session);

    const anger = session.state.cards.find((card) => card.code === angerCode);
    const targetLink = session.state.cards.find((card) => card.code === targetLinkCode);
    expect(anger).toBeDefined();
    expect(targetLink).toBeDefined();
    moveDuelCard(session.state, anger!.uid, "monsterZone", 0);
    anger!.position = "faceUpAttack";
    anger!.faceUp = true;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(angerCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 239,
          sourceUid: anger!.uid,
          value: 1,
        }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLegalActions(restored.session, 0).some((action) => action.type === "linkSummon" && action.uid === targetLink!.uid)).toBe(false);
    expect(() => linkSummonDuelCard(restored.session.state, 0, targetLink!.uid, [anger!.uid])).toThrow("cannot be used as Link material");
    expect(restored.session.state.cards.find((card) => card.uid === targetLink!.uid)).toMatchObject({ location: "extraDeck" });
    expect(restored.session.state.cards.find((card) => card.uid === anger!.uid)).toMatchObject({ location: "monsterZone" });
  });
});
