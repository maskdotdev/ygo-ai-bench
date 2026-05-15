import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
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
const typeEffect = 0x20;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Gemini Soldier", () => {
  it("restores battled trigger, Deck Special Summon, and battle indestructible count", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const soldierCode = "68366996";
    const geminiTargetCode = "3918345";
    const opponentCode = "68366997";
    const responderCode = "68366998";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [soldierCode, geminiTargetCode].includes(card.code)),
      { code: opponentCode, name: "Gemini Soldier Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Gemini Soldier Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 6836, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [soldierCode, geminiTargetCode] }, 1: { main: [opponentCode, responderCode] } });
    startDuel(session);

    const soldier = session.state.cards.find((card) => card.code === soldierCode);
    const target = session.state.cards.find((card) => card.code === geminiTargetCode);
    const opponent = session.state.cards.find((card) => card.code === opponentCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(soldier).toBeDefined();
    expect(target).toBeDefined();
    expect(opponent).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, soldier!.uid, "monsterZone", 0);
    moveDuelCard(session.state, opponent!.uid, "monsterZone", 1);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    soldier!.faceUp = true;
    soldier!.position = "faceUpAttack";
    opponent!.faceUp = true;
    opponent!.position = "faceUpAttack";
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(soldierCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);
    expect(session.state.effects.find((effect) => effect.sourceUid === responder!.uid)).toMatchObject({
      property: 0x4000,
      range: ["hand"],
    });

    const restoredInitial = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredInitial.restoreComplete, restoredInitial.incompleteReasons.join("; ")).toBe(true);
    expect(restoredInitial.missingRegistryKeys).toEqual([]);
    expect(restoredInitial.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredInitial.session.state.effects.find((effect) => effect.sourceUid === responder!.uid)).toMatchObject({
      property: 0x4000,
      range: ["hand"],
    });
    expectRestoredLegalActions(restoredInitial, 0);
    assertGeminiStatus(restoredInitial, soldierCode, false);
    const geminiSummon = getLuaRestoreLegalActions(restoredInitial, 0).find((action) => action.type === "normalSummon" && action.uid === soldier!.uid);
    expect(geminiSummon, JSON.stringify(getLuaRestoreLegalActions(restoredInitial, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredInitial, geminiSummon!);

    const restoredBattleEntry = restoreDuelWithLuaScripts(serializeDuel(restoredInitial.session), source, reader);
    expect(restoredBattleEntry.restoreComplete, restoredBattleEntry.incompleteReasons.join("; ")).toBe(true);
    expect(restoredBattleEntry.missingRegistryKeys).toEqual([]);
    expect(restoredBattleEntry.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredBattleEntry, 0);
    assertGeminiStatus(restoredBattleEntry, soldierCode, true);
    expect(restoredBattleEntry.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 47,
          sourceUid: soldier!.uid,
          luaValueDescriptor: "value-predicate:reason-mask:32",
        }),
      ]),
    );
    const battlePhase = getLuaRestoreLegalActions(restoredBattleEntry, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battlePhase, JSON.stringify(getLuaRestoreLegalActions(restoredBattleEntry, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattleEntry, battlePhase!);

    const restoredAttackWindow = restoreDuelWithLuaScripts(serializeDuel(restoredBattleEntry.session), source, reader);
    expect(restoredAttackWindow.restoreComplete, restoredAttackWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredAttackWindow.missingRegistryKeys).toEqual([]);
    expect(restoredAttackWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredAttackWindow, 0);
    const attack = getLuaRestoreLegalActions(restoredAttackWindow, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === soldier!.uid && action.targetUid === opponent!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredAttackWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttackWindow, attack!);

    const restoredBattleTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredAttackWindow.session), source, reader);
    expect(restoredBattleTrigger.restoreComplete, restoredBattleTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(restoredBattleTrigger.missingRegistryKeys).toEqual([]);
    expect(restoredBattleTrigger.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredBattleTrigger, 1);
    passBattleResponsesUntilTrigger(restoredBattleTrigger.session);
    expect(restoredBattleTrigger.session.state.cards.find((card) => card.uid === soldier!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restoredBattleTrigger.session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-5-1138",
          "eventCardUid": "p0-deck-68366996-0",
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
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventReason": 0,
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "when",
          "eventUids": [
            "p0-deck-68366996-0",
            "p1-deck-68366997-0",
          ],
          "id": "trigger-7-1",
          "player": 0,
          "sourceUid": "p0-deck-68366996-0",
          "triggerBucket": "turnOptional",
        },
      ]
    `);

    const restoredPendingTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredBattleTrigger.session), source, reader);
    expect(restoredPendingTrigger.restoreComplete, restoredPendingTrigger.incompleteReasons.join("; ")).toBe(true);
    expect(restoredPendingTrigger.missingRegistryKeys).toEqual([]);
    expect(restoredPendingTrigger.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredPendingTrigger, 0);
    const trigger = getLuaRestoreLegalActions(restoredPendingTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === soldier!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredPendingTrigger, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPendingTrigger, trigger!);
    expect(restoredPendingTrigger.session.state.pendingTriggers).toEqual([]);
    expect(restoredPendingTrigger.session.state.chain[0]).toMatchObject({
      sourceUid: soldier!.uid,
      operationInfos: [{ category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x1 }],
    });

    const restoredChain = restoreDuelWithLuaScripts(serializeDuel(restoredPendingTrigger.session), source, reader);
    expect(restoredChain.restoreComplete, restoredChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredChain.missingRegistryKeys).toEqual([]);
    expect(restoredChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredChain, 1);
    expect(getLuaRestoreLegalActions(restoredChain, 1).some((action) => action.type === "activateEffect" && action.uid === responder!.uid)).toBe(true);
    resolveRestoredChain(restoredChain);
    expect(restoredChain.host.messages).not.toContain("gemini soldier responder resolved");
    expect(restoredChain.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
    });
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: target!.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: soldier!.uid,
        eventReasonEffectId: 5,
        eventUids: [target!.uid],
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
          sequence: 1,
        },
      },
    ]);

    passBattleResponses(restoredChain.session);
    expect(restoredChain.session.state.cards.find((card) => card.uid === soldier!.uid)).toMatchObject({ location: "monsterZone", controller: 0 });
    expect(restoredChain.session.state.cards.find((card) => card.uid === opponent!.uid)).toMatchObject({ location: "monsterZone", controller: 1 });
    expect(restoredChain.session.state.players[0].lifePoints).toBe(7500);
    expect(restoredChain.session.state.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "continuous",
          code: 47,
          sourceUid: soldier!.uid,
          value: 0,
        }),
      ]),
    );
    expect(restoredChain.session.state.eventHistory.filter((event) => event.eventName === "battleDamageDealt")).toEqual([
      {
        eventName: "battleDamageDealt",
        eventCode: 1143,
        eventCardUid: opponent!.uid,
        eventPlayer: 0,
        eventValue: 500,
        eventReason: duelReason.battle,
        eventReasonPlayer: 1,
        eventPreviousState: {
          controller: 1,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);

    const restoredAfterBattle = restoreDuelWithLuaScripts(serializeDuel(restoredChain.session), source, reader);
    expect(restoredAfterBattle.restoreComplete, restoredAfterBattle.incompleteReasons.join("; ")).toBe(true);
    expect(restoredAfterBattle.missingRegistryKeys).toEqual([]);
    expect(restoredAfterBattle.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredAfterBattle, 0);
    expect(restoredAfterBattle.session.state.cards.find((card) => card.uid === soldier!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restoredAfterBattle.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "monsterZone" });
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetProperty(EFFECT_FLAG_DAMAGE_STEP)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("gemini soldier responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function assertGeminiStatus(restored: ReturnType<typeof restoreDuelWithLuaScripts>, code: string, expected: boolean): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.SelectMatchingCard(0,aux.FilterBoolFunction(Card.IsCode,${code}),0,LOCATION_MZONE,0,1,1,nil):GetFirst()
      Debug.Message("gemini soldier status " .. tostring(target and target:IsGeminiStatus()))
    `,
    `gemini-soldier-status-${expected ? "true" : "false"}.lua`,
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(`gemini soldier status ${expected ? "true" : "false"}`);
}

function passBattleResponsesUntilTrigger(session: DuelSession): void {
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) passOneBattleResponse(session);
}

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle) passOneBattleResponse(session);
}

function passOneBattleResponse(session: DuelSession): void {
  const player = session.state.waitingFor ?? session.state.turnPlayer;
  const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
  const pass = getDuelLegalActions(session, player).find((action) => action.type === passType);
  expect(pass, JSON.stringify(getDuelLegalActions(session, player), null, 2)).toBeDefined();
  applyAndAssert(session, pass!);
}

function resolveRestoredChain(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  let guard = 0;
  while (restored.session.state.chain.length > 0) {
    expect(++guard).toBeLessThan(10);
    const player = restored.session.state.waitingFor ?? restored.session.state.turnPlayer;
    const pass = getLuaRestoreLegalActions(restored, player).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restored, player), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
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
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function applyAndAssert(session: DuelSession, action: DuelAction): void {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  const waitingFor = response.state.waitingFor;
  if (waitingFor !== undefined) {
    expect(response.legalActions).toEqual(getDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, waitingFor));
    expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  }
}
