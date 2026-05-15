import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Leo Wizard opponent summon procedure", () => {
  it("restores Leo Wizard's opponent-range tribute summon procedure", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const leoWizardCode = "55423549";
    const opponentSummonCode = "55423550";
    const opponentTributeCode = "55423551";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === leoWizardCode),
      { code: opponentSummonCode, name: "Leo Wizard Opponent Summon", kind: "monster", typeFlags: 0x1, level: 4, attack: 1400, defense: 1000 },
      { code: opponentTributeCode, name: "Leo Wizard Opponent Tribute", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 554, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [leoWizardCode] }, 1: { main: [opponentSummonCode, opponentTributeCode] } });
    startDuel(session);

    const leoWizard = requireCard(session, leoWizardCode);
    const opponentSummon = requireCard(session, opponentSummonCode);
    const opponentTribute = requireCard(session, opponentTributeCode);
    moveDuelCard(session.state, leoWizard.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, opponentSummon.uid, "hand", 1);
    moveDuelCard(session.state, opponentTribute.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(leoWizardCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const summon = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "tributeSummon" && action.uid === opponentSummon.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restored, 1), null, 2)).toEqual(expect.objectContaining({
      type: "tributeSummon",
      effectId: expect.stringMatching(/^lua-/),
      tributeUids: [],
    }));
    expect(getLuaRestoreLegalActions(restored, 1)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "normalSummon", uid: opponentSummon.uid }),
    ]));
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
