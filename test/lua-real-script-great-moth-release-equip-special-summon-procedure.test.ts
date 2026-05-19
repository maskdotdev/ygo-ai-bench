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
import type { DuelAction } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Great Moth release equip Special Summon procedure", () => {
  it("restores Cocoon of Evolution release gated by an equipped Petit Moth turn counter", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const greatMothCode = "14141448";
    const petitMothCode = "40240595";
    const cocoonCode = "58192742";
    const script = workspace.readScript(`official/c${greatMothCode}.lua`);
    expect(script).toContain("e1:SetCode(EFFECT_SPSUMMON_PROC)");
    expect(script).toContain("return c:IsCode(40240595) and c:GetTurnCounter()>=4");
    expect(script).toContain("return c:IsCode(58192742) and c:GetEquipGroup():IsExists(s.eqfilter,1,nil)");
    expect(script).toContain("Duel.CheckReleaseGroup(c:GetControler(),s.rfilter,1,false,1,true,c,c:GetControler(),nil,false,nil)");
    expect(script).toContain("Duel.SelectReleaseGroup(tp,s.rfilter,1,1,false,true,true,c,nil,nil,false,nil)");
    expect(script).toContain("Duel.Release(g,REASON_COST)");

    const cards = workspace.readDatabaseCards("cards.cdb").filter((card) => [greatMothCode, petitMothCode, cocoonCode].includes(card.code));
    const reader = createCardReader(cards);

    const tooYoung = createRestoredGreatMothWindow({ greatMothCode, petitMothCode, cocoonCode, reader, workspace, petitTurnCounter: 3, withEquip: true });
    expectCleanRestore(tooYoung);
    expectRestoredActionSurfaces(tooYoung, 0);
    expect(getLuaRestoreLegalActions(tooYoung, 0).some((action) => action.type === "specialSummonProcedure")).toBe(false);

    const missingEquip = createRestoredGreatMothWindow({ greatMothCode, petitMothCode, cocoonCode, reader, workspace, petitTurnCounter: 4, withEquip: false });
    expectCleanRestore(missingEquip);
    expectRestoredActionSurfaces(missingEquip, 0);
    expect(getLuaRestoreLegalActions(missingEquip, 0).some((action) => action.type === "specialSummonProcedure")).toBe(false);

    const restored = createRestoredGreatMothWindow({ greatMothCode, petitMothCode, cocoonCode, reader, workspace, petitTurnCounter: 4, withEquip: true });
    expectCleanRestore(restored);
    expectRestoredActionSurfaces(restored, 0);

    const greatMoth = restored.session.state.cards.find((card) => card.code === greatMothCode);
    const petitMoth = restored.session.state.cards.find((card) => card.code === petitMothCode);
    const cocoon = restored.session.state.cards.find((card) => card.code === cocoonCode);
    expect(greatMoth).toBeDefined();
    expect(petitMoth).toBeDefined();
    expect(cocoon).toBeDefined();
    const procedure = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "specialSummonProcedure" && action.uid === greatMoth!.uid);
    expect(procedure, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    expect(procedure).toMatchObject({ windowKind: "open", label: "Special Summon Great Moth" });

    const result = applyLuaRestoreResponse(restored, procedure as DuelAction);
    expect(result.ok, result.error).toBe(true);
    const waitingFor = restored.session.state.waitingFor;
    if (waitingFor !== undefined) {
      expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
      expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
      expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    }

    expect(restored.session.state.cards.find((card) => card.uid === greatMoth!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
    });
    expect(restored.session.state.cards.find((card) => card.uid === cocoon!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.release | duelReason.cost,
      reasonCardUid: greatMoth!.uid,
    });
    expect(restored.session.state.cards.find((card) => card.uid === petitMoth!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      previousEquippedToUid: cocoon!.uid,
      turnCounter: 4,
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "released" && event.eventCardUid === cocoon!.uid)).toEqual([
      {
        eventName: "released",
        eventCode: 1017,
        eventCardUid: cocoon!.uid,
        eventReason: duelReason.release | duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: greatMoth!.uid,
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
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === greatMoth!.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: greatMoth!.uid,
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

function createRestoredGreatMothWindow({
  greatMothCode,
  petitMothCode,
  cocoonCode,
  reader,
  workspace,
  petitTurnCounter,
  withEquip,
}: {
  greatMothCode: string;
  petitMothCode: string;
  cocoonCode: string;
  reader: ReturnType<typeof createCardReader>;
  workspace: ReturnType<typeof createUpstreamNodeWorkspace>;
  petitTurnCounter: number;
  withEquip: boolean;
}): ReturnType<typeof restoreDuelWithLuaScripts> {
  const session = createDuel({ seed: 1414 + petitTurnCounter + (withEquip ? 1 : 0), startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
  loadDecks(session, { 0: { main: [greatMothCode, petitMothCode, cocoonCode] }, 1: { main: [] } });
  startDuel(session);

  const greatMoth = session.state.cards.find((card) => card.code === greatMothCode);
  const petitMoth = session.state.cards.find((card) => card.code === petitMothCode);
  const cocoon = session.state.cards.find((card) => card.code === cocoonCode);
  expect(greatMoth).toBeDefined();
  expect(petitMoth).toBeDefined();
  expect(cocoon).toBeDefined();
  moveDuelCard(session.state, greatMoth!.uid, "hand", 0);
  moveDuelCard(session.state, cocoon!.uid, "monsterZone", 0).position = "faceUpAttack";
  moveDuelCard(session.state, petitMoth!.uid, "spellTrapZone", 0).position = "faceUpAttack";
  petitMoth!.faceUp = true;
  petitMoth!.turnCounter = petitTurnCounter;
  if (withEquip) petitMoth!.equippedToUid = cocoon!.uid;
  session.state.phase = "main1";
  session.state.waitingFor = 0;

  const host = createLuaScriptHost(session, workspace);
  expect(host.loadCardScript(Number(greatMothCode), workspace).ok).toBe(true);
  expect(host.registerInitialEffects()).toBe(1);

  return restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredActionSurfaces(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
}
