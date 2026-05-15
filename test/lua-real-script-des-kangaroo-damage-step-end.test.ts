import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Des Kangaroo damage step end", () => {
  it("restores Des Kangaroo's end Damage Step trigger and destroys the lower-ATK attacker", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const kangarooCode = "78613627";
    const attackerCode = "7861";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === kangarooCode),
      { code: attackerCode, name: "Des Kangaroo Fixture Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1200, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 786, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [attackerCode] }, 1: { main: [kangarooCode] } });
    startDuel(session);

    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    const kangaroo = session.state.cards.find((card) => card.code === kangarooCode);
    expect(attacker).toBeDefined();
    expect(kangaroo).toBeDefined();
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, kangaroo!.uid, "monsterZone", 1).position = "faceUpDefense";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(kangarooCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === kangaroo!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    passUntilPendingTrigger(session);

    expect(session.state.battleWindow?.kind).toBe("endDamageStep");
    expect(session.state.battleDamage).toEqual({ 0: 500, 1: 0 });
    expect(session.state.players[0].lifePoints).toBe(7500);
    expect(session.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(session.state.cards.find((card) => card.uid === kangaroo!.uid)).toMatchObject({ location: "monsterZone", controller: 1, position: "faceUpDefense" });
    expect(session.state.pendingTriggers).toEqual([
      expect.objectContaining({
        eventName: "damageStepEnded",
        eventCode: 1141,
        eventCardUid: kangaroo!.uid,
        sourceUid: kangaroo!.uid,
      }),
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.battleWindow?.kind).toBe("endDamageStep");
    expect(restored.session.state.pendingTriggers).toEqual([
      expect.objectContaining({
        eventName: "damageStepEnded",
        eventCode: 1141,
        eventCardUid: kangaroo!.uid,
        sourceUid: kangaroo!.uid,
      }),
    ]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual([]);

    const trigger = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "activateTrigger" && action.uid === kangaroo!.uid);
    expect(trigger).toBeDefined();
    const triggered = applyLuaRestoreResponse(restored, trigger!);
    expect(triggered.ok, triggered.error).toBe(true);
    expect(restored.session.state.pendingTriggers).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === kangaroo!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restored.session.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: expect.any(Number),
    });
    expect(restored.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "damageStepEnded", eventCode: 1141, eventCardUid: attacker!.uid, eventUids: [attacker!.uid, kangaroo!.uid] }),
        expect.objectContaining({ eventName: "destroyed", eventCode: 1029, eventCardUid: attacker!.uid }),
      ]),
    );
  });
});

function passUntilPendingTrigger(session: DuelSession): void {
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
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
