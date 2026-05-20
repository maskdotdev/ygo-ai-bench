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
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import type { UpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Earth Armor Ninja empty-field Special Summon procedure", () => {
  it("restores its hand procedure only when own MZONE is empty and opponent controls a monster", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const earthArmorCode = "22812068";
    const ownMonsterCode = "228120680";
    const opponentMonsterCode = "228120681";
    const script = workspace.readScript(`c${earthArmorCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
    expect(script).toContain("Duel.GetFieldGroupCount(c:GetControler(),LOCATION_MZONE,0,nil)==0");
    expect(script).toContain("Duel.GetFieldGroupCount(c:GetControler(),0,LOCATION_MZONE,nil)>0");
    expect(script).toContain("Duel.GetLocationCount(c:GetControler(),LOCATION_MZONE)>0");

    expect(procedureAvailable(workspace, earthArmorCode, ownMonsterCode, opponentMonsterCode, "noOpponentMonster")).toBe(false);
    expect(procedureAvailable(workspace, earthArmorCode, ownMonsterCode, opponentMonsterCode, "ownMonsterPresent")).toBe(false);
    const valid = setupDuel(workspace, earthArmorCode, ownMonsterCode, opponentMonsterCode, "valid");

    const restored = restoreDuelWithLuaScripts(serializeDuel(valid.session), valid.workspace, valid.reader);
    expectCleanRestore(restored);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
    const procedure = getLuaRestoreLegalActions(restored, 0).find((action) => (
      action.type === "specialSummonProcedure" && action.uid === valid.earthArmor.uid
    ));
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, procedure!);

    expect(restored.session.state.cards.find((card) => card.uid === valid.earthArmor.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
    });
    expect(restored.session.state.cards.find((card) => card.uid === valid.opponentMonster.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      faceUp: true,
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: valid.earthArmor.uid,
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

type FieldCase = "noOpponentMonster" | "ownMonsterPresent" | "valid";

function procedureAvailable(
  workspace: UpstreamNodeWorkspace,
  earthArmorCode: string,
  ownMonsterCode: string,
  opponentMonsterCode: string,
  fieldCase: FieldCase,
): boolean {
  const setup = setupDuel(workspace, earthArmorCode, ownMonsterCode, opponentMonsterCode, fieldCase);
  const restored = restoreDuelWithLuaScripts(serializeDuel(setup.session), setup.workspace, setup.reader);
  expectCleanRestore(restored);
  expect(getLuaRestoreLegalActions(restored, 0)).toEqual(getDuelLegalActions(restored.session, 0));
  return getLuaRestoreLegalActions(restored, 0).some((action) => (
    action.type === "specialSummonProcedure" && action.uid === setup.earthArmor.uid
  ));
}

function setupDuel(
  workspace: UpstreamNodeWorkspace,
  earthArmorCode: string,
  ownMonsterCode: string,
  opponentMonsterCode: string,
  fieldCase: FieldCase,
) {
  const cards: DuelCardData[] = [
    ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === earthArmorCode),
    { code: ownMonsterCode, name: "Earth Armor Ninja Own Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    { code: opponentMonsterCode, name: "Earth Armor Ninja Opponent Monster", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
  ];
  const reader = createCardReader(cards);
  const session = createDuel({ seed: 22812068, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [earthArmorCode, ownMonsterCode] }, 1: { main: [opponentMonsterCode] } });
  startDuel(session);

  const earthArmor = requireCard(session, earthArmorCode);
  const ownMonster = requireCard(session, ownMonsterCode);
  const opponentMonster = requireCard(session, opponentMonsterCode);
  moveDuelCard(session.state, earthArmor.uid, "hand", 0);
  if (fieldCase === "ownMonsterPresent") {
    moveDuelCard(session.state, ownMonster.uid, "monsterZone", 0).position = "faceUpAttack";
  }
  if (fieldCase !== "noOpponentMonster") {
    const movedOpponent = moveDuelCard(session.state, opponentMonster.uid, "monsterZone", 1);
    movedOpponent.position = "faceUpAttack";
    movedOpponent.faceUp = true;
  }
  session.state.phase = "main1";
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(earthArmorCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);
  return { earthArmor, opponentMonster, reader, session, workspace };
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
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
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}
