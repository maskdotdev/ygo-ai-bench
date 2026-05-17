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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Necroquip Princess contact Fusion", () => {
  it("restores a Contact Fusion procedure that sends selected materials as cost", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const necroquipCode = "93860227";
    const equippedMaterialCode = "93860228";
    const fiendMaterialCode = "93860229";
    const realNecroquip = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === necroquipCode);
    expect(realNecroquip).toBeDefined();
    const cards: DuelCardData[] = [
      {
        ...realNecroquip!,
        kind: "extra",
        fusionMaterials: [equippedMaterialCode, fiendMaterialCode],
      },
      { code: equippedMaterialCode, name: "Necroquip Equipped Material Fixture", kind: "monster", typeFlags: 0x21, level: 4, race: 0x1, attack: 1400, defense: 1000 },
      { code: fiendMaterialCode, name: "Necroquip Fiend Material Fixture", kind: "monster", typeFlags: 0x21, level: 4, race: 0x8, attack: 1200, defense: 1000 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 938, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [equippedMaterialCode, fiendMaterialCode], extra: [necroquipCode] }, 1: { main: [] } });
    startDuel(session);

    const necroquip = session.state.cards.find((card) => card.code === necroquipCode);
    const equippedMaterial = session.state.cards.find((card) => card.code === equippedMaterialCode);
    const fiendMaterial = session.state.cards.find((card) => card.code === fiendMaterialCode);
    expect(necroquip).toBeDefined();
    expect(equippedMaterial).toBeDefined();
    expect(fiendMaterial).toBeDefined();
    moveDuelCard(session.state, equippedMaterial!.uid, "hand", 0);
    moveDuelCard(session.state, fiendMaterial!.uid, "hand", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(necroquipCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const contact = getLuaRestoreLegalActions(restored, 0).find(
      (action): action is Extract<DuelAction, { type: "specialSummonProcedure" }> => action.type === "specialSummonProcedure" && action.uid === necroquip!.uid,
    );
    expect(contact, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();

    const result = applyLuaRestoreResponse(restored, contact!);
    expect(result.ok, result.error).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === necroquip!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "fusion",
      summonMaterialUids: [equippedMaterial!.uid, fiendMaterial!.uid],
    });
    expect(restored.session.state.cards.find((card) => card.uid === equippedMaterial!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.material,
    });
    expect(restored.session.state.cards.find((card) => card.uid === fiendMaterial!.uid)).toMatchObject({
      location: "graveyard",
      controller: 0,
      reason: duelReason.cost | duelReason.material,
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: necroquip!.uid,
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
      && (event.eventCardUid === equippedMaterial!.uid || event.eventCardUid === fiendMaterial!.uid)
    );
    expect(materialGraveEvents.map((event) => event.eventCardUid).sort()).toEqual([equippedMaterial!.uid, equippedMaterial!.uid, fiendMaterial!.uid].sort());
    expect(materialGraveEvents).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-deck-93860228-0",
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
            "sequence": 0,
          },
          "eventReason": 136,
          "eventReasonCardUid": "p0-extraDeck-93860227-0",
          "eventReasonEffectId": 2,
          "eventReasonPlayer": 0,
        },
        {
          "eventCardUid": "p0-deck-93860229-1",
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
            "sequence": 1,
          },
          "eventReason": 136,
          "eventReasonCardUid": "p0-extraDeck-93860227-0",
          "eventReasonEffectId": 2,
          "eventReasonPlayer": 0,
        },
        {
          "eventCardUid": "p0-deck-93860228-0",
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
            "sequence": 0,
          },
          "eventReason": 136,
          "eventReasonCardUid": "p0-extraDeck-93860227-0",
          "eventReasonEffectId": 2,
          "eventReasonPlayer": 0,
          "eventUids": [
            "p0-deck-93860228-0",
            "p0-deck-93860229-1",
          ],
        },
      ]
    `);
    expect(getLegalActions(restored.session, 0).some((action) => action.type === "specialSummonProcedure" && action.uid === necroquip!.uid)).toBe(false);
  });
});
