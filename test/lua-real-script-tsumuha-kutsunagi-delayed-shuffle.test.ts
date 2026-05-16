import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions as getDuelLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
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
const typeSpell = 0x2;
const phaseEndEventCode = 0x1200;

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Tsumuha-Kutsunagi delayed shuffle", () => {
  it("restores its one-tribute summon trigger, opponent send/draw prompt, and delayed End Phase shuffle", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const tsumuhaCode = "78098950";
    const tributeCode = "78098951";
    const selfDrawCode = "78098952";
    const opponentTargetCode = "78098953";
    const opponentDrawCode = "78098954";
    const fieldShuffleCode = "78098955";
    const graveShuffleCode = "78098956";
    const responderCode = "78098957";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === tsumuhaCode),
      { code: tributeCode, name: "Tsumuha Normal Summoned Tribute", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1200, defense: 1000 },
      { code: selfDrawCode, name: "Tsumuha Self Draw", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: opponentTargetCode, name: "Tsumuha Opponent Send Target", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1500, defense: 1200 },
      { code: opponentDrawCode, name: "Tsumuha Opponent Draw", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: fieldShuffleCode, name: "Tsumuha Field Shuffle Decoy", kind: "spell", typeFlags: typeSpell },
      { code: graveShuffleCode, name: "Tsumuha Graveyard Shuffle Decoy", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Tsumuha Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 780, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [tsumuhaCode, tributeCode, selfDrawCode, fieldShuffleCode, graveShuffleCode] }, 1: { main: [opponentTargetCode, opponentDrawCode, responderCode] } });
    startDuel(session);

    const tsumuha = requireCard(session, tsumuhaCode);
    const tribute = requireCard(session, tributeCode);
    const selfDraw = requireCard(session, selfDrawCode);
    const opponentTarget = requireCard(session, opponentTargetCode);
    const opponentDraw = requireCard(session, opponentDrawCode);
    const fieldShuffle = requireCard(session, fieldShuffleCode);
    const graveShuffle = requireCard(session, graveShuffleCode);
    const responder = requireCard(session, responderCode);
    moveDuelCard(session.state, tsumuha.uid, "hand", 0);
    moveDuelCard(session.state, tribute.uid, "monsterZone", 0);
    tribute.position = "faceUpAttack";
    tribute.faceUp = true;
    tribute.summonType = "normal";
    moveDuelCard(session.state, opponentTarget.uid, "monsterZone", 1);
    opponentTarget.position = "faceUpAttack";
    opponentTarget.faceUp = true;
    moveDuelCard(session.state, fieldShuffle.uid, "spellTrapZone", 0);
    fieldShuffle.position = "faceUpAttack";
    fieldShuffle.faceUp = true;
    moveDuelCard(session.state, graveShuffle.uid, "graveyard", 0);
    moveDuelCard(session.state, responder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(tsumuhaCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const restoredSummonWindow = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredSummonWindow.restoreComplete, restoredSummonWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonWindow.missingRegistryKeys).toEqual([]);
    expect(restoredSummonWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSummonWindow, 0);
    const summon = getLuaRestoreLegalActions(restoredSummonWindow, 0).find((action) => action.type === "tributeSummon" && action.uid === tsumuha.uid);
    expect(summon, JSON.stringify(getLuaRestoreLegalActions(restoredSummonWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredSummonWindow, summon!);
    expect(restoredSummonWindow.session.state.cards.find((card) => card.uid === tsumuha.uid)).toMatchObject({ location: "monsterZone", summonType: "tribute" });
    expect(restoredSummonWindow.session.state.cards.find((card) => card.uid === tribute.uid)).toMatchObject({ location: "graveyard", reason: duelReason.release | duelReason.material | duelReason.summon });

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredSummonWindow.session), source, reader);
    expect(restoredTriggerWindow.restoreComplete, restoredTriggerWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTriggerWindow.missingRegistryKeys).toEqual([]);
    expect(restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    expect(restoredTriggerWindow.session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-9-1100",
          "eventCardUid": "p0-deck-78098950-0",
          "eventCode": 1100,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "normalSummoned",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "hand",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 16,
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "when",
          "id": "trigger-6-1",
          "player": 0,
          "sourceUid": "p0-deck-78098950-0",
          "triggerBucket": "turnMandatory",
        },
      ]
    `);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === tsumuha.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);

    const restoredPrompt = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expect(restoredPrompt.restoreComplete, restoredPrompt.incompleteReasons.join("; ")).toBe(true);
    expect(restoredPrompt.missingRegistryKeys).toEqual([]);
    expect(restoredPrompt.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredPrompt.session.state.chain).toMatchInlineSnapshot(`
      [
        {
          "activationLocation": "monsterZone",
          "activationSequence": 0,
          "chainIndex": 1,
          "effectId": "lua-9-1100",
          "eventCardUid": "p0-deck-78098950-0",
          "eventCode": 1100,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "normalSummoned",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "hand",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 16,
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "when",
          "id": "chain-6",
          "player": 0,
          "possibleOperationInfos": [
            {
              "category": 32,
              "count": 1,
              "parameter": 12,
              "player": 1,
              "targetUids": [],
            },
            {
              "category": 65536,
              "count": 0,
              "parameter": 1,
              "player": 0,
              "targetUids": [],
            },
            {
              "category": 16,
              "count": 1,
              "parameter": 60,
              "player": 0,
              "targetUids": [],
            },
          ],
          "sourceUid": "p0-deck-78098950-0",
        },
      ]
    `);
    expectRestoredLegalActions(restoredPrompt, 1);
    const pass = getLuaRestoreLegalActions(restoredPrompt, 1).find((action) => action.type === "passChain");
    expect(pass, JSON.stringify(getLuaRestoreLegalActions(restoredPrompt, 1), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredPrompt, pass!);
    expect(restoredPrompt.host.promptDecisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ api: "SelectYesNo", player: 1, returned: true }),
    ]));

    expect(restoredPrompt.session.state.cards.find((card) => card.uid === opponentTarget.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredPrompt.session.state.cards.find((card) => card.uid === selfDraw.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredPrompt.session.state.cards.find((card) => card.uid === opponentDraw.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredPrompt.session.state.effects.find((effect) => effect.sourceUid === tsumuha.uid && effect.code === phaseEndEventCode && effect.event === "continuous")).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 4608,
        "controller": 0,
        "cost": [Function],
        "countLimit": 1,
        "event": "continuous",
        "id": "lua-12-4608",
        "luaTypeFlags": 2050,
        "oncePerTurn": true,
        "operation": [Function],
        "ownerPlayer": 0,
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
        "registryKey": "lua:78098950:lua-12-4608",
        "reset": {
          "flags": 1073742336,
        },
        "sourceUid": "p0-deck-78098950-0",
        "target": [Function],
        "triggerCode": 4608,
        "triggerEvent": "phaseEnd",
        "triggerTiming": "when",
      }
    `);
    expect(restoredPrompt.session.state.eventHistory.filter((event) => event.eventReasonEffectId === 9 && ["sentToGraveyard", "cardsDrawn"].includes(event.eventName))).toEqual([
      {
        eventName: "sentToGraveyard",
        eventCode: 1014,
        eventCardUid: opponentTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 1,
        eventReasonCardUid: tsumuha.uid,
        eventReasonEffectId: 9,
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
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventCardUid: selfDraw.uid,
        eventPlayer: 0,
        eventValue: 1,
        eventUids: [selfDraw.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: tsumuha.uid,
        eventReasonEffectId: 9,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 0,
        },
      },
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventCardUid: opponentDraw.uid,
        eventPlayer: 1,
        eventValue: 1,
        eventUids: [opponentDraw.uid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: tsumuha.uid,
        eventReasonEffectId: 9,
        eventPreviousState: {
          controller: 1,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 2,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 1,
        },
      },
    ]);

    const restoredDelayed = restoreDuelWithLuaScripts(serializeDuel(restoredPrompt.session), source, reader);
    expect(restoredDelayed.restoreComplete, restoredDelayed.incompleteReasons.join("; ")).toBe(true);
    expect(restoredDelayed.missingRegistryKeys).toEqual([]);
    expect(restoredDelayed.missingChainLimitRegistryKeys).toEqual([]);
    expect(restoredDelayed.session.state.effects.filter((effect) => effect.sourceUid === tsumuha.uid && effect.code === phaseEndEventCode)).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "category": 8,
          "code": 4608,
          "controller": 0,
          "cost": [Function],
          "description": 1105,
          "event": "trigger",
          "id": "lua-1-4608",
          "luaTypeFlags": 514,
          "oncePerTurn": false,
          "operation": [Function],
          "optional": false,
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:78098950:lua-1-4608",
          "sourceUid": "p0-deck-78098950-0",
          "target": [Function],
          "targetCardPredicate": [Function],
          "triggerCode": 4608,
          "triggerEvent": "phaseEnd",
          "triggerTiming": "when",
        },
        {
          "canActivate": [Function],
          "category": 8,
          "code": 4608,
          "controller": 0,
          "cost": [Function],
          "description": 1105,
          "event": "trigger",
          "id": "lua-2-4608",
          "luaTypeFlags": 130,
          "oncePerTurn": false,
          "operation": [Function],
          "optional": true,
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:78098950:lua-2-4608",
          "sourceUid": "p0-deck-78098950-0",
          "target": [Function],
          "targetCardPredicate": [Function],
          "triggerCode": 4608,
          "triggerEvent": "phaseEnd",
          "triggerTiming": "when",
        },
        {
          "code": 4608,
          "controller": 0,
          "countLimit": 1,
          "event": "continuous",
          "id": "lua-12-4608",
          "oncePerTurn": true,
          "operation": [Function],
          "ownerPlayer": 0,
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
          "registryKey": "lua:78098950:lua-12-4608",
          "reset": {
            "flags": 1073742336,
          },
          "sourceUid": "p0-deck-78098950-0",
          "triggerCode": 4608,
          "triggerEvent": "phaseEnd",
          "triggerTiming": "when",
        },
      ]
    `);
    expectRestoredLegalActions(restoredDelayed, 0);
    advanceRestoredToEndPhase(restoredDelayed);
    expect(restoredDelayed.session.state.pendingTriggers).toEqual([]);
    expect(restoredDelayed.session.state.eventHistory.filter((event) => event.eventName === "sentToDeck")).toEqual([
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: tsumuha.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: tsumuha.uid,
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
          location: "deck",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: fieldShuffle.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: tsumuha.uid,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "spellTrapZone",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "deck",
          position: "faceUpAttack",
          sequence: 1,
        },
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: graveShuffle.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: tsumuha.uid,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "deck",
          position: "faceDown",
          sequence: 2,
        },
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: tribute.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: tsumuha.uid,
        eventReasonEffectId: 6,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "deck",
          position: "faceUpAttack",
          sequence: 3,
        },
      },
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: opponentTarget.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: tsumuha.uid,
        eventReasonEffectId: 9,
        eventPreviousState: {
          controller: 1,
          faceUp: true,
          location: "graveyard",
          position: "faceUpAttack",
          sequence: 0,
        },
        eventCurrentState: {
          controller: 1,
          faceUp: true,
          location: "deck",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(restoredDelayed.session.state.cards.find((card) => card.uid === tsumuha.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredDelayed.session.state.cards.find((card) => card.uid === graveShuffle.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredDelayed.session.state.cards.find((card) => card.uid === fieldShuffle.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredDelayed.session.state.cards.find((card) => card.uid === tribute.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restoredDelayed.session.state.cards.find((card) => card.uid === opponentTarget.uid)).toMatchObject({ location: "deck", controller: 1 });
    expect(restoredDelayed.session.state.cards.find((card) => card.uid === selfDraw.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredDelayed.session.state.cards.find((card) => card.uid === opponentDraw.uid)).toMatchObject({ location: "hand", controller: 1 });
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
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("tsumuha responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function advanceRestoredToEndPhase(restored: ReturnType<typeof restoreDuelWithLuaScripts>): void {
  for (const phase of ["battle", "main2", "end"] as const) {
    const action = getLuaRestoreLegalActions(restored, 0).find((candidate) => candidate.type === "changePhase" && candidate.phase === phase);
    expect(action, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restored, action!);
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
