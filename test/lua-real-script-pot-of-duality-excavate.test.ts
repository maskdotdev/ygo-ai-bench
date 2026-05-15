import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getCards, moveDuelCard } from "#duel/card-state.js";
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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Pot of Duality excavate", () => {
  it("restores Pot of Duality's excavate search and Special Summon lock", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const potCode = "98645731";
    const deckCodes = ["980", "981", "982"];
    const procedureCode = "983";
    const responderCode = "984";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === potCode),
      ...deckCodes.map((code, index) => ({ code, name: `Pot of Duality Revealed ${index + 1}`, kind: "monster" as const, typeFlags: 0x1, level: 4 })),
      { code: procedureCode, name: "Pot of Duality Procedure", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Pot of Duality Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 986, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [potCode, ...deckCodes, procedureCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const pot = session.state.cards.find((card) => card.code === potCode);
    const procedure = session.state.cards.find((card) => card.code === procedureCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(pot).toBeDefined();
    expect(procedure).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, pot!.uid, "hand", 0);
    moveDuelCard(session.state, procedure!.uid, "hand", 0);
    moveDuelCard(session.state, responder!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;
    const topDeckUids = getCards(session.state, 0, "deck").map((card) => card.uid);
    expect(topDeckUids).toHaveLength(3);
    const selectedUid = topDeckUids[0]!;
    const remainingUids = topDeckUids.slice(1).sort();

    const source = {
      readScript(name: string) {
        if (name === `c${procedureCode}.lua`) return specialProcedureScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(potCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(procedureCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);
    expect(getLegalActions(session, 0).some((action) => action.type === "specialSummonProcedure" && action.uid === procedure!.uid)).toBe(true);

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
        "id": "chain-2",
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
        "sourceUid": "p0-deck-98645731-0",
        "targetPlayer": 0,
      }
    `);
    expect(session.state.effects.find((effect) => effect.sourceUid === pot!.uid && effect.code === 22)).toMatchObject({
      event: "continuous",
      targetRange: [1, 0],
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.chain).toHaveLength(1);
    expect(restored.session.state.effects.find((effect) => effect.sourceUid === pot!.uid && effect.code === 22)).toMatchObject({
      event: "continuous",
      targetRange: [1, 0],
    });

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === selectedUid)).toMatchObject({ location: "hand", controller: 0 });
    expect(getCards(restored.session.state, 0, "deck").map((card) => card.uid).sort()).toEqual(remainingUids);
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
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "deck",
          position: "faceDown",
          sequence: 0,
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
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 1,
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
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 1,
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
          sequence: 0,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: false,
          location: "hand",
          position: "faceDown",
          sequence: 1,
        },
      },
    ]);
    expect(restored.host.messages).toContain(`confirmed decktop 0: ${topDeckUids.map((uid) => cardsByUid(restored.session)[uid]).join(",")}`);
    expect(restored.host.messages).toContain(`confirmed 1: ${cardsByUid(restored.session)[selectedUid]}`);
    expect(getLegalActions(restored.session, 0).some((action) => action.type === "specialSummonProcedure" && action.uid === procedure!.uid)).toBe(false);
    expect(restored.host.messages).not.toContain("pot of duality responder resolved");
  });
});

function specialProcedureScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetType(EFFECT_TYPE_FIELD)
      e:SetCode(EFFECT_SPSUMMON_PROC)
      e:SetRange(LOCATION_HAND)
      c:RegisterEffect(e)
    end
  `;
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
      e:SetOperation(function(e,tp) Debug.Message("pot of duality responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function cardsByUid(session: DuelSession): Record<string, string> {
  return Object.fromEntries(session.state.cards.map((card) => [card.uid, card.code]));
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups.flatMap((group) => group.actions)).toEqual(response.legalActions);
  return response;
}
