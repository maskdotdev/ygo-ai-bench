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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script The Fabled Cerburrel discard trigger self summon", () => {
  it("restores mandatory discard-to-Graveyard trigger and self Special Summon chain", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const cardDestructionCode = "72892473";
    const cerburrelCode = "82888408";
    const ownDrawCode = "82888409";
    const opponentDiscardCode = "82888410";
    const preChainResponderCode = "82888411";
    const postDrawResponderCode = "82888412";
    const opponentDrawCode = "82888413";
    const cerburrelScript = workspace.readScript(`c${cerburrelCode}.lua`);
    expect(cerburrelScript).toContain("e1:SetType(EFFECT_TYPE_SINGLE+EFFECT_TYPE_TRIGGER_F)");
    expect(cerburrelScript).toContain("e1:SetCode(EVENT_TO_GRAVE)");
    expect(cerburrelScript).toContain("e:GetHandler():IsPreviousLocation(LOCATION_HAND) and (r&REASON_DISCARD)~=0");
    expect(cerburrelScript).toContain("Duel.SetOperationInfo(0,CATEGORY_SPECIAL_SUMMON,e:GetHandler(),1,0,0)");
    expect(cerburrelScript).toContain("Duel.SpecialSummon(e:GetHandler(),0,tp,tp,false,false,POS_FACEUP)");
    const cardDestructionScript = workspace.readScript(`c${cardDestructionCode}.lua`);
    expect(cardDestructionScript).toContain("Duel.SendtoGrave(g,REASON_EFFECT|REASON_DISCARD)");

    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => [cardDestructionCode, cerburrelCode].includes(card.code)),
      { code: ownDrawCode, name: "Cerburrel Draw Filler", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: opponentDiscardCode, name: "Cerburrel Opponent Discard", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: preChainResponderCode, name: "Cerburrel Pre-Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: postDrawResponderCode, name: "Cerburrel Drawn Chain Responder", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
      { code: opponentDrawCode, name: "Cerburrel Opponent Draw Filler", kind: "monster", typeFlags: typeMonster, level: 4, attack: 1000, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 82888408, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [cardDestructionCode, cerburrelCode, ownDrawCode] },
      1: { main: [opponentDiscardCode, preChainResponderCode, postDrawResponderCode, opponentDrawCode] },
    });
    startDuel(session);

    const cardDestruction = requireCard(session, cardDestructionCode);
    const cerburrel = requireCard(session, cerburrelCode);
    const ownDraw = requireCard(session, ownDrawCode);
    const opponentDiscard = requireCard(session, opponentDiscardCode);
    const preChainResponder = requireCard(session, preChainResponderCode);
    const postDrawResponder = requireCard(session, postDrawResponderCode);
    moveDuelCard(session.state, cardDestruction.uid, "hand", 0);
    moveDuelCard(session.state, cerburrel.uid, "hand", 0);
    moveDuelCard(session.state, opponentDiscard.uid, "hand", 1);
    moveDuelCard(session.state, preChainResponder.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${preChainResponderCode}.lua` || name === `c${postDrawResponderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(cardDestructionCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(cerburrelCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(preChainResponderCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(postDrawResponderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(4);

    const cardDestructionAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === cardDestruction.uid);
    expect(cardDestructionAction, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, cardDestructionAction!);
    expect(session.state.chain).toHaveLength(1);

    const restoredCardDestructionChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredCardDestructionChain.restoreComplete, restoredCardDestructionChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredCardDestructionChain.missingRegistryKeys).toEqual([]);
    expect(restoredCardDestructionChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredCardDestructionChain, 1);
    passChain(restoredCardDestructionChain);

    expect(restoredCardDestructionChain.session.state.cards.find((card) => card.uid === cerburrel.uid)).toMatchObject({
      location: "graveyard",
      reason: duelReason.effect | duelReason.discard,
      reasonPlayer: 0,
      reasonCardUid: cardDestruction.uid,
    });
    expect(restoredCardDestructionChain.session.state.cards.find((card) => card.uid === ownDraw.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredCardDestructionChain.session.state.cards.find((card) => card.uid === opponentDiscard.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredCardDestructionChain.session.state.cards.find((card) => card.uid === preChainResponder.uid)).toMatchObject({ location: "graveyard", controller: 1 });
    expect(restoredCardDestructionChain.session.state.cards.find((card) => card.uid === postDrawResponder.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredCardDestructionChain.session.state.eventHistory.filter((event) => event.eventName === "discarded" && event.eventCardUid === cerburrel.uid)).toEqual([
      {
        eventName: "discarded",
        eventCode: 1018,
        eventCardUid: cerburrel.uid,
        eventReason: duelReason.effect | duelReason.discard,
        eventReasonPlayer: 0,
        eventReasonCardUid: cardDestruction.uid,
        eventReasonEffectId: 1,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "graveyard",
          position: "faceDown",
          sequence: 0,
        },
      },
    ]);
    expect(restoredCardDestructionChain.session.state.pendingTriggers).toMatchInlineSnapshot(`
      [
        {
          "effectId": "lua-2-1014",
          "eventCardUid": "p0-deck-82888408-1",
          "eventCode": 1014,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "graveyard",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventName": "sentToGraveyard",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "hand",
            "position": "faceDown",
            "sequence": 1,
          },
          "eventReason": 16448,
          "eventReasonCardUid": "p0-deck-72892473-0",
          "eventReasonEffectId": 1,
          "eventReasonPlayer": 0,
          "eventTriggerTiming": "when",
          "eventUids": [
            "p0-deck-82888408-1",
            "p1-deck-82888410-0",
            "p1-deck-82888411-1",
          ],
          "id": "trigger-6-1",
          "player": 0,
          "sourceUid": "p0-deck-82888408-1",
          "triggerBucket": "turnMandatory",
        },
      ]
    `);

    const restoredTriggerWindow = restoreDuelWithLuaScripts(serializeDuel(restoredCardDestructionChain.session), source, reader);
    expect(restoredTriggerWindow.restoreComplete, restoredTriggerWindow.incompleteReasons.join("; ")).toBe(true);
    expect(restoredTriggerWindow.missingRegistryKeys).toEqual([]);
    expect(restoredTriggerWindow.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredTriggerWindow, 0);
    const trigger = getLuaRestoreLegalActions(restoredTriggerWindow, 0).find((action) => action.type === "activateTrigger" && action.uid === cerburrel.uid);
    expect(trigger, JSON.stringify(getLuaRestoreLegalActions(restoredTriggerWindow, 0), null, 2)).toBeDefined();
    applyRestoredActionAndAssert(restoredTriggerWindow, trigger!);

    expect(restoredTriggerWindow.session.state.chain).toHaveLength(1);
    expect(restoredTriggerWindow.session.state.chain[0]).toEqual({
      activationLocation: "graveyard",
      activationSequence: 0,
      chainIndex: 1,
      effectId: "lua-2-1014",
      eventCardUid: cerburrel.uid,
      eventCode: 1014,
      eventCurrentState: {
        controller: 0,
        faceUp: true,
        location: "graveyard",
        position: "faceDown",
        sequence: 0,
      },
      eventName: "sentToGraveyard",
      eventPreviousState: {
        controller: 0,
        faceUp: false,
        location: "hand",
        position: "faceDown",
        sequence: 1,
      },
      eventReason: duelReason.effect | duelReason.discard,
      eventReasonCardUid: cardDestruction.uid,
      eventReasonEffectId: 1,
      eventReasonPlayer: 0,
      eventTriggerTiming: "when",
      eventUids: [cerburrel.uid, opponentDiscard.uid, preChainResponder.uid],
      id: "chain-12",
      operationInfos: [{ category: 0x200, targetUids: [cerburrel.uid], count: 1, player: 0, parameter: 0 }],
      player: 0,
      sourceUid: cerburrel.uid,
    });

    const restoredSummonChain = restoreDuelWithLuaScripts(serializeDuel(restoredTriggerWindow.session), source, reader);
    expect(restoredSummonChain.restoreComplete, restoredSummonChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredSummonChain.missingRegistryKeys).toEqual([]);
    expect(restoredSummonChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredSummonChain, 1);
    expect(getLuaRestoreLegalActions(restoredSummonChain, 1).some((action) => action.type === "activateEffect" && action.uid === postDrawResponder.uid)).toBe(true);
    passChain(restoredSummonChain);

    expect(restoredSummonChain.session.state.chain).toHaveLength(0);
    expect(restoredSummonChain.session.state.cards.find((card) => card.uid === cerburrel.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      sequence: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
    });
    expect(restoredSummonChain.session.state.cards.find((card) => card.uid === postDrawResponder.uid)).toMatchObject({ location: "hand", controller: 1 });
    expect(restoredSummonChain.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === cerburrel.uid)).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: cerburrel.uid,
        eventUids: [cerburrel.uid],
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: cerburrel.uid,
        eventReasonEffectId: 2,
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
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 0,
        },
      },
    ]);
    expect(restoredSummonChain.host.messages).not.toContain("cerburrel responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("cerburrel responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
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
    expect(pass).toBeDefined();
    applyRestoredActionAndAssert(restored, pass!);
  }
}

function applyRestoredActionAndAssert(restored: ReturnType<typeof restoreDuelWithLuaScripts>, action: DuelAction): void {
  const result = applyLuaRestoreResponse(restored, action);
  expect(result.ok, result.error).toBe(true);
  expect(result.legalActions).toEqual(getLegalActions(restored.session, result.state.waitingFor!));
  expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, result.state.waitingFor!));
  expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
}
