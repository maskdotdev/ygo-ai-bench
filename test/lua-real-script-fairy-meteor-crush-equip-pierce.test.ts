import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelResponse, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Fairy Meteor Crush equip pierce", () => {
  it("restores equip-sourced piercing damage only for the equipped monster", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const equipCode = "97687912";
    const equippedAttackerCode = "9768";
    const unequippedAttackerCode = "9769";
    const firstDefenderCode = "9770";
    const secondDefenderCode = "9771";
    const responderCode = "9772";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === equipCode),
      monster(equippedAttackerCode, "Fairy Meteor Crush Equipped Attacker", 1800, 1000),
      monster(unequippedAttackerCode, "Fairy Meteor Crush Unequipped Attacker", 1800, 1000),
      monster(firstDefenderCode, "Fairy Meteor Crush First Defender", 500, 1000),
      monster(secondDefenderCode, "Fairy Meteor Crush Second Defender", 500, 1000),
      monster(responderCode, "Fairy Meteor Crush Chain Responder", 1000, 1000),
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 976, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [equipCode, equippedAttackerCode, unequippedAttackerCode] }, 1: { main: [firstDefenderCode, secondDefenderCode, responderCode] } });
    startDuel(session);

    const equip = session.state.cards.find((card) => card.code === equipCode);
    const equippedAttacker = session.state.cards.find((card) => card.code === equippedAttackerCode);
    const unequippedAttacker = session.state.cards.find((card) => card.code === unequippedAttackerCode);
    const firstDefender = session.state.cards.find((card) => card.code === firstDefenderCode);
    const secondDefender = session.state.cards.find((card) => card.code === secondDefenderCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(equip).toBeDefined();
    expect(equippedAttacker).toBeDefined();
    expect(unequippedAttacker).toBeDefined();
    expect(firstDefender).toBeDefined();
    expect(secondDefender).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, equip!.uid, "hand", 0);
    moveDuelCard(session.state, equippedAttacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, unequippedAttacker!.uid, "monsterZone", 0).position = "faceDownDefense";
    moveDuelCard(session.state, firstDefender!.uid, "monsterZone", 1).position = "faceUpDefense";
    moveDuelCard(session.state, secondDefender!.uid, "monsterZone", 1).position = "faceUpDefense";
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(equipCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredEquipWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredEquipWindow.restoreComplete, restoredEquipWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredEquipWindow.missingRegistryKeys).toEqual([]);
    expect(restoredEquipWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredEquipWindow, 0);
    const equipAction = getLuaRestoreLegalActions(restoredEquipWindow, 0).find((action) => action.type === "activateEffect" && action.uid === equip!.uid);
    expect(equipAction, JSON.stringify(getLuaRestoreLegalActions(restoredEquipWindow, 0), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restoredEquipWindow, equipAction!);

    expect(restoredEquipWindow.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 262144,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-97687912-0",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-97687912-0",
        "targetUids": [
          "p0-deck-9768-1",
        ],
      }
    `);

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredEquipWindow.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
    resolveRestoredChain(restoredChain);

    expect(restoredChain.session.state.cards.find((card) => card.uid === equip!.uid)).toMatchObject({
      location: "spellTrapZone",
      equippedToUid: equippedAttacker!.uid,
      faceUp: true,
    });
    expect(restoredChain.host.messages).not.toContain("fairy meteor crush responder resolved");

    const postEquip = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(postEquip.restoreComplete, postEquip.incompleteReasons.join("; ")).toBe(true);
    expect(postEquip.missingRegistryKeys).toEqual([]);
    expect(postEquip.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(postEquip, 0);
    const unequippedAfterEquip = postEquip.session.state.cards.find((card) => card.uid === unequippedAttacker!.uid);
    expect(unequippedAfterEquip).toBeDefined();
    unequippedAfterEquip!.position = "faceUpAttack";
    const battlePhase = getLuaRestoreLegalActions(postEquip, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battlePhase, JSON.stringify(getLuaRestoreLegalActions(postEquip, 0), null, 2)).toBeDefined();
    const enteredBattle = applyLuaRestoreResponse(postEquip, battlePhase!);
    expect(enteredBattle.ok, enteredBattle.error).toBe(true);

    const restoredFirstBattle = restoreDuelWithLuaScripts(serializeDuel(postEquip.session), source, reader);
    expect(restoredFirstBattle.restoreComplete, restoredFirstBattle.incompleteReasons.join("; ")).toBe(true);
    expect(restoredFirstBattle.missingRegistryKeys).toEqual([]);
    expect(restoredFirstBattle.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredFirstBattle, 0);
    attackAndRestoreDamage(restoredFirstBattle, unequippedAttacker!.uid, firstDefender!.uid, source, reader);
    expect(restoredFirstBattle.session.state.players[1].lifePoints).toBe(8000);
    expect(restoredFirstBattle.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt" && event.eventPlayer === 1)).toEqual([]);

    const restoredSecondBattle = restoreDuelWithLuaScripts(serializeDuel(restoredFirstBattle.session), source, reader);
    expect(restoredSecondBattle.restoreComplete, restoredSecondBattle.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSecondBattle.missingRegistryKeys).toEqual([]);
    expect(restoredSecondBattle.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSecondBattle, 0);
    attackAndRestoreDamage(restoredSecondBattle, equippedAttacker!.uid, secondDefender!.uid, source, reader);

    expect(restoredSecondBattle.session.state.battleDamage).toEqual({ 0: 0, 1: 800 });
    expect(restoredSecondBattle.session.state.players[1].lifePoints).toBe(7200);
    expect(restoredSecondBattle.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: equippedAttacker!.uid,
        eventPlayer: 1,
        eventValue: 800,
        eventReason: duelReason.battle,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 2,
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
    expect(restoredSecondBattle.session.state.cards.find((card) => card.uid === firstDefender!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredSecondBattle.session.state.cards.find((card) => card.uid === secondDefender!.uid)).toMatchObject({ location: "graveyard" });
  });
});

function monster(code: string, name: string, attack: number, defense: number): DuelCardData {
  return { code, name, kind: "monster", typeFlags: 0x1, level: 4, attack, defense };
}

function attackAndRestoreDamage(
  restored: ReturnType<typeof restoreDuelWithLuaScripts>,
  attackerUid: string,
  targetUid: string,
  source: { readScript(name: string): string | undefined },
  reader: ReturnType<typeof createCardReader>,
): void {
  const attack = getLuaRestoreLegalActions(restored, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attackerUid && action.targetUid === targetUid);
  expect(attack, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
  const attacked = applyLuaRestoreResponse(restored, attack!);
  expect(attacked.ok, attacked.error).toBe(true);
  const restoredDamageWindow = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, reader);
  expect(restoredDamageWindow.restoreComplete, restoredDamageWindow.incompleteReasons.join("; ")).toBe(true);
  expect(restoredDamageWindow.missingRegistryKeys).toEqual([]);
  expect(restoredDamageWindow.missingChainLimitRegistryKeys).toEqual([]);
  expectRestoredLegalActions(restoredDamageWindow, restoredDamageWindow.session.state.waitingFor ?? restoredDamageWindow.session.state.turnPlayer);
  passBattleResponses(restoredDamageWindow.session);
  restored.session = restoredDamageWindow.session;
  restored.host = restoredDamageWindow.host;
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("fairy meteor crush responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function applyLuaRestoreAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, response: DuelResponse): void {
  const result = applyLuaRestoreResponse(restored, response);
  expect(result.ok, result.error).toBe(true);
  const waitingFor = restored.session.state.waitingFor;
  if (waitingFor !== undefined) expect(result.legalActions).toEqual(getLuaRestoreLegalActions(restored, waitingFor));
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyLuaRestoreAndAssert(restored, pass!);
  }
}

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getDuelLegalActions(session, player).find((action) => action.type === passType);
    expect(pass).toBeDefined();
    applyAndAssert(session, pass!);
  }
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
