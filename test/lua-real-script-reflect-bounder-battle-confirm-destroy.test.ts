import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Reflect Bounder battle confirm destroy", () => {
  it("restores battle-confirm damage into a later battled self-destruction trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const bounderCode = "2851070";
    const attackerCode = "28510700";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === bounderCode),
      { code: attackerCode, name: "Reflect Bounder Fixture Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1700, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 285, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [bounderCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const bounder = session.state.cards.find((card) => card.code === bounderCode);
    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    expect(bounder).toBeDefined();
    expect(attacker).toBeDefined();
    moveDuelCard(session.state, bounder!.uid, "monsterZone", 0);
    bounder!.position = "faceUpAttack";
    bounder!.faceUp = true;
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 1);
    attacker!.position = "faceUpAttack";
    attacker!.faceUp = true;
    session.state.turnPlayer = 1;
    session.state.phase = "battle";
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(bounderCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === bounder!.uid,
    );
    expect(attack, JSON.stringify(getLegalActions(session, 1), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    passUntilPendingTrigger(session, "battleConfirmed");

    expect(session.state.battleWindow?.kind).toBe("startDamageStep");
    expect(session.state.pendingTriggers).toEqual([
      expect.objectContaining({
        eventName: "battleConfirmed",
        eventCode: 1133,
        eventCardUid: bounder!.uid,
        sourceUid: bounder!.uid,
      }),
    ]);

    const restoredConfirm = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredConfirm.restoreComplete, restoredConfirm.incompleteReasons.join("; ")).toBe(true);
    expect(restoredConfirm.missingRegistryKeys).toEqual([]);
    expect(restoredConfirm.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredConfirm.session.state.battleWindow?.kind).toBe("startDamageStep");
    expect(getLuaRestoreLegalActionGroups(restoredConfirm, 0)).toEqual(getGroupedDuelLegalActions(restoredConfirm.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredConfirm, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredConfirm, 0));

    const confirmTrigger = getLuaRestoreLegalActions(restoredConfirm, 0).find((action) => action.type === "activateTrigger" && action.uid === bounder!.uid);
    expect(confirmTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredConfirm, 0), null, 2)).toBeDefined();
    let result = applyLuaRestoreResponse(restoredConfirm, confirmTrigger!);
    expect(result.ok, result.error).toBe(true);
    resolveRestoredChain(restoredConfirm);
    expect(restoredConfirm.session.state.players[1].lifePoints).toBe(6300);
    expect(restoredConfirm.session.state.eventHistory).toEqual(
      expect.arrayContaining([expect.objectContaining({ eventName: "battleConfirmed", eventCode: 1133, eventUids: [attacker!.uid, bounder!.uid] })]),
    );
    expect(restoredConfirm.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 1700,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: bounder!.uid,
        eventReasonEffectId: 1,
      },
    ]);

    passRestoredUntilPendingTrigger(restoredConfirm, "afterDamageCalculation");
    expect(restoredConfirm.session.state.battleWindow?.kind).toBe("afterDamageCalculation");
    expect(restoredConfirm.session.state.battleDamage).toEqual({ 0: 0, 1: 0 });
    expect(restoredConfirm.session.state.players[0].lifePoints).toBe(8000);

    const restoredBattled = restoreDuelWithLuaScripts(serializeDuel(restoredConfirm.session), workspace, reader);
    expect(restoredBattled.restoreComplete, restoredBattled.incompleteReasons.join("; ")).toBe(true);
    expect(restoredBattled.missingRegistryKeys).toEqual([]);
    expect(restoredBattled.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredBattled.session.state.battleWindow?.kind).toBe("afterDamageCalculation");
    expect(getLuaRestoreLegalActionGroups(restoredBattled, 0)).toEqual(getGroupedDuelLegalActions(restoredBattled.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredBattled, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredBattled, 0));

    const battledTrigger = getLuaRestoreLegalActions(restoredBattled, 0).find((action) => action.type === "activateTrigger" && action.uid === bounder!.uid);
    expect(battledTrigger, JSON.stringify(getLuaRestoreLegalActions(restoredBattled, 0), null, 2)).toBeDefined();
    result = applyLuaRestoreResponse(restoredBattled, battledTrigger!);
    expect(result.ok, result.error).toBe(true);
    resolveRestoredChain(restoredBattled);
    expect(restoredBattled.session.state.cards.find((card) => card.uid === bounder!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredBattled.session.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredBattled.session.state.eventHistory.filter((event) => event.eventName === "afterDamageCalculation")).toEqual([
      {
        eventName: "afterDamageCalculation",
        eventCode: 1138,
        eventCardUid: attacker!.uid,
        eventUids: [attacker!.uid, bounder!.uid],
        eventReason: 0,
        eventReasonPlayer: 1,
        eventPreviousState: {
          controller: 1,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(restoredBattled.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === bounder!.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: bounder!.uid,
        eventPreviousState: {
          location: "monsterZone",
          controller: 0,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 0,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: bounder!.uid,
        eventReasonEffectId: 2,
      },
    ]);
  });
});

function passUntilPendingTrigger(session: DuelSession, eventName: string): void {
  let guard = 0;
  while (!session.state.pendingTriggers.some((trigger) => trigger.eventName === eventName)) {
    expect(++guard).toBeLessThan(20);
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function passRestoredUntilPendingTrigger(restored: ReturnType<typeof restoreDuelWithLuaScripts>, eventName: string): void {
  let guard = 0;
  while (!restored.session.state.pendingTriggers.some((trigger) => trigger.eventName === eventName)) {
    expect(++guard).toBeLessThan(20);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const passType = restored.session.state.battleStep === "damage" || restored.session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    const result = applyLuaRestoreResponse(restored, pass!);
    expect(result.ok, result.error).toBe(true);
  }
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    const result = applyLuaRestoreResponse(restored, pass!);
    expect(result.ok, result.error).toBe(true);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
