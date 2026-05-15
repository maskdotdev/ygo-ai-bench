import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentAttack, currentDefense } from "#duel/card-stats.js";
import {
  createDuel,
  getGroupedDuelLegalActions,
  getLegalActions as getDuelLegalActions,
  loadDecks,
  serializeDuel,
  startDuel,
} from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;
const raceRock = 0x100;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Megarock Dragon Special Summon procedure", () => {
  it("restores its Rock graveyard banish-cost procedure and selected-count base stats", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const megarockCode = "71544954";
    const rockCode = "71544955";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === megarockCode),
      { code: rockCode, name: "Megarock Dragon Rock Cost", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000, race: raceRock },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 715, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [megarockCode, rockCode] }, 1: { main: [] } });
    startDuel(session);

    const megarock = session.state.cards.find((card) => card.code === megarockCode);
    const rock = session.state.cards.find((card) => card.code === rockCode);
    expect(megarock).toBeDefined();
    expect(rock).toBeDefined();
    moveDuelCard(session.state, megarock!.uid, "hand", 0);
    moveDuelCard(session.state, rock!.uid, "graveyard", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(megarockCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    const procedure = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === megarock!.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, procedure!);

    const restoredMegarock = restored.session.state.cards.find((card) => card.uid === megarock!.uid);
    expect(restoredMegarock).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
    });
    expect(currentAttack(restoredMegarock, restored.session.state)).toBe(700);
    expect(currentDefense(restoredMegarock, restored.session.state)).toBe(700);
    expect(restored.session.state.cards.find((card) => card.uid === rock!.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      previousLocation: "graveyard",
      previousController: 0,
    });
    expect(restored.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "specialSummoned", eventCode: 1102, eventCardUid: megarock!.uid }),
      ]),
    );
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "banished" && event.eventCardUid === rock!.uid)).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: rock!.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: megarock!.uid,
        eventReasonEffectId: 3,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "banished",
          position: "faceDown",
          sequence: 0,
        },
      },
    ]);
    expect(restored.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceUid: megarock!.uid, event: "continuous", code: 103, value: 700 }),
        expect.objectContaining({ sourceUid: megarock!.uid, event: "continuous", code: 107, value: 700 }),
      ]),
    );
  });
});

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
}
