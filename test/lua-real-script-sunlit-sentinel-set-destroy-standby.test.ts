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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Sunlit Sentinel set destroy Standby trigger", () => {
  it("restores its face-down Spell/Trap previous-position check into the next Standby Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sentinelCode = "78360952";
    const cards: DuelCardData[] = workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === sentinelCode);
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 7836, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sentinelCode] }, 1: { main: [] } });
    startDuel(session);

    const sentinel = session.state.cards.find((card) => card.code === sentinelCode);
    expect(sentinel).toBeDefined();
    moveDuelCard(session.state, sentinel!.uid, "spellTrapZone", 0);
    sentinel!.position = "faceDown";
    sentinel!.faceUp = false;
    session.state.turnPlayer = 0;
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(sentinelCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    const destroyed = host.loadScript(
      `
      local sentinel=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${sentinelCode}),0,LOCATION_SZONE,0,1,1,nil):GetFirst()
      Debug.Message("sunlit sentinel destroyed " .. Duel.Destroy(sentinel,REASON_EFFECT))
      `,
      "sunlit-sentinel-destroy-set-spell.lua",
    );
    expect(destroyed.ok, destroyed.error).toBe(true);
    expect(host.messages).toContain("sunlit sentinel destroyed 1");
    expect(session.state.cards.find((card) => card.uid === sentinel!.uid)).toMatchObject({
      location: "graveyard",
      previousLocation: "spellTrapZone",
      previousPosition: "faceDown",
    });
    expect(session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceUid: sentinel!.uid,
          range: ["graveyard"],
          triggerEvent: "phaseStandby",
          luaConditionDescriptor: "condition:source-turn-next",
        }),
      ]),
    );

    const restoredDelayed = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredDelayed.restoreComplete, restoredDelayed.incompleteReasons.join("; ")).toBe(true);
    expect(restoredDelayed.missingRegistryKeys).toEqual([]);
    expect(restoredDelayed.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredDelayed, 0);
    expect(restoredDelayed.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceUid: sentinel!.uid,
          range: ["graveyard"],
          triggerEvent: "phaseStandby",
          luaConditionDescriptor: "condition:source-turn-next",
        }),
      ]),
    );

    restoredDelayed.session.state.turn = session.state.cards.find((card) => card.uid === sentinel!.uid)!.turnId! + 1;
    restoredDelayed.session.state.phase = "draw";
    restoredDelayed.session.state.turnPlayer = 0;
    restoredDelayed.session.state.waitingFor = 0;
    const standby = getLuaRestoreLegalActions(restoredDelayed, 0).find((action) => action.type === "changePhase" && action.phase === "standby");
    expect(standby, JSON.stringify(getLuaRestoreLegalActions(restoredDelayed, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredDelayed, standby!);
    expect(restoredDelayed.session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-3-4098",
          "eventCode": 4098,
          "eventName": "phaseStandby",
          "eventTriggerTiming": "when",
          "id": "trigger-5-1",
          "player": 0,
          "sourceUid": "p0-deck-78360952-0",
          "triggerBucket": "turnOptional",
        },
      ]
    `);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredDelayed.session), workspace, reader);
    expect(restoredTrigger.restoreComplete, restoredTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTrigger.missingRegistryKeys).toEqual([]);
    expect(restoredTrigger.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restoredTrigger, 0)).toEqual(getGroupedDuelLegalActions(restoredTrigger.session, 0));
    expect(getLuaRestoreLegalActionGroups(restoredTrigger, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restoredTrigger, 0));
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === sentinel!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    resolveChain(restoredTrigger.session);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === sentinel!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
    });
  });
});

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction) {
  const response = applyLuaRestoreResponse(restored, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function resolveChain(session: DuelSession): void {
  let guard = 0;
  while (session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const pass = getLegalActions(session, session.state.waitingFor!).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const response = applyResponse(session, pass!);
    expect(response.ok, response.error).toBe(true);
  }
}
