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

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Lady's Dragonmaid contact Fusion", () => {
  it("restores a Contact Fusion procedure that banishes selected field and Graveyard materials", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const ladysDragonmaidCode = "48658295";
    const fieldMaterialCode = "48658296";
    const graveMaterialCode = "48658297";
    const setDragonmaid = 0x133;
    const realLadysDragonmaid = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === ladysDragonmaidCode);
    expect(realLadysDragonmaid).toBeDefined();
    const cards: DuelCardData[] = [
      {
        ...realLadysDragonmaid!,
        kind: "extra",
        fusionMaterials: [fieldMaterialCode, graveMaterialCode],
      },
      { code: fieldMaterialCode, name: "Lady's Dragonmaid Field Material Fixture", kind: "monster", typeFlags: 0x21, level: 3, attribute: 0x10, setcodes: [setDragonmaid], attack: 1200, defense: 1000 },
      { code: graveMaterialCode, name: "Lady's Dragonmaid Grave Material Fixture", kind: "monster", typeFlags: 0x21, level: 8, attribute: 0x10, setcodes: [setDragonmaid], attack: 2600, defense: 1800 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 4865, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [fieldMaterialCode, graveMaterialCode], extra: [ladysDragonmaidCode] }, 1: { main: [] } });
    startDuel(session);

    const ladysDragonmaid = session.state.cards.find((card) => card.code === ladysDragonmaidCode);
    const fieldMaterial = session.state.cards.find((card) => card.code === fieldMaterialCode);
    const graveMaterial = session.state.cards.find((card) => card.code === graveMaterialCode);
    expect(ladysDragonmaid).toBeDefined();
    expect(fieldMaterial).toBeDefined();
    expect(graveMaterial).toBeDefined();
    moveDuelCard(session.state, fieldMaterial!.uid, "monsterZone", 0);
    moveDuelCard(session.state, graveMaterial!.uid, "graveyard", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(ladysDragonmaidCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const contact = getLuaRestoreLegalActions(restored, 0).find(
      (action): action is Extract<DuelAction, { type: "specialSummonProcedure" }> => action.type === "specialSummonProcedure" && action.uid === ladysDragonmaid!.uid,
    );
    expect(contact, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();

    const result = applyLuaRestoreResponse(restored, contact!);
    expect(result.ok, result.error).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === ladysDragonmaid!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "fusion",
      summonMaterialUids: [fieldMaterial!.uid, graveMaterial!.uid],
    });
    expect(restored.session.state.cards.find((card) => card.uid === fieldMaterial!.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost | duelReason.material,
    });
    expect(restored.session.state.cards.find((card) => card.uid === graveMaterial!.uid)).toMatchObject({
      location: "banished",
      controller: 0,
      faceUp: true,
      reason: duelReason.cost | duelReason.material,
    });
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: ladysDragonmaid!.uid,
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
    const materialBanishEvents = restored.session.state.eventHistory.filter((event) =>
      event.eventName === "banished"
      && (event.eventCardUid === fieldMaterial!.uid || event.eventCardUid === graveMaterial!.uid)
    );
    expect(materialBanishEvents.map((event) => event.eventCardUid).sort()).toEqual([fieldMaterial!.uid, fieldMaterial!.uid, graveMaterial!.uid].sort());
    expect(materialBanishEvents).toMatchInlineSnapshot(`
      [
        {
          "eventCardUid": "p0-deck-48658296-0",
          "eventCode": 1011,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "banished",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventName": "banished",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 136,
          "eventReasonCardUid": "p0-extraDeck-48658295-0",
          "eventReasonEffectId": 2,
          "eventReasonPlayer": 0,
        },
        {
          "eventCardUid": "p0-deck-48658297-1",
          "eventCode": 1011,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "banished",
            "position": "faceDown",
            "sequence": 1,
          },
          "eventName": "banished",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": true,
            "location": "graveyard",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 136,
          "eventReasonCardUid": "p0-extraDeck-48658295-0",
          "eventReasonEffectId": 2,
          "eventReasonPlayer": 0,
        },
        {
          "eventCardUid": "p0-deck-48658296-0",
          "eventCode": 1011,
          "eventCurrentState": {
            "controller": 0,
            "faceUp": true,
            "location": "banished",
            "position": "faceUpAttack",
            "sequence": 0,
          },
          "eventName": "banished",
          "eventPreviousState": {
            "controller": 0,
            "faceUp": true,
            "location": "monsterZone",
            "position": "faceDown",
            "sequence": 0,
          },
          "eventReason": 136,
          "eventReasonCardUid": "p0-extraDeck-48658295-0",
          "eventReasonEffectId": 2,
          "eventReasonPlayer": 0,
          "eventUids": [
            "p0-deck-48658296-0",
            "p0-deck-48658297-1",
          ],
        },
      ]
    `);
    expect(getLegalActions(restored.session, 0).some((action) => action.type === "specialSummonProcedure" && action.uid === ladysDragonmaid!.uid)).toBe(false);
  });
});
