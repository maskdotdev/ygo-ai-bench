import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getCards, moveDuelCard } from "#duel/card-state.js";
import { applyResponse, createDuel, drawDuelCards, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData, DuelSession } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Pot of Prosperity excavate", () => {
  it("restores Pot of Prosperity's Extra Deck cost, deck-top selection, draw lock, and damage change", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const potCode = "84211599";
    const extraCodes = ["950", "951", "952"];
    const deckCodes = ["953", "954", "955"];
    const attackerCode = "956";
    const responderCode = "957";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === potCode),
      ...extraCodes.map((code, index) => ({ code, name: `Pot of Prosperity Extra ${index + 1}`, kind: "extra" as const, typeFlags: 0x40 })),
      ...deckCodes.map((code, index) => ({ code, name: `Pot of Prosperity Revealed ${index + 1}`, kind: "monster" as const, typeFlags: 0x1, level: 4 })),
      { code: attackerCode, name: "Pot of Prosperity Attacker", kind: "monster", typeFlags: 0x1, level: 4, attack: 1000, defense: 1000 },
      { code: responderCode, name: "Pot of Prosperity Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 476, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [potCode, ...deckCodes, attackerCode], extra: extraCodes }, 1: { main: [responderCode] } });
    startDuel(session);

    const pot = session.state.cards.find((card) => card.code === potCode);
    const attacker = session.state.cards.find((card) => card.code === attackerCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(pot).toBeDefined();
    expect(attacker).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, pot!.uid, "hand", 0);
    moveDuelCard(session.state, attacker!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;
    const topDeckUids = getCards(session.state, 0, "deck").map((card) => card.uid);
    const selectedUid = topDeckUids[0];
    const bottomUids = topDeckUids.slice(1);
    const extraUids = getCards(session.state, 0, "extraDeck").map((card) => card.uid);
    expect(topDeckUids).toHaveLength(3);
    expect(bottomUids).toHaveLength(2);
    expect(extraUids).toHaveLength(3);

    const source = {
      readScript(name: string) {
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(potCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const potAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === pot!.uid);
    expect(potAction).toBeDefined();
    applyAndAssert(session, potAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "effectLabel": 3,
        "id": "chain-5",
        "operationInfos": [
          {
            "category": 8,
            "count": 1,
            "parameter": 1,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-84211599-0",
        "targetPlayer": 0,
      }
    `);
    for (const uid of extraUids) {
      expect(session.state.cards.find((card) => card.uid === uid)).toMatchObject({
        location: "banished",
        controller: 0,
        faceUp: false,
        position: "faceDownDefense",
        reason: 0x80,
      });
    }

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.chain).toHaveLength(1);
    expect(restored.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "effectLabel": 3,
        "id": "chain-5",
        "operationInfos": [
          {
            "category": 8,
            "count": 1,
            "parameter": 1,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-84211599-0",
        "targetPlayer": 0,
      }
    `);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === selectedUid)).toMatchObject({ location: "hand", controller: 0 });
    expect(getCards(restored.session.state, 0, "deck").map((card) => card.uid)).toEqual(bottomUids);
    expect(restored.session.state.cards.find((card) => card.uid === pot!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.eventHistory.filter((event) => ["confirmed", "sentToHandConfirmed"].includes(event.eventName))).toEqual([
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventPlayer: 0,
        eventCardUid: selectedUid,
        eventValue: 3,
        eventUids: topDeckUids,
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
          location: "deck",
          position: "faceDown",
          sequence: 1,
        },
      },
      {
        eventName: "confirmed",
        eventCode: 1211,
        eventPlayer: 1,
        eventCardUid: selectedUid,
        eventValue: 1,
        eventUids: [selectedUid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: pot!.uid,
        eventReasonEffectId: 1,
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
        eventName: "sentToHandConfirmed",
        eventCode: 1212,
        eventPlayer: 1,
        eventCardUid: selectedUid,
        eventValue: 1,
        eventUids: [selectedUid],
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: pot!.uid,
        eventReasonEffectId: 1,
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
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "sentToHand")).toEqual([
      {
        eventName: "sentToHand",
        eventCode: 1012,
        eventCardUid: selectedUid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: pot!.uid,
        eventReasonEffectId: 1,
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
    ]);
    expect(restored.host.messages).toContain(`confirmed decktop 0: ${topDeckUids.map((uid) => cardsByUid(restored.session)[uid]).join(",")}`);
    expect(restored.host.messages).toContain(`confirmed 1: ${cardsByUid(restored.session)[selectedUid!]}`);
    expect(drawDuelCards(restored.session.state, 0, 1, "Blocked prosperity draw")).toBe(0);

    const changeDamage = restored.session.state.effects.find((effect) => effect.sourceUid === pot!.uid && effect.code === 82);
    expect(changeDamage).toMatchObject({ controller: 0, event: "continuous", targetRange: [0, 1] });
    applyAndAssert(restored.session, getLegalActions(restored.session, 0).find((action) => action.type === "changePhase" && action.phase === "battle")!);
    applyAndAssert(restored.session, getLegalActions(restored.session, 0).find((action) => action.type === "declareAttack" && action.attackerUid === attacker!.uid)!);
    passBattleResponses(restored.session);
    expect(restored.session.state.battleDamage[1]).toBe(500);
    expect(restored.session.state.players[1].lifePoints).toBe(7500);
    expect(restored.host.messages).not.toContain("pot of prosperity responder resolved");
  });
});

function chainResponderScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_QUICK_O)
      e:SetCode(EVENT_FREE_CHAIN)
      e:SetRange(LOCATION_HAND)
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>0 end)
      e:SetOperation(function(e,tp) Debug.Message("pot of prosperity responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function cardsByUid(session: DuelSession): Record<string, string> {
  return Object.fromEntries(session.state.cards.map((card) => [card.uid, card.code]));
}

function passBattleResponses(session: DuelSession): void {
  while (session.state.pendingBattle) {
    const player = session.state.waitingFor ?? session.state.turnPlayer;
    const passType = session.state.battleStep === "damage" || session.state.battleStep === "damageCalculation" ? "passDamage" : "passAttack";
    const pass = getLegalActions(session, player).find((candidate) => candidate.type === passType);
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
