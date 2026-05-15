import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const effectDestroyReason = duelReason.effect | duelReason.destroy;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Skull Conductor Battle Phase destroy", () => {
  it("restores its mandatory Battle Phase trigger and destroys itself", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const skullConductorCode = "62782218";
    const cards = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === skullConductorCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 627, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [skullConductorCode] }, 1: { main: [] } });
    startDuel(session);

    const skullConductor = session.state.cards.find((card) => card.code === skullConductorCode);
    expect(skullConductor).toBeDefined();
    moveDuelCard(session.state, skullConductor!.uid, "monsterZone", 0).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(skullConductorCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.sourceUid === skullConductor!.uid && effect.triggerEvent === "phaseBattle")).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "category": 1,
        "code": 4224,
        "controller": 0,
        "cost": [Function],
        "countLimit": 1,
        "description": 1004515488,
        "event": "trigger",
        "id": "lua-1-4224",
        "luaTypeFlags": 514,
        "oncePerTurn": true,
        "operation": [Function],
        "optional": false,
        "promptOperation": [Function],
        "range": [
          "monsterZone",
        ],
        "registryKey": "lua:62782218:lua-1-4224",
        "sourceUid": "p0-deck-62782218-0",
        "target": [Function],
        "targetCardPredicate": [Function],
        "triggerCode": 4224,
        "triggerEvent": "phaseBattle",
        "triggerTiming": "when",
      }
    `);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredBattle.restoreComplete, restoredBattle.incompleteReasons.join("; ")).toBe(true);
    expect(restoredBattle.missingRegistryKeys).toEqual([]);
    expect(restoredBattle.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredBattle, 0)).toEqual(getGroupedDuelLegalActions(restoredBattle.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredBattle, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredBattle, 0));
    const main2 = getLuaRestoreLegalActions(restoredBattle, 0).find((action) => action.type === "changePhase" && action.phase === "main2");
    expect(main2).toBeDefined();
    const phaseChanged = applyLuaRestoreResponse(restoredBattle, main2!);
    expect(phaseChanged.ok, phaseChanged.error).toBe(true);
    expect(restoredBattle.session.state.phase).toBe("main2");
    expect(restoredBattle.session.state.pendingTriggers).toEqual([
      {
        effectId: "lua-1-4224",
        eventCode: 0x1080,
        eventName: "phaseBattle",
        eventTriggerTiming: "when",
        id: "trigger-2-1",
        player: 0,
        sourceUid: skullConductor!.uid,
        triggerBucket: "turnMandatory",
      },
    ]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expect(restoredTrigger.restoreComplete, restoredTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTrigger.missingRegistryKeys).toEqual([]);
    expect(restoredTrigger.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredTrigger, 0)).toEqual(getGroupedDuelLegalActions(restoredTrigger.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredTrigger, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredTrigger, 0));
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === skullConductor!.uid);
    expect(trigger).toBeDefined();
    const destroyed = applyLuaRestoreResponse(restoredTrigger, trigger!);
    expect(destroyed.ok, destroyed.error).toBe(true);

    expect(restoredTrigger.session.state.pendingTriggers).toEqual([]);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === skullConductor!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: effectDestroyReason,
    });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "phaseBattle")).toEqual([
      {
        eventName: "phaseBattle",
        eventCode: 0x1080,
      },
    ]);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventCardUid === skullConductor!.uid)).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: skullConductor!.uid,
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
        eventReason: effectDestroyReason,
        eventReasonPlayer: 0,
        eventReasonCardUid: skullConductor!.uid,
        eventReasonEffectId: 1,
      },
    ]);
  });
});
