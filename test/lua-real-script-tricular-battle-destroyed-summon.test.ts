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
const typeMonster = 0x1;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Tricular battle destroyed summon", () => {
  it("restores Tricular's optional battle-destroyed trigger and Special Summons Bicular from Deck", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const tricularCode = "20797524";
    const bicularId = "83392426";
    const attackerCode = "2079";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [tricularCode, bicularId].includes(card.code)),
      { code: attackerCode, name: "Tricular Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1800, defense: 1200 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 2079, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [tricularCode, bicularId] }, 1: { main: [attackerCode] } });
    startDuel(session);

    const tricular = session.state.cards.find((card) => card.code === tricularCode);
    const bicular = session.state.cards.find((card) => card.code === bicularId);
    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    expect(tricular).toBeDefined();
    expect(bicular).toBeDefined();
    expect(attacker).toBeDefined();
    moveDuelCard(session.state, tricular!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 1).position = "faceUpAttack";
    session.state.phase = "battle";
    session.state.turnPlayer = 1;
    session.state.waitingFor = 1;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(tricularCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restoredInitial = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restoredInitial.restoreComplete, restoredInitial.incompleteReasons.join("; ")).toBe(true);
    expect(restoredInitial.missingRegistryKeys).toEqual([]);
    expect(restoredInitial.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredInitial, 1);
    expect(restoredInitial.session.state.effects.find((effect) => effect.sourceUid === tricular!.uid)).toMatchObject({
      category: 0x200,
      code: 1140,
      event: "trigger",
      registryKey: "lua:20797524:lua-1-1140",
      triggerEvent: "battleDestroyed",
      triggerSourceOnly: true,
    });

    const attack = getLuaRestoreLegalActions(restoredInitial, 1).find(
      (action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid && action.targetUid === tricular!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredInitial, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredInitial, attack!);
    passBattleResponses(restoredInitial.session);
    expect(restoredInitial.session.state.cards.find((card) => card.uid === tricular!.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.battle | duelReason.destroy,
      reasonCardUid: attacker!.uid,
    });
    expect(restoredInitial.session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-1-1140",
          "eventCardUid": "p0-deck-20797524-0",
          "eventCode": 1140,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "graveyard",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "battleDestroyed",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventReason": 33,
          "eventReasonCardUid": "p1-deck-2079-0",
          "eventReasonPlayer": 1,
          "eventTriggerTiming": "when",
          "id": "trigger-6-1",
          "player": 0,
          "sourceUid": "p0-deck-20797524-0",
          "triggerBucket": "opponentOptional",
        },
      ]
    `);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredInitial.session), workspace, reader);
    expect(restoredTrigger.restoreComplete, restoredTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTrigger.missingRegistryKeys).toEqual([]);
    expect(restoredTrigger.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(getLuaRestoreLegalActions(restoredTrigger, 1)).toEqual([]);
    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === tricular!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTrigger, trigger!);

    expect(restoredTrigger.session.state.pendingTriggers).toEqual([]);
    expect(restoredTrigger.session.state.chain).toHaveLength(0);

    expect(restoredTrigger.session.state.cards.find((card) => card.uid === tricular!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === bicular!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
    });
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === attacker!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredTrigger.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: bicular!.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: tricular!.uid,
        eventReasonEffectId: 1,
        eventUids: [bicular!.uid],
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

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((action) => action.type === passType);
    expect(pass, JSON.stringify(getLegalActions(session, player), null, 2)).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
    expect(result.legalActionGroups).toEqual(getLuaRestoreLegalActionGroups(restored, waitingFor));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
  }
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}
