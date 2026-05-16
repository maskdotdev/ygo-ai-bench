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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script High Ritual Art Deck Ritual stage2", () => {
  it("restores the Deck Ritual Summon and returns the summoned monster during the opponent End Phase", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const highRitualArtCode = "36350300";
    const ritualTargetCode = "36351";
    const normalMaterialCode = "36352";
    const effectDecoyCode = "36353";
    const responderCode = "36354";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === highRitualArtCode),
      { code: ritualTargetCode, name: "High Ritual Art Deck Ritual Fixture", kind: "monster", typeFlags: 0x81, level: 4, attack: 1900, defense: 1200 },
      { code: normalMaterialCode, name: "High Ritual Art Normal Material Fixture", kind: "monster", typeFlags: 0x11, level: 4, attack: 1600, defense: 1000 },
      { code: effectDecoyCode, name: "High Ritual Art Effect Material Decoy", kind: "monster", typeFlags: 0x21, level: 4, attack: 1600, defense: 1000 },
      { code: responderCode, name: "High Ritual Art Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 363, startingHandSize: 0, drawPerTurn: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [highRitualArtCode, ritualTargetCode, normalMaterialCode, effectDecoyCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const highRitualArt = session.state.cards.find((card) => card.code === highRitualArtCode);
    const ritualTarget = session.state.cards.find((card) => card.code === ritualTargetCode);
    const normalMaterial = session.state.cards.find((card) => card.code === normalMaterialCode);
    const effectDecoy = session.state.cards.find((card) => card.code === effectDecoyCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(highRitualArt).toBeDefined();
    expect(ritualTarget).toBeDefined();
    expect(normalMaterial).toBeDefined();
    expect(effectDecoy).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, highRitualArt!.uid, "hand", 0);
    moveDuelCard(session.state, normalMaterial!.uid, "hand", 0);
    moveDuelCard(session.state, effectDecoy!.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(highRitualArtCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === highRitualArt!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
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
            "category": 512,
            "count": 1,
            "parameter": 1,
            "player": 0,
            "targetUids": [],
          },
        ],
        "player": 0,
        "sourceUid": "p0-deck-36350300-0",
      }
    `);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 1)).toEqual(getGroupedDuelLegalActions(restored.session, 1));
    expect(getLuaRestoreLegalActionGroups(restored, 1).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 1));

    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === ritualTarget!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "ritual",
      summonMaterialUids: [normalMaterial!.uid],
    });
    expect(restored.session.state.cards.find((card) => card.uid === normalMaterial!.uid)).toMatchObject({ location: "graveyard", reason: duelReason.material | duelReason.ritual });
    expect(restored.session.state.cards.find((card) => card.uid === effectDecoy!.uid)).toMatchObject({ location: "hand" });
    expect(restored.session.state.cards.find((card) => card.uid === highRitualArt!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    const ritualSummonEvents = restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === ritualTarget!.uid);
    expect(ritualSummonEvents).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-deck-36351-1",
          "eventCode": 1102,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "specialSummoned",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "deck",
            "position": "faceDown",
            "sequence": 3,
          },
          "eventReason": 1050640,
          "eventReasonCardUid": "p0-deck-36350300-0",
          "eventReasonEffectId": 1,
          "eventReasonPlayer": 0,
        },
      ]
    `);
    const materialGraveEvents = restored.session.state.eventHistory.filter((event) => event.eventName === "sentToGraveyard" && event.eventCardUid === normalMaterial!.uid);
    expect(materialGraveEvents).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-deck-36352-2",
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
          "eventReason": 1048584,
          "eventReasonCardUid": "p0-deck-36350300-0",
          "eventReasonEffectId": 1,
          "eventReasonPlayer": 0,
        },
      ]
    `);
    expect(restored.session.state.flagEffects).toContainEqual(expect.objectContaining({ ownerType: "card", ownerId: ritualTarget!.uid, code: Number(highRitualArtCode) }));
    expect(restored.session.state.effects.find((effect) => effect.event === "continuous" && effect.code === 0x1200)).toMatchInlineSnapshot(`
      {
        "canActivate": [Function],
        "code": 4608,
        "controller": 0,
        "cost": [Function],
        "countLimit": 1,
        "event": "continuous",
        "id": "lua-3-4608",
        "luaTypeFlags": 2050,
        "oncePerTurn": true,
        "operation": [Function],
        "ownerPlayer": 0,
        "promptOperation": [Function],
        "property": 128,
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
        "registryKey": "lua:36350300:lua-3-4608",
        "reset": {
          "flags": 1610613248,
        },
        "sourceUid": "p0-deck-36350300-0",
        "target": [Function],
        "triggerCode": 4608,
        "triggerEvent": "phaseEnd",
      }
    `);

    applyAndAssert(restored.session, getLegalActions(restored.session, 0).find((action) => action.type === "endTurn")!);
    expect(restored.session.state.turnPlayer).toBe(1);
    expect(restored.session.state.cards.find((card) => card.uid === ritualTarget!.uid)).toMatchObject({ location: "monsterZone" });

    applyAndAssert(restored.session, getLegalActions(restored.session, 1).find((action) => action.type === "endTurn")!);
    expect(restored.session.state.turnPlayer).toBe(0);
    expect(restored.session.state.cards.find((card) => card.uid === ritualTarget!.uid)).toMatchObject({
      location: "deck",
      controller: 0,
      reason: duelReason.effect,
    });
    expect(restored.session.state.flagEffects).not.toContainEqual(expect.objectContaining({ ownerId: ritualTarget!.uid, code: Number(highRitualArtCode) }));
    expect(restored.host.messages).not.toContain("high ritual art responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("high ritual art responder resolved") end)
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
