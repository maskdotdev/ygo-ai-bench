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
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts, type LuaSnapshotRestoreResult } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Ghost Ogre & Snow Rabbit", () => {
  it("restores its hand response, destroys the related field source, and does not negate that chain link", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const ghostOgreCode = "59438930";
    const targetCode = "920";
    const drawnCode = "921";
    const responderCode = "922";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === ghostOgreCode),
      { code: targetCode, name: "Ghost Ogre Target Effect Monster", kind: "monster", typeFlags: 0x21, level: 4, attack: 1800, defense: 1200 },
      { code: drawnCode, name: "Ghost Ogre Drawn Card", kind: "monster", typeFlags: 0x1, level: 4 },
      { code: responderCode, name: "Ghost Ogre Chain Responder", kind: "monster", typeFlags: 0x21, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 594, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [targetCode, drawnCode, responderCode] }, 1: { main: [ghostOgreCode] } });
    startDuel(session);

    const target = session.state.cards.find((card) => card.code === targetCode);
    const drawn = session.state.cards.find((card) => card.code === drawnCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    const ghostOgre = session.state.cards.find((card) => card.code === ghostOgreCode);
    expect(target).toBeDefined();
    expect(drawn).toBeDefined();
    expect(responder).toBeDefined();
    expect(ghostOgre).toBeDefined();
    moveDuelCard(session.state, target!.uid, "monsterZone", 0);
    target!.position = "faceUpAttack";
    target!.faceUp = true;
    moveDuelCard(session.state, responder!.uid, "hand", 0);
    moveDuelCard(session.state, ghostOgre!.uid, "hand", 1);
    session.state.phase = "main1";
    session.state.turnPlayer = 0;
    session.state.waitingFor = 0;

    const source = {
      readScript(name: string) {
        if (name === `c${targetCode}.lua`) return ghostOgreTargetScript();
        if (name === `c${responderCode}.lua`) return chainResponderScript();
        return workspace.readScript(name);
      },
    };
    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(targetCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(ghostOgreCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(3);

    const targetAction = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === target!.uid);
    expect(targetAction).toBeDefined();
    applyAndAssert(session, targetAction!);
    expect(session.state.chain).toHaveLength(1);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "monsterZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-1",
        "id": "chain-2",
        "operationInfos": [
          {
            "category": 65536,
            "count": 0,
            "parameter": 1,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-920-0",
      }
    `);

    const restoredOpenChain = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restoredOpenChain.restoreComplete, restoredOpenChain.incompleteReasons.join("; ")).toBe(true);
    expect(restoredOpenChain.missingRegistryKeys).toEqual([]);
    expect(restoredOpenChain.missingChainLimitRegistryKeys).toEqual([]);
    expectRestoredLegalActions(restoredOpenChain, 1);
    const ghostOgreAction = getLuaRestoreLegalActions(restoredOpenChain, 1).find((action) => action.type === "activateEffect" && action.uid === ghostOgre!.uid);
    expect(ghostOgreAction).toBeDefined();
    const chained = applyLuaRestoreResponse(restoredOpenChain, ghostOgreAction!);
    expect(chained.ok, chained.error).toBe(true);
    expect(restoredOpenChain.session.state.cards.find((card) => card.uid === ghostOgre!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredOpenChain.session.state.chain).toHaveLength(2);
    expect(restoredOpenChain.session.state.chain[1]).toMatchInlineSnapshot(`
      {
        "activationLocation": "graveyard",
        "activationSequence": 0,
        "chainIndex": 2,
        "effectId": "lua-3-1027",
        "id": "chain-4",
        "operationInfos": [
          {
            "category": 1,
            "count": 1,
            "parameter": 0,
            "player": 0,
            "targetUids": [
              "p0-deck-920-0",
            ],
          },
        ],
        "player": 1,
        "sourceUid": "p1-deck-59438930-0",
      }
    `);

    const restoredPendingResolution = restoreDuelWithLuaScripts(serializeDuel(restoredOpenChain.session), source, reader);
    expect(restoredPendingResolution.restoreComplete, restoredPendingResolution.incompleteReasons.join("; ")).toBe(true);
    expect(restoredPendingResolution.missingRegistryKeys).toEqual([]);
    expect(restoredPendingResolution.missingChainLimitRegistryKeys).toEqual([]);
    const responsePlayer = restoredPendingResolution.session.state.waitingFor;
    expect(responsePlayer).toBeDefined();
    expectRestoredLegalActions(restoredPendingResolution, responsePlayer!);

    resolveOpenChain(restoredPendingResolution);

    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === ghostOgre!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "graveyard" });
    expect(restoredPendingResolution.session.state.cards.find((card) => card.uid === drawn!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restoredPendingResolution.host.messages).toContain("ghost ogre target resolved");
    expect(restoredPendingResolution.host.messages).not.toContain("ghost ogre chain responder resolved");
    expect(
      restoredPendingResolution.session.state.eventHistory.filter((event) => ["destroyed", "cardsDrawn"].includes(event.eventName)),
    ).toEqual([
      {
        eventName: "destroyed",
        eventCode: 1029,
        eventCardUid: target!.uid,
        eventPreviousState: {
          location: "monsterZone",
          controller: 0,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventCurrentState: {
          location: "graveyard",
          controller: 0,
          sequence: 0,
          position: "faceUpAttack",
          faceUp: true,
        },
        eventReason: duelReason.effect | duelReason.destroy,
        eventReasonPlayer: 1,
        eventReasonCardUid: ghostOgre!.uid,
        eventReasonEffectId: 3,
      },
      {
        eventName: "cardsDrawn",
        eventCode: 1110,
        eventCardUid: drawn!.uid,
        eventPlayer: 0,
        eventValue: 1,
        eventPreviousState: {
          location: "deck",
          controller: 0,
          sequence: 2,
          position: "faceDown",
          faceUp: false,
        },
        eventCurrentState: {
          location: "hand",
          controller: 0,
          sequence: 1,
          position: "faceDown",
          faceUp: false,
        },
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: target!.uid,
        eventReasonEffectId: 1,
        eventUids: [drawn!.uid],
      },
    ]);
    expect(restoredPendingResolution.session.state.eventHistory.filter((event) => ["chainNegated", "chainDisabled"].includes(event.eventName))).toEqual([]);
  });
});

function ghostOgreTargetScript(): string {
  return `
    local s,id=GetID()
    function s.initial_effect(c)
      local e=Effect.CreateEffect(c)
      e:SetCategory(CATEGORY_DRAW)
      e:SetType(EFFECT_TYPE_IGNITION)
      e:SetRange(LOCATION_MZONE)
      e:SetTarget(function(e,tp,eg,ep,ev,re,r,rp,chk)
        if chk==0 then return Duel.IsPlayerCanDraw(tp,1) end
        Duel.SetOperationInfo(0,CATEGORY_DRAW,nil,0,tp,1)
      end)
      e:SetOperation(function(e,tp)
        Duel.Draw(tp,1,REASON_EFFECT)
        Debug.Message("ghost ogre target resolved")
      end)
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
      e:SetCondition(function(e,tp) return Duel.GetCurrentChain()>1 end)
      e:SetOperation(function(e,tp) Debug.Message("ghost ogre chain responder resolved") end)
      c:RegisterEffect(e)
    end
  `;
}

function resolveOpenChain(restored: LuaSnapshotRestoreResult): void {
  for (let index = 0; index < 8 && restored.session.state.chain.length > 0; index += 1) {
    const player = restored.session.state.waitingFor;
    expect(player).toBeDefined();
    const pass = getLuaRestoreLegalActions(restored, player!).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const result = applyLuaRestoreResponse(restored, pass!);
    expect(result.ok, result.error).toBe(true);
  }
  expect(restored.session.state.chain).toHaveLength(0);
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
