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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Dyna Base forced-handler Fusion", () => {
  it("restores a Fusion Summon that must use the activating handler as material", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const dynaBaseCode = "39396763";
    const materialCode = "39396764";
    const decoyMaterialCode = "39396765";
    const fusionCode = "39396766";
    const responderCode = "39396767";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === dynaBaseCode),
      { code: materialCode, name: "Dyna Base Fusion Material Fixture", kind: "monster", typeFlags: 0x21, level: 4, attack: 1200, defense: 1000 },
      { code: decoyMaterialCode, name: "Dyna Base Decoy Material Fixture", kind: "monster", typeFlags: 0x21, level: 4, attack: 1300, defense: 1000 },
      {
        code: fusionCode,
        name: "Dyna Base Forced Handler Fusion Fixture",
        kind: "extra",
        typeFlags: 0x41,
        level: 6,
        attack: 2200,
        defense: 1800,
        fusionMaterials: [dynaBaseCode, materialCode],
      },
      { code: responderCode, name: "Dyna Base Chain Responder", kind: "monster", typeFlags: 0x1, level: 4 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 393, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialCode, decoyMaterialCode, dynaBaseCode], extra: [fusionCode] }, 1: { main: [responderCode] } });
    startDuel(session);

    const dynaBase = session.state.cards.find((card) => card.code === dynaBaseCode);
    const material = session.state.cards.find((card) => card.code === materialCode);
    const decoyMaterial = session.state.cards.find((card) => card.code === decoyMaterialCode);
    const fusion = session.state.cards.find((card) => card.code === fusionCode);
    const responder = session.state.cards.find((card) => card.code === responderCode);
    expect(dynaBase).toBeDefined();
    expect(material).toBeDefined();
    expect(decoyMaterial).toBeDefined();
    expect(fusion).toBeDefined();
    expect(responder).toBeDefined();
    moveDuelCard(session.state, dynaBase!.uid, "monsterZone", 0);
    moveDuelCard(session.state, material!.uid, "hand", 0);
    moveDuelCard(session.state, decoyMaterial!.uid, "hand", 0);
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
    expect(host.loadCardScript(Number(dynaBaseCode), source).ok).toBe(true);
    expect(host.loadCardScript(Number(responderCode), source).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(2);

    const activate = getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === dynaBase!.uid);
    expect(activate).toBeDefined();
    applyAndAssert(session, activate!);
    expect(session.state.chain).toHaveLength(1);

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

    expect(restored.session.state.cards.find((card) => card.uid === fusion!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      position: "faceUpAttack",
      faceUp: true,
      summonType: "fusion",
      summonMaterialUids: [dynaBase!.uid, material!.uid],
    });
    expect(restored.session.state.cards.find((card) => card.uid === dynaBase!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.material | duelReason.fusion,
    });
    expect(restored.session.state.cards.find((card) => card.uid === material!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.effect | duelReason.material | duelReason.fusion,
    });
    expect(restored.session.state.cards.find((card) => card.uid === decoyMaterial!.uid)).toMatchObject({ location: "hand", controller: 0 });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned" && event.eventCardUid === fusion!.uid)).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-extraDeck-39396766-0",
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
          "eventReasonCardUid": "p0-deck-39396763-2",
          "eventReasonEffectId": 2,
          "eventReasonPlayer": 0,
        },
      ]
    `);
    const materialGraveEvents = restored.session.state.eventHistory.filter((event) =>
      event.eventName === "sentToGraveyard"
      && (event.eventCardUid === dynaBase!.uid || event.eventCardUid === material!.uid)
    );
    expect(materialGraveEvents.map((event) => event.eventCardUid).sort()).toEqual([dynaBase!.uid, material!.uid].sort());
    expect(materialGraveEvents).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-deck-39396763-2",
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
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 262216,
          "eventReasonCardUid": "p0-deck-39396763-2",
          "eventReasonEffectId": 2,
          "eventReasonPlayer": 0,
        },
        {
          "eventCardUid": "p0-deck-39396764-0",
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
            "location": "hand",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 262216,
          "eventReasonCardUid": "p0-deck-39396763-2",
          "eventReasonEffectId": 2,
          "eventReasonPlayer": 0,
        },
      ]
    `);
    expect(restored.host.messages).not.toContain("dyna responder resolved");
  });

  it("does not expose the Fusion action when the target cannot use Dyna Base", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const dynaBaseCode = "39396763";
    const materialACode = "39396768";
    const materialBCode = "39396769";
    const fusionCode = "39396770";
    const cards: DuelCardData[] = [
      ...workspace.readDatabaseCards("cards.cdb").filter((card) => card.code === dynaBaseCode),
      { code: materialACode, name: "Dyna Base Non-Handler Material A", kind: "monster", typeFlags: 0x21, level: 4, attack: 1200, defense: 1000 },
      { code: materialBCode, name: "Dyna Base Non-Handler Material B", kind: "monster", typeFlags: 0x21, level: 4, attack: 1300, defense: 1000 },
      {
        code: fusionCode,
        name: "Dyna Base No Handler Fusion Fixture",
        kind: "extra",
        typeFlags: 0x41,
        level: 6,
        attack: 2200,
        defense: 1800,
        fusionMaterials: [materialACode, materialBCode],
      },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 394, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [materialACode, materialBCode, dynaBaseCode], extra: [fusionCode] }, 1: { main: [] } });
    startDuel(session);

    const dynaBase = session.state.cards.find((card) => card.code === dynaBaseCode);
    const materialA = session.state.cards.find((card) => card.code === materialACode);
    const materialB = session.state.cards.find((card) => card.code === materialBCode);
    expect(dynaBase).toBeDefined();
    expect(materialA).toBeDefined();
    expect(materialB).toBeDefined();
    moveDuelCard(session.state, dynaBase!.uid, "monsterZone", 0);
    moveDuelCard(session.state, materialA!.uid, "hand", 0);
    moveDuelCard(session.state, materialB!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(dynaBaseCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    expect(getLegalActions(session, 0).find((action) => action.type === "activateEffect" && action.uid === dynaBase!.uid)).toBeUndefined();
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
      e:SetOperation(function(e,tp) Debug.Message("dyna responder resolved") end)
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
