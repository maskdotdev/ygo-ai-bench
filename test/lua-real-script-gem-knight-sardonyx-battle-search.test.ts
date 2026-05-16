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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Gem-Knight Sardonyx battle search", () => {
  it("restores Gemini-status battle-destroyed reason-card search", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const sardonyxCode = "43114901";
    const garnetCode = "91731841";
    const opponentCode = "43114902";
    const responderCode = "43114903";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [sardonyxCode, garnetCode].includes(card.code)),
      { code: opponentCode, name: "Gem-Knight Sardonyx Battle Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Gem-Knight Sardonyx Chain Responder", kind: "monster", typeFlags: typeMonster | typeEffect, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 4311, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [sardonyxCode, garnetCode] }, 1: { main: [opponentCode, responderCode] } });
    startDuel(session);

    const sardonyx = session.state.cards.find((card) => card.code === sardonyxCode);
    const garnet = session.state.cards.find((card) => card.code === garnetCode);
    const opponent = session.state.cards.find((card) => card.code === opponentCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(sardonyx).toBeDefined();
    expect(garnet).toBeDefined();
    expect(opponent).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, sardonyx!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, opponent!.uid, "monsterZone", 1).position = "faceUpAttack";
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
    expect(host.loadCardScript(Number(sardonyxCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredInitial = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expectCleanRestore(restoredInitial);
    expectRestoredLegalActions(restoredInitial, 0);
    assertGeminiStatus(restoredInitial, sardonyxCode, false);
    const geminiSummon = getLuaRestoreLegalActions(restoredInitial, 0).find((action) => action.type === "normalSummon" && action.uid === sardonyx!.uid);
    expect(geminiSummon, JSON.stringify(getLuaRestoreLegalActions(restoredInitial, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredInitial, geminiSummon!);

    const restoredBattleEntry = restoreDuelWithLuaScripts(serializeDuel(restoredInitial.session), source, reader);
    expectCleanRestore(restoredBattleEntry);
    expectRestoredLegalActions(restoredBattleEntry, 0);
    assertGeminiStatus(restoredBattleEntry, sardonyxCode, true);
    const battlePhase = getLuaRestoreLegalActions(restoredBattleEntry, 0).find((action) => action.type === "changePhase" && action.phase === "battle");
    expect(battlePhase, JSON.stringify(getLuaRestoreLegalActions(restoredBattleEntry, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredBattleEntry, battlePhase!);

    const restoredAttackWindow = restoreDuelWithLuaScripts(serializeDuel(restoredBattleEntry.session), source, reader);
    expectCleanRestore(restoredAttackWindow);
    expectRestoredLegalActions(restoredAttackWindow, 0);
    const attack = getLuaRestoreLegalActions(restoredAttackWindow, 0).find(
      (action) => action.type === "declareAttack" && action.attackerUid === sardonyx!.uid && action.targetUid === opponent!.uid,
    );
    expect(attack, JSON.stringify(getLuaRestoreLegalActions(restoredAttackWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredAttackWindow, attack!);
    passBattleResponsesUntilTrigger(restoredAttackWindow.session);

    const restoredTrigger = restoreDuelWithLuaScripts(serializeDuel(restoredAttackWindow.session), source, reader);
    expectCleanRestore(restoredTrigger);
    expectRestoredLegalActions(restoredTrigger, 0);
    expect(restoredTrigger.session.state.cards.find((card) => card.uid === opponent!.uid)).toMatchObject({
      location: "graveyard",
      reasonCardUid: sardonyx!.uid,
    });
    expect(restoredTrigger.session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-4-1140",
          "eventCardUid": "p1-deck-43114902-0",
          "eventCode": 1140,
          "eventCurrentState": {
            "controller": 1,
            "faceUp": true,
            "location": "graveyard",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "battleDestroyed",
          "eventPreviousState": {
            "controller": 1,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventReason": 33,
          "eventReasonCardUid": "p0-deck-43114901-0",
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "when",
          "id": "trigger-8-1",
          "player": 0,
          "sourceUid": "p0-deck-43114901-0",
          "triggerBucket": "turnOptional",
        },
      ]
    `);

    const trigger = getLuaRestoreLegalActions(restoredTrigger, 0).find((action) => action.type === "activateTrigger" && action.uid === sardonyx!.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTrigger, 0), null, 2)).toBeDefined();
    const triggered = applyLuaRestoreResponse(restoredTrigger, trigger!);
    expect(triggered.ok, triggered.error).toBe(true);
    expect(restoredTrigger.host.messages).not.toContain("sardonyx responder resolved");

    const restoredAfterSearch = restoreDuelWithLuaScripts(serializeDuel(restoredTrigger.session), source, reader);
    expectCleanRestore(restoredAfterSearch);
    expectRestoredLegalActions(restoredAfterSearch, 0);
    expect(restoredAfterSearch.session.state.cards.find((card) => card.uid === garnet!.uid)).toMatchObject({
      location: "hand",
      controller: 0,
    });
    expect(restoredAfterSearch.session.state.eventHistory.filter((event) => event.eventName === "battleDestroyed")).toEqual([
      {
        eventName: "battleDestroyed",
        eventCode: 1140,
        eventCardUid: opponent!.uid,
        eventReason: duelReason.battle | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: sardonyx!.uid,
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
    expect(restoredAfterSearch.session.state.eventHistory.filter((event) => event.eventName === "sentToHand")).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: garnet!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: sardonyx!.uid,
        eventReasonEffectId: 4,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
      },
    ]);
    expect(restoredAfterSearch.session.state.eventHistory.filter((event) => event.eventName === "sentToHandConfirmed")).toEqual([
      {
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventCardUid: garnet!.uid,
        eventPlayer: 1,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: sardonyx!.uid,
        eventReasonEffectId: 4,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
        eventUids: [garnet!.uid],
        eventValue: 1,
      },
    ]);
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
      e:SetOperation(function(e,tp) Debug.Message("sardonyx responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function expectCleanRestore(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
  expect(restored.missingRegistryKeys).toEqual([]);
  expect(restored.missingChainLimitRegistryKeys).toEqual([]);
}

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

function assertGeminiStatus(restored: ReturnType<typeof restoreDuelWithLuaScripts>, code: string, expected: boolean): void {
  const probe = restored.host.loadScript(
    `
      local target=Duel.GetFirstMatchingCard(aux.FilterBoolFunction(Card.IsCode,${code}),0,LOCATION_MZONE,0,nil)
      Debug.Message("sardonyx gemini status " .. tostring(target and target:IsGeminiStatus()))
    `,
    `sardonyx-gemini-status-${expected ? "true" : "false"}.lua`,
  );
  expect(probe.ok, probe.error).toBe(true);
  expect(restored.host.messages).toContain(`sardonyx gemini status ${expected ? "true" : "false"}`);
}

function passBattleResponsesUntilTrigger(session: DuelSession): void {
  while (session.state.pendingBattle && session.state.pendingTriggers.length === 0) passOneBattleResponse(session);
}

function passOneBattleResponse(session: DuelSession): void {
  const player = session.state.waitingFor ?? session.state.turnPlayer;
  const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
  const pass = getDuelLegalActions(session, player).find((action) => action.type === passType);
  expect(pass, JSON.stringify(getDuelLegalActions(session, player), null, 2)).toBeDefined();
  applyAndAssert(session, pass!);
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
