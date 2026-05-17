import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Cyber Dragon Special Summon procedure", () => {
  it("restores the empty-own-field opponent-monster hand Special Summon procedure", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const cyberDragonCode = "70095154";
    const ownBlockerCode = "70095155";
    const opponentMonsterCode = "70095156";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === cyberDragonCode),
      { code: ownBlockerCode, name: "Cyber Dragon Own Field Blocker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: opponentMonsterCode, name: "Cyber Dragon Opponent Monster", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);

    const blocked = createRestoredCyberDragonWindow({
      cards,
      cyberDragonCode,
      ownBlockerCode,
      opponentMonsterCode,
      reader,
      workspace,
      withOwnMonster: true,
    });
    expectCleanRestore(blocked);
    expect(getLuaRestoreLegalActions(blocked, 0)).toEqual(getDuelLegalActions(blocked.session, 0));
    expect(getLuaRestoreLegalActionGroups(blocked, 0)).toEqual(getGroupedDuelLegalActions(blocked.session, 0));
    expect(getLuaRestoreLegalActions(blocked, 0).some((action) => action.type === "specialSummonProcedure")).toBe(false);

    const restored = createRestoredCyberDragonWindow({
      cards,
      cyberDragonCode,
      ownBlockerCode,
      opponentMonsterCode,
      reader,
      workspace,
      withOwnMonster: false,
    });
    expectCleanRestore(restored);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));

    const cyberDragon = restored.session.state.cards.find((card) => card.code === cyberDragonCode);
    const opponentMonster = restored.session.state.cards.find((card) => card.code === opponentMonsterCode);
    expect(cyberDragon).toBeDefined();
    expect(opponentMonster).toBeDefined();
    const procedure = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === cyberDragon!.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    expect(procedure).toMatchObject({ windowKind: "open", label: "Special Summon Cyber Dragon" });
    applyRestoredActionAndAssert(restored, procedure!);

    expect(restored.session.state.cards.find((card) => card.uid === cyberDragon!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
    });
    expect(restored.session.state.cards.find((card) => card.uid === opponentMonster!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      faceUp: true,
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: cyberDragon!.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
  });
});

function createRestoredCyberDragonWindow({
  cards,
  cyberDragonCode,
  ownBlockerCode,
  opponentMonsterCode,
  reader,
  workspace,
  withOwnMonster,
}: {
  cards: DuelCardData[];
  cyberDragonCode: string;
  ownBlockerCode: string;
  opponentMonsterCode: string;
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  withOwnMonster: boolean;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: withOwnMonster ? 7001 : 7002, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [cyberDragonCode, ownBlockerCode] }, 1: { main: [opponentMonsterCode] } });
  startDuel(session);

  const cyberDragon = session.state.cards.find((card) => card.code === cyberDragonCode);
  const ownBlocker = session.state.cards.find((card) => card.code === ownBlockerCode);
  const opponentMonster = session.state.cards.find((card) => card.code === opponentMonsterCode);
  expect(cyberDragon).toBeDefined();
  expect(ownBlocker).toBeDefined();
  expect(opponentMonster).toBeDefined();
  moveDuelCard(session.state, cyberDragon!.uid, "hand", 0);
  moveDuelCard(session.state, opponentMonster!.uid, "monsterZone", 1);
  opponentMonster!.faceUp = true;
  opponentMonster!.position = "faceUpAttack";
  if (withOwnMonster) {
    moveDuelCard(session.state, ownBlocker!.uid, "monsterZone", 0);
    ownBlocker!.faceUp = true;
    ownBlocker!.position = "faceUpAttack";
  }
  session.state.phase = "main1";
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(cyberDragonCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

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
