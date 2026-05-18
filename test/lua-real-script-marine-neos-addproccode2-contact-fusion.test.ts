import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { moveDuelCard } from "#duel/card-state.js";
import { createDuel, getGroupedDuelLegalActions, getLegalActions, loadDecks, serializeDuel, startDuel } from "#duel/core.js";
import { duelReason } from "#duel/reasons.js";
import type { DuelAction } from "#duel/types.js";
import { createCardReader, createUpstreamSourceConfig } from "#engine/data-loaders.js";
import { createUpstreamNodeWorkspace } from "#engine/upstream-node.js";
import { createLuaScriptHost } from "#lua/host.js";
import { applyLuaRestoreResponse, getLuaRestoreLegalActionGroups, getLuaRestoreLegalActions, restoreDuelWithLuaScripts } from "#lua/snapshot.js";

const upstreamRoot = path.resolve(".upstream/ignis");
const hasUpstreamScripts = fs.existsSync(path.join(upstreamRoot, "script"));
const hasUpstreamDatabase = fs.existsSync(path.join(upstreamRoot, "cdb", "cards.cdb"));

describe.skipIf(!hasUpstreamScripts || !hasUpstreamDatabase)("Lua real script Elemental HERO Marine Neos Fusion.AddProcCode2 contact Fusion", () => {
  it("restores Fusion.AddProcCode2 exact material metadata and contact summons Marine Neos", () => {
    const workspace = createUpstreamNodeWorkspace(createUpstreamSourceConfig(upstreamRoot));
    const marineNeosCode = "5128859";
    const neosCode = "89943723";
    const marineDolphinCode = "78734254";
    const wantedCodes = [marineNeosCode, neosCode, marineDolphinCode];
    const cards = workspace.readDatabaseCards("cards.cdb").filter((card) => wantedCodes.includes(card.code));
    expect(cards.map((card) => card.code).sort()).toEqual([...wantedCodes].sort());
    const reader = createCardReader(cards);
    const session = createDuel({ seed: 5128859, startingHandSize: 0, cardReader: reader });
    loadDecks(session, { 0: { main: [neosCode, marineDolphinCode], extra: [marineNeosCode] }, 1: { main: [] } });
    startDuel(session);

    const marineNeos = session.state.cards.find((card) => card.code === marineNeosCode);
    const neos = session.state.cards.find((card) => card.code === neosCode);
    const marineDolphin = session.state.cards.find((card) => card.code === marineDolphinCode);
    expect(marineNeos).toBeDefined();
    expect(neos).toBeDefined();
    expect(marineDolphin).toBeDefined();
    moveDuelCard(session.state, neos!.uid, "monsterZone", 0);
    moveDuelCard(session.state, marineDolphin!.uid, "monsterZone", 0);
    session.state.phase = "main1";
    session.state.waitingFor = 0;

    const host = createLuaScriptHost(session, workspace);
    expect(host.loadCardScript(Number(marineNeosCode), workspace).ok).toBe(true);
    expect(host.registerInitialEffects()).toBe(1);
    expect(marineNeos!.data.fusionMaterials).toEqual([neosCode, marineDolphinCode]);

    const restored = restoreDuelWithLuaScripts(serializeDuel(session), workspace, reader);
    expect(restored.restoreComplete, restored.incompleteReasons.join("; ")).toBe(true);
    expect(restored.missingRegistryKeys).toEqual([]);
    expect(restored.missingChainLimitRegistryKeys).toEqual([]);
    expect(restored.session.state.cards.find((card) => card.uid === marineNeos!.uid)?.data.fusionMaterials).toEqual([neosCode, marineDolphinCode]);
    expect(getLuaRestoreLegalActionGroups(restored, 0)).toEqual(getGroupedDuelLegalActions(restored.session, 0));
    expect(getLuaRestoreLegalActionGroups(restored, 0).flatMap((group) => group.actions)).toEqual(getLuaRestoreLegalActions(restored, 0));
    const contact = getLuaRestoreLegalActions(restored, 0).find(
      (action): action is Extract<DuelAction, { type: "specialSummonProcedure" }> => action.type === "specialSummonProcedure" && action.uid === marineNeos!.uid,
    );
    expect(contact, JSON.stringify(getLuaRestoreLegalActions(restored, 0), null, 2)).toBeDefined();

    const result = applyLuaRestoreResponse(restored, contact!);
    expect(result.ok, result.error).toBe(true);
    expect(result.legalActions).toEqual(getLegalActions(restored.session, result.state.waitingFor!));
    expect(result.legalActionGroups).toEqual(getGroupedDuelLegalActions(restored.session, result.state.waitingFor!));
    expect(result.legalActionGroups.flatMap((group) => group.actions)).toEqual(result.legalActions);
    expect(restored.session.state.cards.find((card) => card.uid === marineNeos!.uid)).toMatchObject({
      location: "monsterZone",
      controller: 0,
      faceUp: true,
      position: "faceUpAttack",
      summonType: "fusion",
      summonMaterialUids: [neos!.uid, marineDolphin!.uid],
    });
    for (const material of [neos!, marineDolphin!]) {
      expect(restored.session.state.cards.find((card) => card.uid === material.uid)).toMatchObject({
        location: "deck",
        controller: 0,
        reason: duelReason.cost | duelReason.material,
      });
    }
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "specialSummoned")).toEqual([
      {
        eventName: "specialSummoned",
        eventCode: 1102,
        eventCardUid: marineNeos!.uid,
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
    expect(restored.session.state.eventHistory.filter((event) => event.eventName === "sentToDeck").map((event) => event.eventCardUid).sort()).toEqual([
      neos!.uid,
      neos!.uid,
      marineDolphin!.uid,
    ].sort());
    expect(getLegalActions(restored.session, 0).some((action) => action.type === "specialSummonProcedure" && action.uid === marineNeos!.uid)).toBe(false);
  });
});
