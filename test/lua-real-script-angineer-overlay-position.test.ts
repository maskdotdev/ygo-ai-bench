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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Mechquipped Angineer overlay position", () => {
  it("restores Angineer after detaching Xyz material and resolves its protected position change", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const angineerCode = "15914410";
    const materialCode = "1591";
    const targetCode = "1592";
    const responderCode = "1593";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === angineerCode),
      { code: materialCode, name: "Angineer Overlay Material Fixture", kind: "monster", typeFlags: 0x1, level: 3, attack: 800, defense: 800 },
      { code: targetCode, name: "Angineer Position Target Fixture", kind: "monster", typeFlags: 0x1, level: 4, attack: 1700, defense: 1200 },
      { code: responderCode, name: "Angineer Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 159, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode, targetCode], extra: [angineerCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const angineer = session.state.cards.find((card) => card.code === angineerCode);
    const material = session.state.cards.find((card) => card.code === materialCode);
    const target = session.state.cards.find((card) => card.code === targetCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(angineer).toBeDefined();
    expect(material).toBeDefined();
    expect(target).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, angineer!.uid, "monsterZone", 0).position = "faceUpDefense";
    moveDuelCard(session.state, material!.uid, "overlay", 0);
    angineer!.overlayUids.push(material!.uid);
    moveDuelCard(session.state, target!.uid, "monsterZone", 0).position = "faceUpAttack";
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
    expect(host.loadCardScript(Number(angineerCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === angineer!.uid);
    expect(activate).toBeDefined();
    const activated = applyAndAssert(session, activate!);
    expect(activated.state.chain).toHaveLength(1);
    expect(session.state.chain[0]?.operationInfos ?? []).toEqual([]);
    expect(session.state.chain[0]).toMatchInlineSnapshot(`
      {
        "activationLocation": "monsterZone",
        "activationSequence": 0,
        "chainIndex": 1,
        "effectId": "lua-2-1002",
        "id": "chain-3",
        "player": 0,
        "sourceUid": "p0-extraDeck-15914410-0",
        "targetUids": [
          "p0-deck-1592-1",
        ],
      }
    `);
    expect(session.state.cards.find((card) => card.uid === angineer!.uid)?.overlayUids).toEqual([]);
    expect(session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost,
      reasonPlayer: 0,
    });
    expect(session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "monsterZone", position: "faceUpAttack" });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActions(restored, 0)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === target!.uid)).toMatchObject({ location: "monsterZone", position: "faceUpDefense", faceUp: true });
    expect(restored.session.state.cards.find((card) => card.uid === angineer!.uid)).toMatchObject({ location: "monsterZone", position: "faceUpDefense", overlayUids: [] });
    expect(restored.session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({ location: "graveyard", controller: 0, reason: duelReason.cost });
    expect(restored.session.state.positionsChanged).toEqual([target!.uid]);
    expect(restored.session.state.effects.filter((effect) => effect.event === "continuous" && effect.sourceUid === target!.uid && [41, 42].includes(effect.code ?? -1))).toMatchInlineSnapshot(`
      [
        {
          "canActivate": [Function],
          "code": 42,
          "controller": 0,
          "cost": [Function],
          "description": 3008,
          "event": "continuous",
          "id": "lua-4-42",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "property": 67109888,
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:1592:lua-4-42",
          "reset": {
            "flags": 1107169792,
          },
          "sourceUid": "p0-deck-1592-1",
          "target": [Function],
          "value": 1,
        },
        {
          "canActivate": [Function],
          "code": 41,
          "controller": 0,
          "cost": [Function],
          "description": 3008,
          "event": "continuous",
          "id": "lua-5-41",
          "luaTypeFlags": 1,
          "oncePerTurn": false,
          "operation": [Function],
          "promptOperation": [Function],
          "property": 67109888,
          "range": [
            "monsterZone",
          ],
          "registryKey": "lua:1592:lua-5-41",
          "reset": {
            "flags": 1107169792,
          },
          "sourceUid": "p0-deck-1592-1",
          "target": [Function],
          "value": 1,
        },
      ]
    `);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "positionChanged" && event.eventCardUid === target!.uid)).toEqual([
      {
        eventName: "positionChanged",
        eventCode: 1016,
        eventCardUid: target!.uid,
        eventReason: duelReason.effect,
        eventReasonPlayer: 0,
        eventReasonCardUid: angineer!.uid,
        eventReasonEffectId: 2,
        eventPreviousState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpAttack",
          sequence: 1,
        },
        eventCurrentState: {
          controller: 0,
          faceUp: true,
          location: "monsterZone",
          position: "faceUpDefense",
          sequence: 1,
        },
      },
    ]);
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "detachedMaterial" && event.eventCardUid === material!.uid)).toEqual([
      {
        eventName: "detachedMaterial",
        eventCode: 1202,
        eventCardUid: material!.uid,
        eventReason: duelReason.cost,
        eventReasonPlayer: 0,
        eventReasonCardUid: angineer!.uid,
        eventReasonEffectId: 2,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "overlay",
          position: "faceDown",
          sequence: 0,
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
    expect(restored.host.messages).not.toContain("angineer responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("angineer responder resolved") end)
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
