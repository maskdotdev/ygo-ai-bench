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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Nightmare Magician battle control", () => {
  it("restores battle-target indestructibility and controls the battled monster at Damage Step end", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const nightmareCode = "40221691";
    const targetCode = "40221692";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === nightmareCode),
      { code: targetCode, name: "Nightmare Magician Fixture Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 2000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 402, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [nightmareCode] }, 1: { main: [targetCode] } });
    startDuel(session);

    const nightmare = session.state.cards.find((card) => card.code === nightmareCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    expect(nightmare).toBeDefined();
    expect(target).toBeDefined();
    moveDuelCard(session.state, nightmare!.uid, "monsterZone", 0);
    nightmare!.position = "faceUpAttack";
    nightmare!.faceUp = true;
    moveDuelCard(session.state, target!.uid, "monsterZone", 1);
    target!.position = "faceUpAttack";
    target!.faceUp = true;
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(nightmareCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const protection = session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 42 && effect.sourceUid === nightmare!.uid);
    expect(protection).toMatchObject({
      event: "continuous",
      code: 42,
      controller: 0,
      luaTargetDescriptor: "target:source-or-battle-target",
      range: ["monsterZone"],
      targetRange: [4, 4],
      value: 1,
    });

    const attack = getLegalActions(session, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === nightmare!.uid && action.targetUid === target!.uid,
    );
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    passUntilPendingTrigger(session);

    expect(session.state.battleWindow?.kind).toBe("endDamageStep");
    expect(session.state.battleDamage).toEqual({ 0: 0, 1: 500 });
    expect(session.state.players[1].lifePoints).toBe(7500);
    expect(session.state.cards.find((card) => card.uid === nightmare!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(session.state.pendingTriggers).toEqual([
      {
        effectId: "lua-2-1141",
        eventCardUid: nightmare!.uid,
        eventCode: 1141,
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventName: "damageStepEnded",
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventReason: 0,
        eventReasonPlayer: 0,
        eventTriggerTiming: "when",
        eventUids: [nightmare!.uid, target!.uid],
        id: "trigger-5-1",
        player: 0,
        sourceUid: nightmare!.uid,
        triggerBucket: "turnOptional",
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.battleWindow?.kind).toBe("endDamageStep");
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);
    const restoredProtection = restored.session.state.effects.find((effect) => effect.sourceUid === nightmare!.uid && effect.code === 42);
    expect(restoredProtection).toMatchObject({
      event: "continuous",
      code: 42,
      luaTargetDescriptor: "target:source-or-battle-target",
      range: ["monsterZone"],
      targetRange: [4, 4],
      value: 1,
    });
    expect(restoredProtection?.targetCardPredicate).toBeDefined();

    const trigger = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.uid === nightmare!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    const triggered = applyLuaRestoreResponse(restored, trigger!);
    expect(triggered.ok, triggered.error).toBe(true);
    expect(restored.session.state.pendingTriggers).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === nightmare!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      previousController: 1,
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "damageStepEnded")).toEqual([
      {
        eventName: "damageStepEnded",
        eventCode: 1141,
        eventCardUid: nightmare!.uid,
        eventUids: [nightmare!.uid, target!.uid],
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
  });
});

function passUntilPendingTrigger(session: DuelSession): void {
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
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
