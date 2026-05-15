import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Rikka Konkon extra release cost", () => {
  it("uses opponent Konkon extra-release material for Hellebore graveyard revival cost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const konkonCode = "76869711";
    const helleboreCode = "60880471";
    const opponentCode = "900000259";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [konkonCode, helleboreCode].includes(card.code)),
      { code: opponentCode, name: "Konkon Opponent Release", kind: "monster", typeFlags: 0x21, level: 4, race: 0x2, attack: 1200, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 768, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [konkonCode, helleboreCode] }, 1: { main: [opponentCode] } });
    startDuel(session);

    const konkon = session.state.cards.find((card) => card.code === konkonCode);
    const hellebore = session.state.cards.find((card) => card.code === helleboreCode);
    const opponent = session.state.cards.find((card) => card.code === opponentCode);
    expect(konkon).toBeDefined();
    expect(hellebore).toBeDefined();
    expect(opponent).toBeDefined();
    moveDuelCard(session.state, konkon!.uid, "spellTrapZone", 0);
    moveDuelCard(session.state, hellebore!.uid, "graveyard", 0);
    moveDuelCard(session.state, opponent!.uid, "monsterZone", 1);
    konkon!.faceUp = true;
    opponent!.faceUp = true;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(konkonCode), workspace).ok).toBe(true);
    expect(host.loadCardScript(Number(helleboreCode), workspace).ok).toBe(true);
    const registrations = host.registerInitialEffectsDetailed();
    expect(registrations.filter((result) => !result.skipped).every((result) => result.ok), JSON.stringify(registrations, null, 2)).toBe(true);
    expect(registrations.filter((result) => result.ok && !result.skipped).length).toBe(2);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "continuous", code: 158, sourceUid: konkon!.uid }),
        expect.objectContaining({ event: "continuous", code: Number(konkonCode), sourceUid: konkon!.uid }),
      ]),
    );

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "activateEffect" && candidate.uid === hellebore!.uid);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);

    expect(restored.session.state.cards.find((card) => card.uid === opponent!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "monsterZone",
      reason: duelReason.release | duelReason.cost,
    });
    expect(restored.session.state.cards.find((card) => card.uid === hellebore!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpDefense",
    });
  });
});

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}
