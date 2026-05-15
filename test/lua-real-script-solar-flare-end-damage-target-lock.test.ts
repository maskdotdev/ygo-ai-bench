import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelResponse, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));
const racePyro = 0x80;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Solar Flare Dragon end damage target lock", () => {
  it("restores its Pyro ally battle-target lock and End Phase damage trigger", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const solarFlareCode = "45985838";
    const pyroAllyCode = "45985839";
    const attackerCode = "45985840";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === solarFlareCode),
      { code: pyroAllyCode, name: "Solar Flare Pyro Ally", kind: "monster", typeFlags: 0x1, race: racePyro, level: 4, attack: 1000, defense: 1000 },
      { code: attackerCode, name: "Solar Flare Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 2200, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 4598, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [solarFlareCode, pyroAllyCode] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const solarFlare = requireCard(session, solarFlareCode);
    const pyroAlly = requireCard(session, pyroAllyCode);
    const attacker = requireCard(session, attackerCode);
    moveFaceUpAttack(session, solarFlare, 0);
    moveFaceUpAttack(session, pyroAlly, 0);
    moveFaceUpAttack(session, attacker, 1);
    session.state.turnPlayer = 1;
    session.state.phase = "battle";
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(solarFlareCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredBattle = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expectCleanRestore(restoredBattle);
    expectRestoredLegalActions(restoredBattle, 1);
    const battleActions = getLuaRestoreLegalActions(restoredBattle, 1);
    expect(hasAttack(battleActions, attacker.uid, solarFlare.uid)).toBe(false);
    expect(hasAttack(battleActions, attacker.uid, pyroAlly.uid)).toBe(true);
    expect(restoredBattle.session.state.effects.filter((effect) => effect.sourceUid === solarFlare.uid && [70, 0x1200].includes(effect.code ?? -1))).toMatchInlineSnapshot(`
      [
        {
          "battleDamageValue": [Function],
          "canActivate": [Function],
          "code": 70,
          "controller": 0,
          "cost": [Function],
          "event": "continuous",
          "id": "lua-1-70",
          "lifePointValue": [Function],
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "property": 131072,
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:45985838:lua-1-70",
          "sourceUid": "p0-deck-45985838-0",
          "statValue": [Function],
          "target": [Function],
          "valueCardPredicate": [Function],
          "valuePredicate": [Function],
        },
        {
          "canActivate": [Function],
          "category": 524288,
          "code": 4608,
          "controller": 0,
          "cost": [Function],
          "countLimit": 1,
          "description": 735773408,
          "event": "trigger",
          "id": "lua-2-4608",
          "luaTypeFlags": 514,
          "oncePerTurn": true,
          "operation": [Function],
          "optional": false,
          "property": 2048,
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:45985838:lua-2-4608",
          "sourceUid": "p0-deck-45985838-0",
          "target": [Function],
          "targetCardPredicate": [Function],
          "triggerCode": 4608,
          "triggerEvent": "phaseEnd",
          "triggerTiming": "when",
        },
      ]
    `);

    restoredBattle.session.state.turnPlayer = 0;
    restoredBattle.session.state.waitingFor = 0;
    const restoredEndWindow = restoreDuelWithLuaScripts(serializeDuel(restoredBattle.session), workspace, reader);
    expectCleanRestore(restoredEndWindow);
    expectRestoredLegalActions(restoredEndWindow, 0);
    const main2 = getLuaRestoreLegalActions(restoredEndWindow, 0).find((action) => action.type === "changePhase" && action.phase === "main2");
    expect(main2, JSON.stringify(getLuaRestoreLegalActions(restoredEndWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEndWindow, main2!);
    const endPhase = getLuaRestoreLegalActions(restoredEndWindow, 0).find((action) => action.type === "changePhase" && action.phase === "end");
    expect(endPhase, JSON.stringify(getLuaRestoreLegalActions(restoredEndWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEndWindow, endPhase!);
    expect(restoredEndWindow.session.state.eventHistory.filter((event) => event.eventName === "phaseEnd")).toEqual([{ eventName: "phaseEnd", eventCode: 0x1200 }]);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredEndWindow.session), workspace, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === solarFlare.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    expect(trigger).toMatchObject({ type: "activateTrigger", triggerBucket: "turnMandatory", uid: solarFlare.uid });
    applyLuaRestoreAndAssert(restoredTrigger, trigger!);
    expect(restoredTrigger.session.state.chain).toEqual([]);
    expect(restoredTrigger.session.state.players[1].lifePoints).toBe(7500);
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "damageDealt")).toEqual([
      {
        eventName: "damageDealt",
        eventCode: 1111,
        eventPlayer: 1,
        eventValue: 500,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: solarFlare.uid,
        eventReasonEffectId: 2,
      },
    ]);
  });
});

function moveFaceUpAttack(session: DuelSession, card: DuelSession["state"]["cards"][number], player: 0 | 1): void {
  moveDuelCard(session.state, card.uid, "monsterZone", player);
  card.faceUp = true;
  card.position = "faceUpAttack";
}

function hasAttack(actions: DuelAction[], attackerUid: string, targetUid: string): boolean {
  return actions.some((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid);
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player).flatMap((group) => group.actions));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}
