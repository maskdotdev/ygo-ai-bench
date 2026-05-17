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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Lightning Vortex discard group destroy", () => {
  it("restores Lightning Vortex's discard cost and face-up opponent monster group destroy", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const lightningVortexCode = "69162969";
    const discardCode = "69162970";
    const ownMonsterCode = "69162971";
    const opponentFaceupAttackCode = "69162972";
    const opponentFaceupDefenseCode = "69162973";
    const opponentFacedownCode = "69162974";
    const responderCode = "69162975";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === lightningVortexCode),
      { code: discardCode, name: "Lightning Vortex Discard Cost", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: ownMonsterCode, name: "Lightning Vortex Ally", kind: "monster", typeFlags: 0x1, level: 4, attack: 1400, defense: 1200 },
      { code: opponentFaceupAttackCode, name: "Lightning Vortex Attack Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 1800, defense: 1000 },
      { code: opponentFaceupDefenseCode, name: "Lightning Vortex Defense Target", kind: "monster", typeFlags: 0x1, level: 4, attack: 800, defense: 2000 },
      { code: opponentFacedownCode, name: "Lightning Vortex Facedown Survivor", kind: "monster", typeFlags: 0x1, level: 4, attack: 1600, defense: 1600 },
      { code: responderCode, name: "Lightning Vortex Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 691, startingHandSize: 0, cardReader: reader });
    loadDecks(session, {
      0: { main: [lightningVortexCode, discardCode, ownMonsterCode] },
      1: { main: [opponentFaceupAttackCode, opponentFaceupDefenseCode, opponentFacedownCode, responderCode] },
    });
    startDuel(session);

    const lightningVortex = session.state.cards.find((card) => card.code === lightningVortexCode);
    const discard = session.state.cards.find((card) => card.code === discardCode);
    const ownMonster = session.state.cards.find((card) => card.code === ownMonsterCode);
    const opponentFaceupAttack = session.state.cards.find((card) => card.code === opponentFaceupAttackCode);
    const opponentFaceupDefense = session.state.cards.find((card) => card.code === opponentFaceupDefenseCode);
    const opponentFacedown = session.state.cards.find((card) => card.code === opponentFacedownCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(lightningVortex).toBeDefined();
    expect(discard).toBeDefined();
    expect(ownMonster).toBeDefined();
    expect(opponentFaceupAttack).toBeDefined();
    expect(opponentFaceupDefense).toBeDefined();
    expect(opponentFacedown).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, lightningVortex!.uid, "hand", 0);
    moveDuelCard(session.state, discard!.uid, "hand", 0);
    moveDuelCard(session.state, ownMonster!.uid, "monsterZone", 0).position = "faceUpAttack";
    moveDuelCard(session.state, opponentFaceupAttack!.uid, "monsterZone", 1).position = "faceUpAttack";
    moveDuelCard(session.state, opponentFaceupDefense!.uid, "monsterZone", 1).position = "faceUpDefense";
    moveDuelCard(session.state, opponentFacedown!.uid, "monsterZone", 1).position = "faceDownDefense";
    opponentFacedown!.faceUp = false;
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
    expect(host.loadCardScript(Number(lightningVortexCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const lightningVortexAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === lightningVortex!.uid);
    expect(lightningVortexAction).toBeDefined();
    applyAndAssert(session, lightningVortexAction!);
    expect(session.state.cards.find((card) => card.uid === discard!.uid)).toMatchObject({ location: "graveyard" });
    const discardEvent = {
      eventName: "discarded",
      eventCode: 1018,
      eventCardUid: discard!.uid,
      eventReason: duelReason.cost | duelReason.discard,
      eventReasonPlayer: 0,
      eventReasonCardUid: lightningVortex!.uid,
      eventReasonEffectId: 1,
      eventPreviousState: { controller: 0, location: "hand", sequence: 1, position: "faceDown", faceUp: false },
      eventCurrentState: { controller: 0, location: "graveyard", sequence: 0, position: "faceDown", faceUp: true },
    };
    expect(session.state.eventHistory.filter((event) => event.eventName === "discarded")).toEqual([discardEvent]);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-3",
        "operationInfos": [
          {
            "category": 1,
            "count": 2,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p1-deck-69162972-0",
              "p1-deck-69162973-1",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-69162969-0",
      }
    `);
    expect(session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x1, targetUids: [opponentFaceupAttack!.uid, opponentFaceupDefense!.uid], count: 2, player: 0, parameter: 0 },
    ]);
    expect(sortedUids(session.state.chain[0]!.operationInfos?.[0]?.targetUids ?? [])).toEqual(sortedUids([opponentFaceupAttack!.uid, opponentFaceupDefense!.uid]));

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === discard!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "discarded")).toEqual([discardEvent]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));
    expect(restored.session.state.chain).toHaveLength(1);
    expect(restored.session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "hand",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1-1002",
        "id": "chain-3",
        "operationInfos": [
          {
            "category": 1,
            "count": 2,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p1-deck-69162972-0",
              "p1-deck-69162973-1",
            ],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-69162969-0",
      }
    `);
    expect(restored.session.state.chain[0]?.operationInfos).toEqual([
      { category: 0x1, targetUids: [opponentFaceupAttack!.uid, opponentFaceupDefense!.uid], count: 2, player: 0, parameter: 0 },
    ]);
    expect(sortedUids(restored.session.state.chain[0]!.operationInfos?.[0]?.targetUids ?? [])).toEqual(sortedUids([opponentFaceupAttack!.uid, opponentFaceupDefense!.uid]));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === lightningVortex!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === ownMonster!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentFaceupAttack!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentFaceupDefense!.uid)).toMatchObject({ location: "graveyard" });
    expect(restored.session.state.cards.find((card) => card.uid === opponentFacedown!.uid)).toMatchObject({ location: "monsterZone" });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "destroyed")).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: opponentFaceupAttack!.uid,
        eventPreviousState: {
          location: "monsterZone",
          controller: 1,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 1,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: lightningVortex!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: opponentFaceupDefense!.uid,
        eventPreviousState: {
          location: "monsterZone",
          controller: 1,
          sequence: 1,
          position: "faceUpDefense",
          faceUp: true,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 1,
          sequence: 1,
          position: "faceUpDefense",
          faceUp: true,
        },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: lightningVortex!.uid,
        eventReasonEffectId: 1,
      },
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: opponentFaceupAttack!.uid,
        eventUids: [opponentFaceupAttack!.uid, opponentFaceupDefense!.uid],
        eventPreviousState: {
          location: "monsterZone",
          controller: 1,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 1,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 0,
        eventReasonCardUid: lightningVortex!.uid,
        eventReasonEffectId: 1,
      },
    ]);
    expect(restored.host.messages).not.toContain("lightning vortex responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("lightning vortex responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function sortedUids(uids: string[]): string[] {
  return [...uids].sort();
}

function applyAndAssert(session: DuelSession, action: DuelAction) {
  const response = applyResponse(session, action);
  expect(response.ok, response.error).toBe(true);
  expect(response.legalActions).toEqual(getLegalActions(session, response.state.waitingFor!));
  expect(response.legalActionGroups).toEqual(getGroupedDuelLegalActions(session, response.state.waitingFor!));
}
