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
import { getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Lesser Fiend battle destroy redirect", () => {
  it("restores Lesser Fiend and banishes monsters it destroys by battle", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const lesserFiendCode = "16475472";
    const targetCode = "1647";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === lesserFiendCode),
      { code: targetCode, name: "Lesser Fiend Redirect Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 164, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [lesserFiendCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const lesserFiend = session.state.cards.find((card) => card.code === lesserFiendCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(lesserFiend).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, lesserFiend!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, target!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(lesserFiendCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "continuous", code: 204, sourceUid: lesserFiend!.uid, value: 0x20 }),
      ]),
    );

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === lesserFiend!.uid && action.targetUid === target!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    expect(session.state.battleWindow?.kind).toBe("attackNegationResponse");

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "continuous", code: 204, sourceUid: lesserFiend!.uid, value: 0x20 }),
      ]),
    );

    passBattleResponses(restored.session);
    expect(restored.session.state.battleDamage).toEqual({ 0: 0, 1: 1100 });
    expect(restored.session.state.players[0].lifePoints).toBe(8000);
    expect(restored.session.state.players[1].lifePoints).toBe(6900);
    expect(restored.session.state.cards.find((card) => card.uid === lesserFiend!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "banished", reason: 0x4000021 });
    expect(restored.session.state.log).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "destroy", card: "Lesser Fiend Redirect Target", detail: "Destroyed and moved to banished" }),
      ]),
    );
  });

  it("restores mutual Lesser Fiend battle destruction and redirects both monsters", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const lesserFiendCode = "16475472";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === lesserFiendCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 165, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [lesserFiendCode] }, 1: { main: [lesserFiendCode] } });
    startDuel(session);

    const p0Fiend = session.state.cards.find((card) => card.code === lesserFiendCode && card.owner === 0);
    const p1Fiend = session.state.cards.find((card) => card.code === lesserFiendCode && card.owner === 1);
    expect(p0Fiend).toBeDefined();
    expect(p1Fiend).toBeDefined();
    moveDuelCard(session.state, p0Fiend!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, p1Fiend!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(lesserFiendCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "continuous", code: 204, sourceUid: p0Fiend!.uid, value: 0x20 }),
        expect.objectContaining({ event: "continuous", code: 204, sourceUid: p1Fiend!.uid, value: 0x20 }),
      ]),
    );

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === p0Fiend!.uid && action.targetUid === p1Fiend!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    expect(session.state.battleWindow?.kind).toBe("attackNegationResponse");

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: "continuous", code: 204, sourceUid: p0Fiend!.uid, value: 0x20 }),
        expect.objectContaining({ event: "continuous", code: 204, sourceUid: p1Fiend!.uid, value: 0x20 }),
      ]),
    );

    passBattleResponses(restored.session);
    expect(restored.session.state.players[0].lifePoints).toBe(8000);
    expect(restored.session.state.players[1].lifePoints).toBe(8000);
    expect(restored.session.state.pendingTriggers).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === p0Fiend!.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.destroy | duelReason.battle | duelReason.redirect,
      reasonCardUid: p1Fiend!.uid,
    });
    expect(restored.session.state.cards.find((card) => card.uid === p1Fiend!.uid)).toMatchObject({
      location: "banished",
      reason: duelReason.destroy | duelReason.battle | duelReason.redirect,
      reasonCardUid: p0Fiend!.uid,
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "battleDestroyed")).toEqual([
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: p0Fiend!.uid,
        eventUids: [p0Fiend!.uid, p1Fiend!.uid],
        eventReason: duelReason.battle | duelReason.destroy | duelReason.redirect,
        eventReasonPlayer: 1,
        eventReasonCardUid: p1Fiend!.uid,
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
          location: "banished",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "banished")).toEqual([
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: p0Fiend!.uid,
        eventReason: duelReason.destroy | duelReason.battle | duelReason.redirect,
        eventReasonPlayer: 1,
        eventReasonCardUid: p1Fiend!.uid,
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
          location: "banished",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
      {
        eventName: "banished",
        eventCode: 1011,
        eventCardUid: p1Fiend!.uid,
        eventReason: duelReason.destroy | duelReason.battle | duelReason.redirect,
        eventReasonPlayer: 0,
        eventReasonCardUid: p0Fiend!.uid,
        eventPreviousState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "banished",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
  });
});

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);
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
