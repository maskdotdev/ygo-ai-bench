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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Dark Ruler Ha Des battled disable", () => {
  it("restores its EVENT_BATTLED continuous disable on a battle-destroyed monster in Graveyard", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const haDesCode = "53982768";
    const battleTargetCode = "5398";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === haDesCode),
      { code: battleTargetCode, name: "Ha Des Battle Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 539, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [haDesCode] }, 1: { main: [battleTargetCode] } });
    startDuel(session);

    const haDes = session.state.cards.find((card) => card.code === haDesCode);
    const battleTarget = session.state.cards.find((card) => card.code === battleTargetCode);
    expect(haDes).toBeDefined();
    expect(battleTarget).toBeDefined();
    moveDuelCard(session.state, haDes!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, battleTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(haDesCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.filter((effect) => effect.sourceUid === haDes!.uid && [30, 1138].includes(effect.code ?? -1))).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "code": 30,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-1-30",
          "luaTypeFlags": 1,
          "luaValueDescriptor": "special-summon-condition:false",
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "property": 394240,
          "range": [
            "graveyard",
          ],
          "registryKey": "lua:53982768:lua-1-30",
          "sourceUid": "p0-deck-53982768-0",
          "target": [Function],
        },
        {
          "canActivate": [Function],
          "code": 1138,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-2-1138",
          "luaTypeFlags": 2050,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:53982768:lua-2-1138",
          "sourceUid": "p0-deck-53982768-0",
          "target": [Function],
          "triggerCode": 1138,
          "triggerEvent": "afterDamageCalculation",
          "triggerTiming": "when",
        },
      ]
    `);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === haDes!.uid && action.targetUid === battleTarget!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    passBattleResponses(session);

    expect(session.state.pendingBattle).toBeUndefined();
    expect(session.state.cards.find((card) => card.uid === battleTarget!.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.destroy | duelReason.battle,
      reasonPlayer: 0,
      reasonCardUid: haDes!.uid,
    });
    expect(session.state.effects.filter((effect) => effect.sourceUid === battleTarget!.uid && [2, 8].includes(effect.code ?? -1))).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "code": 2,
          "controller": 1,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-3-2",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:5398:lua-3-2",
          "reset": {
            "flags": 24776704,
          },
          "sourceUid": "p1-deck-5398-0",
          "target": [Function],
        },
        {
          "canActivate": [Function],
          "code": 8,
          "controller": 1,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-4-8",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:5398:lua-4-8",
          "reset": {
            "flags": 24776704,
          },
          "sourceUid": "p1-deck-5398-0",
          "target": [Function],
        },
      ]
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);

    const probe = restored.host.loadScript(
      `
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${battleTargetCode}), 1, LOCATION_GRAVE, 0, 1, 1, nil):GetFirst()
      Debug.Message("ha des target disabled " .. tostring(target:IsDisabled()))
      `,
      "dark-ruler-ha-des-disabled-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toContain("ha des target disabled true");
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "afterDamageCalculation")).toEqual([
      {
        eventName: "afterDamageCalculation",
        eventCode: 1138,
        eventCardUid: haDes!.uid,
        eventUids: [haDes!.uid, battleTarget!.uid],
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
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "battleDestroyed")).toEqual([
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: battleTarget!.uid,
        eventReason: duelReason.destroy | duelReason.battle,
        eventReasonPlayer: 0,
        eventReasonCardUid: haDes!.uid,
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
          location: "graveyard",
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
