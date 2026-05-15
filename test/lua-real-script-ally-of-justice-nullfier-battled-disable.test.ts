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
const attributeLight = 0x10;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Ally of Justice Nullfier battled disable", () => {
  it("restores its EVENT_BATTLED label-object trigger and disables the LIGHT battle target", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const nullfierCode = "76650663";
    const lightTargetCode = "7665";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === nullfierCode),
      { code: lightTargetCode, name: "Nullfier LIGHT Target", kind: "monster", typeFlags: 0x1, level: 4, attribute: attributeLight, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 766, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [nullfierCode] }, 1: { main: [lightTargetCode] } });
    startDuel(session);

    const nullfier = session.state.cards.find((card) => card.code === nullfierCode);
    const lightTarget = session.state.cards.find((card) => card.code === lightTargetCode);
    expect(nullfier).toBeDefined();
    expect(lightTarget).toBeDefined();
    moveDuelCard(session.state, nullfier!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, lightTarget!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(nullfierCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(session.state.effects.find((effect) => effect.event === "trigger" && effect.code === 1138 && effect.sourceUid === nullfier!.uid)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 1138,
        "controller": 0,
        "cost": [Function],
        "description": 1226410608,
        "event": "trigger",
        "id": "lua-1-1138",
        "luaTypeFlags": 513,
        "oncePerTurn": false,
        "operation": [Function],
        "optional": false,
        "promptOperation": [Function],
        "range": [
          "deck",
          "hand",
          "monsterZone",
          "spellTrapZone",
          "graveyard",
          "banished",
          "extraDeck",
          "overlay",
        ],
        "registryKey": "lua:76650663:lua-1-1138",
        "sourceUid": "p0-deck-76650663-0",
        "target": [Function],
        "triggerCode": 1138,
        "triggerEvent": "afterDamageCalculation",
        "triggerSourceOnly": true,
        "triggerTiming": "when",
      }
    `);

    const attack = getLegalActions(session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === nullfier!.uid && action.targetUid === lightTarget!.uid);
    expect(attack).toBeDefined();
    applyAndAssert(session, attack!);
    passUntilPendingTrigger(session);

    expect(session.state.battleWindow?.kind).toBe("afterDamageCalculation");
    expect(session.state.pendingBattle).toMatchObject({ resultApplied: true });
    expect(session.state.battleDamage).toEqual({ 0: 0, 1: 600 });
    expect(session.state.players[1].lifePoints).toBe(7400);
    expect(session.state.cards.find((card) => card.uid === lightTarget!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-1-1138",
          "effectLabelObjectUid": "p1-deck-7665-0",
          "eventCardUid": "p0-deck-76650663-0",
          "eventCode": 1138,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "afterDamageCalculation",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "deck",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 0,
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "when",
          "eventUids": [
            "p0-deck-76650663-0",
            "p1-deck-7665-0",
          ],
          "id": "trigger-5-1",
          "player": 0,
          "sourceUid": "p0-deck-76650663-0",
          "triggerBucket": "turnMandatory",
        },
      ]
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.pendingBattle).toMatchObject({ resultApplied: true });
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);

    const trigger = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "activateTrigger" && action.uid === nullfier!.uid);
    expect(trigger).toBeDefined();
    const triggered = applyLuaRestoreResponse(restored, trigger!);
    expect(triggered.ok, triggered.error).toBe(true);

    expect(restored.session.state.pendingTriggers).toEqual([]);
    expect(restored.session.state.effects.filter((effect) => effect.event === "continuous" && effect.sourceUid === lightTarget!.uid && [2, 8].includes(effect.code))).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "code": 2,
          "controller": 1,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-2-2",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:7665:lua-2-2",
          "reset": {
            "flags": 91885568,
          },
          "sourceUid": "p1-deck-7665-0",
          "target": [Function],
        },
        {
          "canActivate": [Function],
          "code": 8,
          "controller": 1,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-3-8",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:7665:lua-3-8",
          "reset": {
            "flags": 91885568,
          },
          "sourceUid": "p1-deck-7665-0",
          "target": [Function],
        },
      ]
    `);
    expect(restored.session.state.cards.find((card) => card.uid === lightTarget!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    const probe = restored.host.loadScript(
      `
      local target=Duel.SelectMatchingCard(0, aux.FilterBoolFunction(Card.IsCode, ${lightTargetCode}), 1, LOCATION_MZONE, 0, 1, 1, nil):GetFirst()
      Debug.Message("nullfier target disabled " .. tostring(target:IsDisabled()))
      `,
      "ally-of-justice-nullfier-disabled-probe.lua",
    );
    expect(probe.ok, probe.error).toBe(true);
    expect(restored.host.messages).toContain("nullfier target disabled true");
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "afterDamageCalculation")).toEqual([
      {
        eventName: "afterDamageCalculation",
        eventCode: 1138,
        eventCardUid: nullfier!.uid,
        eventUids: [nullfier!.uid, lightTarget!.uid],
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
