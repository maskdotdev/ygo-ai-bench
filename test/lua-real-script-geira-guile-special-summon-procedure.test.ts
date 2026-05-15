import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { currentAttack } from "#duel/card-stats.js";
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
const setCubic = 0xe3;
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Geira Guile Special Summon procedure", () => {
  it("restores its Cubic monster send-to-Graveyard cost and attack gain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const geiraCode = "40392714";
    const costCode = "40392715";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === geiraCode),
      { code: costCode, name: "Geira Guile Cubic Cost", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000, setcodes: [setCubic] },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 403, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [geiraCode, costCode] }, 1: { main: [] } });
    startDuel(session);

    const geira = session.state.cards.find((card) => card.code === geiraCode);
    const cost = session.state.cards.find((card) => card.code === costCode);
    expect(geira).toBeDefined();
    expect(cost).toBeDefined();
    moveDuelCard(session.state, geira!.uid, "hand", 0);
    moveDuelCard(session.state, cost!.uid, "monsterZone", 0);
    cost!.faceUp = true;
    cost!.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(geiraCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restored);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    const procedure = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === geira!.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, procedure!);

    const restoredGeira = restored.session.state.cards.find((card) => card.uid === geira!.uid);
    expect(restoredGeira).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      summonType: "special",
    });
    expect(currentAttack(restoredGeira, restored.session.state)).toBe((geira!.data.attack ?? 0) + 800);
    expect(restored.session.state.cards.find((card) => card.uid === cost!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restored.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "specialSummoned", eventCode: 1102, eventCardUid: geira!.uid }),
      ]),
    );
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === cost!.uid)).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: cost!.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: geira!.uid,
        eventReasonEffectId: 2,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(restored.session.state.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceUid: geira!.uid, event: "continuous", code: 100, value: 800 })]),
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
