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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Big Shield Gardna damage step position", () => {
  it("restores its end Damage Step position change after being attacked in Defense Position", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const gardnaCode = "65240384";
    const attackerCode = "6524";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === gardnaCode),
      { code: attackerCode, name: "Big Shield Gardna Fixture Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 652, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [attackerCode] }, 1: { main: [gardnaCode] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    const gardna = session.state.cards.find((card) => card.code === gardnaCode);
    expect(attacker).toBeDefined();
    expect(gardna).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, gardna!.uid, "monsterZone", 1).position = "faceUpDefense";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(gardnaCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === gardna!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    passUntilEndDamageStep(session);

    expect(session.state.battleWindow?.kind).toBe("endDamageStep");
    expect(session.state.battleDamage).toEqual({ 0: 1600, 1: 0 });
    expect(session.state.players[0].lifePoints).toBe(6400);
    expect(session.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({ location: "monsterZone", position: "faceUpAttack" });
    expect(session.state.cards.find((card) => card.uid === gardna!.uid)).toMatchObject({ location: "monsterZone", position: "faceUpAttack", faceUp: true });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.battleWindow?.kind).toBe("endDamageStep");
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(restored.session.state.cards.find((card) => card.uid === gardna!.uid)).toMatchObject({ location: "monsterZone", position: "faceUpAttack", faceUp: true });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "damageStepEnded")).toEqual([
      {
        eventName: "damageStepEnded",
        eventCode: 1141,
        eventCardUid: attacker!.uid,
        eventUids: [attacker!.uid, gardna!.uid],
        eventReason: 0,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
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
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "positionChanged" && event.eventCardUid === gardna!.uid)).toEqual([
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: gardna!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 1,
        eventReasonCardUid: gardna!.uid,
        eventReasonEffectId: 2,
        eventPreviousState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpDefense",
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
  });
});

function passUntilEndDamageStep(session: DuelSession): void {
  while (session.state.pendingBattle && session.state.battleWindow?.kind !== "endDamageStep") {
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
