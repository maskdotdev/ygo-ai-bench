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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Gimmick Puppet Magnet Doll Special Summon procedure", () => {
  it("restores its both-fields Gimmick Puppet-only hand Special Summon procedure", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const magnetDollCode = "39806198";
    const ownPuppetCode = "39806199";
    const ownNonPuppetCode = "39806200";
    const opponentMonsterCode = "39806201";
    const cards: DuelCardData[] = [
      { code: magnetDollCode, name: "Gimmick Puppet Magnet Doll", kind: "monster", typeFlags: 0x1, setcodes: [0x1083], level: 8, attack: 1000, defense: 1000 },
      { code: ownPuppetCode, name: "Magnet Doll Gimmick Puppet Field", kind: "monster", typeFlags: 0x1, setcodes: [0x1083], level: 4, attack: 1000, defense: 1000 },
      { code: ownNonPuppetCode, name: "Magnet Doll Non Puppet Field", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: opponentMonsterCode, name: "Magnet Doll Opponent Monster", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);

    const noOpponent = createRestoredMagnetDollWindow({
      cards,
      magnetDollCode,
      ownPuppetCode,
      ownNonPuppetCode,
      opponentMonsterCode,
      reader,
      workspace,
      fieldCase: "noOpponentMonster",
    });
    expectCleanRestore(noOpponent);
    expect(getLuaRestoreLegalActions(noOpponent, 0)).toEqual(getDuelLegalActions(noOpponent.session, 0));
    expect(getLuaRestoreLegalActions(noOpponent, 0).some((action) => action.type === "specialSummonProcedure")).toBe(false);

    const nonPuppet = createRestoredMagnetDollWindow({
      cards,
      magnetDollCode,
      ownPuppetCode,
      ownNonPuppetCode,
      opponentMonsterCode,
      reader,
      workspace,
      fieldCase: "ownNonPuppet",
    });
    expectCleanRestore(nonPuppet);
    expect(getLuaRestoreLegalActions(nonPuppet, 0)).toEqual(getDuelLegalActions(nonPuppet.session, 0));
    expect(getLuaRestoreLegalActions(nonPuppet, 0).some((action) => action.type === "specialSummonProcedure")).toBe(false);

    const faceDownPuppet = createRestoredMagnetDollWindow({
      cards,
      magnetDollCode,
      ownPuppetCode,
      ownNonPuppetCode,
      opponentMonsterCode,
      reader,
      workspace,
      fieldCase: "ownFaceDownPuppet",
    });
    expectCleanRestore(faceDownPuppet);
    expect(getLuaRestoreLegalActions(faceDownPuppet, 0)).toEqual(getDuelLegalActions(faceDownPuppet.session, 0));
    expect(getLuaRestoreLegalActions(faceDownPuppet, 0).some((action) => action.type === "specialSummonProcedure")).toBe(false);

    const restored = createRestoredMagnetDollWindow({
      cards,
      magnetDollCode,
      ownPuppetCode,
      ownNonPuppetCode,
      opponentMonsterCode,
      reader,
      workspace,
      fieldCase: "valid",
    });
    expectCleanRestore(restored);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));

    const magnetDoll = restored.session.state.cards.find((card) => card.code === magnetDollCode);
    const ownPuppet = restored.session.state.cards.find((card) => card.code === ownPuppetCode);
    const opponentMonster = restored.session.state.cards.find((card) => card.code === opponentMonsterCode);
    expect(magnetDoll).toBeDefined();
    expect(ownPuppet).toBeDefined();
    expect(opponentMonster).toBeDefined();
    const procedure = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === magnetDoll!.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    expect(procedure).toMatchObject({ windowKind: "open", label: "Special Summon Gimmick Puppet Magnet Doll" });
    applyRestoredActionAndAssert(restored, procedure!);

    expect(restored.session.state.cards.find((card) => card.uid === magnetDoll!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
    });
    expect(restored.session.state.cards.find((card) => card.uid === ownPuppet!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
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
        eventCardUid: magnetDoll!.uid,
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
          sequence: 1,
        },
      },
    ]);
  });
});

type MagnetDollFieldCase = "valid" | "noOpponentMonster" | "ownNonPuppet" | "ownFaceDownPuppet";

function createRestoredMagnetDollWindow({
  cards,
  magnetDollCode,
  ownPuppetCode,
  ownNonPuppetCode,
  opponentMonsterCode,
  reader,
  workspace,
  fieldCase,
}: {
  cards: DuelCardData[];
  magnetDollCode: string;
  ownPuppetCode: string;
  ownNonPuppetCode: string;
  opponentMonsterCode: string;
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  fieldCase: MagnetDollFieldCase;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 3980 + cards.length + fieldCase.length, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [magnetDollCode, ownPuppetCode, ownNonPuppetCode] }, 1: { main: [opponentMonsterCode] } });
  startDuel(session);

  const magnetDoll = session.state.cards.find((card) => card.code === magnetDollCode);
  const ownPuppet = session.state.cards.find((card) => card.code === ownPuppetCode);
  const ownNonPuppet = session.state.cards.find((card) => card.code === ownNonPuppetCode);
  const opponentMonster = session.state.cards.find((card) => card.code === opponentMonsterCode);
  expect(magnetDoll).toBeDefined();
  expect(ownPuppet).toBeDefined();
  expect(ownNonPuppet).toBeDefined();
  expect(opponentMonster).toBeDefined();
  moveDuelCard(session.state, magnetDoll!.uid, "hand", 0);
  moveDuelCard(session.state, ownPuppet!.uid, "monsterZone", 0);
  ownPuppet!.faceUp = fieldCase !== "ownFaceDownPuppet";
  ownPuppet!.position = fieldCase === "ownFaceDownPuppet" ? "faceDownDefense" : "faceUpAttack";
  if (fieldCase === "ownNonPuppet") {
    moveDuelCard(session.state, ownNonPuppet!.uid, "monsterZone", 0);
    ownNonPuppet!.faceUp = true;
    ownNonPuppet!.position = "faceUpAttack";
  }
  if (fieldCase !== "noOpponentMonster") {
    moveDuelCard(session.state, opponentMonster!.uid, "monsterZone", 1);
    opponentMonster!.faceUp = true;
    opponentMonster!.position = "faceUpAttack";
  }
  session.state.phase = "main1";
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(magnetDollCode), workspace).ok).toBe(true);
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
