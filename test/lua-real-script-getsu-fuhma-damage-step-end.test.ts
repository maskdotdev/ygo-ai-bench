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
const effectDestroyReason = duelReason.effect | duelReason.destroy;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Getsu Fuhma damage step end", () => {
  it("restores Getsu Fuhma's stored battle target and destroys it at the end of the Damage Step", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const getsuCode = "21887179";
    const fiendCode = "2188";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === getsuCode),
      { code: fiendCode, name: "Getsu Fuhma Fixture Fiend", kind: "monster", typeFlags: 0x1, level: 4, race: 0x8, attack: 1200, defense: 2000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 218, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [getsuCode] }, 1: { main: [fiendCode] } });
    startDuel(session);

    const getsu = session.state.cards.find((card) => card.code === getsuCode);
    const fiend = session.state.cards.find((card) => card.code === fiendCode);
    expect(getsu).toBeDefined();
    expect(fiend).toBeDefined();
    moveDuelCard(session.state, getsu!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, fiend!.uid, "monsterZone", 1).position = "faceUpDefense";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(getsuCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === getsu!.uid && action.targetUid === fiend!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    passUntilPendingTrigger(session);

    expect(session.state.battleWindow?.kind).toBe("endDamageStep");
    expect(session.state.battleDamage).toEqual({ 0: 300, 1: 0 });
    expect(session.state.players[0].lifePoints).toBe(7700);
    expect(session.state.cards.find((card) => card.uid === getsu!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(session.state.cards.find((card) => card.uid === fiend!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(session.state.pendingTriggers).toEqual([
      expect.objectContaining({
        eventName: "damageStepEnded",
        eventCode: 1141,
        eventCardUid: getsu!.uid,
        sourceUid: getsu!.uid,
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
        eventCardUid: getsu!.uid,
        sourceUid: getsu!.uid,
      }),
    ]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);

    const trigger = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.uid === getsu!.uid);
    expect(trigger).toBeDefined();
    const triggered = applyLuaRestoreResponse(restored, trigger!);
    expect(triggered.ok, triggered.error).toBe(true);
    expect(restored.session.state.pendingTriggers).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === getsu!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === fiend!.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: effectDestroyReason,
    });
    expect(restored.session.state.eventHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "damageStepEnded", eventCode: 1141, eventCardUid: getsu!.uid }),
        expect.objectContaining({ eventName: "destroyed", eventCode: 1029, eventCardUid: fiend!.uid }),
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
