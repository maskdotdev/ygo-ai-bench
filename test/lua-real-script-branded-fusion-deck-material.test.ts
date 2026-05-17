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

function expectRestoredLegalActions(restored: ReturnType<typeof restoreDuelWithLuaScripts>, player: 0 | 1): void {
  expect(getLuaRestoreLegalActions(restored, player)).toEqual(getLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player)).toEqual(getGroupedDuelLegalActions(restored.session, player));
  expect(getLuaRestoreLegalActionGroups(restored, player).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, player));
}

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Branded Fusion deck materials", () => {
  it("restores exact Deck material Fusion Summon with Albaz fcheck and to-Grave operation info", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const brandedFusionCode = "44362883";
    const albazCode = "68468459";
    const materialCode = "4436";
    const fusionCode = "4437";
    const responderCode = "4438";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === brandedFusionCode),
      { code: albazCode, name: "Fallen of Albaz Fixture", kind: "monster", typeFlags: 0x21, level: 4, attack: 1800, defense: 0 },
      { code: materialCode, name: "Branded Fusion Deck Material Fixture", kind: "monster", typeFlags: 0x1, level: 4, attack: 1200, defense: 1000 },
      {
        code: fusionCode,
        name: "Branded Fusion Albaz Target Fixture",
        kind: "extra",
        typeFlags: 0x41,
        level: 8,
        attack: 2500,
        defense: 2000,
        fusionMaterials: [albazCode, materialCode],
      },
      { code: responderCode, name: "Branded Fusion Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 443, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [brandedFusionCode, albazCode, materialCode], extra: [fusionCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const brandedFusion = session.state.cards.find((card) => card.code === brandedFusionCode);
    const albaz = session.state.cards.find((card) => card.code === albazCode);
    const material = session.state.cards.find((card) => card.code === materialCode);
    const fusion = session.state.cards.find((card) => card.code === fusionCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(brandedFusion).toBeDefined();
    expect(albaz).toBeDefined();
    expect(material).toBeDefined();
    expect(fusion).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, brandedFusion!.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(brandedFusionCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === brandedFusion!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);
    const chainLink = session.state.chain[0]!;
    expect(chainLink.operationInfos).toEqual([
      { category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 },
      { category: 0x20, targetUids: [], count: 0, player: 0, parameter: 0x7 },
    ]);
    expect(session.state.effects.find((effect) => effect.sourceUid === brandedFusion!.uid && effect.code === 22)).toMatchObject({
      event: "continuous",
      luaTargetDescriptor: "special-summon-limit:non-fusion-extra",
      targetRange: [1, 0],
    });
    expect(session.state.effects.find((effect) => effect.sourceUid === brandedFusion!.uid && effect.code === 51476410)).toMatchObject({
      event: "continuous",
      value: 1,
    });

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), source, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expectRestoredLegalActions(restored, 1);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    const restoredChainLink = restored.session.state.chain[0]!;
    expect(restoredChainLink.operationInfos).toEqual([
      { category: 0x200, targetUids: [], count: 1, player: 0, parameter: 0x40 },
      { category: 0x20, targetUids: [], count: 0, player: 0, parameter: 0x7 },
    ]);
    expect(restored.session.state.effects.find((effect) => effect.sourceUid === brandedFusion!.uid && effect.code === 22)).toMatchObject({
      event: "continuous",
      luaTargetDescriptor: "special-summon-limit:non-fusion-extra",
      targetRange: [1, 0],
    });
    expect(restored.session.state.effects.find((effect) => effect.sourceUid === brandedFusion!.uid && effect.code === 51476410)).toMatchObject({
      event: "continuous",
      value: 1,
    });
    const pass = getLuaRestoreLegalActions(restored, 1).find((action) => action.type === "passChain");
    expect(pass).toBeDefined();
    const resolved = applyLuaRestoreResponse(restored, pass!);
    expect(resolved.ok, resolved.error).toBe(true);

    expect(restored.session.state.cards.find((card) => card.uid === fusion!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "fusion",
      summonMaterialUids: [albaz!.uid, material!.uid],
    });
    expect(restored.session.state.cards.find((card) => card.uid === albaz!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.material | duelReason.fusion,
    });
    expect(restored.session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.material | duelReason.fusion,
    });
    expect(restored.session.state.cards.find((card) => card.uid === brandedFusion!.uid)).toMatchObject({ location: "graveyard", controller: 0 });
    const fusionSummonEvents = restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === fusion!.uid);
    expect(fusionSummonEvents).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-extraDeck-4437-0",
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
            "location": "extraDeck",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 264208,
          "eventReasonCardUid": "p0-deck-44362883-0",
          "eventReasonEffectId": 1,
          "eventReasonPlayer": 0,
        },
      ]
    `);
    const materialGraveEvents = restored.session.state.eventHistory.filter((event) =>
      event.eventName === "sentToGraveyard"
      && (event.eventCardUid === albaz!.uid || event.eventCardUid === material!.uid)
    );
    expect(materialGraveEvents.map((event) => event.eventCardUid).sort()).toEqual([albaz!.uid, material!.uid].sort());
    expect(materialGraveEvents).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-deck-68468459-1",
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
            "location": "deck",
            "position": "faceDown",
            "sequence": 2,
          },
          "eventReason": 262216,
          "eventReasonCardUid": "p0-deck-44362883-0",
          "eventReasonEffectId": 1,
          "eventReasonPlayer": 0,
        },
        {
          "eventCardUid": "p0-deck-4436-2",
          "eventCode": 1014,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "graveyard",
            "position": "faceDown",
            "sequence": 1,
          },
          "eventName": "sentToGraveyard",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": false,
            "location": "deck",
            "position": "faceDown",
            "sequence": 1,
          },
          "eventReason": 262216,
          "eventReasonCardUid": "p0-deck-44362883-0",
          "eventReasonEffectId": 1,
          "eventReasonPlayer": 0,
        },
      ]
    `);
    expect(restored.host.messages).not.toContain("branded fusion responder resolved");
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
      e:SetOperation(function(e,tp) Debug.Message("branded fusion responder resolved") end)
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
