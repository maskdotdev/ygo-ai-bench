import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import { luaSummonTypeSpecial } from "#duel/summon-type-codes.js";
import type { DuelAction, DuelCardData } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Gladiator Beast Andabata contact Fusion", () => {
  it("restores a custom Contact Fusion procedure summon type from the Extra Deck", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const andabataCode = "3779662";
    const specificMaterialCode = "7573135";
    const gladiatorMaterialACode = "3779663";
    const gladiatorMaterialBCode = "3779664";
    const gladiatorFusionTargetCode = "3779665";
    const setGladiator = 0x19;
    const realAndabata = workspace.readDatabaseCards("cards.cdb").find((card) => card.code === andabataCode);
    expect(realAndabata).toBeDefined();
    const cards: DuelCardData[] = [
      {
        ...realAndabata!,
        kind: "extra",
        fusionMaterials: [specificMaterialCode, gladiatorMaterialACode, gladiatorMaterialBCode],
      },
      { code: specificMaterialCode, name: "Gladiator Beast Specific Material Fixture", kind: "monster", typeFlags: 0x21, level: 4, setcodes: [setGladiator], attack: 1800, defense: 1200 },
      { code: gladiatorMaterialACode, name: "Gladiator Beast Material A Fixture", kind: "monster", typeFlags: 0x21, level: 4, setcodes: [setGladiator], attack: 1600, defense: 1200 },
      { code: gladiatorMaterialBCode, name: "Gladiator Beast Material B Fixture", kind: "monster", typeFlags: 0x21, level: 4, setcodes: [setGladiator], attack: 1500, defense: 1000 },
      { code: gladiatorFusionTargetCode, name: "Gladiator Beast Fusion Target Fixture", kind: "extra", typeFlags: 0x61, level: 6, setcodes: [setGladiator], attack: 2100, defense: 1600 },
    ];
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 3779, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [specificMaterialCode, gladiatorMaterialACode, gladiatorMaterialBCode], extra: [andabataCode, gladiatorFusionTargetCode] }, 1: { main: [] } });
    startDuel(session);

    const andabata = session.state.cards.find((card) => card.code === andabataCode);
    const specificMaterial = session.state.cards.find((card) => card.code === specificMaterialCode);
    const gladiatorMaterialA = session.state.cards.find((card) => card.code === gladiatorMaterialACode);
    const gladiatorMaterialB = session.state.cards.find((card) => card.code === gladiatorMaterialBCode);
    expect(andabata).toBeDefined();
    expect(specificMaterial).toBeDefined();
    expect(gladiatorMaterialA).toBeDefined();
    expect(gladiatorMaterialB).toBeDefined();
    moveDuelCard(session.state, specificMaterial!.uid, "monsterZone", 0);
    moveDuelCard(session.state, gladiatorMaterialA!.uid, "monsterZone", 0);
    moveDuelCard(session.state, gladiatorMaterialB!.uid, "monsterZone", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(andabataCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const contact = getLuaRestoreLegalActions(restored, 0).find(
      (action): action is Extract<DuelAction, { type: "specialSummonProcedure" }> => action.type === "specialSummonProcedure" && action.uid === andabata!.uid,
    );
    expect(contact, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();

    const result = applyLuaRestoreResponse(restored, contact!);
    expect(result.ok, result.error).toBe(true);
    expect(restored.session.state.cards.find((card) => card.uid === andabata!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "special",
      summonTypeCode: luaSummonTypeSpecial + 1,
      summonMaterialUids: [specificMaterial!.uid, gladiatorMaterialA!.uid, gladiatorMaterialB!.uid],
    });
    for (const material of [specificMaterial!, gladiatorMaterialA!, gladiatorMaterialB!]) {
      expect(restored.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
        location: "deck",
        controller: 0,
        reason: duelReason.cost | duelReason.material,
      });
    }
    expect(restored.session.state.pendingTriggers.some((trigger) => trigger.sourceUid === andabata!.uid && trigger.eventName === "specialSummoned")).toBe(true);
    expect(getLegalActions(restored.session, 0).some((action) => action.type === "activateTrigger" && action.uid === andabata!.uid)).toBe(true);
    expect(getLegalActions(restored.session, 0).some((action) => action.type === "specialSummonProcedure" && action.uid === andabata!.uid)).toBe(false);
  });
});
