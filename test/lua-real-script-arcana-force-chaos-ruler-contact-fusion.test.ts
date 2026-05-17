import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Arcana Force EX - The Chaos Ruler contact Fusion", () => {
  it("restores a Contact Fusion procedure that sends an opponent field material to its Graveyard", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const chaosRulerCode = "12686296";
    const ownMaterialACode = "12686297";
    const ownMaterialBCode = "12686298";
    const opponentMaterialCode = "12686299";
    const setArcanaForce = 0x5;
    const realChaosRuler = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === chaosRulerCode);
    expect(realChaosRuler).toBeDefined();
    const cards: DuelCardData[] = [
      {
        ...realChaosRuler!,
        kind: "extra",
        fusionMaterials: [ownMaterialACode, ownMaterialBCode, opponentMaterialCode],
      },
      { code: ownMaterialACode, name: "Arcana Force Own Material A Fixture", kind: "monster", typeFlags: 0x21, level: 4, setcodes: [setArcanaForce], attack: 1200, defense: 1000 },
      { code: ownMaterialBCode, name: "Arcana Force Own Material B Fixture", kind: "monster", typeFlags: 0x21, level: 5, setcodes: [setArcanaForce], attack: 1600, defense: 1200 },
      { code: opponentMaterialCode, name: "Arcana Force Opponent Material Fixture", kind: "monster", typeFlags: 0x21, level: 6, setcodes: [setArcanaForce], attack: 2100, defense: 1400 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 1268, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [ownMaterialACode, ownMaterialBCode], extra: [chaosRulerCode] }, 1: { main: [opponentMaterialCode] } });
    startDuel(session);

    const chaosRuler = session.state.cards.find((card) => card.code === chaosRulerCode);
    const ownMaterialA = session.state.cards.find((card) => card.code === ownMaterialACode);
    const ownMaterialB = session.state.cards.find((card) => card.code === ownMaterialBCode);
    const opponentMaterial = session.state.cards.find((card) => card.code === opponentMaterialCode);
    expect(chaosRuler).toBeDefined();
    expect(ownMaterialA).toBeDefined();
    expect(ownMaterialB).toBeDefined();
    expect(opponentMaterial).toBeDefined();
    moveDuelCard(session.state, ownMaterialA!.uid, "monsterZone", 0);
    moveDuelCard(session.state, ownMaterialB!.uid, "monsterZone", 0);
    moveDuelCard(session.state, opponentMaterial!.uid, "monsterZone", 1);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(chaosRulerCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const contact = getLuaRestoreLegalActions(restored, 0).find(
      (action): action is Extract<DuelAction, { type: "specialSummonProcedure" }> => action.type === "specialSummonProcedure" && action.uid === chaosRuler!.uid,
    );
    expect(contact, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();

    const result = applyLuaRestoreResponse(restored, contact!);
    expect(result.ok, result.error).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === chaosRuler!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "fusion",
      summonMaterialUids: [ownMaterialA!.uid, ownMaterialB!.uid, opponentMaterial!.uid],
    });
    expect(restored.session.state.cards.find((card) => card.uid === ownMaterialA!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.material,
    });
    expect(restored.session.state.cards.find((card) => card.uid === ownMaterialB!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.material,
    });
    expect(restored.session.state.cards.find((card) => card.uid === opponentMaterial!.uid)).toMatchObject({
      location: "graveyard",
      controller: 1,
      reason: duelReason.cost | duelReason.material,
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: chaosRuler!.uid,
        eventReason: duelReason.summon | duelReason.specialSummon,
        eventReasonPlayer: 0,
        eventPreviousState: {
          controller: 0,
          faceUp: false,
          location: "extraDeck",
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
    const materialGraveEvents = restored.session.state.eventHistory.filter((event) =>
      event.eventName === "sentToGraveyard"
      && (event.eventCardUid === ownMaterialA!.uid || event.eventCardUid === ownMaterialB!.uid || event.eventCardUid === opponentMaterial!.uid)
    );
    expect(materialGraveEvents.map((event) => event.eventCardUid).sort()).toEqual([ownMaterialA!.uid, ownMaterialA!.uid, ownMaterialB!.uid, opponentMaterial!.uid].sort());
    expect(materialGraveEvents).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-deck-12686297-0",
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
          "eventReason": 136,
          "eventReasonCardUid": "p0-extraDeck-12686296-0",
          "eventReasonEffectId": 2,
          "eventReasonPlayer": 0,
        },
        {
          "eventCardUid": "p0-deck-12686298-1",
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
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceDown",
            "sequence": 1,
          },
          "eventReason": 136,
          "eventReasonCardUid": "p0-extraDeck-12686296-0",
          "eventReasonEffectId": 2,
          "eventReasonPlayer": 0,
        },
        {
          "eventCardUid": "p1-deck-12686299-0",
          "eventCode": 1014,
          "eventCurrentState": {
            "controller": 1,
            "faceUp": true,
            "location": "graveyard",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventName": "sentToGraveyard",
          "eventPreviousState": {
            "controller": 1,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 136,
          "eventReasonCardUid": "p0-extraDeck-12686296-0",
          "eventReasonEffectId": 2,
          "eventReasonPlayer": 0,
        },
        {
          "eventCardUid": "p0-deck-12686297-0",
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
          "eventReason": 136,
          "eventReasonCardUid": "p0-extraDeck-12686296-0",
          "eventReasonEffectId": 2,
          "eventReasonPlayer": 0,
          "eventUids": [
            "p0-deck-12686297-0",
            "p0-deck-12686298-1",
            "p1-deck-12686299-0",
          ],
        },
      ]
    `);
    expect(getLegalActions(restored.session, 0).some((action) => action.type === "specialSummonProcedure" && action.uid === chaosRuler!.uid)).toBe(false);
  });
});
