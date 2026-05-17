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
const attributeLight = 0x10;
const attributeDark = 0x20;
const battleDestroyReason = duelReason.battle | duelReason.destroy;
const effectDestroyReason = duelReason.effect | duelReason.destroy;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Radiant Spirit battle-destroyed group destroy", () => {
  it("restores mandatory battle-destroyed GetMatchingGroup destruction from a real script", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const radiantSpiritCode = "12624008";
    const attackerCode = "12624009";
    const darkTargetCode = "12624010";
    const lightSurvivorCode = "12624011";
    const facedownTargetCode = "12624012";
    const responderCode = "12624013";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === radiantSpiritCode),
      { code: attackerCode, name: "Radiant Spirit Dark Attacker", kind: "monster", typeFlags: typeMonster, level: 4, attack: 3000, defense: 1000, attribute: attributeDark },
      { code: darkTargetCode, name: "Radiant Spirit Dark Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000, attribute: attributeDark },
      { code: lightSurvivorCode, name: "Radiant Spirit Light Survivor", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000, attribute: attributeLight },
      { code: facedownTargetCode, name: "Radiant Spirit Facedown Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000, attribute: attributeLight },
      { code: responderCode, name: "Radiant Spirit Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 12624, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [radiantSpiritCode, darkTargetCode] },
      1: { main: [attackerCode, lightSurvivorCode, facedownTargetCode, responderCode] },
    });
    startDuel(session);

    const radiantSpirit = requireCard(session, radiantSpiritCode);
    const attacker = requireCard(session, attackerCode);
    const darkTarget = requireCard(session, darkTargetCode);
    const lightSurvivor = requireCard(session, lightSurvivorCode);
    const facedownTarget = requireCard(session, facedownTargetCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, radiantSpirit.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, darkTarget.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, attacker.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, lightSurvivor.uid, "monsterZone", 1).position = "faceUpAttack";
    const setTarget = moveDuelCard(session.state, facedownTarget.uid, "monsterZone", 1);
    setTarget.faceUp = false;
    setTarget.position = "faceDownDefense";
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "battle";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(radiantSpiritCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const attack = getLegalActions(session, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === radiantSpirit.uid && action.targetUid === attacker.uid,
    );
    expect(attack, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, attack!);
    passBattleResponses(session);

    expect(session.state.cards.find((card) => card.uid === radiantSpirit.uid)).toMatchObject({
      location: "graveyard",
      reason: battleDestroyReason,
      reasonCardUid: attacker.uid,
    });
    expect(session.state.pendingTriggers).toEqual([
      {
        id: "trigger-6-1",
        player: 0,
        effectId: "lua-1-1140",
        sourceUid: radiantSpirit.uid,
        triggerBucket: "turnMandatory",
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: radiantSpirit.uid,
        eventReason: battleDestroyReason,
        eventReasonPlayer: 1,
        eventReasonCardUid: attacker.uid,
        eventTriggerTiming: "when",
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restored, 0);
    expect(getLuaRestoreLegalActions(restored, 1)).toEqual([]);

    const trigger = getLuaRestoreLegalActions(restored, 0).find(
      (action) => action.type === "activateTrigger" && action.uid === radiantSpirit.uid,
    );
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    const triggered = applyLuaRestoreResponse(restored, trigger!);
    expect(triggered.ok, triggered.error).toBe(true);
    expect(restored.session.state.chain).toHaveLength(1);
    expect(restored.session.state.chain[0]).toEqual({
      activationLocation: "graveyard",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-1-1140",
      eventCardUid: radiantSpirit.uid,
      eventCode: 1140,
      eventCurrentState: {
        controller: 0,
        faceUp: true,
        location: "graveyard",
        position: "faceUpAttack",
        sequence: 0,
      },
      eventName: "battleDestroyed",
      eventPreviousState: {
        controller: 0,
        faceUp: true,
        location: "monsterZone",
        position: "faceUpAttack",
        sequence: 0,
      },
      eventReason: battleDestroyReason,
      eventReasonCardUid: attacker.uid,
      eventReasonPlayer: 1,
      eventTriggerTiming: "when",
      id: "chain-6",
      operationInfos: [{ category: 0x1, targetUids: [darkTarget.uid, attacker.uid, facedownTarget.uid], count: 3, player: 0, parameter: 0 }],
      player: 0,
      sourceUid: radiantSpirit.uid,
    });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restored.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredChain, 1);
    passChain(restoredChain);

    expect(restoredChain.session.state.cards.find((card) => card.uid === radiantSpirit.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredChain.session.state.cards.find((card) => card.uid === darkTarget.uid)).toMatchObject({ location: "graveyard", reason: effectDestroyReason });
    expect(restoredChain.session.state.cards.find((card) => card.uid === attacker.uid)).toMatchObject({ location: "graveyard", reason: effectDestroyReason });
    expect(restoredChain.session.state.cards.find((card) => card.uid === facedownTarget.uid)).toMatchObject({ location: "graveyard", reason: effectDestroyReason });
    expect(restoredChain.session.state.cards.find((card) => card.uid === lightSurvivor.uid)).toMatchObject({
      location: "monsterZone",
      controller: 1,
      position: "faceUpAttack",
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "destroyed" && event.eventReasonCardUid === radiantSpirit.uid)).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-deck-12624010-1",
          "eventCode": 1029,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "graveyard",
            "position": "faceUpAttack",
            "sequence": 1,
          },
          "eventName": "destroyed",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 1,
          },
          "eventReason": 65,
          "eventReasonCardUid": "p0-deck-12624008-0",
          "eventReasonEffectId": 1,
          "eventReasonPlayer": 0,
        },
        {
          "eventCardUid": "p1-deck-12624009-0",
          "eventCode": 1029,
          "eventCurrentState": {
            "controller": 1,
            "faceUp": true,
            "location": "graveyard",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "destroyed",
          "eventPreviousState": {
            "controller": 1,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventReason": 65,
          "eventReasonCardUid": "p0-deck-12624008-0",
          "eventReasonEffectId": 1,
          "eventReasonPlayer": 0,
        },
        {
          "eventCardUid": "p1-deck-12624012-2",
          "eventCode": 1029,
          "eventCurrentState": {
            "controller": 1,
            "faceUp": true,
            "location": "graveyard",
            "position": "faceDownDefense",
            "sequence": 1,
          },
          "eventName": "destroyed",
          "eventPreviousState": {
            "controller": 1,
            "faceUp": false,
            "location": "monsterZone",
            "position": "faceDownDefense",
            "sequence": 2,
          },
          "eventReason": 65,
          "eventReasonCardUid": "p0-deck-12624008-0",
          "eventReasonEffectId": 1,
          "eventReasonPlayer": 0,
        },
        {
          "eventCardUid": "p0-deck-12624010-1",
          "eventCode": 1029,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "graveyard",
            "position": "faceUpAttack",
            "sequence": 1,
          },
          "eventName": "destroyed",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 1,
          },
          "eventReason": 65,
          "eventReasonCardUid": "p0-deck-12624008-0",
          "eventReasonEffectId": 1,
          "eventReasonPlayer": 0,
          "eventUids": [
            "p0-deck-12624010-1",
            "p1-deck-12624009-0",
            "p1-deck-12624012-2",
          ],
        },
      ]
    `);
    expect(host.messages).not.toContain("radiant spirit responder resolved");
    expect(restored.host.messages).not.toContain("radiant spirit responder resolved");
    expect(restoredChain.host.messages).not.toContain("radiant spirit responder resolved");
  });
});

function requireCard(session: DuelSession, code: string) {
  const card = session.state.cards.find((candidate) => candidate.code === code);
  expect(card).toBeDefined();
  return card!;
}

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetProperty(EFFECT_FLAG_DAMAGE_STEP+EFFECT_FLAG_DAMAGE_CAL)
      e:SetHintTiming(TIMING_BATTLE_PHASE)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("radiant spirit responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function passBattleResponses(session: DuelSession): void {
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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function passChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  while (restored.session.state.chain.length > 0) {
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player!), null, 2)).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);
  }
}
