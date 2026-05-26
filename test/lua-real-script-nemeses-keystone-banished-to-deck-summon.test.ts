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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Nemeses Keystone banished to Deck summon", () => {
  it("restores Nemeses Keystone's banished target return to Deck and self Special Summon", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const keystoneCode = "44440058";
    const banishedTargetCode = "44440059";
    const banishedDecoyCode = "44440060";
    const responderCode = "44440061";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === keystoneCode),
      { code: banishedTargetCode, name: "Nemeses Keystone Banished Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1600, defense: 1200 },
      { code: banishedDecoyCode, name: "Nemeses Keystone Banished Decoy", kind: "spell", typeFlags: 0x2 },
      { code: responderCode, name: "Nemeses Keystone Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 444, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [keystoneCode, banishedTargetCode, banishedDecoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const keystone = session.state.cards.find((card) => card.code === keystoneCode);
    const banishedTarget = session.state.cards.find((card) => card.code === banishedTargetCode);
    const banishedDecoy = session.state.cards.find((card) => card.code === banishedDecoyCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(keystone).toBeDefined();
    expect(banishedTarget).toBeDefined();
    expect(banishedDecoy).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, keystone!.uid, "hand", 0);
    moveDuelCard(session.state, banishedTarget!.uid, "banished", 0).faceUp = true;
    moveDuelCard(session.state, banishedDecoy!.uid, "banished", 0).faceUp = true;
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
    expect(host.loadCardScript(Number(keystoneCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const keystoneAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === keystone!.uid);
    expect(keystoneAction, JSON.stringify(getLegalActions(session, 0), null, 2)).toBeDefined();
    applyAndAssert(session, keystoneAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 16,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-44440059-1",
            ],
          },
          {
            "category": 512,
            "count": 1,
            "parameter": 2,
            "player": 0,
            "targetUids": [
              "p0-deck-44440058-0",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-44440058-0",
        "targetFieldIds": [
          6,
        ],
        "targetUids": [
          "p0-deck-44440059-1",
        ],
      }
    `);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x10, targetUids: [banishedTarget!.uid], count: 1, player: 0, parameter: 0 },
      { category: 0x200, targetUids: [keystone!.uid], count: 1, player: 0, parameter: 0x2 },
    ]);

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
        "effectId": "lua-1",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 16,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-44440059-1",
            ],
          },
          {
            "category": 512,
            "count": 1,
            "parameter": 2,
            "player": 0,
            "targetUids": [
              "p0-deck-44440058-0",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-44440058-0",
        "targetFieldIds": [
          6,
        ],
        "targetUids": [
          "p0-deck-44440059-1",
        ],
      }
    `);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x10, targetUids: [banishedTarget!.uid], count: 1, player: 0, parameter: 0 },
      { category: 0x200, targetUids: [keystone!.uid], count: 1, player: 0, parameter: 0x2 },
    ]);

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === keystone!.uid)).toMatchObject({
      controller: 0,
      location: "monsterZone",
      position: "faceUpAttack",
      faceUp: true,
      summonType: "special",
    });
    expect(restored.session.state.cards.find((card) => card.uid === banishedTarget!.uid)).toMatchObject({ location: "deck", controller: 0 });
    expect(restored.session.state.cards.find((card) => card.uid === banishedDecoy!.uid)).toMatchObject({ location: "banished", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => ["specialSummoned", "sentToDeck"].includes(event.eventName))).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: keystone!.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventReasonCardUid: keystone!.uid,
        eventReasonEffectId: 1,
        eventUids: [keystone!.uid],
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "hand",
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
      {
        eventName: "sentToDeck",
        eventCode: 1013,
        eventCardUid: banishedTarget!.uid,
        eventPreviousState: { controller: 0, location: "banished", sequence: 0, position: "faceDown", faceUp: true },
        eventCurrentState: { controller: 0, location: "deck", sequence: 0, position: "faceDown", faceUp: true },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: keystone!.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(restored.host.messages).not.toContain("nemeses keystone responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("nemeses keystone responder resolved") end)
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
}
